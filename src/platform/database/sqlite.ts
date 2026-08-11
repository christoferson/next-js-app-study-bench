import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

/**
 * SQLite connection factory.
 *
 * SQLite is the local-development and personal-POC database only; PostgreSQL
 * arrives in D13. This module is the single place that opens a driver
 * connection, so the pragmas required by `SPEC.md` section 9.2 cannot be
 * forgotten by a caller.
 */
export type SqliteDatabase = Database.Database;

/** `:memory:` is used by tests so they never touch the real database file. */
export const IN_MEMORY_DATABASE = ":memory:";

export function openSqliteDatabase(file: string): SqliteDatabase {
  if (file !== IN_MEMORY_DATABASE) {
    mkdirSync(dirname(file), { recursive: true });
  }

  const database = new Database(file);

  // Required on every connection: foreign keys are off by default in SQLite,
  // WAL keeps readers from blocking the single writer, and the busy timeout
  // absorbs short lock contention between concurrent Next.js requests.
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");

  return database;
}

/** Reads a pragma that returns a single scalar value. */
export function readPragma(
  database: SqliteDatabase,
  pragma: string,
): string | number {
  const value: unknown = database.pragma(pragma, { simple: true });

  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`Pragma "${pragma}" returned an unexpected value.`);
  }

  return value;
}
