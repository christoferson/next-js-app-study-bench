import { DomainError } from "@/shared/domain-error";
import type { FlashcardLifecycleStatus } from "./flashcard";
import { describeFlashcardLifecycleStatus } from "./flashcard";

/**
 * Domain errors for the flashcards module.
 *
 * Expected failures are explicit error types with stable codes, each mapping its
 * message to the form field that caused it (`spec/ARCHITECTURE.md` section 6.5,
 * `spec/CODING-STANDARDS.md` section 2).
 */

export type FlashcardDomainErrorCode =
  | "FLASHCARD_NOT_FOUND"
  | "INVALID_FLASHCARD_CONTENT"
  | "INVALID_FLASHCARD_LIFECYCLE_TRANSITION"
  | "FLASHCARD_OBJECTIVE_MISMATCH"
  | "FLASHCARD_NOT_REVIEWABLE"
  | "QUESTION_NOT_CONVERTIBLE";

export class FlashcardNotFoundError extends DomainError {
  readonly code = "FLASHCARD_NOT_FOUND";

  constructor(readonly flashcardId: string) {
    super(`No flashcard matches "${flashcardId}".`);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": ["That flashcard no longer exists."] };
  }
}

/**
 * Content that cannot be studied as a card of its declared type.
 *
 * The message is attached to the field the owner can correct, so the form shows
 * the reason next to its cause.
 */
export class InvalidFlashcardContentError extends DomainError {
  readonly code = "INVALID_FLASHCARD_CONTENT";

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

export class InvalidFlashcardLifecycleTransitionError extends DomainError {
  readonly code = "INVALID_FLASHCARD_LIFECYCLE_TRANSITION";

  constructor(
    readonly from: FlashcardLifecycleStatus,
    readonly to: FlashcardLifecycleStatus,
  ) {
    super(
      `A flashcard cannot move from ${describeFlashcardLifecycleStatus(from)} to ${describeFlashcardLifecycleStatus(to)}.`,
    );
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return {
      "": [
        `This card is ${describeFlashcardLifecycleStatus(this.from).toLowerCase()}, so it cannot become ${describeFlashcardLifecycleStatus(this.to).toLowerCase()}.`,
      ],
    };
  }
}

/** An objective from a different study track cannot be mapped. */
export class FlashcardObjectiveMismatchError extends DomainError {
  readonly code = "FLASHCARD_OBJECTIVE_MISMATCH";

  constructor(readonly objectiveId: string) {
    super(
      `Objective "${objectiveId}" does not belong to this flashcard's study track.`,
    );
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return {
      objectiveId: ["Choose an objective that belongs to this study track."],
    };
  }
}

/**
 * A rating was submitted for a card that is not in the study pool.
 *
 * Reachable from a stale review page: the card was retired in another tab
 * between the page render and the rating. Recording the review anyway would put
 * a retired card back on a schedule.
 */
export class FlashcardNotReviewableError extends DomainError {
  readonly code = "FLASHCARD_NOT_REVIEWABLE";

  constructor(readonly status: FlashcardLifecycleStatus) {
    super(
      `A ${describeFlashcardLifecycleStatus(status).toLowerCase()} flashcard cannot be reviewed.`,
    );
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return {
      "": [
        `This card is ${describeFlashcardLifecycleStatus(this.status).toLowerCase()} and is no longer in the review queue.`,
      ],
    };
  }
}

/**
 * A question the owner asked to convert cannot become a card.
 *
 * Only an active question converts: converting a draft would copy wording the
 * owner has not finished, and converting a retired one would return content to
 * study that was deliberately withdrawn.
 */
export class QuestionNotConvertibleError extends DomainError {
  readonly code = "QUESTION_NOT_CONVERTIBLE";

  constructor(readonly reason: string) {
    super(reason);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": [this.reason] };
  }
}
