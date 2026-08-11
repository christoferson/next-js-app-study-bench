import type { QuestionAttempt } from "@/modules/study-sessions/domain/question-attempt";
import type {
  StudySession,
  StudySessionItem,
} from "@/modules/study-sessions/domain/study-session";

/**
 * Deterministic study-session fixtures.
 *
 * The clock, ID generator, and migrated in-memory database helpers are shared with
 * the certifications module
 * (`@/modules/certifications/infrastructure/test-support`); only the session shapes
 * are defined here.
 */

export const FIXTURE_TIME = "2026-01-01T00:00:00.000Z";

export function sessionFixture(
  overrides: Partial<StudySession> = {},
): StudySession {
  return {
    id: "session-1",
    mode: "SINGLE_TRACK",
    status: "IN_PROGRESS",
    certificationIds: ["certification-1"],
    targetMinutes: 10,
    createdAt: FIXTURE_TIME,
    completedAt: null,
    ...overrides,
  };
}

/** A question item, which is the common case. */
export function questionItemFixture(
  overrides: Partial<StudySessionItem> = {},
): StudySessionItem {
  return {
    id: "item-1",
    sessionId: "session-1",
    position: 1,
    content: {
      itemType: "QUESTION",
      questionId: "question-1",
      questionRevisionId: "revision-1",
    },
    status: "PENDING",
    completedAt: null,
    ...overrides,
  };
}

export function cardItemFixture(
  overrides: Partial<StudySessionItem> = {},
): StudySessionItem {
  return {
    id: "item-card-1",
    sessionId: "session-1",
    position: 1,
    content: {
      itemType: "FLASHCARD",
      flashcardId: "flashcard-1",
      flashcardRevisionId: "card-revision-1",
    },
    status: "PENDING",
    completedAt: null,
    ...overrides,
  };
}

export function attemptFixture(
  overrides: Partial<QuestionAttempt> = {},
): QuestionAttempt {
  return {
    id: "attempt-1",
    sessionId: "session-1",
    questionId: "question-1",
    questionRevisionId: "revision-1",
    submittedAnswer: { type: "SINGLE_CHOICE", choiceId: "choice-1" },
    isCorrect: true,
    confidence: "FAIRLY_SURE",
    durationSeconds: 12,
    attemptedAt: FIXTURE_TIME,
    evaluationMode: "DETERMINISTIC",
    feedbackSnapshot: null,
    ...overrides,
  };
}
