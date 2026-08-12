import { z } from "zod";
import type {
  GenerationMode,
  Question,
  QuestionContent,
  QuestionLifecycleStatus,
  QuestionQualityStatus,
  QuestionRevision,
  QuestionType,
} from "@/modules/question-bank/domain/question";
import {
  GENERATION_MODES,
  QUESTION_LIFECYCLE_STATUSES,
  QUESTION_QUALITY_STATUSES,
  QUESTION_TYPES,
} from "@/modules/question-bank/domain/question";

/**
 * Row mapping for the SQLite question tables.
 *
 * The database is an external boundary, so stored values are validated on the
 * way out rather than cast (`spec/CODING-STANDARDS.md` section 2). That matters
 * most for `content_payload`: it is JSON, and a payload that no longer matches
 * the discriminated union — after a hand-edited local database, or a future
 * schema change applied without a data migration — must fail loudly instead of
 * flowing into the domain as a lie.
 */

export interface QuestionRow {
  readonly id: string;
  readonly certification_id: string;
  readonly current_revision_id: string | null;
  readonly lifecycle_status: string;
  readonly quality_status: string;
  readonly generation_mode: string;
  readonly generation_run_id: string | null;
  readonly dispute_reason: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface QuestionRevisionRow {
  readonly id: string;
  readonly question_id: string;
  readonly revision_number: number;
  readonly stem: string;
  readonly instructions: string | null;
  readonly question_type: string;
  readonly content_payload: string;
  readonly explanation: string | null;
  readonly difficulty: number | null;
  readonly tags: string;
  readonly language: string | null;
  readonly created_at: string;
}

const choiceSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});

/**
 * Persisted shape of `QuestionContent`.
 *
 * A discriminated union in the schema too, so the stored `type` selects the
 * required fields instead of every field being optional.
 */
const contentSchema: z.ZodType<QuestionContent> = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("SINGLE_CHOICE"),
    choices: z.array(choiceSchema),
    correctChoiceId: z.string().min(1),
  }),
  z.object({
    type: z.literal("MULTIPLE_RESPONSE"),
    choices: z.array(choiceSchema),
    correctChoiceIds: z.array(z.string().min(1)),
  }),
  z.object({
    type: z.literal("SHORT_ANSWER"),
    expectedConcepts: z.array(z.string().min(1)),
  }),
]);

const tagsSchema = z.array(z.string().min(1));

export function toQuestion(row: QuestionRow): Question {
  if (row.current_revision_id === null) {
    // Only reachable if a root was committed without its first revision, which
    // the create transaction makes impossible.
    throw new Error(
      `Stored question ${row.id} has no current revision; the aggregate is incomplete.`,
    );
  }

  return {
    id: row.id,
    certificationId: row.certification_id,
    currentRevisionId: row.current_revision_id,
    lifecycleStatus: toLifecycleStatus(row.lifecycle_status),
    qualityStatus: toQualityStatus(row.quality_status),
    generationMode: toGenerationMode(row.generation_mode),
    generationRunId: row.generation_run_id,
    disputeReason: row.dispute_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toQuestionRevision(row: QuestionRevisionRow): QuestionRevision {
  const questionType = toQuestionType(row.question_type);
  const content = parseContent(row.id, row.content_payload);

  if (content.type !== questionType) {
    throw new Error(
      `Stored revision ${row.id} declares type ${questionType} but its content is ${content.type}.`,
    );
  }

  return {
    id: row.id,
    questionId: row.question_id,
    revisionNumber: row.revision_number,
    stem: row.stem,
    instructions: row.instructions,
    questionType,
    content,
    explanation: row.explanation,
    difficulty: row.difficulty,
    tags: parseTags(row.id, row.tags),
    language: row.language,
    createdAt: row.created_at,
  };
}

export function serializeContent(content: QuestionContent): string {
  return JSON.stringify(content);
}

export function serializeTags(tags: readonly string[]): string {
  return JSON.stringify(tags);
}

function parseContent(revisionId: string, payload: string): QuestionContent {
  const result = contentSchema.safeParse(readJson(revisionId, payload));

  if (!result.success) {
    throw new Error(
      `Stored revision ${revisionId} has unsupported question content: ${result.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
    );
  }

  return result.data;
}

function parseTags(revisionId: string, payload: string): readonly string[] {
  const result = tagsSchema.safeParse(readJson(revisionId, payload));

  if (!result.success) {
    throw new Error(`Stored revision ${revisionId} has unsupported tags.`);
  }

  return result.data;
}

function readJson(revisionId: string, payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    throw new Error(`Stored revision ${revisionId} holds invalid JSON.`);
  }
}

/** Exported so the candidate query validates its type column the same way. */
export function toQuestionType(value: string): QuestionType {
  const questionType = QUESTION_TYPES.find((candidate) => candidate === value);

  if (questionType === undefined) {
    throw new Error(`Unsupported stored question type: ${value}`);
  }

  return questionType;
}

function toLifecycleStatus(value: string): QuestionLifecycleStatus {
  const status = QUESTION_LIFECYCLE_STATUSES.find(
    (candidate) => candidate === value,
  );

  if (status === undefined) {
    throw new Error(`Unsupported stored question lifecycle status: ${value}`);
  }

  return status;
}

function toQualityStatus(value: string): QuestionQualityStatus {
  const status = QUESTION_QUALITY_STATUSES.find(
    (candidate) => candidate === value,
  );

  if (status === undefined) {
    throw new Error(`Unsupported stored question quality status: ${value}`);
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
