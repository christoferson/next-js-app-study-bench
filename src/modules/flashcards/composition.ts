import "server-only";
import { systemClock } from "@/platform/clock";
import { cryptoIdGenerator } from "@/platform/id-generator";
import { getDatabaseContainer } from "@/platform/database/composition";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { SqliteTransactionRunner } from "@/platform/database/sqlite-transaction-runner";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import { FlashcardFacade } from "@/modules/flashcards/application/flashcard-facade";
import { DeterministicReviewScheduler } from "@/modules/flashcards/domain/review-scheduling";
import { SqliteFlashcardRepository } from "@/modules/flashcards/infrastructure/sqlite-flashcard-repository";
import { SqliteFlashcardUnitOfWork } from "@/modules/flashcards/infrastructure/sqlite-flashcard-unit-of-work";

/**
 * Server-only composition root for flashcards.
 *
 * Uses the shared connection and transaction runner, so flashcard writes cannot
 * deadlock against certification or question-bank writes on the same SQLite write
 * lock.
 *
 * The scheduling strategy is composed here rather than constructed inside the
 * facade: replacing the deterministic algorithm with a spaced-repetition model is
 * one line in this file and no change to the facade, the routes, or persistence
 * (`SPEC.md` section 6.5).
 */
export function createFlashcardFacade(
  database: SqliteDatabase,
  runner?: SqliteTransactionRunner,
): FlashcardFacade {
  return new FlashcardFacade({
    flashcards: new SqliteFlashcardRepository(database),
    certifications: new SqliteCertificationRepository(database),
    objectives: new SqliteObjectiveRepository(database),
    unitOfWork: new SqliteFlashcardUnitOfWork(database, runner),
    scheduler: new DeterministicReviewScheduler(systemClock),
    clock: systemClock,
    ids: cryptoIdGenerator,
  });
}

let facade: FlashcardFacade | null = null;

export function getFlashcardFacade(): FlashcardFacade {
  if (facade === null) {
    const container = getDatabaseContainer();

    facade = createFlashcardFacade(container.database, container.transactions);
  }

  return facade;
}
