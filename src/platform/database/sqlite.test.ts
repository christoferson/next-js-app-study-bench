import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listAppliedMigrations, runMigrations } from "./migration-runner";
import { MIGRATIONS } from "./migrations";
import { IN_MEMORY_DATABASE, openSqliteDatabase, readPragma } from "./sqlite";

/**
 * File-backed connection tests.
 *
 * WAL is not available for an in-memory database, so these cases use a
 * throwaway directory under the OS temporary path. The real
 * `./data/study-bench.db` is never opened by the test suite.
 */
describe("openSqliteDatabase", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "study-bench-test-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("applies the required pragmas to a file-backed connection", () => {
    const database = openSqliteDatabase(join(directory, "study-bench.db"));

    try {
      expect(readPragma(database, "foreign_keys")).toBe(1);
      expect(readPragma(database, "journal_mode")).toBe("wal");
      expect(readPragma(database, "busy_timeout")).toBe(5000);
    } finally {
      database.close();
    }
  });

  it("creates a missing parent directory for the database file", () => {
    const database = openSqliteDatabase(
      join(directory, "nested", "study-bench.db"),
    );

    try {
      expect(database.open).toBe(true);
    } finally {
      database.close();
    }
  });

  it("keeps data across reconnections to the same file", () => {
    const file = join(directory, "study-bench.db");
    const first = openSqliteDatabase(file);
    runMigrations(first);
    first
      .prepare(
        `INSERT INTO certifications (id, slug, name, provider, study_type,
           description, priority, default_session_minutes, status, origin,
           created_at, updated_at)
         VALUES ('persisted', 'persisted', 'Persisted track', 'Demo', 'GENERAL',
           '', 3, 20, 'ACTIVE', 'OWNER', '2026-01-01T00:00:00.000Z',
           '2026-01-01T00:00:00.000Z')`,
      )
      .run();
    first.close();

    const second = openSqliteDatabase(file);

    try {
      const row = second
        .prepare(`SELECT name FROM certifications WHERE id = 'persisted'`)
        .get();

      expect(row).toEqual({ name: "Persisted track" });
    } finally {
      second.close();
    }
  });
});

describe("runMigrations", () => {
  it("applies every migration on a clean database", () => {
    const database = openSqliteDatabase(IN_MEMORY_DATABASE);

    try {
      const applied = runMigrations(database);

      expect(applied).toEqual(MIGRATIONS.map((migration) => migration.id));
      expect(
        listAppliedMigrations(database).map((migration) => migration.id),
      ).toEqual(MIGRATIONS.map((migration) => migration.id));
    } finally {
      database.close();
    }
  });

  it("is idempotent when run again", () => {
    const database = openSqliteDatabase(IN_MEMORY_DATABASE);

    try {
      runMigrations(database);

      expect(runMigrations(database)).toEqual([]);
      expect(listAppliedMigrations(database)).toHaveLength(MIGRATIONS.length);
    } finally {
      database.close();
    }
  });

  it("creates the expected tables", () => {
    const database = openSqliteDatabase(IN_MEMORY_DATABASE);

    try {
      runMigrations(database);

      const tables = database
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
        )
        .all() as { readonly name: string }[];

      // The full list, so a migration that creates a table nobody expected is a
      // failure rather than a silent addition. Extended in D4 with the flashcard
      // tables from migration 0003, and in D5 with the session and attempt tables
      // from migration 0004.
      expect(tables.map((table) => table.name)).toEqual([
        "certification_objectives",
        "certifications",
        "flashcard_objective_links",
        "flashcard_reviews",
        "flashcard_revisions",
        "flashcards",
        "question_attempts",
        "question_objective_links",
        "question_revisions",
        "questions",
        "review_schedules",
        "schema_migrations",
        "session_certifications",
        "study_session_items",
        "study_sessions",
      ]);
    } finally {
      database.close();
    }
  });

  it("rolls a failing migration back and leaves earlier ones applied", () => {
    const database = openSqliteDatabase(IN_MEMORY_DATABASE);

    try {
      expect(() =>
        runMigrations(database, [
          {
            id: "0001",
            description: "good",
            sql: "CREATE TABLE good (id TEXT);",
          },
          { id: "0002", description: "broken", sql: "CREATE TABLE ;" },
        ]),
      ).toThrow();

      expect(
        listAppliedMigrations(database).map((migration) => migration.id),
      ).toEqual(["0001"]);
    } finally {
      database.close();
    }
  });

  it("reports no applied migrations before the bookkeeping table exists", () => {
    const database = openSqliteDatabase(IN_MEMORY_DATABASE);

    try {
      expect(listAppliedMigrations(database)).toEqual([]);
    } finally {
      database.close();
    }
  });
});
