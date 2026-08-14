import type {
  CertificationId,
  CertificationSlug,
} from "@/modules/certifications/domain/certification";
import type {
  Objective,
  ObjectiveId,
  ObjectiveSourceType,
} from "@/modules/certifications/domain/objective";
import {
  GRAMMAR_ROOT,
  TASKS_ROOT_TITLE,
  TOPICS_ROOT_TITLE,
} from "@/modules/certifications/domain/objective-kind";
import type {
  HskExamSkillKind,
  HskExamStructure,
} from "./hsk-exam-structure-parser";
import type { HskGrammarOutline } from "./hsk-grammar-parser";
import type { HskThemeEntry, HskThemeOutline } from "./hsk-theme-parser";
import { REAL_TRACK_SLUGS } from "./real-content-importer";
import type { RealImportDependencies } from "./real-content-importer";

/**
 * Adds the HSK 5 syllabus structure to the existing HSK track
 * (`npm run import:hsk-syllabus`).
 *
 * A second one-off import tool beside `npm run import:real`, and separate from it
 * on purpose. `import:real` is idempotent whole-track: it sees the HSK track
 * already exists and leaves it completely untouched, which is the behaviour that
 * protects the owner's 1,600 imported vocabulary cards. Adding the syllabus
 * objectives there would mean weakening that check. This script instead never
 * creates a track — it only adds objectives to one that is already there, and its
 * idempotency is per root objective.
 *
 * **Idempotency is by root.** A root whose title or code already exists on the
 * track is reported as already present and neither it nor its children are
 * written. Six roots are therefore independent: an interrupted run can be resumed
 * by re-running, and a root the owner has since renamed is left alone rather than
 * being written a second time. The `HSK 5 vocabulary` root that `import:real`
 * created, and every card mapped to it, is never read or touched here.
 *
 * **Everything goes through the certification facade**, exactly as `import:real`
 * does, so the imported objectives pass the same validation and hierarchy rules as
 * ones the owner types.
 *
 * **Provenance is split, because the sources differ in kind.** The examination
 * structure and the grammar appendix come from the syllabus the examining body
 * publishes, and are recorded as `OFFICIAL_SYLLABUS`. The topic areas and language
 * tasks come from the owner's notes — a chatbot answer citing third-party study
 * sites — and are recorded as `AI_PROPOSED` and titled "unofficial", because
 * AI-derived content must never be presented as official
 * (`SPEC.md` section 6.2, `spec/AI-GUIDELINES.md` section 1.3).
 *
 * As in `import:real`, no wording from any source document is embedded in this
 * repository: the descriptions written here are the owner's own, and the syllabus
 * text that reaches the database arrives through the parsers at run time.
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

/** What the import did to one root and its subtree. */
export interface RootImportResult {
  readonly title: string;
  readonly code: string | null;
  /** True when the root was already on the track and nothing was written. */
  readonly alreadyPresent: boolean;
  /** Objectives written, the root included. Zero when it was already present. */
  readonly objectivesCreated: number;
}

export interface HskSyllabusImportResult {
  readonly slug: CertificationSlug;
  readonly roots: readonly RootImportResult[];
  readonly objectivesCreated: number;
}

export class HskSyllabusImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HskSyllabusImportError";
  }
}

/**
 * The whole objective plan, as data.
 *
 * Pure and exported so the shape of the tree — six roots, what carries a weight,
 * which source type each subtree gets — is asserted directly rather than through a
 * database. The writing below is then a trivial walk.
 */
export function planHskSyllabusObjectives(sources: {
  readonly structure: HskExamStructure;
  readonly grammar: HskGrammarOutline;
  readonly themes: HskThemeOutline;
}): readonly PlannedObjective[] {
  return [
    ...sources.structure.skills.map(planSkill),
    planGrammar(sources.grammar),
    planThemes(
      TOPICS_ROOT_TITLE,
      "Topic areas the owner's own notes suggest the examination draws its passages and audio from. Unofficial: proposed by a chatbot citing third-party study sites, not published by the examining body.",
      sources.themes.topics.entries,
    ),
    planThemes(
      TASKS_ROOT_TITLE,
      "Communication tasks the owner's own notes suggest the examination asks a candidate to perform. Unofficial: proposed by a chatbot citing third-party study sites, not published by the examining body.",
      sources.themes.tasks.entries,
    ),
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

/**
 * Writes the plan onto the HSK track, root by root.
 *
 * The track must already exist: this import extends the one `import:real`
 * created and never creates a track of its own, so a missing track is a clear
 * failure rather than a silent second import path for the same content.
 */
export async function importHskSyllabusObjectives(
  deps: RealImportDependencies,
  plan: readonly PlannedObjective[],
  onRoot?: (result: RootImportResult) => void,
): Promise<HskSyllabusImportResult> {
  const slug = REAL_TRACK_SLUGS.hsk5Chinese;
  const certification = await deps.certifications.findEditFormBySlug(slug);

  if (certification === null) {
    throw new HskSyllabusImportError(
      `There is no study track at "${slug}", so there is nothing to add the syllabus to. Run the vocabulary import first.`,
    );
  }

  const existing = await listObjectives(deps, slug);
  const results: RootImportResult[] = [];

  for (const root of plan) {
    const result = alreadyPresent(existing, root)
      ? {
          title: root.title,
          code: root.code,
          alreadyPresent: true,
          objectivesCreated: 0,
        }
      : {
          title: root.title,
          code: root.code,
          alreadyPresent: false,
          objectivesCreated: await writeSubtree(
            deps,
            certification.id,
            null,
            root,
          ),
        };

    results.push(result);
    onRoot?.(result);
  }

  return {
    slug,
    roots: results,
    objectivesCreated: results.reduce(
      (total, result) => total + result.objectivesCreated,
      0,
    ),
  };
}

/**
 * Whether a root is already on the track.
 *
 * Matched on the title, or on the code when the plan gives one, and only among
 * root objectives — a child titled "Reading" under something else is a different
 * objective. Either match counts, so renaming an imported root's title does not
 * cause a second copy to be written under its old code, and vice versa. Archived
 * roots count as present: the owner archiving an imported root is a decision, and
 * re-creating it would undo that decision.
 */
function alreadyPresent(
  existing: readonly Objective[],
  root: PlannedObjective,
): boolean {
  return existing.some(
    (objective) =>
      objective.parentObjectiveId === null &&
      (objective.title === root.title ||
        (root.code !== null && objective.code === root.code)),
  );
}

/**
 * Writes one planned objective and its descendants, depth first.
 *
 * Not wrapped in a transaction, for the reason `import:real` documents: a facade
 * owns its own transaction boundary and the shared runner forbids nesting one unit
 * of work inside another. Each objective is therefore its own atomic write, and an
 * interrupted run leaves a partial subtree under a root — which the per-root check
 * above then reports as already present, so the owner is told rather than given a
 * silent second copy.
 */
async function writeSubtree(
  deps: RealImportDependencies,
  certificationId: CertificationId,
  parentObjectiveId: ObjectiveId | null,
  planned: PlannedObjective,
): Promise<number> {
  const objective = await deps.certifications.addObjective(certificationId, {
    parentObjectiveId,
    code: planned.code,
    title: planned.title,
    description: planned.description,
    weight: planned.weight,
    sourceType: planned.sourceType,
  });

  let written = 1;

  for (const child of planned.children) {
    written += await writeSubtree(deps, certificationId, objective.id, child);
  }

  return written;
}

async function listObjectives(
  deps: RealImportDependencies,
  slug: CertificationSlug,
): Promise<readonly Objective[]> {
  const form = await deps.certifications.findNewObjectiveForm(slug, null);

  if (form === null) {
    throw new HskSyllabusImportError(
      `There is no study track at "${slug}", so its objectives could not be read.`,
    );
  }

  return form.parentCandidates;
}
