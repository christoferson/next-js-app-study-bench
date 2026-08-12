/**
 * Real-content import: `npm run import:real`.
 *
 * Reads two documents the owner already has — an official AWS exam guide and a
 * New HSK 5 word list, both as text extracted from their own PDFs — and writes
 * the study structure they describe into the database: the guide's content
 * domains and tasks as an objective map, and every HSK 5 word as an active
 * vocabulary card.
 *
 * A one-off tool, not a product feature. There is no source library, nothing is
 * uploaded, and neither document is copied into the repository or into the
 * database. Both files stay in `external/`, which is gitignored, and are read at
 * run time; if they are absent the script explains where to put them and exits
 * without writing anything. That is why the parsers hold no exam wording and no
 * vocabulary of their own (`src/import/`), and why this script prints counts
 * rather than content.
 *
 * Idempotent by track slug: a track that already exists is reported as already
 * imported and is left completely untouched, so a second run is safe and does not
 * produce a second copy.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveDatabaseFile } from "@/platform/database/config";
import { runMigrations } from "@/platform/database/migration-runner";
import { openSqliteDatabase } from "@/platform/database/sqlite";
import { SqliteTransactionRunner } from "@/platform/database/sqlite-transaction-runner";
import {
  assertExamGuideOutlineSize,
  parseExamGuideOutline,
} from "@/import/exam-guide-parser";
import {
  assertHskVocabularyListSize,
  HSK5_EXPECTATIONS,
  parseHskVocabularyList,
} from "@/import/hsk-vocabulary-parser";
import type { HskVocabularyList } from "@/import/hsk-vocabulary-parser";
import { createImportFacades } from "@/import/composition";
import {
  importExamGuideTrack,
  importHskVocabularyTrack,
} from "@/import/real-content-importer";
import type {
  ImportProgress,
  TrackImportResult,
} from "@/import/real-content-importer";

/**
 * Where the owner's extracted text is expected.
 *
 * Relative to the repository root and outside version control. Named for the
 * documents rather than for their content, so this script names no exam and no
 * syllabus edition it has not been given.
 */
const SOURCE_DIRECTORY = "external/sources";
const EXAM_GUIDE_FILE = "ai-professional-01.txt";
const VOCABULARY_FILE = "hsk5-vocabulary-list-2026.txt";

/**
 * The track descriptions, written here rather than lifted from the documents.
 *
 * Paraphrased in the owner's own words on purpose: a description is displayed
 * text, and copying a publisher's blurb into the database would put third-party
 * wording in a field the owner owns.
 */
const EXAM_GUIDE_DESCRIPTION =
  "Professional-level AWS certification covering the design, build, and operation of generative AI applications on AWS: foundation model selection, prompt engineering, retrieval-augmented generation, agents, fine-tuning, evaluation, and the security and cost controls a production workload needs. Objectives imported from the official exam guide.";

const VOCABULARY_DESCRIPTION =
  "Band 5 of the HSK Chinese proficiency examination under the HSK 3.0 standard, whose 2025 syllabus sets 1,600 new words for this level. Imported as one vocabulary flashcard per word, with pinyin, English meaning, and register.";

async function main(): Promise<void> {
  const guideText = readSource(EXAM_GUIDE_FILE);
  const vocabularyText = readSource(VOCABULARY_FILE);
  const outline = parseExamGuideOutline(guideText);

  assertExamGuideOutlineSize(outline);

  const vocabulary = parseHskVocabularyList(vocabularyText);

  assertHskVocabularyListSize(vocabulary);
  reportParse(outline.domains.length, outline.tasks.length, vocabulary);

  const file = resolveDatabaseFile();
  const database = openSqliteDatabase(file);

  try {
    const applied = runMigrations(database);

    if (applied.length > 0) {
      console.log(`Applied migrations: ${applied.join(", ")}`);
    }

    console.log(`Database: ${file}`);

    // One runner for the whole script: `BEGIN` is connection-wide, so two runners
    // on one connection could interleave transactions.
    const facades = createImportFacades(
      database,
      new SqliteTransactionRunner(database),
    );
    const guideResult = await importExamGuideTrack(
      facades,
      outline,
      EXAM_GUIDE_DESCRIPTION,
    );

    reportTrack(guideResult);

    const vocabularyResult = await importHskVocabularyTrack(
      facades,
      vocabulary,
      VOCABULARY_DESCRIPTION,
      reportProgress,
    );

    reportTrack(vocabularyResult);
  } finally {
    database.close();
  }
}

/**
 * Reads one source file, or explains what is missing and stops.
 *
 * The message names the path and the file rather than the document, because the
 * owner knows which of their PDFs is which and a log should not describe someone
 * else's material.
 */
function readSource(name: string): string {
  const path = resolve(process.cwd(), SOURCE_DIRECTORY, name);

  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(
      [
        `Could not read ${SOURCE_DIRECTORY}/${name}.`,
        "",
        "This import reads two text files the owner extracts from their own PDFs:",
        `  ${SOURCE_DIRECTORY}/${EXAM_GUIDE_FILE}`,
        `  ${SOURCE_DIRECTORY}/${VOCABULARY_FILE}`,
        "",
        `Place both files there and run the import again. The ${SOURCE_DIRECTORY.split("/")[0] ?? "external"}/ directory is gitignored: its contents are never committed.`,
      ].join("\n"),
    );
  }
}

/** What the parsers read, as counts. */
function reportParse(
  domainCount: number,
  taskCount: number,
  vocabulary: HskVocabularyList,
): void {
  console.log(
    `Exam guide: ${domainCount} content domains, ${taskCount} tasks.`,
  );
  console.log(
    `Word list: ${vocabulary.entries.length} of ${HSK5_EXPECTATIONS.wordCount} words, ${vocabulary.radicalRepairCount} with a repaired radical codepoint.`,
  );

  if (vocabulary.skipped.length > 0) {
    // Numbers and reasons only: enough to look a row up in the source, with
    // nothing of the row itself in the log.
    console.log(
      `Word list: ${vocabulary.skipped.length} row(s) could not be read: ${vocabulary.skipped
        .map((row) => `${row.number ?? "unnumbered"} (${row.reason})`)
        .join(", ")}.`,
    );
  }
}

function reportTrack(result: TrackImportResult): void {
  if (result.alreadyImported) {
    console.log(
      `${result.slug}: already imported, left unchanged. Delete or archive the track to import it again.`,
    );

    return;
  }

  console.log(
    `${result.slug}: created with ${result.rootObjectivesCreated} top-level objective(s), ${result.childObjectivesCreated} child objective(s), ${result.flashcardsCreated} flashcard(s).`,
  );
}

function reportProgress(progress: ImportProgress): void {
  console.log(
    `${progress.slug}: ${progress.cardsWritten} of ${progress.cardsTotal} flashcards written.`,
  );
}

main().catch((error: unknown) => {
  console.error("Real-content import failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
