import { DomainError } from "@/shared/domain-error";

/**
 * Domain errors for the certification module.
 *
 * Expected failures are explicit error types with stable codes. Callers must not
 * string-match error messages (`spec/ARCHITECTURE.md` section 6.5).
 *
 * `DomainError`, `ValidationError`, and `isDomainError` moved to
 * `@/shared/domain-error` in D3 so the question-bank module raises errors that
 * the same UI plumbing understands. They are re-exported here so existing
 * imports keep working.
 */

export {
  DomainError,
  ValidationError,
  isDomainError,
} from "@/shared/domain-error";

export type CertificationDomainErrorCode =
  | "SLUG_CONFLICT"
  | "CERTIFICATION_NOT_FOUND"
  | "OBJECTIVE_NOT_FOUND"
  | "INVALID_PARENT_OBJECTIVE"
  | "CYCLIC_OBJECTIVE_PARENT";

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
