import type { ObjectiveSourceType } from "@/modules/certifications/domain/objective";
import {
  GRAMMAR_ROOT,
  TASKS_ROOT_TITLE,
  TOPICS_ROOT_TITLE,
} from "@/modules/certifications/domain/objective-kind";
import type {
  HskExamSkillKind,
  HskExamStructure,
} from "./exam-structure-parser";
import type { HskGrammarOutline } from "./grammar-parser";
import type { HskThemeEntry, HskThemeOutline } from "./theme-parser";

/**
 * The objective plan the HSK syllabus documents describe, as pure data.
 *
 * Moved here from `src/import/` in the import-strategy rework, and the move is the
 * point. This planner and the three parsers beside it were reachable only from a CLI
 * script, which meant the one reader that actually understands the HSK documents was
 * not available on the screen where the owner imports objectives — they got the generic
 * AI extractor, which returns an empty outline for a syllabus whose structure is a
 * table. `src/import/` is script-side code (it writes through facades, prints to the
 * console, and reads `external/`), so the web flow cannot import from it; the parsers
 * and this planner are certification-family *reading* logic and belong beside the flow
 * that uses them. The script keeps working because `src/import/hsk-syllabus-importer.ts`
 * re-exports what moved, the same way `@/shared/text-normalization` is re-exported for
 * its earlier callers.
 *
 * Application layer rather than domain: the parsers validate untrusted file content and
 * the grammar parser uses zod, which the domain forbids. Nothing here writes anything —
 * `importHskSyllabusObjectives` (script) and `ObjectiveImportFacade` (web) each take
 * this plan and do their own writing.
 */

/** Source type for the objectives read from the published syllabus. */
const SYLLABUS_SOURCE: ObjectiveSourceType = "OFFICIAL_SYLLABUS";

/**
 * Source type for the objectives read from the owner's unofficial notes.
 *
 * `AI_PROPOSED` rather than `IMPORTED`: the notes are a chatbot answer, so the
 * themes are a model's proposal about what the examination covers, not a
 * transcription of a document. Labelling them `IMPORTED` would hide that.
 */
const UNOFFICIAL_SOURCE: ObjectiveSourceType = "AI_PROPOSED";

/**
 * The names the roots are created under.
 *
 * Imported from the domain rather than declared here, because generation reads them
 * back: an objective's kind is judged by the root it descends from, so the importer
 * that writes a root and the prompt that recognises it must agree on its name. The
 * word "unofficial" in the theme titles is deliberate and is part of that contract.
 */
const GRAMMAR_ROOT_CODE = GRAMMAR_ROOT.code;
const GRAMMAR_ROOT_TITLE = GRAMMAR_ROOT.title;

/** One objective to create, with its descendants. Pure data, no identifiers. */
export interface PlannedObjective {
  readonly code: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly weight: number | null;
  readonly sourceType: ObjectiveSourceType;
  readonly children: readonly PlannedObjective[];
}

/**
 * The whole objective plan, as data.
 *
 * Pure and exported so the shape of the tree — what carries a weight, which source type
 * each subtree gets — is asserted directly rather than through a database. The writing
 * is then a trivial walk, wherever it happens.
 *
 * **Every input is optional, and any subset is a legitimate import.** That is a change
 * the web flow needed: the owner may hold the grammar appendix for one level and the
 * syllabus text for another, and refusing to import the one they have because the other
 * is missing would send them back to the CLI. A call with nothing at all returns an
 * empty plan rather than throwing, because "this upload contained nothing this strategy
 * recognises" is a state the confirm page already renders.
 */
export function planHskSyllabusObjectives(sources: {
  /** Optional: a level's examination structure may not be part of the upload. */
  readonly structure?: HskExamStructure | null;
  /** Optional: the grammar appendix alone is a legitimate import. */
  readonly grammar?: HskGrammarOutline | null;
  /** Optional: theme notes are the one unofficial input and a level may have none. */
  readonly themes?: HskThemeOutline | null;
}): readonly PlannedObjective[] {
  const structure = sources.structure ?? null;
  const grammar = sources.grammar ?? null;
  const themes = sources.themes ?? null;

  return [
    ...(structure === null ? [] : structure.skills.map(planSkill)),
    ...(grammar === null ? [] : [planGrammar(grammar)]),
    ...(themes === null
      ? []
      : [
          planThemes(
            TOPICS_ROOT_TITLE,
            "Topic areas the owner's own notes suggest the examination draws its passages and audio from. Unofficial: proposed by a chatbot citing third-party study sites, not published by the examining body.",
            themes.topics.entries,
          ),
          planThemes(
            TASKS_ROOT_TITLE,
            "Communication tasks the owner's own notes suggest the examination asks a candidate to perform. Unofficial: proposed by a chatbot citing third-party study sites, not published by the examining body.",
            themes.tasks.entries,
          ),
        ]),
  ];
}

/**
 * One skill, with one child per part.
 *
 * The root carries the skill's item count as its weight. That is only a legitimate
 * percentage because the examination has exactly 100 items, which the structure
 * parser asserts before this is reached — so the three weights add to 100 and mean
 * "this share of the paper" rather than "this many questions".
 */
function planSkill(
  skill: HskExamStructure["skills"][number],
): PlannedObjective {
  const itemCount = skill.parts.reduce(
    (total, part) => total + part.itemCount,
    0,
  );

  return {
    code: skill.code,
    title: describeSkillKind(skill.kind),
    description: `${describeSkillKind(skill.kind)} section of the HSK 5 paper: ${skill.parts.length} part(s), ${itemCount} items.`,
    weight: itemCount,
    sourceType: SYLLABUS_SOURCE,
    children: skill.parts.map((part) => ({
      code: part.code,
      title: `Part ${part.position} (${part.itemCount} items)`,
      // The syllabus's own statement of the part's format, item count included.
      description: part.description,
      weight: null,
      sourceType: SYLLABUS_SOURCE,
      children: [],
    })),
  };
}

/**
 * The grammar appendix, three levels deep.
 *
 * A level for the appendix, a level per category group, and a leaf per grammar
 * point. The leaves are what make the tree worth having: a drill request can name
 * one pattern, and a generated question can be mapped to the exact point it
 * exercises rather than to "grammar".
 */
function planGrammar(grammar: HskGrammarOutline): PlannedObjective {
  return {
    code: GRAMMAR_ROOT_CODE,
    title: GRAMMAR_ROOT_TITLE,
    description: `The ${grammar.pointCount} grammar points the HSK 5 syllabus lists, in its own ${grammar.groups.length} categories.`,
    weight: null,
    sourceType: SYLLABUS_SOURCE,
    children: grammar.groups.map((group) => ({
      code: group.category,
      title: group.name,
      description: `${group.points.length} grammar point(s) the syllabus lists under ${group.category} / ${group.name}.`,
      weight: null,
      sourceType: SYLLABUS_SOURCE,
      children: group.points.map((point) => ({
        // The group's own name, so a picker row reads "复句 — ……，便……".
        code: group.name,
        title: point.content,
        description: point.detail === "" ? null : point.detail,
        weight: null,
        sourceType: SYLLABUS_SOURCE,
        children: [],
      })),
    })),
  };
}

function planThemes(
  title: string,
  description: string,
  entries: readonly HskThemeEntry[],
): PlannedObjective {
  return {
    code: null,
    title,
    description,
    weight: null,
    sourceType: UNOFFICIAL_SOURCE,
    children: entries.map((entry) => ({
      code: null,
      title: describeTheme(entry),
      description: entry.description,
      weight: null,
      sourceType: UNOFFICIAL_SOURCE,
      children: [],
    })),
  };
}

/**
 * One theme's title: the Chinese name and the English gloss together.
 *
 * The two lists name themselves in opposite orders, and both names are useful — the
 * Chinese is what a generated passage should be about, the English is what the
 * owner reads down a list of objectives — so both are kept, in one order.
 */
export function describeTheme(entry: HskThemeEntry): string {
  return entry.chineseName === ""
    ? entry.englishName
    : `${entry.chineseName} — ${entry.englishName}`;
}

/** The skill's owner-facing name. Exhaustive, so a fourth skill must decide. */
export function describeSkillKind(kind: HskExamSkillKind): string {
  switch (kind) {
    case "LISTENING":
      return "Listening";
    case "READING":
      return "Reading";
    case "WRITING":
      return "Writing";
  }
}
