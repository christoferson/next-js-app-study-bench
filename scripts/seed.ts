/**
 * Explicit demo-content seed: `npm run seed`.
 *
 * Inserts the two clearly labelled demo study tracks with their demo objectives,
 * then fills each track's question bank and flashcard bank with demo items, so a
 * fresh database has something studiable in it rather than two empty banks.
 *
 * Idempotent, in two layers:
 *
 * - Tracks are idempotent by slug: a demo track that already exists is reported
 *   as skipped and left untouched.
 * - Bank content is idempotent per bank: a bank that already holds any item is
 *   left completely alone. An empty bank receives the whole demo set.
 *
 * Nothing is edited, and nothing is deleted. Every demo item is written through
 * the question-bank and flashcard facades, so it passes the same validation and
 * carries the same `MANUAL` provenance as content the owner writes; the seed has
 * no SQL of its own.
 *
 * This is a development convenience, not a migration. Migrations create schema;
 * this script only inserts optional demo rows.
 */
import { systemClock } from "@/platform/clock";
import { cryptoIdGenerator } from "@/platform/id-generator";
import { resolveDatabaseFile } from "@/platform/database/config";
import { runMigrations } from "@/platform/database/migration-runner";
import { openSqliteDatabase } from "@/platform/database/sqlite";
import { SqliteTransactionRunner } from "@/platform/database/sqlite-transaction-runner";
import { seedDemoContent } from "@/modules/certifications/infrastructure/demo-seed";
import { SqliteUnitOfWork } from "@/modules/certifications/infrastructure/sqlite-unit-of-work";
import { seedDemoBanksInto } from "@/seed/composition";

async function main(): Promise<void> {
  const file = resolveDatabaseFile();
  const database = openSqliteDatabase(file);

  try {
    const applied = runMigrations(database);

    if (applied.length > 0) {
      console.log(`Applied migrations: ${applied.join(", ")}`);
    }

    // One runner for the whole script, shared by the track seed and the bank
    // seed: `BEGIN` is connection-wide, so two runners on one connection could
    // interleave transactions.
    const transactions = new SqliteTransactionRunner(database);
    const outcome = await seedDemoContent({
      unitOfWork: new SqliteUnitOfWork(database, transactions),
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

    const banks = await seedDemoBanksInto(database, transactions);

    for (const track of banks.tracks) {
      console.log(`Demo content for ${track.slug}: ${describeBank(track)}`);
    }
  } finally {
    database.close();
  }
}

/** One line per track, saying what was written and what was left alone. */
function describeBank(track: {
  readonly trackFound: boolean;
  readonly questionsInserted: number;
  readonly flashcardsInserted: number;
  readonly questionsSkipped: boolean;
  readonly flashcardsSkipped: boolean;
}): string {
  if (!track.trackFound) {
    return "track not present, nothing written";
  }

  return [
    track.questionsSkipped
      ? "questions already present, left unchanged"
      : `${track.questionsInserted} questions inserted`,
    track.flashcardsSkipped
      ? "flashcards already present, left unchanged"
      : `${track.flashcardsInserted} flashcards inserted`,
  ].join("; ");
}

main().catch((error: unknown) => {
  console.error("Seeding failed.");
  console.error(error);
  process.exitCode = 1;
});
