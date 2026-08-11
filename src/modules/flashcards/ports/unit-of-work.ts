import type { CertificationRepository } from "@/modules/certifications/ports/certification-repository";
import type { ObjectiveRepository } from "@/modules/certifications/ports/objective-repository";
import type { QuestionRepository } from "@/modules/question-bank/ports/question-repository";
import type { FlashcardRepository } from "./flashcard-repository";

/**
 * Repositories bound to one flashcard transaction.
 *
 * The certification and objective repositories are included because objective
 * mapping must validate an objective against the card's certification inside the
 * same transaction that writes the links.
 *
 * The question repository is included for conversion: turning a question into a
 * card reads the question and its objective mappings, and those reads must see
 * the same snapshot as the writes that copy them.
 */
export interface FlashcardTransactionRepositories {
  readonly flashcards: FlashcardRepository;
  readonly certifications: CertificationRepository;
  readonly objectives: ObjectiveRepository;
  readonly questions: QuestionRepository;
}

/**
 * Transaction boundary for multi-record flashcard operations, following the
 * reference shape in `SPEC.md` section 9.6.
 *
 * Used by create (root plus revision 1), edit (append revision plus current
 * pointer), objective-mapping replacement, conversion (read question, write card
 * plus revision plus links), and — the one the acceptance criteria name
 * explicitly — recording a review, where the review record and the schedule must
 * commit together or not at all. Transaction handling never appears in a React
 * component or route handler.
 */
export interface FlashcardUnitOfWork {
  transaction<T>(
    operation: (repositories: FlashcardTransactionRepositories) => Promise<T>,
  ): Promise<T>;
}
