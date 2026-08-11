import type {
  QuestionDeletionEligibility,
  QuestionDependencyChecker,
} from "@/modules/question-bank/ports/question-dependency-checker";

/**
 * The D3 dependency checker: nothing depends on a question yet.
 *
 * Attempts, study-session history, printed artifacts, variants, and review
 * records are the protected dependents in `SPEC.md` section 6.3.2, and none of
 * those tables exists before D5. Reporting "no dependents" is therefore the
 * truthful answer today, not a stub standing in for missing logic.
 *
 * When D5 adds attempts, it adds a checker that queries them and composes it in
 * place of this one; the facade, the delete transaction, and
 * `QuestionNotDeletableError` do not change.
 */
export class NoDependencyChecker implements QuestionDependencyChecker {
  // The question id is not read: the answer is the same for every question until
  // a milestone adds a table that can depend on one.
  async checkDeletionEligibility(): Promise<QuestionDeletionEligibility> {
    return { deletable: true, blockingDependencies: [] };
  }
}
