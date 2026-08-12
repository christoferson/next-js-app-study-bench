import type { CertificationRepository } from "@/modules/certifications/ports/certification-repository";
import type { ObjectiveRepository } from "@/modules/certifications/ports/objective-repository";
import type { QuestionRepository } from "@/modules/question-bank/ports/question-repository";
import type { FlashcardRepository } from "@/modules/flashcards/ports/flashcard-repository";
import type { GenerationRunRepository } from "./generation-run-repository";

/**
 * Repositories bound to one generation transaction.
 *
 * Generation writes across module boundaries by nature: one batch produces a run
 * row plus question or flashcard aggregates plus their objective links, and
 * either all of it commits or none of it does. A run claiming ten items that were
 * never stored, or items pointing at a run row that was rolled back, would both be
 * provenance that lies.
 *
 * The precedent is `FlashcardTransactionRepositories`, which already reaches into
 * the question repository for conversion (`spec/ARCHITECTURE.md` section 7.4).
 * Cross-module composition happens in composition roots, not in facades.
 */
export interface GenerationTransactionRepositories {
  readonly runs: GenerationRunRepository;
  readonly questions: QuestionRepository;
  readonly flashcards: FlashcardRepository;
  readonly certifications: CertificationRepository;
  readonly objectives: ObjectiveRepository;
}

export interface GenerationUnitOfWork {
  transaction<T>(
    operation: (repositories: GenerationTransactionRepositories) => Promise<T>,
  ): Promise<T>;
}
