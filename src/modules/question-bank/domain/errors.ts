import { DomainError } from "@/shared/domain-error";
import type {
  QuestionLifecycleStatus,
  QuestionQualityStatus,
} from "./question";
import { describeLifecycleStatus, describeQualityStatus } from "./question";

/**
 * Domain errors for the question-bank module.
 *
 * Expected failures are explicit error types with stable codes, each mapping its
 * message to the form field that caused it (`spec/ARCHITECTURE.md` section 6.5,
 * `spec/CODING-STANDARDS.md` section 2).
 */

export type QuestionBankDomainErrorCode =
  | "QUESTION_NOT_FOUND"
  | "INVALID_QUESTION_CONTENT"
  | "INVALID_LIFECYCLE_TRANSITION"
  | "INVALID_QUALITY_TRANSITION"
  | "QUESTION_OBJECTIVE_MISMATCH"
  | "QUESTION_NOT_DELETABLE";

export class QuestionNotFoundError extends DomainError {
  readonly code = "QUESTION_NOT_FOUND";

  constructor(readonly questionId: string) {
    super(`No question matches "${questionId}".`);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": ["That question no longer exists."] };
  }
}

/**
 * A choice configuration that cannot represent an answerable question.
 *
 * The message is attached to the field the owner can correct, so the bad choice
 * row or the correct-answer control shows the reason.
 */
export class InvalidQuestionContentError extends DomainError {
  readonly code = "INVALID_QUESTION_CONTENT";

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

export class InvalidLifecycleTransitionError extends DomainError {
  readonly code = "INVALID_LIFECYCLE_TRANSITION";

  constructor(
    readonly from: QuestionLifecycleStatus,
    readonly to: QuestionLifecycleStatus,
  ) {
    super(
      `A question cannot move from ${describeLifecycleStatus(from)} to ${describeLifecycleStatus(to)}.`,
    );
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return {
      "": [
        `This question is ${describeLifecycleStatus(this.from).toLowerCase()}, so it cannot become ${describeLifecycleStatus(this.to).toLowerCase()}.`,
      ],
    };
  }
}

export class InvalidQualityTransitionError extends DomainError {
  readonly code = "INVALID_QUALITY_TRANSITION";

  constructor(
    readonly from: QuestionQualityStatus,
    readonly to: QuestionQualityStatus,
  ) {
    super(
      `A question cannot move from ${describeQualityStatus(from)} to ${describeQualityStatus(to)}.`,
    );
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return {
      "": [
        `This question is ${describeQualityStatus(this.from).toLowerCase()}, so that review action does not apply.`,
      ],
    };
  }
}

/** An objective from a different study track cannot be mapped. */
export class QuestionObjectiveMismatchError extends DomainError {
  readonly code = "QUESTION_OBJECTIVE_MISMATCH";

  constructor(readonly objectiveId: string) {
    super(
      `Objective "${objectiveId}" does not belong to this question's study track.`,
    );
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return {
      objectiveId: ["Choose an objective that belongs to this study track."],
    };
  }
}

/**
 * Hard deletion blocked by dependent history (`SPEC.md` section 6.3.2).
 *
 * No D3 flow can produce this yet because no dependent record type exists; the
 * error is raised by the facade the moment a dependency check reports one, which
 * is how D5 attempts and D9 artifacts will surface.
 */
export class QuestionNotDeletableError extends DomainError {
  readonly code = "QUESTION_NOT_DELETABLE";

  constructor(readonly dependencies: readonly string[]) {
    super(
      `This question has dependent history and cannot be deleted: ${dependencies.join(", ")}.`,
    );
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return {
      "": [
        `This question cannot be deleted because it has ${this.dependencies.join(", ")}. Retire it instead.`,
      ],
    };
  }
}
