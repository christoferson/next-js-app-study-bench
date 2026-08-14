import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import { GenerationRunNotFoundError } from "@/modules/ai-generation/domain/errors";
import type {
  GeneratedItemKind,
  GenerationRun,
  GenerationRunId,
} from "@/modules/ai-generation/domain/generation-run";
import type {
  GenerationRunCriteria,
  GenerationRunItemCounts,
  GenerationRunPage,
  GenerationRunRepository,
} from "@/modules/ai-generation/ports/generation-run-repository";
import type { GenerationRunRow } from "./rows";
import { serializeSnapshotIds, serializeUsage, toGenerationRun } from "./rows";

const RUN_COLUMNS = `id, certification_id, item_kind, generation_mode,
  model_provider, model_id, persona_id, persona_version, prompt_template_id,
  prompt_template_version, input_hash, selected_source_snapshot_ids,
  requested_item_count, successful_item_count, failed_item_count,
  usage_metadata, failure_reason, started_at, completed_at, status`;

/**
 * SQLite-backed generation-run persistence.
 *
 * Two writes only: `create` inserts a `PENDING` run before the provider is called,
 * and `complete` records the outcome. There is no method that edits a completed run
 * and none that deletes one, because a run is the explanation of where bank content
 * came from.
 *
 * Item counts and identifiers are read from whichever bank table the run's own
 * `itemKind` names, so a question run can never report card identifiers.
 */
export class SqliteGenerationRunRepository implements GenerationRunRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async findById(id: GenerationRunId): Promise<GenerationRun | null> {
    const row = this.database
      .prepare(`SELECT ${RUN_COLUMNS} FROM generation_runs WHERE id = ?`)
      .get(id) as GenerationRunRow | undefined;

    return row === undefined ? null : toGenerationRun(row);
  }

  /**
   * Bounded run history, newest first.
   *
   * `started_at` descending with the identifier breaking ties, so two runs started
   * in the same millisecond still page deterministically.
   */
  async list(criteria: GenerationRunCriteria): Promise<GenerationRunPage> {
    const rows = this.database
      .prepare(
        `SELECT ${RUN_COLUMNS} FROM generation_runs
         WHERE certification_id = ?
         ORDER BY started_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(
        criteria.certificationId,
        criteria.limit,
        criteria.offset,
      ) as GenerationRunRow[];

    const counted = this.database
      .prepare(
        `SELECT COUNT(*) AS total FROM generation_runs WHERE certification_id = ?`,
      )
      .get(criteria.certificationId) as { readonly total: number };

    return {
      items: rows.map(toGenerationRun),
      totalCount: counted.total,
      limit: criteria.limit,
      offset: criteria.offset,
    };
  }

  /**
   * The most recent run of one track with the same fingerprint that produced
   * something.
   *
   * A failed run left no content, so asking for the same batch again is not a
   * repeat and must not be warned about (`SPEC.md` section 11.6).
   */
  async findLatestByInputHash(
    certificationId: CertificationId,
    inputHash: string,
    itemKind: GeneratedItemKind,
  ): Promise<GenerationRun | null> {
    const row = this.database
      .prepare(
        `SELECT ${RUN_COLUMNS} FROM generation_runs
         WHERE certification_id = ?
           AND input_hash = ?
           AND item_kind = ?
           AND status IN ('COMPLETED', 'PARTIAL')
         ORDER BY started_at DESC, id DESC
         LIMIT 1`,
      )
      .get(certificationId, inputHash, itemKind) as
      GenerationRunRow | undefined;

    return row === undefined ? null : toGenerationRun(row);
  }

  async create(run: GenerationRun): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO generation_runs (id, certification_id, item_kind,
           generation_mode, model_provider, model_id, persona_id,
           persona_version, prompt_template_id, prompt_template_version,
           input_hash, selected_source_snapshot_ids, requested_item_count,
           successful_item_count, failed_item_count, usage_metadata,
           failure_reason, started_at, completed_at, status)
         VALUES (@id, @certificationId, @itemKind, @generationMode,
           @modelProvider, @modelId, @personaId, @personaVersion,
           @promptTemplateId, @promptTemplateVersion, @inputHash,
           @selectedSourceSnapshotIds, @requestedItemCount,
           @successfulItemCount, @failedItemCount, @usageMetadata,
           @failureReason, @startedAt, @completedAt, @status)`,
      )
      .run({
        id: run.id,
        certificationId: run.certificationId,
        itemKind: run.itemKind,
        generationMode: run.generationMode,
        modelProvider: run.modelProvider,
        modelId: run.modelId,
        personaId: run.personaId,
        personaVersion: run.personaVersion,
        promptTemplateId: run.promptTemplateId,
        promptTemplateVersion: run.promptTemplateVersion,
        inputHash: run.inputHash,
        selectedSourceSnapshotIds: serializeSnapshotIds(
          run.selectedSourceSnapshotIds,
        ),
        requestedItemCount: run.requestedItemCount,
        successfulItemCount: run.successfulItemCount,
        failedItemCount: run.failedItemCount,
        usageMetadata: serializeUsage(run.usageMetadata),
        failureReason: run.failureReason,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        status: run.status,
      });
  }

  /**
   * Records the outcome of a finished run.
   *
   * Only the outcome columns are written. Identity, provenance, and the request
   * fingerprint were fixed when the run was created, so re-writing them here would
   * let a completion silently change what the run says it was.
   */
  async complete(run: GenerationRun): Promise<void> {
    const result = this.database
      .prepare(
        `UPDATE generation_runs
         SET successful_item_count = @successfulItemCount,
             failed_item_count = @failedItemCount,
             usage_metadata = @usageMetadata,
             failure_reason = @failureReason,
             completed_at = @completedAt,
             status = @status
         WHERE id = @id`,
      )
      .run({
        id: run.id,
        successfulItemCount: run.successfulItemCount,
        failedItemCount: run.failedItemCount,
        usageMetadata: serializeUsage(run.usageMetadata),
        failureReason: run.failureReason,
        completedAt: run.completedAt,
        status: run.status,
      });

    if (result.changes === 0) {
      throw new GenerationRunNotFoundError(run.id);
    }
  }

  async countItems(id: GenerationRunId): Promise<GenerationRunItemCounts> {
    const run = await this.findById(id);

    if (run === null) {
      throw new GenerationRunNotFoundError(id);
    }

    const source = itemSourceFor(run.itemKind);
    const row = this.database
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN lifecycle_status = 'DRAFT' THEN 1 ELSE 0 END) AS draft,
           SUM(CASE WHEN lifecycle_status = 'ACTIVE' THEN 1 ELSE 0 END) AS active
         FROM ${source.table}
         WHERE ${source.condition}`,
      )
      .get(id) as {
      readonly total: number;
      readonly draft: number | null;
      readonly active: number | null;
    };

    return {
      total: row.total,
      // `SUM` over no rows is NULL in SQLite, which is zero of them.
      draft: row.draft ?? 0,
      active: row.active ?? 0,
    };
  }

  async listItemIds(id: GenerationRunId): Promise<readonly string[]> {
    const run = await this.findById(id);

    if (run === null) {
      throw new GenerationRunNotFoundError(id);
    }

    const source = itemSourceFor(run.itemKind);
    const rows = this.database
      .prepare(
        `SELECT id FROM ${source.table}
         WHERE ${source.condition}
         ORDER BY created_at ASC, id ASC`,
      )
      .all(id) as { readonly id: string }[];

    return rows.map((row) => row.id);
  }
}

/**
 * Where a run's items are found: the bank table, and how a row belongs to the run.
 *
 * Both halves are fixed literals chosen by an exhaustive switch, so the strings
 * interpolated into the statements above can only ever be one of three constant
 * pairs and no caller value reaches the SQL text.
 *
 * The third pair is the interesting one. An enrichment run creates no cards, so
 * `flashcards.generation_run_id` does not name it — that column still records what
 * *created* each card. The run's mark is on the revisions it appended, so the cards
 * it touched are reached through those. Every column the two queries need
 * (`id`, `created_at`, `lifecycle_status`) is on `flashcards` either way, which is
 * why the subquery form fits both without a second shape.
 */
function itemSourceFor(kind: GeneratedItemKind): {
  readonly table: "questions" | "flashcards";
  readonly condition: string;
} {
  switch (kind) {
    case "QUESTION":
      return { table: "questions", condition: "generation_run_id = ?" };
    case "FLASHCARD":
      return { table: "flashcards", condition: "generation_run_id = ?" };
    case "ENRICH_VOCABULARY":
      return {
        table: "flashcards",
        condition: `id IN (SELECT flashcard_id FROM flashcard_revisions
             WHERE generation_run_id = ?)`,
      };
  }
}
