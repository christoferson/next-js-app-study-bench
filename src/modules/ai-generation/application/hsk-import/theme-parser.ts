import { normalizeLigatures } from "@/shared/text-normalization";

/**
 * Parser for the owner's unofficial notes on HSK 5 topic areas and language
 * tasks.
 *
 * A pure function over a string, like the other import parsers. The notes stay in
 * `external/`, which is gitignored, and nothing here holds one of their topics.
 *
 * **What this document is matters more than its layout.** Unlike the vocabulary
 * list and the syllabus, it is not a publication — it is a chatbot answer that
 * cites third-party study sites. It is therefore imported as `AI_PROPOSED`, never
 * as an official syllabus (`SPEC.md` section 6.2, and `spec/AI-GUIDELINES.md`
 * section 1.3: model-derived content must be identified as such). The parser
 * exists to read a useful list of study themes out of it, not to lend it
 * authority.
 *
 * Two sections are read and the rest of the file is ignored:
 *
 * ```
 * ## The 9 Core Topic Areas
 *
 *    1. Daily Life & Public Services (日常琐事与服务): Apartment renting, …
 *
 * ## The 12 Core Language Tasks (Communication Objectives)
 *
 *    1. 租住房屋 (Renting & Housing): Negotiating clauses, …
 * ```
 *
 * Three properties shape the implementation:
 *
 * - **A section ends at the next `##` heading.** Everything after the two lists —
 *   a duplicate of the official grammar appendix, and a block of prompt text
 *   addressed to a chatbot — is therefore never read. The prompt block in
 *   particular must not reach a model: third-party text does not go into system
 *   instructions (`spec/AI-GUIDELINES.md` section 1.7).
 * - **The two lists name themselves in opposite orders.** A topic is written
 *   `English (中文)` and a task `中文 (English)`, so which side is which is
 *   decided by looking for Chinese characters rather than by position.
 * - **The heading states its own count.** It is read and returned, so a list that
 *   has gained or lost an entry fails the assertion below instead of importing a
 *   different number of objectives than the document claims.
 */

/** One topic area or language task. */
export interface HskThemeEntry {
  /** 1-based position in its list, as the document numbers it. */
  readonly position: number;
  /** The Chinese name, or an empty string when the entry has none. */
  readonly chineseName: string;
  /** The English name or gloss. */
  readonly englishName: string;
  /** The one-line description that follows the colon. */
  readonly description: string;
}

/** One of the two lists, with the count its own heading stated. */
export interface HskThemeList {
  /** The number in the heading, for example 9 in "The 9 Core Topic Areas". */
  readonly statedCount: number;
  readonly entries: readonly HskThemeEntry[];
}

export interface HskThemeOutline {
  readonly topics: HskThemeList;
  readonly tasks: HskThemeList;
}

/** Raised when the notes do not have the structure the parser needs. */
export class HskThemeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HskThemeParseError";
  }
}

export interface HskThemeExpectations {
  readonly topicCount: number;
  readonly taskCount: number;
}

/** What the owner's notes list. */
export const HSK5_THEME_EXPECTATIONS: HskThemeExpectations = {
  topicCount: 9,
  taskCount: 12,
};

/** The heading that opens the topic list, with the count it states. */
const TOPICS_HEADING = /^#+\s*The\s+(\d+)\s+Core\s+Topic\s+Areas\b/i;

/** The heading that opens the task list, with the count it states. */
const TASKS_HEADING = /^#+\s*The\s+(\d+)\s+Core\s+Language\s+Tasks\b/i;

/** Any heading, which is what closes a section. */
const ANY_HEADING = /^#+\s/;

/**
 * One numbered entry: `1. Name (Other name): description`.
 *
 * The name and the parenthesised name are both required, because every entry in
 * both lists has them and an entry missing one would be a layout change worth
 * failing on rather than importing half of.
 */
const ENTRY = /^(\d+)\.\s*(.+?)\s*[（(]([^）)]+)[）)]\s*[:：]\s*(.+)$/;

/** Any CJK ideograph: how the Chinese side of a name is recognised. */
const CJK = /[㐀-鿿]/;

export function parseHskThemeOutline(text: string): HskThemeOutline {
  const lines = toThemeLines(text);

  return {
    topics: readSection(lines, TOPICS_HEADING, "topic areas"),
    tasks: readSection(lines, TASKS_HEADING, "language tasks"),
  };
}

/**
 * Checks a parsed outline against both the counts its own headings state and the
 * counts the import expects.
 *
 * Both checks are worth making. The first catches a list that lost an entry to a
 * layout change, because the heading and the list would then disagree. The second
 * catches a document that has been replaced with a different one, because the
 * heading and the list would agree with each other and not with the import.
 */
export function assertHskThemeOutlineSize(
  outline: HskThemeOutline,
  expectations: HskThemeExpectations = HSK5_THEME_EXPECTATIONS,
): void {
  assertList(outline.topics, expectations.topicCount, "topic area");
  assertList(outline.tasks, expectations.taskCount, "language task");
}

function assertList(list: HskThemeList, expected: number, label: string): void {
  if (list.entries.length !== list.statedCount) {
    throw new HskThemeParseError(
      `The ${label} heading states ${list.statedCount} entries, but ${list.entries.length} could be read. The list layout may have changed.`,
    );
  }

  if (list.entries.length !== expected) {
    throw new HskThemeParseError(
      `Read ${list.entries.length} ${label}(s), not the ${expected} the import expects.`,
    );
  }

  const positions = list.entries.map((entry) => entry.position);
  const contiguous = positions.every(
    (position, index) => position === index + 1,
  );

  if (!contiguous) {
    throw new HskThemeParseError(
      `The ${label} entries are numbered ${positions.join(", ")} rather than 1 to ${expected}.`,
    );
  }
}

/**
 * The notes as trimmed, non-empty lines.
 *
 * Exported for the tests: the list items are indented, and losing that indent is
 * the behaviour most likely to break with a re-paste.
 */
export function toThemeLines(text: string): readonly string[] {
  return normalizeLigatures(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "");
}

function readSection(
  lines: readonly string[],
  heading: RegExp,
  label: string,
): HskThemeList {
  const start = lines.findIndex((line) => heading.test(line));

  if (start === -1) {
    throw new HskThemeParseError(
      `The ${label} section was not found in the notes.`,
    );
  }

  const statedCount = Number(heading.exec(lines[start] ?? "")?.[1] ?? "0");
  const entries: HskThemeEntry[] = [];

  for (const line of lines.slice(start + 1)) {
    // A section ends at the next heading, so nothing after the two lists — the
    // duplicated grammar matrix, the chatbot prompt block — is ever read.
    if (ANY_HEADING.test(line) || line.startsWith("---")) {
      break;
    }

    const match = ENTRY.exec(line);

    if (match === null) {
      continue;
    }

    entries.push(toEntry(match));
  }

  return { statedCount, entries };
}

function toEntry(match: RegExpExecArray): HskThemeEntry {
  const position = Number(match[1] ?? "0");
  const first = (match[2] ?? "").trim();
  const second = (match[3] ?? "").trim();
  const description = (match[4] ?? "").trim();
  const firstIsChinese = CJK.test(first);

  return {
    position,
    chineseName: firstIsChinese ? first : CJK.test(second) ? second : "",
    englishName: firstIsChinese ? second : first,
    description,
  };
}
