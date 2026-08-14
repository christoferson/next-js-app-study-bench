import type { IsoTimestamp } from "@/platform/clock";
import type { CertificationId, LifecycleStatus } from "./certification";
import {
  CyclicObjectiveParentError,
  InvalidParentObjectiveError,
  ObjectiveNotFoundError,
} from "./errors";

/**
 * Objective hierarchy domain model, including the pure tree rules that guard
 * the hierarchy (`SPEC.md` section 6.2).
 */

export type ObjectiveId = string;

/** Source types from `SPEC.md` section 6.2. */
export type ObjectiveSourceType =
  | "OFFICIAL"
  | "OFFICIAL_SYLLABUS"
  | "USER_DEFINED"
  | "AI_PROPOSED"
  | "IMPORTED";

export const OBJECTIVE_SOURCE_TYPES: readonly ObjectiveSourceType[] = [
  "OFFICIAL",
  "OFFICIAL_SYLLABUS",
  "USER_DEFINED",
  "AI_PROPOSED",
  "IMPORTED",
];

/**
 * Source types the owner may choose in D2.
 *
 * `AI_PROPOSED` and `IMPORTED` are set by the generation and import milestones,
 * never by a manual form, so offering them would let the owner mislabel
 * provenance.
 */
export const SELECTABLE_OBJECTIVE_SOURCE_TYPES: readonly ObjectiveSourceType[] =
  ["USER_DEFINED", "OFFICIAL", "OFFICIAL_SYLLABUS"];

export interface Objective {
  readonly id: ObjectiveId;
  readonly certificationId: CertificationId;
  readonly parentObjectiveId: ObjectiveId | null;
  readonly code: string | null;
  readonly title: string;
  readonly description: string | null;
  /** Percentage share of the examination, when the owner records one. */
  readonly weight: number | null;
  readonly sourceType: ObjectiveSourceType;
  /** Rank among siblings. Contiguous from 1 after any repository write. */
  readonly displayOrder: number;
  readonly status: LifecycleStatus;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/** An objective plus its descendants, ready for rendering as a nested list. */
export interface ObjectiveTreeNode {
  readonly objective: Objective;
  readonly depth: number;
  readonly children: readonly ObjectiveTreeNode[];
}

export function describeObjectiveSourceType(
  sourceType: ObjectiveSourceType,
): string {
  switch (sourceType) {
    case "OFFICIAL":
      return "Official";
    case "OFFICIAL_SYLLABUS":
      return "Official syllabus";
    case "USER_DEFINED":
      return "User defined";
    case "AI_PROPOSED":
      return "AI proposed";
    case "IMPORTED":
      return "Imported";
  }
}

/** AI-proposed objectives must never be presented as official. */
export function isOfficialSource(sourceType: ObjectiveSourceType): boolean {
  return sourceType === "OFFICIAL" || sourceType === "OFFICIAL_SYLLABUS";
}

/**
 * Builds the objective forest from a flat list.
 *
 * Siblings keep repository order (`displayOrder`, then `id` as a stable
 * tiebreaker). Objectives whose parent is absent from the input — for example
 * an active child under a filtered-out archived parent — are surfaced at the
 * root so nothing silently disappears from the tree.
 */
export function buildObjectiveTree(
  objectives: readonly Objective[],
): readonly ObjectiveTreeNode[] {
  const present = new Set(objectives.map((objective) => objective.id));
  const childrenByParent = new Map<ObjectiveId | null, Objective[]>();

  for (const objective of sortSiblings(objectives)) {
    const parentId =
      objective.parentObjectiveId !== null &&
      present.has(objective.parentObjectiveId)
        ? objective.parentObjectiveId
        : null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(objective);
    childrenByParent.set(parentId, siblings);
  }

  const build = (
    parentId: ObjectiveId | null,
    depth: number,
  ): readonly ObjectiveTreeNode[] =>
    (childrenByParent.get(parentId) ?? []).map((objective) => ({
      objective,
      depth,
      children: build(objective.id, depth + 1),
    }));

  return build(null, 0);
}

/** One objective in hierarchy order, carrying the depth it was found at. */
export interface ObjectiveOption {
  readonly objective: Objective;
  readonly depth: number;
}

/**
 * Every objective in hierarchy order: each root followed by its own descendants.
 *
 * This is the one ordering used by every select and checkbox list that offers
 * objectives, and it is deliberately expressed as a flattening of
 * `buildObjectiveTree` rather than a second sort. The tree view on the track page and
 * the option lists therefore cannot disagree about what order the objectives are in,
 * and a change to sibling order changes both.
 */
export function listObjectiveOptions(
  objectives: readonly Objective[],
): readonly ObjectiveOption[] {
  return flatten(buildObjectiveTree(objectives));
}

function flatten(
  nodes: readonly ObjectiveTreeNode[],
): readonly ObjectiveOption[] {
  return nodes.flatMap((node) => [
    { objective: node.objective, depth: node.depth },
    ...flatten(node.children),
  ]);
}

/**
 * One level of indent inside an option label.
 *
 * Two non-breaking spaces, written as escapes so the invisible characters are
 * legible in source.
 */
const OPTION_INDENT = "\u00a0\u00a0";

/**
 * One option's label: its depth, its code, its title, and whether it is archived.
 *
 * Indented with two non-breaking spaces per level. Non-breaking rather than
 * ordinary spaces because browsers collapse leading whitespace inside an `option`,
 * and an `option` cannot be indented with CSS in a way they agree on. The indent is
 * decoration only: accessible-name computation collapses U+00A0 as whitespace, so a
 * screen reader still announces the code and the title.
 */
export function describeObjectiveOption(option: ObjectiveOption): string {
  const indent = OPTION_INDENT.repeat(option.depth);
  const prefix =
    option.objective.code === null ? "" : `${option.objective.code} — `;
  const suffix = option.objective.status === "ARCHIVED" ? " (archived)" : "";

  return `${indent}${prefix}${option.objective.title}${suffix}`;
}

function sortSiblings(objectives: readonly Objective[]): readonly Objective[] {
  return [...objectives].sort(
    (left, right) =>
      left.displayOrder - right.displayOrder || left.id.localeCompare(right.id),
  );
}

/** Every descendant of `objectiveId`, excluding the objective itself. */
export function collectDescendantIds(
  objectives: readonly Objective[],
  objectiveId: ObjectiveId,
): ReadonlySet<ObjectiveId> {
  const childrenByParent = new Map<ObjectiveId, ObjectiveId[]>();

  for (const objective of objectives) {
    if (objective.parentObjectiveId === null) {
      continue;
    }
    const siblings = childrenByParent.get(objective.parentObjectiveId) ?? [];
    siblings.push(objective.id);
    childrenByParent.set(objective.parentObjectiveId, siblings);
  }

  const descendants = new Set<ObjectiveId>();
  const pending = [...(childrenByParent.get(objectiveId) ?? [])];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || descendants.has(current)) {
      continue;
    }
    descendants.add(current);
    pending.push(...(childrenByParent.get(current) ?? []));
  }

  return descendants;
}

/**
 * Asserts that `parentObjectiveId` is a legal parent for a new objective.
 *
 * A parent must exist within the same certification. `siblings` is the full
 * objective set of that certification, archived rows included, because an
 * archived parent still constrains the hierarchy.
 */
export function assertValidNewParent(
  objectives: readonly Objective[],
  parentObjectiveId: ObjectiveId | null,
): void {
  if (parentObjectiveId === null) {
    return;
  }

  const parentExists = objectives.some(
    (objective) => objective.id === parentObjectiveId,
  );

  if (!parentExists) {
    throw new InvalidParentObjectiveError(parentObjectiveId);
  }
}

/**
 * Asserts that moving `objectiveId` under `parentObjectiveId` is legal.
 *
 * Rejects a missing objective, a parent outside the certification, self-parenting,
 * and any move that would place an objective under one of its own descendants.
 */
export function assertValidReparent(
  objectives: readonly Objective[],
  objectiveId: ObjectiveId,
  parentObjectiveId: ObjectiveId | null,
): void {
  const objective = objectives.find((entry) => entry.id === objectiveId);

  if (objective === undefined) {
    throw new ObjectiveNotFoundError(objectiveId);
  }

  if (parentObjectiveId === null) {
    return;
  }

  if (parentObjectiveId === objectiveId) {
    throw new CyclicObjectiveParentError(objectiveId, parentObjectiveId);
  }

  assertValidNewParent(objectives, parentObjectiveId);

  if (collectDescendantIds(objectives, objectiveId).has(parentObjectiveId)) {
    throw new CyclicObjectiveParentError(objectiveId, parentObjectiveId);
  }
}

/**
 * Candidate parents for an objective being edited or moved.
 *
 * Excludes the objective itself and its descendants, which are exactly the
 * choices that `assertValidReparent` would reject as cyclic.
 */
export function listReparentCandidates(
  objectives: readonly Objective[],
  objectiveId: ObjectiveId,
): readonly Objective[] {
  const excluded = collectDescendantIds(objectives, objectiveId);

  return objectives.filter(
    (objective) => objective.id !== objectiveId && !excluded.has(objective.id),
  );
}
