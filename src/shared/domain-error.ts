/**
 * Base type for expected application failures.
 *
 * Every module raises explicit domain errors with a stable `code`; callers switch
 * on the code or use `isDomainError`, never on a message string
 * (`spec/ARCHITECTURE.md` section 6.5). Each module declares its own code union
 * next to its errors.
 *
 * This lives in `shared/` because D3 introduces a second module (question bank)
 * that needs the same error contract, and neither module owns the other.
 */
export abstract class DomainError extends Error {
  /** Stable, module-declared identifier for this failure. */
  abstract readonly code: string;

  /**
   * Messages keyed by form field name. Every domain error carries field
   * mappings so that a form can render the failure next to its cause; the empty
   * string key holds messages that belong to the form as a whole.
   */
  abstract fieldMessages(): Readonly<Record<string, readonly string[]>>;
}

/** Input that failed schema or invariant validation. */
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

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
