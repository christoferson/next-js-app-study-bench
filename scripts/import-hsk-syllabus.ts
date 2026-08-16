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

/**
 * Defaults are the HSK 5 documents this script was written for. Another level
 * is imported by naming its track and files (owner request, 2026-08-16):
 *
 *   npm run import:hsk-syllabus -- --track hsk-4-chinese \
 *     --syllabus hsk4-syllabus.txt --grammar HSK_4_GRAMMAR.json \
 *     --themes HSK_4_TOPICS.txt
 *
 * Any file flag may be omitted to use the HSK 5 default; --themes may be set
 * to "none" when no theme notes exist for the level (themes are the one
 * unofficial, optional input).
 */
interface CliOptions {
  readonly track: string | undefined;
  readonly syllabusFile: string;
  readonly grammarFile: string;
  readonly themesFile: string | null;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];

    if (flag?.startsWith("--")) {
      const value = argv[index + 1];

      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Flag ${flag} needs a value.`);
      }

      values.set(flag.slice(2), value);
      index += 1;
    }
  }

  const themes = values.get("themes") ?? "HSK_3_LEVEL_5_TOPICS.txt";

  return {
    track: values.get("track"),
    syllabusFile: values.get("syllabus") ?? "hsk3-level5-syllabus.txt",
    grammarFile: values.get("grammar") ?? "HSK_3_LEVEL_5_GRAMMAR.json",
    themesFile: themes === "none" ? null : themes,
  };
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const structure = parseHskExamStructure(readSource(options.syllabusFile));

  assertHskExamStructureSize(structure);

  const grammar = parseHskGrammarOutline(readSource(options.grammarFile));

  assertHskGrammarOutlineSize(grammar);

  let themes: HskThemeOutline | null = null;

  if (options.themesFile !== null) {
    themes = parseHskThemeOutline(readSource(options.themesFile));
    assertHskThemeOutlineSize(themes);
  }

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
    const result = await importHskSyllabusObjectives(
      facades,
      plan,
      reportRoot,
      options.track,
    );

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
        "This import reads the owner's files from outside version control:",
        `  a syllabus text (--syllabus, default hsk3-level5-syllabus.txt)`,
        `  a grammar appendix JSON (--grammar, default HSK_3_LEVEL_5_GRAMMAR.json)`,
        `  optional theme notes (--themes, default HSK_3_LEVEL_5_TOPICS.txt; pass "none" to skip)`,
        "",
        `Place the named file under ${SOURCE_DIRECTORY}/ and run the import again. The directory is gitignored: its contents are never committed.`,
      ].join("\n"),
    );
  }
}

/** What the parsers read, as counts. */
function reportParse(
  structure: HskExamStructure,
  grammar: HskGrammarOutline,
  themes: HskThemeOutline | null,
): void {
  console.log(
    `Examination: ${structure.skills.length} skills, ${structure.skills.reduce((total, skill) => total + skill.parts.length, 0)} parts, ${structure.totalItemCount} items.`,
  );
  console.log(
    `Grammar appendix: ${grammar.pointCount} points in ${grammar.groups.length} categories.`,
  );
  console.log(
    themes === null
      ? "Notes: none (themes skipped)."
      : `Notes: ${themes.topics.entries.length} topic areas, ${themes.tasks.entries.length} language tasks (unofficial).`,
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
