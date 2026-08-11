import "server-only";
import { systemClock } from "@/platform/clock";
import { cryptoIdGenerator } from "@/platform/id-generator";
import { getDatabaseContainer } from "@/platform/database/composition";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { SqliteTransactionRunner } from "@/platform/database/sqlite-transaction-runner";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import { QuestionBankFacade } from "@/modules/question-bank/application/question-bank-facade";
import { SqliteQuestionBankUnitOfWork } from "@/modules/question-bank/infrastructure/sqlite-question-bank-unit-of-work";
import { SqliteQuestionRepository } from "@/modules/question-bank/infrastructure/sqlite-question-repository";
import { FlashcardQuestionDependencyChecker } from "@/modules/flashcards/infrastructure/flashcard-question-dependency-checker";
import { SqliteFlashcardRepository } from "@/modules/flashcards/infrastructure/sqlite-flashcard-repository";

/**
 * Server-only composition root for the question bank.
 *
 * Uses the shared connection and transaction runner, so question-bank writes and
 * certification writes cannot deadlock each other on the same SQLite write lock.
 *
 * The dependency checker is composed here rather than constructed inside the
 * facade, which is what lets D4 replace the D3 "nothing depends on a question yet"
 * checker with one that reports converted flashcards, without touching the facade,
 * the delete flow, or the error type. The cross-module import belongs here for the
 * same reason: composition roots are where modules are wired together, and the
 * question bank still depends only on its own port.
 */
export function createQuestionBankFacade(
  database: SqliteDatabase,
  runner?: SqliteTransactionRunner,
): QuestionBankFacade {
  return new QuestionBankFacade({
    questions: new SqliteQuestionRepository(database),
    certifications: new SqliteCertificationRepository(database),
    objectives: new SqliteObjectiveRepository(database),
    unitOfWork: new SqliteQuestionBankUnitOfWork(database, runner),
    dependencies: new FlashcardQuestionDependencyChecker(
      new SqliteFlashcardRepository(database),
    ),
    clock: systemClock,
    ids: cryptoIdGenerator,
  });
}

let facade: QuestionBankFacade | null = null;

export function getQuestionBankFacade(): QuestionBankFacade {
  if (facade === null) {
    const container = getDatabaseContainer();

    facade = createQuestionBankFacade(
      container.database,
      container.transactions,
    );
  }

  return facade;
}
