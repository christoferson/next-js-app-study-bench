import { z } from "zod";
import type {
  GenerationFailureCategory,
  GeneratedItemKind,
  GenerationRun,
  GenerationRunStatus,
  ProviderUsage,
} from "@/modules/ai-generation/domain/generation-run";
import {
  GENERATED_ITEM_KINDS,
  GENERATION_FAILURE_CATEGORIES,
  GENERATION_RUN_STATUSES,
} from "@/modules/ai-generation/domain/generation-run";
import type { GenerationMode } from "@/modules/question-bank/domain/question";
import { GENERATION_MODES } from "@/modules/question-bank/domain/question";

/**
 * Row mapping for the `generation_runs` table.
 *
 * The database is an external boundary, so stored values are validated on the way
 * out rather than cast (`spec/CODING-STANDARDS.md` section 2). Three columns hold
 * JSON — the source snapshot list, the token counts, and nothing else — and each is
 * parsed through a schema so a hand-edited local database fails loudly instead of
 * feeding a lie into the domain.
 *
 * `usage_metadata` is only ever token counts. Nothing derived from credentials,
 * request signing, or account identity is written here (`SPEC.md` section 10.3), so
 * the schema refuses any other shape rather than passing extra keys through.
 */

export interface GenerationRunRow {
  readonly id: string;
  readonly certification_id: string;
  readonly item_kind: string;
  readonly generation_mode: string;
  readonly model_provider: string;
  readonly model_id: string;
  readonly persona_id: string;
  readonly persona_version: number;
  readonly prompt_template_id: string;
  readonly prompt_template_version: number;
  readonly input_hash: string;
  readonly selected_source_snapshot_ids: string;
  readonly requested_item_count: number;
  readonly successful_item_count: number;
  readonly failed_item_count: number;
  readonly usage_metadata: string | null;
  readonly failure_reason: string | null;
  readonly proposed_payload: string | null;
  readonly applied_at: string | null;
  readonly subject_question_id: string | null;
  readonly subject_revision_id: string | null;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly status: string;
}

const snapshotIdsSchema = z.array(z.string().min(1));

/**
 * Token counts as stored.
 *
 * `strict` rather than permissive: an unexpected key in this column would mean
 * something other than token counts was written into run metadata, which is the
 * one thing `SPEC.md` section 10.3 forbids. Failing is the correct response.
 */
const usageSchema = z
  .object({
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0),
  })
  .strict();

export function toGenerationRun(row: GenerationRunRow): GenerationRun {
  const status = toRunStatus(row.status);

  return {
    id: row.id,
    certificationId: row.certification_id,
    itemKind: toItemKind(row.item_kind),
    generationMode: toGenerationMode(row.generation_mode),
    modelProvider: row.model_provider,
    modelId: row.model_id,
    personaId: row.persona_id,
    personaVersion: row.persona_version,
    promptTemplateId: row.prompt_template_id,
    promptTemplateVersion: row.prompt_template_version,
    inputHash: row.input_hash,
    selectedSourceSnapshotIds: parseSnapshotIds(
      row.id,
      row.selected_source_snapshot_ids,
    ),
    requestedItemCount: row.requested_item_count,
    successfulItemCount: row.successful_item_count,
    failedItemCount: row.failed_item_count,
    usageMetadata: parseUsage(row.id, row.usage_metadata),
    failureReason:
      row.failure_reason === null
        ? null
        : toFailureCategory(row.id, row.failure_reason),
    // Carried across as text and validated by the application when it needs the tree
    // (`application/objective-import-schema.ts`). Parsing it here would put a
    // proposal's shape in the row mapper for every kind of run, including the three
    // that never propose anything.
    proposedPayload: row.proposed_payload,
    appliedAt: row.applied_at,
    // Nullable in the row and nullable in the domain: the columns are `ON DELETE SET
    // NULL`, so a review of a question the owner has since deleted keeps its findings
    // and loses only the link. Reads must not assume a review still has its subject.
    subjectQuestionId: row.subject_question_id,
    subjectRevisionId: row.subject_revision_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status,
  };
}

export function serializeSnapshotIds(ids: readonly string[]): string {
  return JSON.stringify(ids);
}

export function serializeUsage(usage: ProviderUsage | null): string | null {
  return usage === null ? null : JSON.stringify(usage);
}

function parseSnapshotIds(runId: string, payload: string): readonly string[] {
  const result = snapshotIdsSchema.safeParse(readJson(runId, payload));

  if (!result.success) {
    throw new Error(
      `Stored generation run ${runId} has an unsupported source snapshot list.`,
    );
  }

  return result.data;
}

function parseUsage(
  runId: string,
  payload: string | null,
): ProviderUsage | null {
  if (payload === null) {
    return null;
  }

  const result = usageSchema.safeParse(readJson(runId, payload));

  if (!result.success) {
    throw new Error(
      `Stored generation run ${runId} has unsupported usage metadata.`,
    );
  }

  return result.data;
}

function readJson(runId: string, payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    throw new Error(`Stored generation run ${runId} holds invalid JSON.`);
  }
}

function toItemKind(value: string): GeneratedItemKind {
  const kind = GENERATED_ITEM_KINDS.find((candidate) => candidate === value);

  if (kind === undefined) {
    throw new Error(`Unsupported stored generated item kind: ${value}`);
  }

  return kind;
}

function toRunStatus(value: string): GenerationRunStatus {
  const status = GENERATION_RUN_STATUSES.find(
    (candidate) => candidate === value,
  );

  if (status === undefined) {
    throw new Error(`Unsupported stored generation run status: ${value}`);
  }

  return status;
}

function toGenerationMode(value: string): GenerationMode {
  const mode = GENERATION_MODES.find((candidate) => candidate === value);

  if (mode === undefined) {
    throw new Error(`Unsupported stored generation mode: ${value}`);
  }

  return mode;
}

/**
 * A stored failure category.
 *
 * Unknown values fail rather than falling back to `UNEXPECTED`: the column is
 * written only from the closed category list, so an unrecognised value means the
 * row was not written by this application.
 */
function toFailureCategory(
  runId: string,
  value: string,
): GenerationFailureCategory {
  const category = GENERATION_FAILURE_CATEGORIES.find(
    (candidate) => candidate === value,
  );

  if (category === undefined) {
    throw new Error(
      `Stored generation run ${runId} has an unsupported failure reason: ${value}`,
    );
  }

  return category;
}
