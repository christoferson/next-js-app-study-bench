import { normalizeLigatures } from "@/shared/text-normalization";

/**
 * Parser for the content outline of an official AWS exam guide, as extracted
 * text.
 *
 * A pure function over a string: it takes the text the owner extracted from
 * their own copy of the guide and returns the domain and task structure. It
 * contains no exam content of its own — no domain title, no task title, no
 * weighting is written down in this repository — which is what lets the import
 * tooling be committed while the guide itself stays outside it
 * (`external/`, gitignored).
 *
 * The shape it looks for is the guide's own layout:
 *
 * ```
 * Content outline
 * This exam guide includes weightings, ...
 * •Content Domain 1: <title> (31% of scored content)
 * ...
 * Content Domain 1: <title>
 * Task 1.1: <title>
 * •Skill 1.1.1: <statement> (for example, ...)
 * ```
 *
 * Three properties of PDF-extracted text drive the implementation:
 *
 * - **Headings wrap.** A domain heading or task title can be split across two
 *   lines mid-sentence, so a line that does not start a new element is joined
 *   onto the one before it.
 * - **Every page repeats furniture.** A running header and a footer that repeats
 *   the current heading followed by a page number sit inside the region, so both
 *   are dropped before anything is joined.
 * - **Ligatures.** `conﬁgure` must become `configure` or the stored objective is
 *   unsearchable (`text-normalization.ts`).
 *
 * Nothing here is specific to one exam code, so the same parser reads the next
 * guide the owner extracts as long as AWS keeps this layout. When they do not,
 * it throws rather than returning a partial outline.
 */

export interface ExamGuideTask {
  /** The guide's own task number, for example `Task 1.6`. */
  readonly code: string;
  readonly title: string;
  /**
   * The task's skill statements, one per line.
   *
   * The `(for example, by using ...)` service lists the guide appends to each
   * skill are deliberately dropped: they are the bulk of the guide's verbatim
   * wording, they do not reach a generation prompt (which is given objective
   * codes and titles only), and the full text of one task's skills exceeds the
   * objective description limit. What is kept is the skill statement itself,
   * which is what tells the owner what the task actually covers.
   */
  readonly description: string;
}

export interface ExamGuideDomain {
  /** The guide's own domain number, for example `Domain 1`. */
  readonly code: string;
  readonly title: string;
  /** Percentage of scored content, as the number the guide states. */
  readonly weight: number;
  readonly tasks: readonly ExamGuideTask[];
}

export interface ExamGuideOutline {
  readonly domains: readonly ExamGuideDomain[];
  /** Every task of every domain, in guide order. */
  readonly tasks: readonly ExamGuideTask[];
}

/** Raised when the text does not have the structure the parser needs. */
export class ExamGuideParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExamGuideParseError";
  }
}

/**
 * How many domains and tasks the AIP-C01 guide is expected to yield.
 *
 * Recorded as a shape check rather than as data: the parser does not know the
 * titles, but "five domains, and roughly twenty tasks" is a property the import
 * must not silently lose. A future guide with a different count is a deliberate
 * change to these numbers, not a quietly truncated import.
 */
export interface ExamGuideExpectations {
  readonly domainCount: number;
  readonly minimumTaskCount: number;
  readonly maximumTaskCount: number;
}

export const AIP_C01_EXPECTATIONS: ExamGuideExpectations = {
  domainCount: 5,
  minimumTaskCount: 20,
  maximumTaskCount: 24,
};

/** The heading that opens the outline, and the sentence that follows it. */
const OUTLINE_HEADING = "Content outline";
const OUTLINE_ANCHOR = "This exam guide includes weightings";

/** The heading that closes the outline; everything after it is the appendix. */
const OUTLINE_END_HEADING =
  "Technologies and concepts that might appear on the exam";

const BULLET = "•";

/** `•Content Domain 3: Some Title (20% of scored content)` */
const WEIGHT_BULLET =
  /^•Content Domain (\d+):\s*(.*?)\s*\((\d+(?:\.\d+)?)%\s+of\s+scored\s+content\)$/;

/** `Content Domain 3: Some Title` as a section heading. */
const DOMAIN_HEADING = /^Content Domain (\d+):\s*(.*)$/;

/** `Task 3.2: Some title.` */
const TASK_HEADING = /^Task (\d+)\.(\d+):\s*(.*)$/;

/** `•Skill 3.2.1: Some statement (for example, ...).` */
const SKILL_BULLET = /^•Skill \d+\.\d+\.\d+:\s*(.*)$/;

/**
 * A repeated page footer: a heading this parser also matches, plus a page number.
 *
 * Matched narrowly — only against lines that already look like a heading — so an
 * ordinary sentence that happens to end in a number is never dropped.
 */
const FOOTER_SUFFIX = /\s+\d{1,4}$/;

/**
 * The trailing `(for example, ...)` list of one skill statement.
 *
 * Anchored to the end of the string and applied to a single skill, so a
 * statement that merely mentions an example mid-sentence keeps its wording.
 */
const EXAMPLE_PARENTHETICAL = /\s*\(for example[\s\S]*\)\s*\.?\s*$/i;

export function parseExamGuideOutline(text: string): ExamGuideOutline {
  const lines = toOutlineLines(text);
  const weights = readWeightBullets(lines);
  const domains = readDomains(lines, weights);

  return {
    domains,
    tasks: domains.flatMap((domain) => domain.tasks),
  };
}

/**
 * Checks the parsed outline against what the guide should contain.
 *
 * Separate from parsing so the parser stays about structure and the expectations
 * stay about one document. The import script calls both.
 */
export function assertExamGuideOutlineSize(
  outline: ExamGuideOutline,
  expectations: ExamGuideExpectations = AIP_C01_EXPECTATIONS,
): void {
  if (outline.domains.length !== expectations.domainCount) {
    throw new ExamGuideParseError(
      `Expected ${expectations.domainCount} content domains in the exam guide, parsed ${outline.domains.length}. The extracted text may be truncated or its layout may have changed.`,
    );
  }

  if (
    outline.tasks.length < expectations.minimumTaskCount ||
    outline.tasks.length > expectations.maximumTaskCount
  ) {
    throw new ExamGuideParseError(
      `Expected between ${expectations.minimumTaskCount} and ${expectations.maximumTaskCount} tasks in the exam guide, parsed ${outline.tasks.length}. The extracted text may be truncated or its layout may have changed.`,
    );
  }

  const emptyDomains = outline.domains.filter(
    (domain) => domain.tasks.length === 0,
  );

  if (emptyDomains.length > 0) {
    throw new ExamGuideParseError(
      `These content domains parsed with no tasks: ${emptyDomains
        .map((domain) => domain.code)
        .join(", ")}.`,
    );
  }
}

/**
 * The outline region, cleaned and rejoined into one line per element.
 *
 * Exported for the tests, which assert the joining behaviour directly: wrapped
 * headings are the failure mode most likely to reappear with a new extraction.
 */
export function toOutlineLines(text: string): readonly string[] {
  const lines = normalizeLigatures(text)
    // A form feed marks a page break in extracted text and carries no content.
    .replace(/\f/g, "\n")
    .split(/\r?\n/)
    .map((line) => line.trim());
  const start = lines.findIndex(
    (line, index) =>
      line === OUTLINE_HEADING &&
      (lines[index + 1] ?? "").startsWith(OUTLINE_ANCHOR),
  );

  if (start === -1) {
    throw new ExamGuideParseError(
      `Could not find the "${OUTLINE_HEADING}" section in the extracted text.`,
    );
  }

  const end = lines.findIndex(
    (line, index) => index > start && line === OUTLINE_END_HEADING,
  );

  if (end === -1) {
    throw new ExamGuideParseError(
      `Could not find the end of the "${OUTLINE_HEADING}" section (the "${OUTLINE_END_HEADING}" heading) in the extracted text.`,
    );
  }

  const region = lines.slice(start, end).filter(isOutlineContent);

  return joinWrappedLines(region);
}

/**
 * Whether a line carries outline content rather than page furniture.
 *
 * The running header is the one line this recognises by its own text, because it
 * is the only furniture with no structural marker. It is matched as "a line that
 * repeats a domain-style heading with nothing else on it" — see below — so no
 * exam-specific string has to be hard-coded here.
 */
function isOutlineContent(line: string): boolean {
  if (line === "") {
    return false;
  }

  // The running header is the guide's title line, repeated on every page. It is
  // recognised by the exam-code parenthesis at its end, which no heading, task,
  // or skill line has.
  if (/^AWS Certified .*Exam Guide \([A-Z]{2,4}-[A-Z]?\d{2,3}\)$/.test(line)) {
    return false;
  }

  // A footer repeats the current heading and appends the page number.
  const withoutPageNumber = line.replace(FOOTER_SUFFIX, "");

  if (withoutPageNumber === line) {
    return true;
  }

  return !(
    withoutPageNumber === OUTLINE_HEADING ||
    DOMAIN_HEADING.test(withoutPageNumber) ||
    TASK_HEADING.test(withoutPageNumber)
  );
}

/**
 * Joins each line that continues the element before it.
 *
 * A line starts a new element only when it opens a domain heading, a task
 * heading, or a bullet. Everything else is the tail of a wrapped line, which is
 * how `Task 1.6: Implement prompt engineering strategies and governance for` and
 * `FM interactions.` become one title.
 */
function joinWrappedLines(lines: readonly string[]): readonly string[] {
  const joined: string[] = [];

  for (const line of lines) {
    const previous = joined.at(-1);

    if (previous === undefined || startsElement(line)) {
      joined.push(line);
      continue;
    }

    joined[joined.length - 1] = `${previous} ${line}`;
  }

  return joined;
}

function startsElement(line: string): boolean {
  return (
    line.startsWith(BULLET) ||
    DOMAIN_HEADING.test(line) ||
    TASK_HEADING.test(line) ||
    line === OUTLINE_HEADING
  );
}

/**
 * The stated weighting of each domain, by domain number.
 *
 * Read from the bullet list under the outline heading, which is the only place
 * the guide states a percentage.
 */
function readWeightBullets(
  lines: readonly string[],
): ReadonlyMap<string, number> {
  const weights = new Map<string, number>();

  for (const line of lines) {
    const match = WEIGHT_BULLET.exec(line);

    if (match === null) {
      continue;
    }

    const [, number, , percentage] = match;

    if (number === undefined || percentage === undefined) {
      continue;
    }

    weights.set(number, Number(percentage));
  }

  if (weights.size === 0) {
    throw new ExamGuideParseError(
      "Could not find the domain weighting bullets in the outline section.",
    );
  }

  return weights;
}

/** A task while its skill bullets are still being collected. */
interface TaskAccumulator {
  readonly code: string;
  readonly title: string;
  readonly skills: string[];
}

interface DomainAccumulator {
  readonly code: string;
  readonly number: string;
  readonly title: string;
  readonly tasks: TaskAccumulator[];
}

function readDomains(
  lines: readonly string[],
  weights: ReadonlyMap<string, number>,
): readonly ExamGuideDomain[] {
  const accumulated: DomainAccumulator[] = [];

  for (const line of lines) {
    if (line.startsWith(BULLET)) {
      addSkill(accumulated, line);

      continue;
    }

    const domain = DOMAIN_HEADING.exec(line);

    if (domain !== null && domain[1] !== undefined && domain[2] !== undefined) {
      accumulated.push({
        code: `Domain ${domain[1]}`,
        number: domain[1],
        title: domain[2].trim(),
        tasks: [],
      });

      continue;
    }

    const task = TASK_HEADING.exec(line);

    if (
      task !== null &&
      task[1] !== undefined &&
      task[2] !== undefined &&
      task[3] !== undefined
    ) {
      const owner = accumulated.at(-1);

      if (owner === undefined || owner.number !== task[1]) {
        throw new ExamGuideParseError(
          `Task ${task[1]}.${task[2]} appears outside its content domain, so the outline could not be read reliably.`,
        );
      }

      owner.tasks.push({
        code: `Task ${task[1]}.${task[2]}`,
        title: task[3].trim(),
        skills: [],
      });
    }
  }

  return accumulated.map((domain) => toDomain(domain, weights));
}

/**
 * Appends a skill statement to the task currently being read.
 *
 * A bullet that is not a skill — the weighting bullets, and the topic list above
 * the outline — matches nothing and is ignored, and a skill before the first task
 * has no owner and is ignored too, because a skill can only belong to a task.
 */
function addSkill(
  accumulated: readonly DomainAccumulator[],
  line: string,
): void {
  const skill = SKILL_BULLET.exec(line);
  const statement = skill?.[1];

  if (statement === undefined) {
    return;
  }

  const task = accumulated.at(-1)?.tasks.at(-1);

  if (task !== undefined) {
    task.skills.push(stripExampleList(statement));
  }
}

function toDomain(
  domain: DomainAccumulator,
  weights: ReadonlyMap<string, number>,
): ExamGuideDomain {
  const weight = weights.get(domain.number);

  if (weight === undefined) {
    throw new ExamGuideParseError(
      `${domain.code} has no stated weighting in the outline section.`,
    );
  }

  if (domain.title === "") {
    throw new ExamGuideParseError(`${domain.code} parsed with no title.`);
  }

  return {
    code: domain.code,
    title: domain.title,
    weight,
    tasks: domain.tasks.map((task) => ({
      code: task.code,
      title: task.title,
      description: task.skills.join("\n"),
    })),
  };
}

/** Drops the guide's trailing example list from one skill statement. */
function stripExampleList(skill: string): string {
  return skill.replace(EXAMPLE_PARENTHETICAL, ".").replace(/\s+/g, " ").trim();
}
