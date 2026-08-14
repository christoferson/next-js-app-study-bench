import { z } from "zod";
import type { GenerationMode } from "@/modules/question-bank/domain/question";
import { GENERATION_MODES } from "@/modules/question-bank/domain/question";
import type {
  CardType,
  Flashcard,
  FlashcardContent,
  FlashcardLifecycleStatus,
  FlashcardRevision,
} from "@/modules/flashcards/domain/flashcard";
import {
  CARD_TYPES,
  FLASHCARD_LIFECYCLE_STATUSES,
} from "@/modules/flashcards/domain/flashcard";
import type {
  RecallRating,
  ReviewSchedule,
} from "@/modules/flashcards/domain/review-scheduling";
import { RECALL_RATINGS } from "@/modules/flashcards/domain/review-scheduling";
import type { FlashcardReviewRecord } from "@/modules/flashcards/ports/flashcard-repository";

/**
 * Row mapping for the SQLite flashcard tables.
 *
 * The database is an external boundary, so stored values are validated on the way
 * out rather than cast (`spec/CODING-STANDARDS.md` section 2). That matters most
 * for `content_payload`: it is JSON, and a payload that no longer matches the
 * discriminated union — after a hand-edited local database, or a future schema
 * change applied without a data migration — must fail loudly instead of flowing
 * into the domain as a lie.
 */

export interface FlashcardRow {
  readonly id: string;
  readonly certification_id: string;
  readonly current_revision_id: string | null;
  readonly lifecycle_status: string;
  readonly source_question_id: string | null;
  readonly generation_mode: string;
  readonly generation_run_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface FlashcardRevisionRow {
  readonly id: string;
  readonly flashcard_id: string;
  readonly revision_number: number;
  readonly card_type: string;
  readonly content_payload: string;
  readonly search_text: string;
  readonly notes: string | null;
  readonly tags: string;
  readonly language: string | null;
  readonly generation_run_id: string | null;
  readonly created_at: string;
}

export interface ReviewScheduleRow {
  readonly flashcard_id: string;
  readonly interval_minutes: number;
  readonly due_at: string;
  readonly lapse_count: number;
  readonly review_count: number;
  readonly last_reviewed_at: string;
  readonly scheduler_id: string;
}

export interface FlashcardReviewRow {
  readonly id: string;
  readonly flashcard_id: string;
  readonly flashcard_revision_id: string;
  readonly rating: string;
  readonly reviewed_at: string;
  readonly interval_minutes: number;
  readonly due_at: string;
  readonly scheduler_id: string;
}

/**
 * Persisted shape of `FlashcardContent`.
 *
 * A discriminated union in the schema too, so the stored `type` selects the
 * required fields instead of every field being optional. The four original
 * vocabulary fields are `.nullable()` rather than `.optional()`: absent and null
 * must not be two ways of saying the same thing in stored data.
 *
 * The richer vocabulary fields *are* `.optional()`, and that difference is the
 * whole back-compatibility story. Every payload written before they existed —
 * including the owner's imported vocabulary bank — simply does not have the keys,
 * and reads back unchanged as a card without them. Nothing was migrated and no
 * stored JSON was rewritten.
 */
const rawContentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("BASIC"),
    front: z.string(),
    back: z.string(),
  }),
  z.object({
    type: z.literal("REVERSED"),
    front: z.string(),
    back: z.string(),
  }),
  z.object({
    type: z.literal("CLOZE"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("VOCABULARY"),
    term: z.string(),
    reading: z.string().nullable(),
    meaning: z.string(),
    exampleSentence: z.string().nullable(),
    meanings: z.array(z.string()).optional(),
    synonyms: z.array(z.string()).optional(),
    antonyms: z.array(z.string()).optional(),
    examples: z
      .array(
        z.object({
          text: z.string(),
          reading: z.string().optional(),
          translation: z.string().optional(),
        }),
      )
      .optional(),
    usageNotes: z.string().optional(),
  }),
  z.object({
    type: z.literal("SCENARIO"),
    scenario: z.string(),
    question: z.string(),
    answer: z.string(),
  }),
]);

/**
 * The parsed row as domain content.
 *
 * An explicit step rather than a direct assignment because the domain type uses
 * optional properties under `exactOptionalPropertyTypes`, where `meanings?:
 * readonly string[]` and `meanings: string[] | undefined` are different types. A
 * key that was absent in the JSON stays absent here rather than becoming an
 * explicit `undefined`, so a round trip through `serializeContent` produces the
 * same payload it read.
 */
function toContent(raw: z.output<typeof rawContentSchema>): FlashcardContent {
  switch (raw.type) {
    case "BASIC":
      return { type: "BASIC", front: raw.front, back: raw.back };
    case "REVERSED":
      return { type: "REVERSED", front: raw.front, back: raw.back };
    case "CLOZE":
      return { type: "CLOZE", text: raw.text };
    case "VOCABULARY":
      return {
        type: "VOCABULARY",
        term: raw.term,
        reading: raw.reading,
        meaning: raw.meaning,
        exampleSentence: raw.exampleSentence,
        ...(raw.meanings === undefined ? {} : { meanings: raw.meanings }),
        ...(raw.synonyms === undefined ? {} : { synonyms: raw.synonyms }),
        ...(raw.antonyms === undefined ? {} : { antonyms: raw.antonyms }),
        ...(raw.examples === undefined
          ? {}
          : {
              examples: raw.examples.map((example) => ({
                text: example.text,
                ...(example.reading === undefined
                  ? {}
                  : { reading: example.reading }),
                ...(example.translation === undefined
                  ? {}
                  : { translation: example.translation }),
              })),
            }),
        ...(raw.usageNotes === undefined ? {} : { usageNotes: raw.usageNotes }),
      };
    case "SCENARIO":
      return {
        type: "SCENARIO",
        scenario: raw.scenario,
        question: raw.question,
        answer: raw.answer,
      };
  }
}

const contentSchema: z.ZodType<FlashcardContent> =
  rawContentSchema.transform(toContent);

const tagsSchema = z.array(z.string().min(1));

export function toFlashcard(row: FlashcardRow): Flashcard {
  if (row.current_revision_id === null) {
    // Only reachable if a root was committed without its first revision, which
    // the create transaction makes impossible.
    throw new Error(
      `Stored flashcard ${row.id} has no current revision; the aggregate is incomplete.`,
    );
  }

  return {
    id: row.id,
    certificationId: row.certification_id,
    currentRevisionId: row.current_revision_id,
    lifecycleStatus: toLifecycleStatus(row.lifecycle_status),
    sourceQuestionId: row.source_question_id,
    generationMode: toGenerationMode(row.generation_mode),
    generationRunId: row.generation_run_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toFlashcardRevision(
  row: FlashcardRevisionRow,
): FlashcardRevision {
  const cardType = toCardType(row.card_type);
  const content = parseContent(row.id, row.content_payload);

  if (content.type !== cardType) {
    throw new Error(
      `Stored revision ${row.id} declares type ${cardType} but its content is ${content.type}.`,
    );
  }

  return {
    id: row.id,
    flashcardId: row.flashcard_id,
    revisionNumber: row.revision_number,
    cardType,
    content,
    notes: row.notes,
    tags: parseTags(row.id, row.tags),
    language: row.language,
    generationRunId: row.generation_run_id,
    createdAt: row.created_at,
  };
}

export function toReviewSchedule(row: ReviewScheduleRow): ReviewSchedule {
  return {
    intervalMinutes: row.interval_minutes,
    dueAt: row.due_at,
    lapseCount: row.lapse_count,
    reviewCount: row.review_count,
    lastReviewedAt: row.last_reviewed_at,
    schedulerId: row.scheduler_id,
  };
}

export function toReviewRecord(row: FlashcardReviewRow): FlashcardReviewRecord {
  return {
    id: row.id,
    flashcardId: row.flashcard_id,
    flashcardRevisionId: row.flashcard_revision_id,
    rating: toRating(row.rating),
    reviewedAt: row.reviewed_at,
    intervalMinutes: row.interval_minutes,
    dueAt: row.due_at,
    schedulerId: row.scheduler_id,
  };
}

export function serializeContent(content: FlashcardContent): string {
  return JSON.stringify(content);
}

export function serializeTags(tags: readonly string[]): string {
  return JSON.stringify(tags);
}

function parseContent(revisionId: string, payload: string): FlashcardContent {
  const result = contentSchema.safeParse(readJson(revisionId, payload));

  if (!result.success) {
    throw new Error(
      `Stored revision ${revisionId} has unsupported card content: ${result.error.issues
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

function toCardType(value: string): CardType {
  const cardType = CARD_TYPES.find((candidate) => candidate === value);

  if (cardType === undefined) {
    throw new Error(`Unsupported stored card type: ${value}`);
  }

  return cardType;
}

function toLifecycleStatus(value: string): FlashcardLifecycleStatus {
  const status = FLASHCARD_LIFECYCLE_STATUSES.find(
    (candidate) => candidate === value,
  );

  if (status === undefined) {
    throw new Error(`Unsupported stored flashcard lifecycle status: ${value}`);
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

function toRating(value: string): RecallRating {
  const rating = RECALL_RATINGS.find((candidate) => candidate === value);

  if (rating === undefined) {
    throw new Error(`Unsupported stored recall rating: ${value}`);
  }

  return rating;
}
