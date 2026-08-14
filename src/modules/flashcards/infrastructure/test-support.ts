import type {
  Flashcard,
  FlashcardContent,
  FlashcardRevision,
} from "@/modules/flashcards/domain/flashcard";
import type { ReviewSchedule } from "@/modules/flashcards/domain/review-scheduling";
import { DETERMINISTIC_SCHEDULER_ID } from "@/modules/flashcards/domain/review-scheduling";
import type { FlashcardReviewRecord } from "@/modules/flashcards/ports/flashcard-repository";

/**
 * Deterministic flashcard fixtures.
 *
 * The clock, ID generator, and migrated in-memory database helpers are shared
 * with the certifications module
 * (`@/modules/certifications/infrastructure/test-support`); only the flashcard
 * shapes are defined here.
 */

export const FIXTURE_TIME = "2026-01-01T00:00:00.000Z";

export function basicContent(): FlashcardContent {
  return {
    type: "BASIC",
    front: "What does S3 stand for?",
    back: "Simple Storage Service",
  };
}

export function reversedContent(): FlashcardContent {
  return {
    type: "REVERSED",
    front: "ephemeral",
    back: "lasting for a very short time",
  };
}

export function clozeContent(): FlashcardContent {
  return {
    type: "CLOZE",
    text: "An S3 bucket name must be {{globally unique}}.",
  };
}

/** The demo vocabulary card from `SPEC.md` section 6.4. */
export function vocabularyContent(): FlashcardContent {
  return {
    type: "VOCABULARY",
    term: "学习",
    reading: "xuéxí",
    meaning: "to study; to learn",
    exampleSentence: "我每天学习汉语。",
  };
}

/**
 * The same card carrying every optional field.
 *
 * A separate fixture rather than a richer default, because the two shapes are both
 * real: the plain one is what the owner's imported bank holds, and both must round
 * trip and render.
 */
export function enrichedVocabularyContent(): FlashcardContent {
  return {
    type: "VOCABULARY",
    term: "学习",
    reading: "xuéxí",
    meaning: "to study; to learn",
    exampleSentence: "我每天学习汉语。",
    meanings: ["to imitate a good example"],
    synonyms: ["念书", "读书"],
    antonyms: ["玩儿"],
    examples: [
      {
        text: "他在学习开车。",
        reading: "tā zài xuéxí kāichē.",
        translation: "He is learning to drive.",
      },
      { text: "值得学习。" },
    ],
    usageNotes: "Neutral register; also used of learning from an example.",
  };
}

/** A cloze card whose blank carries a hint. */
export function hintedClozeContent(): FlashcardContent {
  return {
    type: "CLOZE",
    text: "An S3 bucket name must be {{globally unique|across every account}}.",
  };
}

export function scenarioContent(): FlashcardContent {
  return {
    type: "SCENARIO",
    scenario: "A workload writes 20 GB of logs a day and reads them rarely.",
    question: "Which storage class fits?",
    answer: "S3 Standard-IA.",
  };
}

/** One content fixture per card type, for round-trip and rendering coverage. */
export function contentFixtures(): readonly FlashcardContent[] {
  return [
    basicContent(),
    reversedContent(),
    clozeContent(),
    vocabularyContent(),
    scenarioContent(),
  ];
}

export function flashcardFixture(
  overrides: Partial<Flashcard> = {},
): Flashcard {
  return {
    id: "flashcard-1",
    certificationId: "certification-1",
    currentRevisionId: "card-revision-1",
    lifecycleStatus: "DRAFT",
    sourceQuestionId: null,
    generationMode: "MANUAL",
    generationRunId: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    ...overrides,
  };
}

export function cardRevisionFixture(
  overrides: Partial<FlashcardRevision> = {},
): FlashcardRevision {
  const content = overrides.content ?? basicContent();

  return {
    id: "card-revision-1",
    flashcardId: "flashcard-1",
    revisionNumber: 1,
    cardType: content.type,
    content,
    notes: null,
    tags: [],
    language: null,
    generationRunId: null,
    createdAt: FIXTURE_TIME,
    ...overrides,
  };
}

export function scheduleFixture(
  overrides: Partial<ReviewSchedule> = {},
): ReviewSchedule {
  return {
    intervalMinutes: 4320,
    dueAt: "2026-01-04T00:00:00.000Z",
    lapseCount: 0,
    reviewCount: 1,
    lastReviewedAt: FIXTURE_TIME,
    schedulerId: DETERMINISTIC_SCHEDULER_ID,
    ...overrides,
  };
}

export function reviewRecordFixture(
  overrides: Partial<FlashcardReviewRecord> = {},
): FlashcardReviewRecord {
  return {
    id: "review-1",
    flashcardId: "flashcard-1",
    flashcardRevisionId: "card-revision-1",
    rating: "GOOD",
    reviewedAt: FIXTURE_TIME,
    intervalMinutes: 4320,
    dueAt: "2026-01-04T00:00:00.000Z",
    schedulerId: DETERMINISTIC_SCHEDULER_ID,
    ...overrides,
  };
}
