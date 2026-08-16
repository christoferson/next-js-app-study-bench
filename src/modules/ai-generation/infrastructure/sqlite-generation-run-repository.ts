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
  usage_metadata, failure_reason, proposed_payload, applied_at,
  subject_question_id, subject_revision_id, started_at,
  completed_at, status`;

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

  /**
   * The newest completed review of one question.
   *
   * Filtered on `item_kind` as well as on the subject column, and that filter is now
   * load-bearing rather than defensive: tutor runs set the same subject column, so without
   * it the findings panel would show a tutor's explanation as a review.
   */
  async findLatestReviewForQuestion(
    questionId: string,
  ): Promise<GenerationRun | null> {
    const row = this.database
      .prepare(
        `SELECT ${RUN_COLUMNS} FROM generation_runs
         WHERE subject_question_id = ?
           AND item_kind = 'QUESTION_REVIEW'
           AND status = 'COMPLETED'
         ORDER BY started_at DESC, id DESC
         LIMIT 1`,
      )
      .get(questionId) as GenerationRunRow | undefined;

    return row === undefined ? null : toGenerationRun(row);
  }

  /**
   * The newest completed tutor exchanges about one question.
   *
   * Same index as the review query — `(subject_question_id, started_at)` — and the same
   * two conditions plus a limit. `started_at DESC, id DESC` rather than `started_at`
   * alone because two asks about the same question can land in the same second on a fast
   * machine, and a list the owner reads must have a stable order.
   */
  async listTutorExchangesForQuestion(
    questionId: string,
    limit: number,
  ): Promise<readonly GenerationRun[]> {
    const rows = this.database
      .prepare(
        `SELECT ${RUN_COLUMNS} FROM generation_runs
         WHERE subject_question_id = ?
           AND item_kind = 'TUTOR_EXPLANATION'
           AND status = 'COMPLETED'
         ORDER BY started_at DESC, id DESC
         LIMIT ?`,
      )
      .all(questionId, Math.max(1, limit)) as GenerationRunRow[];

    return rows.map(toGenerationRun);
  }

  /**
   * The newest completed challenge of one question.
   *
   * Same index and same three conditions as the review query, with a different kind. The
   * `item_kind` filter is what keeps a challenge out of the findings panel and a review
   * out of the challenge panel, now that four kinds of run set the same subject column.
   */
  async findLatestChallengeForQuestion(
    questionId: string,
  ): Promise<GenerationRun | null> {
    const row = this.database
      .prepare(
        `SELECT ${RUN_COLUMNS} FROM generation_runs
         WHERE subject_question_id = ?
           AND item_kind = 'QUESTION_CHALLENGE'
           AND status = 'COMPLETED'
         ORDER BY started_at DESC, id DESC
         LIMIT 1`,
      )
      .get(questionId) as GenerationRunRow | undefined;

    return row === undefined ? null : toGenerationRun(row);
  }

  /**
   * The newest completed source check of one question.
   *
   * The fifth query on the same `(subject_question_id, started_at)` index, with the same
   * three conditions and a different kind. By now the `item_kind` filter is the only thing
   * keeping five kinds of run out of each other's panels.
   */
  async findLatestSourceVerificationForQuestion(
    questionId: string,
  ): Promise<GenerationRun | null> {
    const row = this.database
      .prepare(
        `SELECT ${RUN_COLUMNS} FROM generation_runs
         WHERE subject_question_id = ?
           AND item_kind = 'SOURCE_VERIFICATION'
           AND status = 'COMPLETED'
         ORDER BY started_at DESC, id DESC
         LIMIT 1`,
      )
      .get(questionId) as GenerationRunRow | undefined;

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
           failure_reason, proposed_payload, applied_at,
           subject_question_id, subject_revision_id, started_at,
           completed_at, status)
         VALUES (@id, @certificationId, @itemKind, @generationMode,
           @modelProvider, @modelId, @personaId, @personaVersion,
           @promptTemplateId, @promptTemplateVersion, @inputHash,
           @selectedSourceSnapshotIds, @requestedItemCount,
           @successfulItemCount, @failedItemCount, @usageMetadata,
           @failureReason, @proposedPayload, @appliedAt,
           @subjectQuestionId, @subjectRevisionId, @startedAt,
           @completedAt, @status)`,
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
        proposedPayload: run.proposedPayload,
        appliedAt: run.appliedAt,
        // Written at creation and never on completion: which question a review is about
        // is part of the request, not of the outcome, so it is recorded before the model
        // is called and a failed review still says what it was looking at.
        subjectQuestionId: run.subjectQuestionId,
        subjectRevisionId: run.subjectRevisionId,
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
             proposed_payload = @proposedPayload,
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
        // Written on completion because that is when a proposal exists: the PENDING
        // row is created before the model is called. `applied_at` is deliberately not
        // here — applying happens later, by the owner, through `markApplied`.
        proposedPayload: run.proposedPayload,
        completedAt: run.completedAt,
        status: run.status,
      });

    if (result.changes === 0) {
      throw new GenerationRunNotFoundError(run.id);
    }
  }

  /**
   * Claims a proposal, or reports that it was already claimed.
   *
   * The guard is the `applied_at IS NULL` in the statement, not a read followed by a
   * write: a conditional `UPDATE` is atomic, so two tabs that both post Apply produce
   * one row change and one zero, and the loser is refused. Checking first and updating
   * second would let both pass the check.
   *
   * Returns whether the claim succeeded rather than throwing, because "already applied"
   * is an ordinary answer the facade turns into an owner-facing message, and the
   * repository has no business deciding how that reads.
   */
  async markApplied(id: GenerationRunId, appliedAt: string): Promise<boolean> {
    const result = this.database
      .prepare(
        `UPDATE generation_runs
         SET applied_at = ?
         WHERE id = ? AND applied_at IS NULL AND proposed_payload IS NOT NULL`,
      )
      .run(appliedAt, id);

    return result.changes === 1;
  }

  async countItems(id: GenerationRunId): Promise<GenerationRunItemCounts> {
    const run = await this.findById(id);

    if (run === null) {
      throw new GenerationRunNotFoundError(id);
    }

    const source = itemSourceFor(run.itemKind);

    if (source === null) {
      return { total: 0, draft: 0, active: 0 };
    }

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

    if (source === null) {
      return [];
    }

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
 *
 * `null` is the fourth answer and means "this kind of run has no bank items at all".
 * An objective-import run proposes objectives, which are the track's outline rather
 * than bank content, and they are inserted by the owner's own Apply rather than by the
 * run — so there is no table to look in and no query to run.
 */
function itemSourceFor(kind: GeneratedItemKind): {
  readonly table: "questions" | "flashcards";
  readonly condition: string;
} | null {
  switch (kind) {
    case "OBJECTIVE_IMPORT":
    // A review creates nothing either. It is *about* one question, which is recorded on
    // the run's own `subject_question_id` rather than found by searching the bank —
    // counting it as an item of the run would claim the run produced a question.
    case "QUESTION_REVIEW":
    // Nor does a tutor answer, for the same reason plus a stronger one: its follow-up
    // question is deliberately never written to the bank, so there is no row anywhere that
    // this run produced.
    case "TUTOR_EXPLANATION":
    // Nor does a grading: its subject is an answer the owner typed, which lives on the
    // attempt rather than in the bank, and the grading writes nothing at all.
    case "ANSWER_EVALUATION":
    // Nor does a challenge. Its outcome may say a revision is needed, but the revision is
    // the owner's own edit, so no row anywhere belongs to this run.
    case "QUESTION_CHALLENGE":
    // Nor does a source check. It reads one question and some of the owner's own passages
    // and writes nothing; the quality status it may lead to is set by the owner's accept.
    case "SOURCE_VERIFICATION":
      return null;
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
