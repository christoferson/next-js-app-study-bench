import type { QuestionId } from "@/modules/question-bank/domain/question";

/**
 * Dependent-history check consulted before a hard deletion
 * (`SPEC.md` section 6.3.2, `spec/DOMAIN-RULES.md` section 1.3).
 *
 * A question may be deleted only when nothing depends on it. Each dependent kind
 * arrives with the milestone that creates the records:
 *
 * - `ATTEMPTS` — D5 question attempts
 * - `STUDY_SESSIONS` — D5 study-session history
 * - `PRINTED_ARTIFACTS` — D9 study artifacts
 * - `VARIANTS` — variant generation
 * - `REVIEW_RECORDS` — D4 flashcard review records
 * - `DERIVED_FLASHCARDS` — D4 flashcards converted from the question
 *
 * The first five are the list in `SPEC.md` section 6.3.2. `DERIVED_FLASHCARDS`
 * extends it because D4 introduced a record that specification could not name: a
 * flashcard converted from a question stores `source_question_id` as provenance,
 * and deleting the question would erase where the card came from. That is exactly
 * what section 6.3.2 protects against, so it is enumerated rather than ignored;
 * the owner retires the question instead.
 *
 * The check is a port rather than an inline `true` so a later milestone adds its
 * dependency source by implementing this interface and composing it in, with no
 * change to the facade, the delete flow, or the error type. The facade always
 * consults it and always raises `QuestionNotDeletableError` when a dependent is
 * reported.
 */

export type QuestionDependencyKind =
  | "ATTEMPTS"
  | "STUDY_SESSIONS"
  | "PRINTED_ARTIFACTS"
  | "VARIANTS"
  | "REVIEW_RECORDS"
  | "DERIVED_FLASHCARDS";

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
    case "DERIVED_FLASHCARDS":
      return "flashcards made from it";
  }
}
