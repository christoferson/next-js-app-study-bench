import type { SqliteDatabase } from "@/platform/database/sqlite";
import { SqliteTransactionRunner } from "@/platform/database/sqlite-transaction-runner";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import type {
  QuestionBankTransactionRepositories,
  QuestionBankUnitOfWork,
} from "@/modules/question-bank/ports/unit-of-work";
import { SqliteQuestionRepository } from "./sqlite-question-repository";

/**
 * SQLite unit of work for the question bank.
 *
 * Shares one `SqliteTransactionRunner` with the certification unit of work when
 * the composition root passes one in, because both modules use the same
 * connection and `BEGIN` is connection-wide. Passing no runner (tests, scripts
 * that only use this module) creates a private one for that connection.
 */
export class SqliteQuestionBankUnitOfWork implements QuestionBankUnitOfWork {
  private readonly repositories: QuestionBankTransactionRepositories;

  private readonly runner: SqliteTransactionRunner;

  constructor(database: SqliteDatabase, runner?: SqliteTransactionRunner) {
    this.runner = runner ?? new SqliteTransactionRunner(database);
    this.repositories = {
      questions: new SqliteQuestionRepository(database),
      certifications: new SqliteCertificationRepository(database),
      objectives: new SqliteObjectiveRepository(database),
    };
  }

  async transaction<T>(
    operation: (
      repositories: QuestionBankTransactionRepositories,
    ) => Promise<T>,
  ): Promise<T> {
    return this.runner.run(async () => operation(this.repositories));
  }
}
