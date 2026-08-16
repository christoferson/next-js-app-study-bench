import type { SqliteDatabase } from "@/platform/database/sqlite";
import { SqliteTransactionRunner } from "@/platform/database/sqlite-transaction-runner";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import type {
  SourceTransactionRepositories,
  SourceUnitOfWork,
} from "@/modules/sources/ports/unit-of-work";
import { SqliteSourceRepository } from "./sqlite-source-repository";

/**
 * SQLite unit of work for the source library.
 *
 * Shares the connection-wide `SqliteTransactionRunner` when the composition root passes
 * one, for the reason every other module's does: `BEGIN` applies to the connection, so a
 * private runner here would let a source import and a question write issue `BEGIN`
 * against the same connection at once.
 */
export class SqliteSourceUnitOfWork implements SourceUnitOfWork {
  private readonly repositories: SourceTransactionRepositories;

  private readonly runner: SqliteTransactionRunner;

  constructor(database: SqliteDatabase, runner?: SqliteTransactionRunner) {
    this.runner = runner ?? new SqliteTransactionRunner(database);
    this.repositories = {
      sources: new SqliteSourceRepository(database),
      certifications: new SqliteCertificationRepository(database),
      objectives: new SqliteObjectiveRepository(database),
    };
  }

  async transaction<T>(
    operation: (repositories: SourceTransactionRepositories) => Promise<T>,
  ): Promise<T> {
    return this.runner.run(async () => operation(this.repositories));
  }
}
