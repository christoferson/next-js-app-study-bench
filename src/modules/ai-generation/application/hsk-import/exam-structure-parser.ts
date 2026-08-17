import {
  normalizeCjkNumberSpacing,
  normalizeLigatures,
} from "@/shared/text-normalization";

/**
 * Parser for the examination structure section of the HSK 5 syllabus, as
 * extracted text.
 *
 * A pure function over a string, for the same reason as the vocabulary and
 * exam-guide parsers: the syllabus is the owner's own copy of a third-party
 * document and stays in `external/`, which is gitignored. Nothing here holds a
 * sentence of it. The Chinese that does appear is structural — the three skill
 * names the sections are anchored on and the bullet marker — exactly as the
 * vocabulary parser anchors on its column header.
 *
 * The layout it reads is a numbered heading per skill followed by one bullet per
 * part:
 *
 * ```
 * 1． 听力
 * ◎ 第一部分，共20题。每题听一次。每题会听到一个对话和一个问题，
 * 考生根据听到的内容选出答案。
 * ◎ 第二部分，共25题。…
 * 2. 阅读
 * ◎ 第一部分，共15题。…
 * ```
 *
 * Three properties of the extraction shape the implementation:
 *
 * - **A running header is glued to the front of a line.** The first skill heading
 *   arrives as `│HSK考试大纲  五级│ 41． 听力`, so a leading `│…│` segment and the
 *   page number after it are stripped before anything is matched.
 * - **A bullet wraps** with no marker of its own, and a continuation line carries
 *   nothing that identifies it. A bullet is therefore treated as continuing until
 *   its text ends in a full stop (`。`), which is what closes every complete one.
 * - **The skill names recur** later in the document, in the invigilation script.
 *   A heading for a skill whose parts have already been read is ignored, so the
 *   later prose cannot append to or reset a section.
 * - **Two extractions of the same page space the numbers differently.** `pypdf`
 *   writes `共20题`; `pdf.js`, which is what the web upload path uses, writes
 *   `共 20 题`. The lines are therefore run through
 *   `normalizeCjkNumberSpacing` before anything is matched, and the patterns below
 *   tolerate stray whitespace anyway — a count is the one thing in this document
 *   that must not be lost to a space.
 *
 * The parser reads the item counts rather than trusting a table: the count in each
 * bullet is what the assertion below checks against the 100 items the examination
 * states, and it is what gives each skill its weighting on import.
 */

/** The three skills the examination is divided into. */
export type HskExamSkillKind = "LISTENING" | "READING" | "WRITING";

export const HSK_EXAM_SKILL_KINDS: readonly HskExamSkillKind[] = [
  "LISTENING",
  "READING",
  "WRITING",
];

/** One part of one skill. */
export interface HskExamPart {
  /** The syllabus's own name for the part, for example 第一部分. */
  readonly code: string;
  /** 1 for 第一部分, 2 for 第二部分, and so on. */
  readonly position: number;
  /** How many items the part contains, as the syllabus states. */
  readonly itemCount: number;
  /** The part's format description, rejoined from however many lines it wrapped across. */
  readonly description: string;
}

export interface HskExamSkill {
  readonly kind: HskExamSkillKind;
  /** The syllabus's own name for the skill, for example 听力. */
  readonly code: string;
  readonly parts: readonly HskExamPart[];
}

export interface HskExamStructure {
  readonly skills: readonly HskExamSkill[];
  /** Every part's item count added up. */
  readonly totalItemCount: number;
}

/** Raised when the text does not have the structure the parser needs. */
export class HskExamStructureParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HskExamStructureParseError";
  }
}

export interface HskExamStructureExpectations {
  /** How many parts each skill must have. */
  readonly partCounts: Readonly<Record<HskExamSkillKind, number>>;
  /** How many items the whole examination has. */
  readonly totalItemCount: number;
}

/** What the HSK 5 syllabus states about its own structure. */
export const HSK5_STRUCTURE_EXPECTATIONS: HskExamStructureExpectations = {
  partCounts: { LISTENING: 2, READING: 3, WRITING: 2 },
  totalItemCount: 100,
};

/**
 * The skill headings, by the syllabus's own name for each.
 *
 * Structural anchors rather than content: these three words are how the sections
 * are found, in the same way that `#汉字` is how the vocabulary parser finds its
 * table header.
 */
const SKILL_CODES: readonly {
  readonly kind: HskExamSkillKind;
  readonly code: string;
}[] = [
  { kind: "LISTENING", code: "听力" },
  { kind: "READING", code: "阅读" },
  { kind: "WRITING", code: "书写" },
];

/**
 * The bullet that opens one part, with its ordinal and its item count.
 *
 * Whitespace-tolerant at every join, as defence in depth behind
 * `normalizeCjkNumberSpacing`: a count that a future extraction spaces some third
 * way must still be read, because a bullet this fails to match is a part silently
 * missing from the import rather than an error.
 */
const PART_BULLET =
  /^◎\s*(第\s*([一二三四五六七八九十]+)\s*部分)\s*[，,]\s*共\s*(\d+)\s*题/;

/** Chinese ordinals, in order, so 一 is 1 and 十 is 10. */
const ORDINALS = "一二三四五六七八九十";

/** A full stop closes a bullet; anything else means it wrapped. */
const SENTENCE_END = "。";

export function parseHskExamStructure(text: string): HskExamStructure {
  const collected = new Map<HskExamSkillKind, HskExamPart[]>();
  const order: HskExamSkillKind[] = [];
  let current: HskExamSkillKind | null = null;

  for (const line of toStructureLines(text)) {
    const heading = readHeading(line);

    if (heading !== null) {
      const existing = collected.get(heading);

      // A heading for a skill that already has parts is a later mention in the
      // prose, not a second section.
      if (existing !== undefined && existing.length > 0) {
        current = null;

        continue;
      }

      current = heading;

      if (!collected.has(heading)) {
        collected.set(heading, []);
        order.push(heading);
      }

      continue;
    }

    const parts = current === null ? undefined : collected.get(current);

    if (parts === undefined) {
      continue;
    }

    const bullet = PART_BULLET.exec(line);

    if (bullet !== null) {
      parts.push(toPart(line, bullet));

      continue;
    }

    const last = parts[parts.length - 1];

    if (last !== undefined && !last.description.endsWith(SENTENCE_END)) {
      parts[parts.length - 1] = {
        ...last,
        description: `${last.description}${line}`,
      };
    }
  }

  const skills = order.map((kind) => ({
    kind,
    code: codeFor(kind),
    parts: collected.get(kind) ?? [],
  }));

  return {
    skills,
    totalItemCount: skills.reduce(
      (total, skill) =>
        total + skill.parts.reduce((sum, part) => sum + part.itemCount, 0),
      0,
    ),
  };
}

/**
 * Checks a parsed structure against what the syllabus states about itself.
 *
 * Strict in both directions. A missing part or a miscounted item would produce an
 * objective map that misdescribes the examination, and the whole point of
 * importing the structure rather than typing it is that it is the document's own.
 */
export function assertHskExamStructureSize(
  structure: HskExamStructure,
  expectations: HskExamStructureExpectations = HSK5_STRUCTURE_EXPECTATIONS,
): void {
  if (structure.skills.length !== HSK_EXAM_SKILL_KINDS.length) {
    throw new HskExamStructureParseError(
      `Expected ${HSK_EXAM_SKILL_KINDS.length} skill sections, but read ${structure.skills.length}. The syllabus layout may have changed.`,
    );
  }

  for (const kind of HSK_EXAM_SKILL_KINDS) {
    const skill = structure.skills.find((entry) => entry.kind === kind);
    const expected = expectations.partCounts[kind];

    if (skill === undefined) {
      throw new HskExamStructureParseError(
        `The ${kind.toLowerCase()} section was not found.`,
      );
    }

    // Explicitly before the count check, so the failure an extraction change
    // actually produces — a heading found, no bullets under it — names itself
    // instead of arriving as an off-by-two part count.
    if (skill.parts.length === 0) {
      throw new HskExamStructureParseError(
        `The ${kind.toLowerCase()} section was found but no part bullets could be read from it. The extraction of this document may space its item counts differently than the parser expects.`,
      );
    }

    if (skill.parts.length !== expected) {
      throw new HskExamStructureParseError(
        `Expected ${expected} part(s) in the ${kind.toLowerCase()} section, but read ${skill.parts.length}.`,
      );
    }

    const positions = skill.parts.map((part) => part.position);
    const contiguous = positions.every(
      (position, index) => position === index + 1,
    );

    if (!contiguous) {
      throw new HskExamStructureParseError(
        `The ${kind.toLowerCase()} parts are numbered ${positions.join(", ")} rather than 1 to ${expected}.`,
      );
    }
  }

  if (structure.totalItemCount <= 0) {
    throw new HskExamStructureParseError(
      "The parts add up to no items at all, so no item count could be read. The extraction of this document may space its item counts differently than the parser expects.",
    );
  }

  if (structure.totalItemCount !== expectations.totalItemCount) {
    throw new HskExamStructureParseError(
      `The parts add up to ${structure.totalItemCount} items, not the ${expectations.totalItemCount} the examination has.`,
    );
  }
}

/**
 * The syllabus lines, with page furniture removed.
 *
 * Exported for the tests: stripping a running header that is glued to the front
 * of a heading is the behaviour most likely to break with a new extraction, and
 * asserting it directly is clearer than asserting it through a parsed part.
 */
export function toStructureLines(text: string): readonly string[] {
  return (
    normalizeCjkNumberSpacing(normalizeLigatures(text))
      // A form feed marks a page break and carries no content.
      .replace(/\f/g, "\n")
      .split(/\r?\n/)
      // The running header is `│…│` followed by the page number, and it is glued to
      // the front of whatever line the extraction put it on.
      .map((line) => line.replace(/^│[^│]*│\s*\d*/, "").trim())
      // Collapse the tabs and doubled spaces the extraction leaves behind, so a
      // description does not carry the layout of the page it was printed on.
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line !== "" && !/^\d+$/.test(line))
  );
}

function readHeading(line: string): HskExamSkillKind | null {
  if (line.includes("◎")) {
    return null;
  }

  const match = SKILL_CODES.find((skill) => line.endsWith(skill.code));

  return match?.kind ?? null;
}

function codeFor(kind: HskExamSkillKind): string {
  const match = SKILL_CODES.find((skill) => skill.kind === kind);

  if (match === undefined) {
    throw new HskExamStructureParseError(`No syllabus name for ${kind}.`);
  }

  return match.code;
}

function toPart(line: string, bullet: RegExpExecArray): HskExamPart {
  const code = bullet[1] ?? "";
  const ordinal = bullet[2] ?? "";
  const itemCount = Number(bullet[3] ?? "0");
  const position = readOrdinal(ordinal);

  if (position === null) {
    throw new HskExamStructureParseError(
      `A part is numbered with an ordinal this parser does not know (${ordinal.length} character(s)).`,
    );
  }

  return {
    code,
    position,
    itemCount,
    // Everything after the bullet marker, including the item count: the part's
    // description is the syllabus's own statement of its format.
    description: line.replace(/^◎\s*/, ""),
  };
}

function readOrdinal(ordinal: string): number | null {
  if (ordinal.length !== 1) {
    return null;
  }

  const index = ORDINALS.indexOf(ordinal);

  return index === -1 ? null : index + 1;
}
