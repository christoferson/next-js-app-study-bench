import type { QuestionId } from "@/modules/question-bank/domain/question";
import type {
  QuestionDeletionEligibility,
  QuestionDependencyChecker,
} from "@/modules/question-bank/ports/question-dependency-checker";
import type { FlashcardRepository } from "@/modules/flashcards/ports/flashcard-repository";

/**
 * Reports flashcards converted from a question as dependents of that question.
 *
 * D4 created the first records that depend on a question: a converted card stores
 * `source_question_id` as provenance. Deleting the question would erase where the
 * card came from, which is what `SPEC.md` section 6.3.2 and
 * `spec/DOMAIN-RULES.md` section 1.3 forbid — the owner retires the question
 * instead. The `ON DELETE RESTRICT` foreign key is the backstop; this checker is
 * what lets the detail view say so before the owner clicks delete.
 *
 * It lives in the flashcards module because the flashcards module owns that table,
 * and it implements the question-bank port so the question-bank facade, delete
 * flow, and error type are unchanged. The composition root wires the two together.
 *
 * The other protected kinds — attempts, study sessions, printed artifacts,
 * variants — still have no tables, so nothing here reports them. D5 composes an
 * additional checker for attempts and sessions rather than editing this one.
 */
export class FlashcardQuestionDependencyChecker implements QuestionDependencyChecker {
  constructor(private readonly flashcards: FlashcardRepository) {}

  async checkDeletionEligibility(
    id: QuestionId,
  ): Promise<QuestionDeletionEligibility> {
    const derived = await this.flashcards.listBySourceQuestion(id);

    return derived.length === 0
      ? { deletable: true, blockingDependencies: [] }
      : { deletable: false, blockingDependencies: ["DERIVED_FLASHCARDS"] };
  }
}
