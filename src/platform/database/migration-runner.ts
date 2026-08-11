import type { Migration } from "@/platform/database/migrations";
import { MIGRATIONS } from "@/platform/database/migrations";
import type { SqliteDatabase } from "@/platform/database/sqlite";

/**
 * Minimal hand-rolled migration runner.
 *
 * Each pending migration runs inside its own transaction together with the
 * `schema_migrations` bookkeeping insert, so a failure leaves the database on
 * the last fully applied version rather than half-migrated. No migration
 * framework is used.
 */
export interface AppliedMigration {
  readonly id: string;
  readonly appliedAt: string;
}

const MIGRATION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;
`;

interface MigrationRow {
  readonly id: string;
  readonly applied_at: string;
}

export function runMigrations(
  database: SqliteDatabase,
  migrations: readonly Migration[] = MIGRATIONS,
  appliedAt: string = new Date().toISOString(),
): readonly string[] {
  database.exec(MIGRATION_TABLE_SQL);

  const alreadyApplied = new Set(
    listAppliedMigrations(database).map((migration) => migration.id),
  );
  const applied: string[] = [];

  for (const migration of ordered(migrations)) {
    if (alreadyApplied.has(migration.id)) {
      continue;
    }

    const apply = database.transaction(() => {
      database.exec(migration.sql);
      database
        .prepare(
          `INSERT INTO schema_migrations (id, description, applied_at)
           VALUES (?, ?, ?)`,
        )
        .run(migration.id, migration.description, appliedAt);
    });

    apply();
    applied.push(migration.id);
  }

  return applied;
}

export function listAppliedMigrations(
  database: SqliteDatabase,
): readonly AppliedMigration[] {
  const tableExists =
    database
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`,
      )
      .get() !== undefined;

  if (!tableExists) {
    return [];
  }

  const rows = database
    .prepare(`SELECT id, applied_at FROM schema_migrations ORDER BY id`)
    .all() as MigrationRow[];

  return rows.map((row) => ({ id: row.id, appliedAt: row.applied_at }));
}

function ordered(migrations: readonly Migration[]): readonly Migration[] {
  return [...migrations].sort((left, right) => left.id.localeCompare(right.id));
}
