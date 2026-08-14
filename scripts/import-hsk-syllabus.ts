/**
 * HSK 5 syllabus structure import: `npm run import:hsk-syllabus`.
 *
 * Reads three documents the owner already has — the HSK 5 syllabus as text
 * extracted from their own PDF, its grammar appendix as JSON, and their own notes
 * on the band's topic areas and language tasks — and adds the study structure they
 * describe to the HSK track that `npm run import:real` created: the examination's
 * skills and parts, the syllabus's grammar points, and the notes' themes.
 *
 * A one-off tool, not a product feature, with the same rules as `import:real`. All
 * three files stay in `external/`, which is gitignored, and are read at run time;
 * if one is absent the script explains where to put it and exits without writing
 * anything. Nothing is copied into the repository, and this script prints counts
 * rather than content.
 *
 * Idempotent per root objective: a root that is already on the track is reported
 * as already present and neither it nor its children are written, so a second run
 * is safe. The vocabulary root and its cards are never touched.
 *
 * Separate from `import:real` because that script is idempotent whole-track — it
 * leaves an existing HSK track completely alone, which is what protects the
 * imported vocabulary bank. This one only ever adds objectives to a track that is
 * already there.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveDatabaseFile } from "@/platform/database/config";
import { runMigrations } from "@/platform/database/migration-runner";
import { openSqliteDatabase } from "@/platform/database/sqlite";
import { SqliteTransactionRunner } from "@/platform/database/sqlite-transaction-runner";
import { createImportFacades } from "@/import/composition";
import {
  assertHskExamStructureSize,
  parseHskExamStructure,
} from "@/import/hsk-exam-structure-parser";
import type { HskExamStructure } from "@/import/hsk-exam-structure-parser";
import {
  assertHskGrammarOutlineSize,
  parseHskGrammarOutline,
} from "@/import/hsk-grammar-parser";
import type { HskGrammarOutline } from "@/import/hsk-grammar-parser";
import {
  assertHskThemeOutlineSize,
  parseHskThemeOutline,
} from "@/import/hsk-theme-parser";
import type { HskThemeOutline } from "@/import/hsk-theme-parser";
import {
  importHskSyllabusObjectives,
  planHskSyllabusObjectives,
} from "@/import/hsk-syllabus-importer";
import type { RootImportResult } from "@/import/hsk-syllabus-importer";

/** Where the owner's extracted text and their notes are expected. */
const SOURCE_DIRECTORY = "external/sources";
const SYLLABUS_FILE = "hsk3-level5-syllabus.txt";
const GRAMMAR_FILE = "HSK_3_LEVEL_5_GRAMMAR.json";
const THEMES_FILE = "HSK_3_LEVEL_5_TOPICS.txt";

const SOURCE_FILES: readonly string[] = [
  SYLLABUS_FILE,
  GRAMMAR_FILE,
  THEMES_FILE,
];

async function main(): Promise<void> {
  const structure = parseHskExamStructure(readSource(SYLLABUS_FILE));

  assertHskExamStructureSize(structure);

  const grammar = parseHskGrammarOutline(readSource(GRAMMAR_FILE));

  assertHskGrammarOutlineSize(grammar);

  const themes = parseHskThemeOutline(readSource(THEMES_FILE));

  assertHskThemeOutlineSize(themes);
  reportParse(structure, grammar, themes);

  const plan = planHskSyllabusObjectives({ structure, grammar, themes });
  const file = resolveDatabaseFile();
  const database = openSqliteDatabase(file);

  try {
    const applied = runMigrations(database);

    if (applied.length > 0) {
      console.log(`Applied migrations: ${applied.join(", ")}`);
    }

    console.log(`Database: ${file}`);

    const facades = createImportFacades(
      database,
      new SqliteTransactionRunner(database),
    );
    const result = await importHskSyllabusObjectives(facades, plan, reportRoot);

    console.log(
      `${result.slug}: ${result.objectivesCreated} objective(s) created across ${result.roots.length} root(s).`,
    );
  } finally {
    database.close();
  }
}

/**
 * Reads one source file, or explains what is missing and stops.
 *
 * Names the paths rather than the documents, because the owner knows which of
 * their files is which and a log should not describe someone else's material.
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
        "This import reads three files the owner keeps outside version control:",
        ...SOURCE_FILES.map((file) => `  ${SOURCE_DIRECTORY}/${file}`),
        "",
        `Place all three there and run the import again. The ${SOURCE_DIRECTORY.split("/")[0] ?? "external"}/ directory is gitignored: its contents are never committed.`,
      ].join("\n"),
    );
  }
}

/** What the parsers read, as counts. */
function reportParse(
  structure: HskExamStructure,
  grammar: HskGrammarOutline,
  themes: HskThemeOutline,
): void {
  console.log(
    `Examination: ${structure.skills.length} skills, ${structure.skills.reduce((total, skill) => total + skill.parts.length, 0)} parts, ${structure.totalItemCount} items.`,
  );
  console.log(
    `Grammar appendix: ${grammar.pointCount} points in ${grammar.groups.length} categories.`,
  );
  console.log(
    `Notes: ${themes.topics.entries.length} topic areas, ${themes.tasks.entries.length} language tasks (unofficial).`,
  );
}

function reportRoot(result: RootImportResult): void {
  if (result.alreadyPresent) {
    console.log(
      `${result.title}: already on the track, left unchanged. Delete the root objective to import it again.`,
    );

    return;
  }

  console.log(
    `${result.title}: created with ${result.objectivesCreated} objective(s) including the root.`,
  );
}

main().catch((error: unknown) => {
  console.error("HSK syllabus import failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
