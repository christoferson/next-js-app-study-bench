import type { IsoTimestamp } from "@/platform/clock";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import type { ObjectiveId } from "@/modules/certifications/domain/objective";
import type { QuestionId } from "@/modules/question-bank/domain/question";

/**
 * Flashcard aggregate: a root that owns identity, lifecycle, and provenance,
 * plus immutable revisions that own the content.
 *
 * The shape deliberately mirrors the question aggregate
 * (`spec/DOMAIN-RULES.md` section 1.1): a root with a current-revision pointer,
 * append-only revisions, and content modelled as a discriminated union. A card
 * has no quality dimension — `SPEC.md` section 6.4 gives flashcards no review
 * state — so lifecycle is the only status a card carries.
 *
 * Domain code is framework-free: no React, Next.js, database driver, or
 * environment access.
 */

export type FlashcardId = string;
export type FlashcardRevisionId = string;

/** Flashcard types from `SPEC.md` section 6.4. */
export type CardType =
  "BASIC" | "REVERSED" | "CLOZE" | "VOCABULARY" | "SCENARIO";

export const CARD_TYPES: readonly CardType[] = [
  "BASIC",
  "REVERSED",
  "CLOZE",
  "VOCABULARY",
  "SCENARIO",
];

/**
 * Lifecycle status.
 *
 * The same four states as a question (`spec/DOMAIN-RULES.md` section 1.2), and
 * `ARCHIVED` is unproduced for the same reason it is unproduced for questions:
 * D4 offers retire (reversible), and archival becomes meaningful once a card
 * cannot be withdrawn from study by retirement alone.
 */
export type FlashcardLifecycleStatus =
  "DRAFT" | "ACTIVE" | "RETIRED" | "ARCHIVED";

export const FLASHCARD_LIFECYCLE_STATUSES: readonly FlashcardLifecycleStatus[] =
  ["DRAFT", "ACTIVE", "RETIRED", "ARCHIVED"];

/**
 * Variant card content, discriminated by `type`
 * (`spec/CODING-STANDARDS.md` section 1.3). The discriminator is persisted in
 * its own column as well as inside the JSON payload, so the bank can filter by
 * card type without parsing JSON.
 *
 * `REVERSED` is its own type rather than a flag on `BASIC`: which side is
 * prompted is part of what the card *is*, it must survive a round trip through
 * persistence, and the renderer must be forced to handle it. `SPEC.md`
 * section 6.4 lists it as a type alongside the others.
 *
 * `CLOZE` keeps one text containing `{{...}}` deletions rather than a separate
 * front and back: the two faces are derived from the same sentence, so storing
 * them apart would allow them to disagree.
 */
export type FlashcardContent =
  | {
      readonly type: "BASIC";
      readonly front: string;
      readonly back: string;
    }
  | {
      readonly type: "REVERSED";
      /** Written the same way round as a basic card; prompted back first. */
      readonly front: string;
      readonly back: string;
    }
  | {
      readonly type: "CLOZE";
      /** Sentence with one or more `{{deleted}}` sections. */
      readonly text: string;
    }
  | {
      readonly type: "VOCABULARY";
      readonly term: string;
      /** Pronunciation such as pinyin. Optional: not every language needs one. */
      readonly reading: string | null;
      readonly meaning: string;
      readonly exampleSentence: string | null;
    }
  | {
      readonly type: "SCENARIO";
      readonly scenario: string;
      readonly question: string;
      readonly answer: string;
    };

/**
 * Immutable card content.
 *
 * A revision is never updated once written: editing a card appends revision
 * `n + 1` and moves the root's `currentRevisionId`. The repository port has no
 * update-revision method, and every recorded review names the revision it was
 * answered against (`spec/DOMAIN-RULES.md` section 1.4), so a later edit can
 * never rewrite what was studied.
 */
export interface FlashcardRevision {
  readonly id: FlashcardRevisionId;
  readonly flashcardId: FlashcardId;
  /** 1 for the first revision, incrementing by one per edit. */
  readonly revisionNumber: number;
  readonly cardType: CardType;
  readonly content: FlashcardContent;
  /** Owner-only note; never shown while reviewing. */
  readonly notes: string | null;
  readonly tags: readonly string[];
  /** BCP-47-style tag such as `en` or `zh`, when the owner records one. */
  readonly language: string | null;
  readonly createdAt: IsoTimestamp;
}

/**
 * Flashcard root.
 *
 * `currentRevisionId` is typed non-nullable because a card without content is
 * not a valid aggregate. The column is nullable in SQLite only so the root row
 * can be inserted before the revision it points at (a circular foreign key).
 *
 * `sourceQuestionId` records that the card was converted from a question. The
 * card is independent from that moment on: editing either side never changes the
 * other, and the pointer is provenance only.
 */
export interface Flashcard {
  readonly id: FlashcardId;
  readonly certificationId: CertificationId;
  readonly currentRevisionId: FlashcardRevisionId;
  readonly lifecycleStatus: FlashcardLifecycleStatus;
  readonly sourceQuestionId: QuestionId | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/** A root together with its current revision, as list and detail views need. */
export interface FlashcardWithRevision {
  readonly flashcard: Flashcard;
  readonly revision: FlashcardRevision;
}

/** A root with its full revision history and mappings. */
export interface FlashcardWithHistory {
  readonly flashcard: Flashcard;
  readonly currentRevision: FlashcardRevision;
  readonly revisions: readonly FlashcardRevision[];
  readonly objectiveIds: readonly ObjectiveId[];
}

export function describeCardType(cardType: CardType): string {
  switch (cardType) {
    case "BASIC":
      return "Basic";
    case "REVERSED":
      return "Reversed";
    case "CLOZE":
      return "Cloze";
    case "VOCABULARY":
      return "Vocabulary";
    case "SCENARIO":
      return "Scenario";
  }
}

/** Owner-facing description of how the type is studied. */
export function describeCardPrompting(cardType: CardType): string {
  switch (cardType) {
    case "BASIC":
      return "Front prompts, back answers.";
    case "REVERSED":
      return "Back prompts, front answers — the same pair, studied the other way round.";
    case "CLOZE":
      return "A sentence with blanks to fill in.";
    case "VOCABULARY":
      return "A term prompts its reading, meaning, and example.";
    case "SCENARIO":
      return "A situation prompts a question and its answer.";
  }
}

export function describeFlashcardLifecycleStatus(
  status: FlashcardLifecycleStatus,
): string {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "ACTIVE":
      return "Active";
    case "RETIRED":
      return "Retired";
    case "ARCHIVED":
      return "Archived";
  }
}

/** Shortened text for list rows, cut on a word boundary where possible. */
export function textExcerpt(text: string, limit = 120): string {
  const collapsed = text.replace(/\s+/g, " ").trim();

  if (collapsed.length <= limit) {
    return collapsed;
  }

  const cut = collapsed.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");

  return `${(lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
