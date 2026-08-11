import type { SqliteDatabase } from "@/platform/database/sqlite";

/**
 * Serialises SQLite transactions for one connection.
 *
 * `better-sqlite3` is synchronous, so its own `transaction()` helper rejects a
 * callback that returns a promise. The unit-of-work ports are promise-based
 * (PostgreSQL in D13 will be genuinely asynchronous), so a transaction is driven
 * with explicit `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` statements instead.
 *
 * Those statements apply to the whole connection, so two operations must never
 * interleave inside one transaction and a transaction must never nest. One
 * runner therefore owns one connection and queues every operation. Because
 * StudyBench shares a single connection across modules, every module's unit of
 * work delegates to the same runner instance; a module-private queue would allow
 * two modules to issue `BEGIN` concurrently on the same connection.
 *
 * A unit of work must not be started from inside another unit of work: the
 * queued operation would wait for a transaction that cannot finish until it
 * returns. No D3 flow does this.
 *
 * `BEGIN IMMEDIATE` takes the write lock up front so a second process (the seed
 * script) fails fast on the busy timeout rather than midway through.
 */
export class SqliteTransactionRunner {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly database: SqliteDatabase) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
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

  private async runExclusively<T>(operation: () => Promise<T>): Promise<T> {
    this.database.exec("BEGIN IMMEDIATE");

    try {
      const result = await operation();
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
