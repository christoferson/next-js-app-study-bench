import type { IsoTimestamp } from "@/platform/clock";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import type { FlashcardId } from "@/modules/flashcards/domain/flashcard";
import type {
  QuestionId,
  QuestionRevisionId,
} from "@/modules/question-bank/domain/question";

/**
 * Study-session aggregate: a session root that owns the requested mode, the
 * selected tracks, and the ordered list of items it was composed from
 * (`SPEC.md` sections 6.6 and 23.2).
 *
 * Domain code is framework-free: no React, Next.js, database driver, or
 * environment access.
 */

export type StudySessionId = string;
export type StudySessionItemId = string;

/**
 * Session modes, one per option in `SPEC.md` section 6.6.
 *
 * `DIAGNOSTIC` is a mode rather than a separate flag or a separate aggregate. A
 * diagnostic differs from a normal session only in how the composer selects
 * items and in how the summary reads; it records ordinary attempts
 * (`SPEC.md` section 6.9). Keeping it in this enum means "is this session a
 * diagnostic" is one question with one answer, and no session can be both.
 *
 * "One study track" and "mixed study tracks" are two modes rather than one mode
 * plus a track count, because the specification lists them separately and the
 * distinction is what the owner chose, not what the data happens to look like.
 */
export type SessionMode =
  | "SINGLE_TRACK"
  | "MIXED_TRACKS"
  | "QUESTIONS_ONLY"
  | "FLASHCARDS_ONLY"
  | "MISTAKE_REVIEW"
  | "DIAGNOSTIC";

export const SESSION_MODES: readonly SessionMode[] = [
  "SINGLE_TRACK",
  "MIXED_TRACKS",
  "QUESTIONS_ONLY",
  "FLASHCARDS_ONLY",
  "MISTAKE_REVIEW",
  "DIAGNOSTIC",
];

/**
 * Session status.
 *
 * `ABANDONED` is produced by exactly one flow: starting a new session while an
 * earlier one is still in progress. Only one session is in progress at a time
 * (see `SPEC.md` section 6.6 — resumption is about returning to *the* session),
 * so the earlier one has to end, and ending it as `COMPLETED` would claim the
 * owner finished it. Everything already answered inside it is kept.
 */
export type SessionStatus = "IN_PROGRESS" | "COMPLETED" | "ABANDONED";

export const SESSION_STATUSES: readonly SessionStatus[] = [
  "IN_PROGRESS",
  "COMPLETED",
  "ABANDONED",
];

export type SessionItemType = "QUESTION" | "FLASHCARD";

/**
 * Item status.
 *
 * `SKIPPED` and `PENDING` are deliberately different states. `SKIPPED` means the
 * owner saw the item and moved past it; `PENDING` means the item was never
 * reached, which is what remains after finishing a session early. Neither
 * records an attempt, so neither produces a score — that is what keeps a skipped
 * diagnostic objective `UNSEEN` (`spec/DOMAIN-RULES.md` section 2.5).
 */
export type SessionItemStatus = "PENDING" | "COMPLETED" | "SKIPPED";

/**
 * What one item points at, discriminated by `itemType`
 * (`spec/CODING-STANDARDS.md` section 1.3).
 *
 * Both identifiers are frozen when the session is created: the revision is the
 * one that was current at composition time, so a later edit cannot change an
 * in-progress session (`spec/DOMAIN-RULES.md` section 2.3). A union rather than
 * four nullable fields, so an item can never name a question and a flashcard at
 * once, and a switch over it is exhaustive.
 */
export type SessionItemContent =
  | {
      readonly itemType: "QUESTION";
      readonly questionId: QuestionId;
      readonly questionRevisionId: QuestionRevisionId;
    }
  | {
      readonly itemType: "FLASHCARD";
      readonly flashcardId: FlashcardId;
      readonly flashcardRevisionId: string;
    };

export interface StudySessionItem {
  readonly id: StudySessionItemId;
  readonly sessionId: StudySessionId;
  /** 1-based rank in the composed order. Unique within the session. */
  readonly position: number;
  readonly content: SessionItemContent;
  readonly status: SessionItemStatus;
  readonly completedAt: IsoTimestamp | null;
}

export interface StudySession {
  readonly id: StudySessionId;
  readonly mode: SessionMode;
  readonly status: SessionStatus;
  /**
   * The tracks the owner selected. One for a single-track session, several for a
   * mixed one; stored as an association rather than a JSON list so progress
   * reporting can group by track in SQL.
   */
  readonly certificationIds: readonly CertificationId[];
  /**
   * The length the owner asked for, in minutes. An estimate used to size the
   * item list, never a timer: `SPEC.md` section 6.6 requires estimating duration
   * rather than enforcing one, and permits finishing early.
   */
  readonly targetMinutes: number;
  readonly createdAt: IsoTimestamp;
  readonly completedAt: IsoTimestamp | null;
}

/** A session together with its ordered items, as the study screen needs. */
export interface StudySessionWithItems {
  readonly session: StudySession;
  readonly items: readonly StudySessionItem[];
}

export function describeSessionMode(mode: SessionMode): string {
  switch (mode) {
    case "SINGLE_TRACK":
      return "One study track";
    case "MIXED_TRACKS":
      return "Mixed study tracks";
    case "QUESTIONS_ONLY":
      return "Questions only";
    case "FLASHCARDS_ONLY":
      return "Flashcards only";
    case "MISTAKE_REVIEW":
      return "Mistake review";
    case "DIAGNOSTIC":
      return "Diagnostic";
  }
}

/** What each mode will actually put in front of the owner. */
export function describeSessionModeHint(mode: SessionMode): string {
  switch (mode) {
    case "SINGLE_TRACK":
      return "Questions and due flashcards from one track.";
    case "MIXED_TRACKS":
      return "Questions and due flashcards from every track you select.";
    case "QUESTIONS_ONLY":
      return "Questions only, no flashcards.";
    case "FLASHCARDS_ONLY":
      return "Only flashcards that are due for review.";
    case "MISTAKE_REVIEW":
      return "Only questions you answered incorrectly before.";
    case "DIAGNOSTIC":
      return "A spread of questions across objectives you have not studied yet.";
  }
}

export function describeSessionStatus(status: SessionStatus): string {
  switch (status) {
    case "IN_PROGRESS":
      return "In progress";
    case "COMPLETED":
      return "Completed";
    case "ABANDONED":
      return "Ended early";
  }
}

export function describeItemStatus(status: SessionItemStatus): string {
  switch (status) {
    case "PENDING":
      return "Not reached";
    case "COMPLETED":
      return "Answered";
    case "SKIPPED":
      return "Skipped";
  }
}

/**
 * Whether the mode composes questions.
 *
 * Exhaustive, so a seventh mode cannot be added without deciding what it draws
 * from (`spec/CODING-STANDARDS.md` section 1.4).
 */
export function modeIncludesQuestions(mode: SessionMode): boolean {
  switch (mode) {
    case "SINGLE_TRACK":
    case "MIXED_TRACKS":
    case "QUESTIONS_ONLY":
    case "MISTAKE_REVIEW":
    case "DIAGNOSTIC":
      return true;
    case "FLASHCARDS_ONLY":
      return false;
  }
}

/**
 * Whether the mode composes flashcards.
 *
 * `MISTAKE_REVIEW` and `DIAGNOSTIC` are question-only by definition: a mistake
 * is a recorded incorrect answer, and a diagnostic measures objective coverage
 * with questions. A card rating is neither.
 */
export function modeIncludesFlashcards(mode: SessionMode): boolean {
  switch (mode) {
    case "SINGLE_TRACK":
    case "MIXED_TRACKS":
    case "FLASHCARDS_ONLY":
      return true;
    case "QUESTIONS_ONLY":
    case "MISTAKE_REVIEW":
    case "DIAGNOSTIC":
      return false;
  }
}

/** Whether the mode is meant to be used with more than one track. */
export function modeAllowsSeveralTracks(mode: SessionMode): boolean {
  switch (mode) {
    case "SINGLE_TRACK":
      return false;
    case "MIXED_TRACKS":
    case "QUESTIONS_ONLY":
    case "FLASHCARDS_ONLY":
    case "MISTAKE_REVIEW":
    case "DIAGNOSTIC":
      return true;
  }
}

/** The first item still waiting to be studied, or `null` when none is left. */
export function nextPendingItem(
  items: readonly StudySessionItem[],
): StudySessionItem | null {
  return (
    [...items]
      .sort((left, right) => left.position - right.position)
      .find((item) => item.status === "PENDING") ?? null
  );
}

/** How many items the owner has already answered or skipped. */
export function settledItemCount(items: readonly StudySessionItem[]): number {
  return items.filter((item) => item.status !== "PENDING").length;
}
