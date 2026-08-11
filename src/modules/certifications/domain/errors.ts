/**
 * Domain errors for the certification module.
 *
 * Expected failures are explicit error types with stable codes. Callers must not
 * string-match error messages (`spec/ARCHITECTURE.md` section 6.5).
 */

export type DomainErrorCode =
  | "VALIDATION_FAILED"
  | "SLUG_CONFLICT"
  | "CERTIFICATION_NOT_FOUND"
  | "OBJECTIVE_NOT_FOUND"
  | "INVALID_PARENT_OBJECTIVE"
  | "CYCLIC_OBJECTIVE_PARENT";

export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode;

  /**
   * Messages keyed by form field name. Every domain error carries field
   * mappings so that a form can render the failure next to its cause; the empty
   * string key holds messages that belong to the form as a whole.
   */
  abstract fieldMessages(): Readonly<Record<string, readonly string[]>>;
}

export class ValidationError extends DomainError {
  readonly code = "VALIDATION_FAILED";

  private readonly messages: Readonly<Record<string, readonly string[]>>;

  constructor(messages: Readonly<Record<string, readonly string[]>>) {
    super("The submitted values are not valid.");
    this.messages = messages;
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return this.messages;
  }
}

export class SlugConflictError extends DomainError {
  readonly code = "SLUG_CONFLICT";

  constructor(readonly slug: string) {
    super(`Another study track already uses the address "${slug}".`);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return {
      name: [
        `Another study track already uses the address "${this.slug}". Choose a different name.`,
      ],
    };
  }
}

export class CertificationNotFoundError extends DomainError {
  readonly code = "CERTIFICATION_NOT_FOUND";

  constructor(readonly reference: string) {
    super(`No study track matches "${reference}".`);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": ["That study track no longer exists."] };
  }
}

export class ObjectiveNotFoundError extends DomainError {
  readonly code = "OBJECTIVE_NOT_FOUND";

  constructor(readonly objectiveId: string) {
    super(`No objective matches "${objectiveId}".`);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": ["That objective no longer exists."] };
  }
}

export class InvalidParentObjectiveError extends DomainError {
  readonly code = "INVALID_PARENT_OBJECTIVE";

  constructor(readonly parentObjectiveId: string) {
    super(
      `Parent objective "${parentObjectiveId}" does not exist in this study track.`,
    );
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return {
      parentObjectiveId: [
        "Choose a parent objective that belongs to this study track.",
      ],
    };
  }
}

export class CyclicObjectiveParentError extends DomainError {
  readonly code = "CYCLIC_OBJECTIVE_PARENT";

  constructor(
    readonly objectiveId: string,
    readonly parentObjectiveId: string,
  ) {
    super(
      `Objective "${objectiveId}" cannot be moved under "${parentObjectiveId}" because that would create a cycle.`,
    );
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return {
      parentObjectiveId: [
        "An objective cannot be moved under itself or one of its own children.",
      ],
    };
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
