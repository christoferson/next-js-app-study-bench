import { z } from "zod";
import type {
  AnswerConfidence,
  EvaluationMode,
  QuestionAttempt,
  SubmittedAnswer,
} from "@/modules/study-sessions/domain/question-attempt";
import {
  ANSWER_CONFIDENCES,
  EVALUATION_MODES,
} from "@/modules/study-sessions/domain/question-attempt";
import type {
  SessionItemContent,
  SessionItemStatus,
  SessionItemType,
  SessionMode,
  SessionStatus,
  StudySession,
  StudySessionItem,
} from "@/modules/study-sessions/domain/study-session";
import {
  SESSION_MODES,
  SESSION_STATUSES,
} from "@/modules/study-sessions/domain/study-session";

/**
 * Row mapping for the SQLite study-session tables.
 *
 * The database is an external boundary, so stored values are validated on the way
 * out rather than cast (`spec/CODING-STANDARDS.md` section 2). That matters most
 * for `submitted_answer`: it is JSON, and a payload that no longer matches the
 * discriminated union must fail loudly rather than flow into grading and progress
 * reporting as a lie about what the owner answered.
 */

export interface StudySessionRow {
  readonly id: string;
  readonly mode: string;
  readonly status: string;
  readonly target_minutes: number;
  readonly created_at: string;
  readonly completed_at: string | null;
}

export interface StudySessionItemRow {
  readonly id: string;
  readonly session_id: string;
  readonly position: number;
  readonly item_type: string;
  readonly question_id: string | null;
  readonly question_revision_id: string | null;
  readonly flashcard_id: string | null;
  readonly flashcard_revision_id: string | null;
  readonly status: string;
  readonly completed_at: string | null;
}

export interface QuestionAttemptRow {
  readonly id: string;
  readonly session_id: string;
  readonly question_id: string;
  readonly question_revision_id: string;
  readonly submitted_answer: string;
  readonly is_correct: number;
  readonly confidence: string;
  readonly duration_seconds: number | null;
  readonly attempted_at: string;
  readonly evaluation_mode: string;
  readonly feedback_snapshot: string | null;
}

/**
 * Persisted shape of `SubmittedAnswer`.
 *
 * A discriminated union in the schema too, so the stored `type` selects the
 * required fields instead of every field being optional. An answer to a
 * multiple-response question therefore cannot be read back as a single choice.
 */
const submittedAnswerSchema: z.ZodType<SubmittedAnswer> = z.discriminatedUnion(
  "type",
  [
    z.object({ type: z.literal("SINGLE_CHOICE"), choiceId: z.string() }),
    z.object({
      type: z.literal("MULTIPLE_RESPONSE"),
      choiceIds: z.array(z.string()),
    }),
    z.object({ type: z.literal("SHORT_ANSWER"), text: z.string() }),
  ],
);

export function toStudySession(
  row: StudySessionRow,
  certificationIds: readonly string[],
): StudySession {
  return {
    id: row.id,
    mode: toSessionMode(row.mode),
    status: toSessionStatus(row.status),
    certificationIds,
    targetMinutes: row.target_minutes,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function toStudySessionItem(row: StudySessionItemRow): StudySessionItem {
  return {
    id: row.id,
    sessionId: row.session_id,
    position: row.position,
    content: toItemContent(row),
    status: toItemStatus(row.status),
    completedAt: row.completed_at,
  };
}

export function toQuestionAttempt(row: QuestionAttemptRow): QuestionAttempt {
  return {
    id: row.id,
    sessionId: row.session_id,
    questionId: row.question_id,
    questionRevisionId: row.question_revision_id,
    submittedAnswer: parseSubmittedAnswer(row.id, row.submitted_answer),
    // SQLite in STRICT mode has no boolean type, so correctness is stored as
    // 0 or 1 under a CHECK constraint and converted here.
    isCorrect: row.is_correct === 1,
    confidence: toConfidence(row.confidence),
    durationSeconds: row.duration_seconds,
    attemptedAt: row.attempted_at,
    evaluationMode: toEvaluationMode(row.evaluation_mode),
    feedbackSnapshot: row.feedback_snapshot,
  };
}

export function serializeSubmittedAnswer(answer: SubmittedAnswer): string {
  return JSON.stringify(answer);
}

/**
 * Splits one item row into the discriminated union the domain uses.
 *
 * The table's CHECK constraint already guarantees that exactly one pair of
 * identifiers is present for each item type; this converts that guarantee into a
 * shape the type system enforces, and throws if a hand-edited row violated it.
 */
function toItemContent(row: StudySessionItemRow): SessionItemContent {
  const itemType = toItemType(row.item_type);

  switch (itemType) {
    case "QUESTION": {
      if (row.question_id === null || row.question_revision_id === null) {
        throw new Error(
          `Stored session item ${row.id} is a question item without a frozen question revision.`,
        );
      }

      return {
        itemType,
        questionId: row.question_id,
        questionRevisionId: row.question_revision_id,
      };
    }
    case "FLASHCARD": {
      if (row.flashcard_id === null || row.flashcard_revision_id === null) {
        throw new Error(
          `Stored session item ${row.id} is a flashcard item without a frozen card revision.`,
        );
      }

      return {
        itemType,
        flashcardId: row.flashcard_id,
        flashcardRevisionId: row.flashcard_revision_id,
      };
    }
  }
}

function parseSubmittedAnswer(
  attemptId: string,
  payload: string,
): SubmittedAnswer {
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error(`Stored attempt ${attemptId} holds invalid JSON.`);
  }

  const result = submittedAnswerSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `Stored attempt ${attemptId} has an unsupported submitted answer: ${result.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
    );
  }

  return result.data;
}

function toSessionMode(value: string): SessionMode {
  const mode = SESSION_MODES.find((candidate) => candidate === value);

  if (mode === undefined) {
    throw new Error(`Unsupported stored session mode: ${value}`);
  }

  return mode;
}

function toSessionStatus(value: string): SessionStatus {
  const status = SESSION_STATUSES.find((candidate) => candidate === value);

  if (status === undefined) {
    throw new Error(`Unsupported stored session status: ${value}`);
  }

  return status;
}

function toItemType(value: string): SessionItemType {
  if (value === "QUESTION" || value === "FLASHCARD") {
    return value;
  }

  throw new Error(`Unsupported stored session item type: ${value}`);
}

function toItemStatus(value: string): SessionItemStatus {
  if (value === "PENDING" || value === "COMPLETED" || value === "SKIPPED") {
    return value;
  }

  throw new Error(`Unsupported stored session item status: ${value}`);
}

/** Exported so the summary projection validates its own column the same way. */
export function toConfidence(value: string): AnswerConfidence {
  const confidence = ANSWER_CONFIDENCES.find(
    (candidate) => candidate === value,
  );

  if (confidence === undefined) {
    throw new Error(`Unsupported stored answer confidence: ${value}`);
  }

  return confidence;
}

function toEvaluationMode(value: string): EvaluationMode {
  const mode = EVALUATION_MODES.find((candidate) => candidate === value);

  if (mode === undefined) {
    throw new Error(`Unsupported stored evaluation mode: ${value}`);
  }

  return mode;
}
