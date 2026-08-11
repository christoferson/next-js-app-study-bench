import "server-only";
import { resolveDatabaseFile } from "@/platform/database/config";
import { runMigrations } from "@/platform/database/migration-runner";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import { openSqliteDatabase } from "@/platform/database/sqlite";
import { SqliteTransactionRunner } from "@/platform/database/sqlite-transaction-runner";

/**
 * The process-wide database container.
 *
 * D2 opened the connection inside the certifications composition root. D3 adds a
 * second module that persists to the same file, so connection ownership moved
 * here: two modules opening two connections would each run migrations against
 * the same file, and two independent transaction runners would issue `BEGIN` on
 * connections that share one write lock. One connection, one migration run, one
 * runner.
 *
 * Module composition roots depend on this container instead of opening a
 * database; nothing else in the application constructs a SQLite connection.
 */
export interface DatabaseContainer {
  readonly database: SqliteDatabase;
  /**
   * Shared transaction runner. Every module's unit of work delegates to it so
   * that transactions on the shared connection are serialised.
   */
  readonly transactions: SqliteTransactionRunner;
}

let container: DatabaseContainer | null = null;

export function getDatabaseContainer(): DatabaseContainer {
  if (container === null) {
    const database = openSqliteDatabase(resolveDatabaseFile());

    runMigrations(database);

    container = {
      database,
      transactions: new SqliteTransactionRunner(database),
    };
  }

  return container;
}
