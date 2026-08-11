import type { SqliteDatabase } from "@/platform/database/sqlite";
import { SqliteTransactionRunner } from "@/platform/database/sqlite-transaction-runner";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import { SqliteQuestionRepository } from "@/modules/question-bank/infrastructure/sqlite-question-repository";
import type {
  FlashcardTransactionRepositories,
  FlashcardUnitOfWork,
} from "@/modules/flashcards/ports/unit-of-work";
import { SqliteFlashcardRepository } from "./sqlite-flashcard-repository";

/**
 * SQLite unit of work for flashcards.
 *
 * Shares one `SqliteTransactionRunner` with the certification and question-bank
 * units of work when the composition root passes one in, because all three use the
 * same connection and `BEGIN` is connection-wide. Passing no runner (tests,
 * scripts that only use this module) creates a private one for that connection.
 */
export class SqliteFlashcardUnitOfWork implements FlashcardUnitOfWork {
  private readonly repositories: FlashcardTransactionRepositories;

  private readonly runner: SqliteTransactionRunner;

  constructor(database: SqliteDatabase, runner?: SqliteTransactionRunner) {
    this.runner = runner ?? new SqliteTransactionRunner(database);
    this.repositories = {
      flashcards: new SqliteFlashcardRepository(database),
      certifications: new SqliteCertificationRepository(database),
      objectives: new SqliteObjectiveRepository(database),
      questions: new SqliteQuestionRepository(database),
    };
  }

  async transaction<T>(
    operation: (repositories: FlashcardTransactionRepositories) => Promise<T>,
  ): Promise<T> {
    return this.runner.run(async () => operation(this.repositories));
  }
}
