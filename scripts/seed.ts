/**
 * Explicit demo-content seed: `npm run seed`.
 *
 * Inserts the two clearly labelled demo study tracks and their demo objectives
 * into the local SQLite database. Idempotent by slug: a demo track that already
 * exists is reported as skipped and left untouched. Nothing is edited, and
 * nothing is deleted.
 *
 * This is a development convenience, not a migration. Migrations create schema;
 * this script only inserts optional demo rows.
 */
import { systemClock } from "@/platform/clock";
import { cryptoIdGenerator } from "@/platform/id-generator";
import { resolveDatabaseFile } from "@/platform/database/config";
import { runMigrations } from "@/platform/database/migration-runner";
import { openSqliteDatabase } from "@/platform/database/sqlite";
import { seedDemoContent } from "@/modules/certifications/infrastructure/demo-seed";
import { SqliteUnitOfWork } from "@/modules/certifications/infrastructure/sqlite-unit-of-work";

async function main(): Promise<void> {
  const file = resolveDatabaseFile();
  const database = openSqliteDatabase(file);

  try {
    const applied = runMigrations(database);

    if (applied.length > 0) {
      console.log(`Applied migrations: ${applied.join(", ")}`);
    }

    const outcome = await seedDemoContent({
      unitOfWork: new SqliteUnitOfWork(database),
      clock: systemClock,
      ids: cryptoIdGenerator,
    });

    console.log(`Database: ${file}`);
    console.log(
      outcome.inserted.length > 0
        ? `Inserted demo tracks: ${outcome.inserted.join(", ")}`
        : "Inserted demo tracks: none",
    );
    console.log(
      outcome.skipped.length > 0
        ? `Already present, left unchanged: ${outcome.skipped.join(", ")}`
        : "Already present, left unchanged: none",
    );
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  console.error("Seeding failed.");
  console.error(error);
  process.exitCode = 1;
});
