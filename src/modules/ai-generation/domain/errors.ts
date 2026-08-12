import { DomainError } from "@/shared/domain-error";
import type { GenerationFailureCategory } from "./generation-run";
import { describeFailureCategory } from "./generation-run";

/**
 * Domain errors for the ai-generation module.
 *
 * Expected failures are explicit error types with stable codes, each mapping its
 * message to the form field that caused it (`spec/ARCHITECTURE.md` section 6.5).
 *
 * None of these errors carries a provider message, request identifier, or stack
 * trace. A provider failure is reduced to a category before it reaches this
 * module's error types, so nothing that could contain account or credential
 * detail can be rendered or logged (`spec/SECURITY.md`).
 */

export type GenerationDomainErrorCode =
  | "GENERATION_RUN_NOT_FOUND"
  | "GENERATION_NOT_CONFIGURED"
  | "GENERATION_BATCH_TOO_LARGE"
  | "GENERATED_DRAFT_NOT_REJECTABLE";

export class GenerationRunNotFoundError extends DomainError {
  readonly code = "GENERATION_RUN_NOT_FOUND";

  constructor(readonly runId: string) {
    super(`No generation run matches "${runId}".`);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": ["That generation run no longer exists."] };
  }
}

/**
 * The batch limit, enforced in the facade as well as in the schema.
 *
 * Two enforcement points on purpose: the schema stops a hostile form post, and
 * the facade stops a caller that bypassed the schema. Cost control must not
 * depend on one layer being reached (`SPEC.md` section 11.6).
 */
export class GenerationBatchTooLargeError extends DomainError {
  readonly code = "GENERATION_BATCH_TOO_LARGE";

  constructor(
    readonly requested: number,
    readonly maximum: number,
  ) {
    super(`A batch may contain at most ${maximum} items.`);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return {
      itemCount: [
        `Ask for ${this.maximum} items or fewer. Generation is synchronous and each item costs a model call.`,
      ],
    };
  }
}

/**
 * A draft the owner asked to reject can no longer be rejected.
 *
 * Reachable from a stale run page: the draft was activated or already rejected in
 * another tab. Deleting an activated item would remove content the owner has since
 * put into study.
 */
export class GeneratedDraftNotRejectableError extends DomainError {
  readonly code = "GENERATED_DRAFT_NOT_REJECTABLE";

  constructor(readonly reason: string) {
    super(reason);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": [this.reason] };
  }
}

/**
 * Generation was attempted without usable model configuration.
 *
 * Raised at composition in production, and surfaced on the generate form so the
 * owner sees a configuration problem rather than a failed run.
 */
export class GenerationNotConfiguredError extends DomainError {
  readonly code = "GENERATION_NOT_CONFIGURED";

  constructor(readonly detail: string) {
    super(detail);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": [this.detail] };
  }
}

/**
 * A provider failure reduced to a category.
 *
 * Not a `DomainError`: it never reaches a form. The facade catches it, records
 * the category on the run, and returns the run — a failed run is a recorded
 * outcome the owner can read, not an exception the interface has to render.
 */
export class ProviderFailure extends Error {
  constructor(
    readonly category: GenerationFailureCategory,
    /** Safe, category-derived text. Never the provider's own message. */
    message: string = describeFailureCategory(category),
  ) {
    super(message);
    this.name = "ProviderFailure";
  }
}
