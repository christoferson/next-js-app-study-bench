import type { ProposedObjective } from "@/modules/ai-generation/domain/objective-import";
import {
  MAX_DETERMINISTIC_IMPORT_NODES,
  MAX_IMPORT_STRATEGY_FILES,
} from "@/modules/ai-generation/domain/import-strategy";
import {
  HskExamStructureParseError,
  parseHskExamStructure,
} from "./exam-structure-parser";
import type { HskExamStructure } from "./exam-structure-parser";
import { HskGrammarParseError, parseHskGrammarOutline } from "./grammar-parser";
import type { HskGrammarOutline } from "./grammar-parser";
import { HskThemeParseError, parseHskThemeOutline } from "./theme-parser";
import type { HskThemeOutline } from "./theme-parser";
import { planHskSyllabusObjectives } from "./objective-plan";
import type { PlannedObjective } from "./objective-plan";

/**
 * The `HSK_EXAMINATION` import strategy: several files in, one proposed tree out.
 *
 * The whole reason this strategy exists is that the HSK syllabus is three documents, not
 * one, and none of them is prose. The examination structure is numbered sections with a
 * bullet per part, the grammar appendix is a four-column JSON table, and the theme notes
 * are two numbered lists — and a model handed the extracted text of any of them returns
 * an empty outline or an invention. The parsers beside this file read them exactly; this
 * file decides *which parser gets which file* and converts the result into the same
 * `ProposedObjectiveTree` the AI extraction produces, so the confirm page, the run
 * record, and the apply step are unchanged.
 *
 * **Roles are classified, then overridable.** Auto-classification is a convenience, not
 * a guarantee: it tries each parser's own probe against the file and reports what it
 * found, and every file also carries a role select on the form. That ordering matters
 * because the alternative — guessing from the filename — would be wrong for exactly the
 * owner who renamed their files.
 *
 * **Any subset is valid.** Grammar alone is a legitimate import, as is the syllabus text
 * alone. Requiring all three would send the owner back to the CLI for the level whose
 * theme notes they never wrote.
 *
 * **Nothing is asserted against HSK 5's own counts here.** The CLI script calls
 * `assertHskExamStructureSize` and friends because it is importing one known document
 * and a short read means the extraction broke. The web flow deliberately does not: the
 * owner may be importing HSK 4, whose paper has a different number of items, and the
 * confirm page shows them the whole tree before anything is written — which is a better
 * check than a hard-coded count that would refuse every other level.
 */

/** What one uploaded file is read as. */
export type HskFileRole =
  | "SYLLABUS_STRUCTURE"
  | "GRAMMAR_APPENDIX"
  | "THEME_NOTES"
  | "IGNORE"
  | "UNRECOGNIZED";

/** The roles the owner may choose on the form, in the order they are offered. */
export const HSK_SELECTABLE_FILE_ROLES: readonly HskFileRole[] = [
  "SYLLABUS_STRUCTURE",
  "GRAMMAR_APPENDIX",
  "THEME_NOTES",
  "IGNORE",
];

export function describeHskFileRole(role: HskFileRole): string {
  switch (role) {
    case "SYLLABUS_STRUCTURE":
      return "Syllabus structure";
    case "GRAMMAR_APPENDIX":
      return "Grammar appendix";
    case "THEME_NOTES":
      return "Theme notes";
    case "IGNORE":
      return "Ignore this file";
    case "UNRECOGNIZED":
      return "Not recognised";
  }
}

/** One file, as text, with the role it should be read as. */
export interface HskImportFile {
  readonly filename: string;
  readonly text: string;
  /** The role the owner chose, or `null` to classify the content. */
  readonly role: HskFileRole | null;
}

/** What one file turned out to be, and whether reading it worked. */
export interface HskFileReading {
  readonly filename: string;
  /** The role actually used: the owner's choice when they made one, else the guess. */
  readonly role: HskFileRole;
  /** True when the role came from the owner rather than from classification. */
  readonly roleWasChosen: boolean;
  /** What the file contributed, in the owner's terms. Empty when nothing. */
  readonly summary: string;
  /** Why the file could not be read as its role. `null` when it could. */
  readonly problem: string | null;
}

/** The outcome of reading one upload of several files. */
export interface HskImportReading {
  readonly files: readonly HskFileReading[];
  readonly roots: readonly ProposedObjective[];
  /** Every objective the plan carries, at every level. */
  readonly nodeCount: number;
}

/**
 * What one file looks like, without committing to reading it.
 *
 * Each probe is the parser's own recognition rule, run cheaply:
 *
 * - **Grammar** is JSON that parses to the appendix's four columns. The parser is asked
 *   rather than the text sniffed, because "is this the grammar table" and "can the
 *   grammar parser read this" are the same question and having two answers to it is how
 *   a file gets classified as grammar and then fails.
 * - **Syllabus structure** is text carrying the layout markers the structure parser
 *   anchors on: a skill heading (听力 / 阅读 / 书写) and at least one part bullet (◎ …
 *   第…部分). Both, not either, because the invigilation script mentions the skill names
 *   in prose and the grammar table contains no bullets.
 * - **Theme notes** are the two numbered-list headings the theme parser looks for.
 *
 * Order matters: JSON is tested first because a JSON file is never any of the others,
 * and the theme probe last because its headings are English and could in principle
 * appear in a mixed document, in which case the Chinese structural markers are the
 * stronger signal.
 */
export function classifyHskFile(text: string): HskFileRole {
  if (looksLikeGrammarAppendix(text)) {
    return "GRAMMAR_APPENDIX";
  }

  if (looksLikeSyllabusStructure(text)) {
    return "SYLLABUS_STRUCTURE";
  }

  if (looksLikeThemeNotes(text)) {
    return "THEME_NOTES";
  }

  return "UNRECOGNIZED";
}

/** A skill heading the structure parser anchors on. */
const SKILL_HEADING = /(听力|阅读|书写)/;

/** A part bullet, which is what distinguishes the structure section from prose. */
const PART_BULLET = /◎\s*第[一二三四五六七八九十]+部分/;

/** The theme notes' own two headings. */
const THEME_HEADINGS = [
  /^#+\s*The\s+\d+\s+Core\s+Topic\s+Areas\b/im,
  /^#+\s*The\s+\d+\s+Core\s+Language\s+Tasks\b/im,
];

function looksLikeGrammarAppendix(text: string): boolean {
  const trimmed = text.trimStart();

  // Cheap gate before a JSON parse of a possibly large file: the appendix is an array.
  if (!trimmed.startsWith("[")) {
    return false;
  }

  try {
    parseHskGrammarOutline(text);

    return true;
  } catch {
    return false;
  }
}

function looksLikeSyllabusStructure(text: string): boolean {
  return SKILL_HEADING.test(text) && PART_BULLET.test(text);
}

function looksLikeThemeNotes(text: string): boolean {
  return THEME_HEADINGS.every((heading) => heading.test(text));
}

/**
 * Reads an upload of several files into one proposed tree.
 *
 * Per-file failures are collected rather than thrown: an owner who uploaded the syllabus
 * and a grammar file with one renamed column should get the syllabus imported and be told
 * about the grammar file, not lose both. The one thing that *is* refused outright is a
 * second file claiming a role another file already filled, because two syllabus texts in
 * one submission means the owner mis-set a role and silently keeping the first would
 * import half of what they chose.
 */
export function readHskImportFiles(
  files: readonly HskImportFile[],
): HskImportReading {
  const readings: HskFileReading[] = [];
  let structure: HskExamStructure | null = null;
  let grammar: HskGrammarOutline | null = null;
  let themes: HskThemeOutline | null = null;

  for (const file of files.slice(0, MAX_IMPORT_STRATEGY_FILES)) {
    const role = file.role ?? classifyHskFile(file.text);
    const roleWasChosen = file.role !== null;

    if (role === "IGNORE" || role === "UNRECOGNIZED") {
      readings.push({
        filename: file.filename,
        role,
        roleWasChosen,
        summary: "",
        problem:
          role === "UNRECOGNIZED"
            ? "This file does not look like the syllabus structure, the grammar appendix, or theme notes. Choose what it is, or leave it out."
            : null,
      });

      continue;
    }

    const taken =
      (role === "SYLLABUS_STRUCTURE" && structure !== null) ||
      (role === "GRAMMAR_APPENDIX" && grammar !== null) ||
      (role === "THEME_NOTES" && themes !== null);

    if (taken) {
      readings.push({
        filename: file.filename,
        role,
        roleWasChosen,
        summary: "",
        problem: `Another file is already being read as the ${describeHskFileRole(role).toLowerCase()}. Only one file fills each role — set this one to a different role, or ignore it.`,
      });

      continue;
    }

    try {
      switch (role) {
        case "SYLLABUS_STRUCTURE": {
          structure = parseHskExamStructure(file.text);

          const parts = structure.skills.reduce(
            (total, skill) => total + skill.parts.length,
            0,
          );

          if (structure.skills.length === 0) {
            throw new HskExamStructureParseError(
              "No examination sections could be read from this file.",
            );
          }

          readings.push({
            filename: file.filename,
            role,
            roleWasChosen,
            summary: `${structure.skills.length} skill section(s), ${parts} part(s), ${structure.totalItemCount} items.`,
            problem: null,
          });

          break;
        }
        case "GRAMMAR_APPENDIX": {
          grammar = parseHskGrammarOutline(file.text);
          readings.push({
            filename: file.filename,
            role,
            roleWasChosen,
            summary: `${grammar.pointCount} grammar point(s) in ${grammar.groups.length} categories.`,
            problem: null,
          });

          break;
        }
        case "THEME_NOTES": {
          themes = parseHskThemeOutline(file.text);
          readings.push({
            filename: file.filename,
            role,
            roleWasChosen,
            summary: `${themes.topics.entries.length} topic area(s), ${themes.tasks.entries.length} language task(s), unofficial.`,
            problem: null,
          });

          break;
        }
      }
    } catch (error) {
      // Only the parsers' own errors are reported to the owner. They are written to name
      // a row or a section and never to quote the document's content
      // (`spec/SECURITY.md` section 4), which is what makes them safe to show.
      if (
        error instanceof HskExamStructureParseError ||
        error instanceof HskGrammarParseError ||
        error instanceof HskThemeParseError
      ) {
        if (role === "SYLLABUS_STRUCTURE") {
          structure = null;
        }

        readings.push({
          filename: file.filename,
          role,
          roleWasChosen,
          summary: "",
          problem: error.message,
        });

        continue;
      }

      throw error;
    }
  }

  const roots = toProposedObjectives(
    planHskSyllabusObjectives({ structure, grammar, themes }),
  );

  return {
    files: readings,
    roots,
    nodeCount: roots.reduce((total, root) => total + countNodes(root), 0),
  };
}

/**
 * A group of planned objectives as proposed ones.
 *
 * Two conversions happen here and both are about the difference between writing straight
 * to the repository, which the CLI script does, and going through the import flow, which
 * this does.
 *
 * **`sourceType` is dropped.** A `ProposedObjective` has no source type because the
 * confirm page asks the owner for one claim covering the whole import, and that is the
 * right place for the question: the plan's own split — official for the syllabus subtrees,
 * `AI_PROPOSED` for the theme roots — is a fact about *documents the CLI script knows it
 * is holding*, and on the web the owner may have uploaded anything under any role. So the
 * owner states the provenance, exactly as they do for an AI extraction.
 *
 * **A code repeated among siblings is dropped.** The plan codes every grammar leaf with
 * its group's name, so a picker row reads `复句 — ……，便……`, which means a category's
 * points all carry the same code. That is fine for the CLI, which writes rows directly,
 * and it is refused by `checkProposedTree`, which requires codes to be distinct within a
 * sibling group so a proposal cannot claim two objectives are the same section. The code
 * is the redundant half of that pairing — the group heading it names is the parent — so
 * the duplicate is cleared rather than made unique with a suffix, which would invent a
 * reference the document does not have. The first sibling keeps it.
 *
 * Slice B, which merges into an existing tree per item, is where a per-root source type
 * becomes worth carrying: at that point each root is confirmed separately and can claim
 * its own provenance.
 */
export function toProposedObjectives(
  planned: readonly PlannedObjective[],
): readonly ProposedObjective[] {
  const seen = new Set<string>();

  return planned.map((node) => {
    const code = node.code === null ? null : node.code.trim().toLowerCase();
    const duplicate = code !== null && code.length > 0 && seen.has(code);

    if (code !== null && code.length > 0) {
      seen.add(code);
    }

    return {
      code: duplicate ? null : node.code,
      title: node.title,
      description: node.description,
      weight: node.weight,
      children: toProposedObjectives(node.children),
    };
  });
}

function countNodes(node: ProposedObjective): number {
  return (
    1 + node.children.reduce((total, child) => total + countNodes(child), 0)
  );
}

/** The cap this strategy's output is checked against. Re-exported for the tests. */
export { MAX_DETERMINISTIC_IMPORT_NODES };
