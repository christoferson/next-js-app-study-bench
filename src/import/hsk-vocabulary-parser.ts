import {
  findUnmappedRadicals,
  normalizeCjkRadicals,
  normalizeLigatures,
} from "./text-normalization";

/**
 * Parser for a tabular HSK vocabulary list, as extracted text.
 *
 * A pure function over a string, for the same reason as the exam-guide parser: the
 * word list is the owner's own third-party document and stays outside the
 * repository (`external/`, gitignored). Nothing here contains a Chinese word, a
 * pinyin reading, or an English gloss from it.
 *
 * The row layout it reads is one table row per word, wrapped across as many lines
 * as the English column needed:
 *
 * ```
 * 2001<hanzi> <pinyin> interj. hey!; (interjection used to attract
 * attention or to express surprise or
 * disapprobation)Spoken
 * ```
 *
 * Five properties of the extraction shape the implementation:
 *
 * - **The running number is glued to the word.** There is no separator between
 *   `2001` and the first character, so a row starts at a four-digit number
 *   followed immediately by a non-space.
 * - **The English column wraps** with no hyphenation marker of its own, and the
 *   continuation lines carry no row number, so a line that is not a row start
 *   belongs to the row above it.
 * - **The register is glued to the end of the meaning**, and an optional `New`
 *   flag is glued after the register: `disapprobation)Spoken`,
 *   `admirationSpokenNew`.
 * - **Page furniture repeats**: a cover line, a column header on every page, and
 *   a footer with a page number.
 * - **Ligatures and radical codepoints** must be repaired before anything is
 *   stored, or the words are unsearchable (`text-normalization.ts`).
 *
 * The parser reports what it could not read rather than guessing: an unreadable
 * row is returned in `skipped` with its running number only, so the caller can
 * decide whether the loss is acceptable and can say so without quoting the
 * source.
 */

/** One parsed vocabulary row. */
export interface HskVocabularyEntry {
  /** The list's own running number, for example 2001. */
  readonly number: number;
  /** The word in simplified Chinese, with radical codepoints repaired. */
  readonly term: string;
  /** Pinyin with tone marks. */
  readonly reading: string;
  /** Part of speech as the list abbreviates it, for example `v./n.`. */
  readonly partOfSpeech: string;
  /** The English gloss, rejoined from however many lines it wrapped across. */
  readonly meaning: string;
  readonly register: HskRegister;
  /** True when the list marks the word as new in this syllabus revision. */
  readonly isNewInSyllabus: boolean;
}

/** The registers the list distinguishes. */
export type HskRegister = "Spoken" | "Written" | "Neutral";

export const HSK_REGISTERS: readonly HskRegister[] = [
  "Spoken",
  "Written",
  "Neutral",
];

/** A row the parser could not read, identified by number only. */
export interface SkippedHskRow {
  /** The row's running number, or `null` when even that could not be read. */
  readonly number: number | null;
  /** Which part of the row failed, for a report that quotes no content. */
  readonly reason: HskSkipReason;
}

export type HskSkipReason =
  "NO_REGISTER" | "NO_PART_OF_SPEECH" | "NO_MEANING" | "NO_TERM";

export interface HskVocabularyList {
  readonly entries: readonly HskVocabularyEntry[];
  readonly skipped: readonly SkippedHskRow[];
  /** How many entries needed a radical codepoint repaired in their term. */
  readonly radicalRepairCount: number;
  /**
   * Radical codepoints this build has no mapping for, if any.
   *
   * Non-empty means some term still holds a radical character and would be
   * unsearchable, so the import treats it as a failure.
   */
  readonly unmappedRadicals: readonly string[];
}

/** Raised when the text does not have the structure the parser needs. */
export class HskVocabularyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HskVocabularyParseError";
  }
}

/** What the HSK 5 list is expected to yield (`SPEC.md` has no opinion; the list states it). */
export interface HskListExpectations {
  /** Exact number of words the list claims to contain. */
  readonly wordCount: number;
  /** Fewest entries an import will accept before failing outright. */
  readonly minimumEntryCount: number;
}

export const HSK5_EXPECTATIONS: HskListExpectations = {
  wordCount: 1600,
  minimumEntryCount: 1590,
};

/**
 * A row start: four digits followed immediately by a non-space character.
 *
 * The "followed immediately" part matters — it is what distinguishes a row start
 * from a wrapped English line that happens to begin with a year.
 */
const ROW_START = /^(\d{4})(\S.*)$/;

/** The register, and the optional `New` flag, glued to the end of a row. */
const REGISTER_TAIL = /(Spoken|Written|Neutral)(New)?$/;

/**
 * A part-of-speech token, which separates the reading from the meaning.
 *
 * The list writes compounds with slashes (`v./n.`, `adj./adv.`) and occasionally
 * annotates one (`n.(time)`, `n.(prop.)`), so the token is matched by its first
 * abbreviation rather than as a closed list of compounds. `idiom` carries no
 * trailing dot, and 数量 ("measure word / quantity") is written in Chinese in a
 * handful of rows.
 */
const PART_OF_SPEECH = new RegExp(
  `^(?:${[
    "n",
    "v",
    "adj",
    "adv",
    "pron",
    "prep",
    "conj",
    "mw",
    "interj",
    "onom",
    "part",
    "num",
    "suf",
    "pref",
    "aux",
  ].join("|")})\\.|^idiom$|^数量`,
);

/** Page furniture: lines that carry no vocabulary. */
const FURNITURE: readonly RegExp[] = [
  // Cover banner.
  /^MANDARIN ZONE$/,
  // Column header, repeated on every page. Starts with the "#" of the number
  // column followed by the Chinese word for "characters".
  /^#汉字/,
  // Page footer with "Page n / m".
  /Page \d+\s*\/\s*\d+$/,
  // Cover subtitle lines, recognised by the list's own title and summary.
  /^New HSK \d+ Vocabulary List/,
  /^All [\d,]+ New HSK \d+ words/,
];

export function parseHskVocabularyList(text: string): HskVocabularyList {
  const rows = toVocabularyRows(text);
  const entries: HskVocabularyEntry[] = [];
  const skipped: SkippedHskRow[] = [];
  let radicalRepairCount = 0;
  const unmapped = new Set<string>();

  for (const row of rows) {
    const parsed = parseRow(row);

    if ("reason" in parsed) {
      skipped.push(parsed);

      continue;
    }

    if (parsed.entry.term !== parsed.rawTerm) {
      radicalRepairCount += 1;
    }

    for (const radical of findUnmappedRadicals(parsed.entry.term)) {
      unmapped.add(radical);
    }

    entries.push(parsed.entry);
  }

  return {
    entries,
    skipped,
    radicalRepairCount,
    unmappedRadicals: [...unmapped],
  };
}

/**
 * Checks a parsed list against what the document should contain.
 *
 * A shortfall inside the tolerance is not an error — the caller reports the exact
 * count and the numbers of the rows it lost — but a shortfall below it, a
 * surplus, or a term still holding an unmapped radical is.
 */
export function assertHskVocabularyListSize(
  list: HskVocabularyList,
  expectations: HskListExpectations = HSK5_EXPECTATIONS,
): void {
  if (list.unmappedRadicals.length > 0) {
    throw new HskVocabularyParseError(
      `${list.unmappedRadicals.length} radical codepoint(s) in the word list have no simplified-character mapping (${list.unmappedRadicals
        .map((radical) => `U+${codepointOf(radical)}`)
        .join(
          ", ",
        )}). Importing them would store words that cannot be searched for.`,
    );
  }

  if (list.entries.length > expectations.wordCount) {
    throw new HskVocabularyParseError(
      `Parsed ${list.entries.length} vocabulary entries, more than the ${expectations.wordCount} the list contains. The row detection is matching something that is not a word.`,
    );
  }

  if (list.entries.length < expectations.minimumEntryCount) {
    throw new HskVocabularyParseError(
      `Parsed only ${list.entries.length} of ${expectations.wordCount} vocabulary entries. The extracted text may be truncated or its layout may have changed.`,
    );
  }

  const duplicates = findDuplicateNumbers(list.entries);

  if (duplicates.length > 0) {
    throw new HskVocabularyParseError(
      `These row numbers appear more than once: ${duplicates.join(", ")}.`,
    );
  }
}

/**
 * The table rows, each rejoined into one line.
 *
 * Exported for the tests: rejoining a wrapped English column is the behaviour
 * most likely to break with a new extraction, and asserting it directly is
 * clearer than asserting it through a parsed entry.
 */
export function toVocabularyRows(text: string): readonly string[] {
  const lines = normalizeLigatures(text)
    // A form feed marks a page break and carries no content.
    .replace(/\f/g, "\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !isFurniture(line));
  const rows: string[] = [];

  for (const line of lines) {
    if (ROW_START.test(line) || rows.length === 0) {
      rows.push(line);

      continue;
    }

    const previous = rows[rows.length - 1] ?? "";

    // A wrapped English column resumes mid-phrase, and the extraction dropped
    // the line break rather than a space, so one space is the right join. A line
    // the extraction hyphenated at the break ("high-" / "speed") is joined
    // without one, because the hyphen already separates the parts.
    rows[rows.length - 1] = previous.endsWith("-")
      ? `${previous}${line}`
      : `${previous} ${line}`;
  }

  return rows.filter((row) => ROW_START.test(row));
}

function isFurniture(line: string): boolean {
  return FURNITURE.some((pattern) => pattern.test(line));
}

/** A successfully read row, plus its term before radical repair. */
interface ParsedRow {
  readonly entry: HskVocabularyEntry;
  readonly rawTerm: string;
}

function parseRow(row: string): ParsedRow | SkippedHskRow {
  const start = ROW_START.exec(row);
  const number = start?.[1];
  const remainder = start?.[2];

  if (number === undefined || remainder === undefined) {
    return { number: null, reason: "NO_TERM" };
  }

  const rowNumber = Number(number);
  const tail = REGISTER_TAIL.exec(remainder.trimEnd());

  if (tail === null || tail.index === undefined) {
    return { number: rowNumber, reason: "NO_REGISTER" };
  }

  const register = toRegister(tail[1]);

  if (register === null) {
    return { number: rowNumber, reason: "NO_REGISTER" };
  }

  const body = remainder.trimEnd().slice(0, tail.index).trim();
  const tokens = body.split(/\s+/);
  const rawTerm = tokens[0];

  if (rawTerm === undefined || rawTerm === "") {
    return { number: rowNumber, reason: "NO_TERM" };
  }

  // The reading may be more than one token: a few rows write a two-word pinyin
  // ("cóng bù") and the idioms hyphenate syllable groups. The part of speech is
  // therefore found by scanning forward, and everything before it is the reading.
  const partOfSpeechIndex = tokens.findIndex(
    (token, index) => index > 0 && PART_OF_SPEECH.test(token),
  );

  if (partOfSpeechIndex === -1) {
    return { number: rowNumber, reason: "NO_PART_OF_SPEECH" };
  }

  const reading = tokens.slice(1, partOfSpeechIndex).join(" ");
  const partOfSpeech = tokens[partOfSpeechIndex] ?? "";
  const meaning = tokens.slice(partOfSpeechIndex + 1).join(" ");

  if (meaning === "") {
    return { number: rowNumber, reason: "NO_MEANING" };
  }

  return {
    rawTerm,
    entry: {
      number: rowNumber,
      term: normalizeCjkRadicals(rawTerm),
      reading: normalizeCjkRadicals(reading),
      partOfSpeech,
      meaning: normalizeCjkRadicals(meaning),
      register,
      isNewInSyllabus: tail[2] !== undefined,
    },
  };
}

function toRegister(value: string | undefined): HskRegister | null {
  return HSK_REGISTERS.find((register) => register === value) ?? null;
}

function findDuplicateNumbers(
  entries: readonly HskVocabularyEntry[],
): readonly number[] {
  const seen = new Set<number>();
  const duplicates = new Set<number>();

  for (const entry of entries) {
    if (seen.has(entry.number)) {
      duplicates.add(entry.number);
    }

    seen.add(entry.number);
  }

  return [...duplicates];
}

function codepointOf(character: string): string {
  return (character.codePointAt(0) ?? 0).toString(16).toUpperCase();
}
