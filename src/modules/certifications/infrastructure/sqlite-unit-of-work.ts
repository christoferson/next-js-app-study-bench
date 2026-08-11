import type { SqliteDatabase } from "@/platform/database/sqlite";
import type {
  CertificationTransactionRepositories,
  CertificationUnitOfWork,
} from "@/modules/certifications/ports/unit-of-work";
import { SqliteCertificationRepository } from "./sqlite-certification-repository";
import { SqliteObjectiveRepository } from "./sqlite-objective-repository";

/**
 * SQLite unit of work.
 *
 * `better-sqlite3` is synchronous, so its own `transaction()` helper rejects a
 * callback that returns a promise. The port is promise-based (PostgreSQL in D13
 * will be genuinely asynchronous), so the transaction is driven with explicit
 * `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` statements instead.
 *
 * Because those statements apply to the whole connection, concurrent operations
 * must not interleave inside one transaction. Units of work are therefore
 * serialised through an in-process queue, and every mutating application
 * operation runs inside one. `BEGIN IMMEDIATE` takes the write lock up front so
 * a second process (the seed script) fails fast on the busy timeout rather than
 * midway through.
 */
export class SqliteUnitOfWork implements CertificationUnitOfWork {
  private readonly repositories: CertificationTransactionRepositories;

  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly database: SqliteDatabase) {
    this.repositories = {
      certifications: new SqliteCertificationRepository(database),
      objectives: new SqliteObjectiveRepository(database),
    };
  }

  async transaction<T>(
    operation: (
      repositories: CertificationTransactionRepositories,
    ) => Promise<T>,
  ): Promise<T> {
    const result = this.queue.then(async (): Promise<T> =>
      this.runExclusively(operation),
    );

    // Keep the queue alive after a failed operation without turning that
    // failure into an unhandled rejection on the queue chain itself.
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  private async runExclusively<T>(
    operation: (
      repositories: CertificationTransactionRepositories,
    ) => Promise<T>,
  ): Promise<T> {
    this.database.exec("BEGIN IMMEDIATE");

    try {
      const result = await operation(this.repositories);
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.database.inTransaction) {
        this.database.exec("ROLLBACK");
      }
      throw error;
    }
  }
}
