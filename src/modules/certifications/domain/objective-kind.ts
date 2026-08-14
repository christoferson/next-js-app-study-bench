import type { Objective, ObjectiveId } from "./objective";

/**
 * What kind of thing an objective names.
 *
 * Generation needs this because an objective is not always a subject to explain.
 * A grammar point names a pattern the learner must *use*; a topic names a situation
 * to set an item in; a word list names words to test. A prompt that treats all
 * three as "the topic of the question" produces questions *about* the syllabus
 * instead of drills on it.
 *
 * The kind is derived rather than stored. Storing it would mean a column, a
 * migration, and a value the owner could set to something the tree contradicts —
 * and the tree already says which root an objective sits under, which is the whole
 * signal. `GENERAL` is the default, so a track whose objectives are ordinary exam
 * domains (every technical certification) is classified the way it always was and
 * its prompts are unchanged.
 *
 * The root markers below are the *domain's* names for the roots the HSK syllabus
 * import creates. They live here rather than in `src/import` so that the importer
 * that writes them and the prompt that reads them cannot drift apart, and so that
 * nothing outside this file has to recognise a root by guessing at a title. This is
 * matching on the owner's own recorded objective titles, never on a track's name,
 * provider, or slug (`spec/AI-GUIDELINES.md` section 2.1: behaviour is selected by
 * study type and by recorded data, never by a provider string).
 */

export type ObjectiveKind = "GRAMMAR" | "THEME" | "VOCABULARY_LIST" | "GENERAL";

/** The grammar appendix root: its own name in the syllabus, and the owner's. */
export const GRAMMAR_ROOT = { code: "语法", title: "Grammar" } as const;

/**
 * The two unofficial theme roots.
 *
 * "unofficial" is part of the title on purpose (`SPEC.md` section 6.2): these came
 * from a chatbot's proposal about the examination, not from the examining body, and
 * the objective tree has to say so wherever it is read.
 */
export const TOPICS_ROOT_TITLE = "Topics (unofficial)";
export const TASKS_ROOT_TITLE = "Language tasks (unofficial)";

/** The root every imported vocabulary card is mapped to. */
export const VOCABULARY_LIST_ROOT = {
  code: "HSK 5",
  title: "HSK 5 vocabulary",
} as const;

/**
 * Which kind of objective this is, judged by the root it descends from.
 *
 * By the root rather than by the objective itself, because a grammar point's own
 * title *is* the pattern — there is nothing in "……，便……" that says "grammar" — and
 * because selecting a whole category should drill it the same way as selecting one
 * point in it.
 *
 * `objectives` is the track's full objective set, archived rows included: an
 * archived parent still says where its children sit. An objective whose ancestry
 * cannot be walked to a root — a missing parent, or a cycle the repository should
 * have prevented — falls back to `GENERAL` rather than throwing, because a prompt
 * is not the place to discover a broken hierarchy.
 */
export function objectiveKind(
  objectives: readonly Objective[],
  objectiveId: ObjectiveId,
): ObjectiveKind {
  const root = rootOf(objectives, objectiveId);

  if (root === null) {
    return "GENERAL";
  }

  if (matches(root, GRAMMAR_ROOT)) {
    return "GRAMMAR";
  }

  if (root.title === TOPICS_ROOT_TITLE || root.title === TASKS_ROOT_TITLE) {
    return "THEME";
  }

  if (matches(root, VOCABULARY_LIST_ROOT)) {
    return "VOCABULARY_LIST";
  }

  return "GENERAL";
}

/**
 * A root matches when either its code or its title is the one recorded.
 *
 * Either, for the reason the import's own idempotency check accepts either: the
 * owner may rename an imported root, and a renamed grammar root is still the
 * grammar root.
 */
function matches(
  root: Objective,
  marker: { readonly code: string; readonly title: string },
): boolean {
  return root.code === marker.code || root.title === marker.title;
}

/**
 * The root `objectiveId` descends from, or itself when it is one.
 *
 * An objective whose parent is absent from the set counts as its own root, which is
 * what `buildObjectiveTree` does with the same situation: nothing silently
 * disappears because a parent was filtered out. `seen` bounds the walk, so a cycle
 * the repository should have prevented ends the search instead of hanging.
 */
function rootOf(
  objectives: readonly Objective[],
  objectiveId: ObjectiveId,
): Objective | null {
  const byId = new Map(
    objectives.map((objective) => [objective.id, objective] as const),
  );
  const seen = new Set<ObjectiveId>();
  let current = byId.get(objectiveId);

  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);

    const parent =
      current.parentObjectiveId === null
        ? undefined
        : byId.get(current.parentObjectiveId);

    if (parent === undefined) {
      return current;
    }

    current = parent;
  }

  return null;
}
