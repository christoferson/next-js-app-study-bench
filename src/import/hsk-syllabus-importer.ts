import type {
  CertificationId,
  CertificationSlug,
} from "@/modules/certifications/domain/certification";
import type {
  Objective,
  ObjectiveId,
} from "@/modules/certifications/domain/objective";
import type { PlannedObjective } from "@/modules/ai-generation/application/hsk-import/objective-plan";
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
 * written. The roots are therefore independent: an interrupted run can be resumed
 * by re-running, and a root the owner has since renamed is left alone rather than
 * being written a second time. The `HSK 5 vocabulary` root that `import:real`
 * created, and every card mapped to it, is never read or touched here.
 *
 * **Everything goes through the certification facade**, exactly as `import:real`
 * does, so the imported objectives pass the same validation and hierarchy rules as
 * ones the owner types.
 *
 * **The parsers and the plan now live in the ai-generation module**
 * (`application/hsk-import/`), because the web import strategy needs the same
 * readers and `src/import/` is script-side code — it writes through facades, prints
 * to the console, and reads `external/`. They are re-exported below so this script
 * and its tests keep their import paths. What stays here is the *writing*: the
 * per-root idempotency check and the facade walk, which are script concerns.
 *
 * **Provenance is split, because the sources differ in kind** — the examination
 * structure and the grammar appendix are `OFFICIAL_SYLLABUS`, the owner's theme
 * notes are `AI_PROPOSED`. `application/hsk-import/objective-plan.ts` decides that
 * and states why.
 *
 * As in `import:real`, no wording from any source document is embedded in this
 * repository: the descriptions the planner writes are the owner's own, and the
 * syllabus text that reaches the database arrives through the parsers at run time.
 */

/**
 * The parsers and the planner, re-exported at their historical paths.
 *
 * Kept so the CLI script and its tests continue to work unchanged after the
 * relocation — the same courtesy `@/shared/text-normalization` was given its earlier
 * callers. New code should import from
 * `@/modules/ai-generation/application/hsk-import/*` directly.
 */
export {
  describeSkillKind,
  describeTheme,
  planHskSyllabusObjectives,
} from "@/modules/ai-generation/application/hsk-import/objective-plan";
export type { PlannedObjective } from "@/modules/ai-generation/application/hsk-import/objective-plan";

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
 * Writes the plan onto an HSK track, root by root.
 *
 * The track must already exist: this import extends a track the owner already
 * has and never creates one of its own, so a missing track is a clear failure
 * rather than a silent second import path for the same content. The slug
 * defaults to the HSK 5 track `import:real` creates, and may name any other
 * language track (owner request, 2026-08-16: reuse this importer per level).
 */
export async function importHskSyllabusObjectives(
  deps: RealImportDependencies,
  plan: readonly PlannedObjective[],
  onRoot?: (result: RootImportResult) => void,
  trackSlug?: CertificationSlug,
): Promise<HskSyllabusImportResult> {
  const slug = trackSlug ?? REAL_TRACK_SLUGS.hsk5Chinese;
  const certification = await deps.certifications.findEditFormBySlug(slug);

  if (certification === null) {
    throw new HskSyllabusImportError(
      `There is no study track at "${slug}", so there is nothing to add the syllabus to. Create the track first (or run the vocabulary import for the default HSK 5 track).`,
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
