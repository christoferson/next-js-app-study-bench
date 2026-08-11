import type { QuestionId } from "@/modules/question-bank/domain/question";

/**
 * Dependent-history check consulted before a hard deletion
 * (`SPEC.md` section 6.3.2, `spec/DOMAIN-RULES.md` section 1.3).
 *
 * A question may be deleted only when nothing depends on it. The protected
 * dependent kinds are fixed by the specification, and each arrives with its own
 * milestone:
 *
 * - `ATTEMPTS` — D5 question attempts
 * - `STUDY_SESSIONS` — D5 study-session history
 * - `PRINTED_ARTIFACTS` — D9 study artifacts
 * - `VARIANTS` — variant generation
 * - `REVIEW_RECORDS` — review records
 *
 * In D3 none of those tables exist, so the only implementation reports no
 * dependents and every question is deletable. The check is a port rather than an
 * inline `true` so a later milestone adds its dependency source by implementing
 * this interface and composing it in, with no change to the facade, the delete
 * flow, or the error type. The facade always consults it and always raises
 * `QuestionNotDeletableError` when a dependent is reported, which is behaviour
 * the D3 tests exercise with a stub reporting dependents.
 */

export type QuestionDependencyKind =
  | "ATTEMPTS"
  | "STUDY_SESSIONS"
  | "PRINTED_ARTIFACTS"
  | "VARIANTS"
  | "REVIEW_RECORDS";

export interface QuestionDeletionEligibility {
  readonly deletable: boolean;
  /** The dependent kinds that block deletion. Empty when `deletable`. */
  readonly blockingDependencies: readonly QuestionDependencyKind[];
}

export interface QuestionDependencyChecker {
  checkDeletionEligibility(
    id: QuestionId,
  ): Promise<QuestionDeletionEligibility>;
}

/** Owner-facing label for a blocking dependent kind. */
export function describeDependencyKind(kind: QuestionDependencyKind): string {
  switch (kind) {
    case "ATTEMPTS":
      return "answer attempts";
    case "STUDY_SESSIONS":
      return "study-session history";
    case "PRINTED_ARTIFACTS":
      return "printed study material";
    case "VARIANTS":
      return "generated variants";
    case "REVIEW_RECORDS":
      return "review records";
  }
}
