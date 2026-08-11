import { DomainError } from "@/shared/domain-error";
import type { SessionStatus } from "./study-session";
import { describeSessionStatus } from "./study-session";

/**
 * Domain errors for the study-sessions module.
 *
 * Expected failures are explicit error types with stable codes, each mapping its
 * message to the form field that caused it (`spec/ARCHITECTURE.md` section 6.5,
 * `spec/CODING-STANDARDS.md` section 2).
 */

export type StudySessionDomainErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_IN_PROGRESS"
  | "SESSION_ITEM_NOT_FOUND"
  | "NO_STUDY_CONTENT"
  | "INVALID_SUBMITTED_ANSWER"
  | "DIAGNOSTIC_NOT_AVAILABLE";

export class StudySessionNotFoundError extends DomainError {
  readonly code = "SESSION_NOT_FOUND";

  constructor(readonly sessionId: string) {
    super(`No study session matches "${sessionId}".`);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": ["That study session no longer exists."] };
  }
}

/**
 * An answer or rating arrived for a session that has already ended.
 *
 * Reachable from a study screen left open in another tab: the session was
 * finished elsewhere, and accepting the answer would add history to a completed
 * session.
 */
export class SessionNotInProgressError extends DomainError {
  readonly code = "SESSION_NOT_IN_PROGRESS";

  constructor(readonly status: SessionStatus) {
    super(`This session is ${describeSessionStatus(status)}.`);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return {
      "": [
        `This session is already ${describeSessionStatus(this.status).toLowerCase()}, so nothing more can be recorded against it.`,
      ],
    };
  }
}

/** The submitted item does not belong to the session, or was already settled. */
export class SessionItemNotFoundError extends DomainError {
  readonly code = "SESSION_ITEM_NOT_FOUND";

  constructor(readonly itemId: string) {
    super(`No pending session item matches "${itemId}".`);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return {
      "": [
        "That item is no longer waiting in this session. Reload the session to see what is next.",
      ],
    };
  }
}

/**
 * The composer found nothing to study for the requested mode and tracks.
 *
 * A session with no items would be a screen with nothing on it, so it is refused
 * at creation with a message that names the reason the bank came back empty.
 */
export class NoStudyContentError extends DomainError {
  readonly code = "NO_STUDY_CONTENT";

  constructor(readonly reason: string) {
    super(reason);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": [this.reason] };
  }
}

/** A submission that cannot be judged against the question on screen. */
export class InvalidSubmittedAnswerError extends DomainError {
  readonly code = "INVALID_SUBMITTED_ANSWER";

  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(reason);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { [this.field]: [this.reason] };
  }
}

/**
 * A diagnostic was requested without enough active questions to measure with.
 *
 * `SPEC.md` section 6.9: "a diagnostic can be offered only when enough active
 * questions exist across relevant objectives". The threshold is in the composer;
 * this error reports the shortfall in the owner's terms.
 */
export class DiagnosticNotAvailableError extends DomainError {
  readonly code = "DIAGNOSTIC_NOT_AVAILABLE";

  constructor(
    readonly requiredObjectives: number,
    readonly requiredQuestions: number,
  ) {
    super(
      `A diagnostic needs active questions covering at least ${requiredObjectives} objectives.`,
    );
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return {
      mode: [
        `A diagnostic needs at least ${this.requiredQuestions} active questions spread across at least ${this.requiredObjectives} objectives. Add more questions, or choose another kind of session.`,
      ],
    };
  }
}
