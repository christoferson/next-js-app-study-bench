import type { FlashcardRepository } from "@/modules/flashcards/ports/flashcard-repository";
import type { QuestionRepository } from "@/modules/question-bank/ports/question-repository";
import type { StudySessionRepository } from "./study-session-repository";

/**
 * Repositories bound to one study transaction.
 *
 * The flashcard repository is included because rating a card inside a session is
 * one atomic act with three writes: the review record, the card's schedule, and
 * the session item's completion. `SPEC.md` section 9.6 names both "recording an
 * attempt and updating review scheduling" and "completing a session item" as
 * transaction examples, and inside a session they are the same act — committing
 * the schedule without the item completion would offer the card again, and
 * committing the item without the schedule would lose the rating.
 *
 * The question repository is included because submitting an answer must read the
 * frozen revision it is graded against in the same snapshot that writes the
 * attempt. Grading against a revision read outside the transaction could record a
 * verdict from content that changed before the insert landed.
 */
export interface StudyTransactionRepositories {
  readonly sessions: StudySessionRepository;
  readonly questions: QuestionRepository;
  readonly flashcards: FlashcardRepository;
}

/**
 * Transaction boundary for multi-record study operations, following the reference
 * shape in `SPEC.md` section 9.6.
 *
 * Used by starting a session (abandoning any earlier one, then inserting the
 * session, its tracks, and every composed item), submitting an answer (attempt
 * plus item completion), rating a card in a session (review plus schedule plus
 * item completion), and finishing. Transaction handling never appears in a React
 * component or route handler.
 */
export interface StudyUnitOfWork {
  transaction<T>(
    operation: (repositories: StudyTransactionRepositories) => Promise<T>,
  ): Promise<T>;
}
