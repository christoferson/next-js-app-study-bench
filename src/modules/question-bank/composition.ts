import "server-only";
import { systemClock } from "@/platform/clock";
import { cryptoIdGenerator } from "@/platform/id-generator";
import { getDatabaseContainer } from "@/platform/database/composition";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { SqliteTransactionRunner } from "@/platform/database/sqlite-transaction-runner";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import { QuestionBankFacade } from "@/modules/question-bank/application/question-bank-facade";
import { NoDependencyChecker } from "@/modules/question-bank/infrastructure/no-dependency-checker";
import { SqliteQuestionBankUnitOfWork } from "@/modules/question-bank/infrastructure/sqlite-question-bank-unit-of-work";
import { SqliteQuestionRepository } from "@/modules/question-bank/infrastructure/sqlite-question-repository";

/**
 * Server-only composition root for the question bank.
 *
 * Uses the shared connection and transaction runner, so question-bank writes and
 * certification writes cannot deadlock each other on the same SQLite write lock.
 *
 * The dependency checker is composed here rather than constructed inside the
 * facade: D5 replaces `NoDependencyChecker` with an attempt-aware checker by
 * changing this one line.
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
    dependencies: new NoDependencyChecker(),
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
