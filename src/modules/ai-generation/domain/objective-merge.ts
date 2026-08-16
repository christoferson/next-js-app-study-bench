/**
 * The reconciliation between an extracted outline and the outline a track already has.
 *
 * Slice A's behaviour was a whole-root skip: a proposed root whose title or code matched
 * one the track already had was shown greyed and not written. That is safe and it is
 * coarse — importing the HSK 4 grammar appendix onto a track that already has a `Grammar`
 * root skipped every grammar point in the file, because the *root* matched. What the owner
 * wants there is the opposite: the new points added **under** the existing root, the
 * existing points' descriptions enriched from the new material, and only the true
 * duplicates skipped.
 *
 * So a second step exists between extraction and confirmation, and it produces one verdict
 * per extracted node:
 *
 * - `ADD` — write this node, under a named existing objective, under another node being
 *   added in the same batch, or as a new root.
 * - `ENRICH` — the track already has this objective; replace its description with one that
 *   incorporates what the new document says. Nothing else about an existing objective is
 *   ever touched: not its title, not its code, not its parent, not its weight.
 * - `SKIP` — a true duplicate, with a reason the owner can read.
 *
 * Domain code: no framework, no zod, no database. The zod schema that parses the model's
 * answer is `application/objective-merge-schema.ts` and calls the checks here, for the same
 * reason the import's schema does — "what shape did the model send" and "is this plan
 * applicable to this tree" are different questions, and the second one would hold however
 * the plan arrived.
 *
 * Every verdict references the *extracted* node by a `ref` the prompt assigned, and every
 * existing objective by its **database id**. Both directions matter. Refs are assigned by
 * the sender rather than invented by the model, so a plan cannot claim a verdict about a
 * node that was never sent. Ids rather than titles for the existing side, because a
 * title-match round-trip is exactly the ambiguity this step exists to remove: two objectives
 * can share a title, and an enrichment aimed at "Grammar" would have to guess which one.
 */

import { MAX_IMPORT_DEPTH } from "./objective-import";
import type { ProposedObjective } from "./objective-import";

/** Field limits for a merge verdict, matching the import's own. */
export const MERGE_CODE_LIMIT = 200;
export const MERGE_TITLE_LIMIT = 200;
export const MERGE_DESCRIPTION_LIMIT = 2000;
export const MERGE_REASON_LIMIT = 400;
export const MERGE_SUMMARY_LIMIT = 800;
export const MERGE_REF_LIMIT = 40;

/**
 * The most verdicts one merge may carry.
 *
 * One per extracted node, so it is the deterministic import's node cap rather than the
 * model's: an HSK level's grammar appendix is legitimately a few hundred nodes, and every
 * one of them needs a verdict or the merge would silently drop material.
 */
export const MAX_MERGE_ITEMS = 400;

/**
 * How many existing objectives are described to the model.
 *
 * A bound on the prompt rather than on the track: a track may hold more, and the merge is
 * still useful when it does — it just cannot enrich or nest under a node it was not shown.
 * Truncation is recorded and stated on screen rather than hidden, because "the merge did not
 * consider your last 40 objectives" is something the owner has to be able to find out.
 */
export const MAX_MERGE_EXISTING_NODES = 300;

/**
 * One objective the track already has, as the merge step sees it.
 *
 * Five fields and no more: the id to reference it by, the code and title to recognise it by,
 * the depth so a verdict cannot propose a fourth level, and the parent so the model can see
 * the shape it is merging into. Deliberately *not* an `Objective` — this stays domain code
 * with no dependency on the certifications module, and the same rules apply to a list read
 * out of any repository.
 */
export interface ExistingObjectiveNode {
  readonly id: string;
  readonly code: string | null;
  readonly title: string;
  /** Roots are depth 1, matching `MAX_IMPORT_DEPTH`. */
  readonly depth: number;
  readonly parentId: string | null;
}

/** One extracted node as it was offered to the merge, by the ref the prompt gave it. */
export interface MergeSourceNode {
  readonly ref: string;
  readonly title: string;
  readonly code: string | null;
  readonly description: string | null;
  readonly weight: number | null;
  readonly depth: number;
  /** The ref of the extracted node this one sits under, or `null` for a root. */
  readonly parentRef: string | null;
}

/**
 * The extracted tree, flattened into refs, in document order.
 *
 * `n1`, `n2`, … assigned by walking the tree depth-first, which is the order the document
 * presents it in. Assigned here rather than in the template so the same numbering is used
 * by the prompt, the checks, the stored payload, and the confirm page — a ref that meant one
 * node in the prompt and another on screen would be worse than no ref at all.
 */
export function flattenForMerge(
  roots: readonly ProposedObjective[],
): readonly MergeSourceNode[] {
  const nodes: MergeSourceNode[] = [];

  const walk = (
    children: readonly ProposedObjective[],
    parentRef: string | null,
    depth: number,
  ): void => {
    for (const node of children) {
      const ref = `n${nodes.length + 1}`;

      nodes.push({
        ref,
        title: node.title,
        code: node.code,
        description: node.description,
        weight: node.weight,
        depth,
        parentRef,
      });
      walk(node.children, ref, depth + 1);
    }
  };

  walk(roots, null, 1);

  return nodes;
}

/** Write this extracted node, somewhere. */
export interface MergeAdd {
  readonly kind: "ADD";
  readonly ref: string;
  /** The existing objective to nest under, or `null`. */
  readonly parentExistingId: string | null;
  /** The ref of another node being added in this same batch, or `null`. */
  readonly parentRef: string | null;
  readonly code: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly weight: number | null;
}

/** Improve one existing objective's description from the new material. */
export interface MergeEnrich {
  readonly kind: "ENRICH";
  readonly ref: string;
  readonly existingId: string;
  /** The description to store. Never empty: an enrichment that erases is a deletion. */
  readonly description: string;
}

/** A true duplicate, with the reason it is one. */
export interface MergeSkip {
  readonly kind: "SKIP";
  readonly ref: string;
  readonly reason: string;
  readonly matchedExistingId: string | null;
}

export type MergeItem = MergeAdd | MergeEnrich | MergeSkip;

/** One reconciliation, as the model answered it. */
export interface ObjectiveMergePlan {
  readonly items: readonly MergeItem[];
  /** One sentence about the whole reconciliation, for the confirm page's lede. */
  readonly summary: string;
}

/**
 * The stable identifier a checkbox carries for one actionable verdict.
 *
 * Derived from the verdict rather than from its position, so a form submitted against a
 * payload that was re-read cannot apply the wrong item, and so the apply step can look a
 * submitted key up without trusting an index. Skips have no key because they are not
 * actionable — there is nothing to do to a duplicate.
 */
export function mergeItemKey(item: MergeItem): string | null {
  switch (item.kind) {
    case "ADD":
      return `add:${item.ref}`;
    case "ENRICH":
      return `enrich:${item.ref}`;
    case "SKIP":
      return null;
  }
}

/** How many of each verdict a plan carries, for the counts the confirm page states. */
export interface MergeCounts {
  readonly adds: number;
  readonly enriches: number;
  readonly skips: number;
}

export function countMergeItems(items: readonly MergeItem[]): MergeCounts {
  return {
    adds: items.filter((item) => item.kind === "ADD").length,
    enriches: items.filter((item) => item.kind === "ENRICH").length,
    skips: items.filter((item) => item.kind === "SKIP").length,
  };
}

/**
 * Everything wrong with a merge plan, in messages safe to send back to the model.
 *
 * The same contract `checkProposedTree` has: a list rather than the first failure, every
 * message naming a path and an expectation, and never a character of the owner's document —
 * these messages drive the gateway's one repair attempt, so they travel back to the provider
 * (`spec/AI-GUIDELINES.md` section 1.7).
 *
 * The checks are the deterministic half of the merge, and they are what makes trusting a
 * model's answer here defensible at all. A plan may only:
 *
 * - talk about nodes that were actually sent, once each;
 * - reference existing objectives that actually exist;
 * - nest an addition under an existing objective, under an earlier addition, or nowhere —
 *   never under something that is not being added, and never past the depth cap;
 * - enrich any one objective at most once, and never with an empty description.
 *
 * Anything else is a plan that could not be applied without guessing, and guessing on the
 * owner's objective hierarchy is the one thing this flow exists to avoid.
 */
export function checkObjectiveMerge(
  plan: ObjectiveMergePlan,
  /** The extracted nodes that were offered, by ref. */
  sourceNodes: readonly MergeSourceNode[],
  /** The existing objectives that were described to the model. */
  existing: readonly ExistingObjectiveNode[],
): readonly string[] {
  const problems: string[] = [];
  const { items } = plan;

  if (items.length > MAX_MERGE_ITEMS) {
    problems.push(
      `merge: ${items.length} verdicts were returned but at most ${MAX_MERGE_ITEMS} are accepted; return one verdict per extracted objective and no more`,
    );
  }

  if (plan.summary.trim().length === 0) {
    problems.push("merge.summary: must not be empty");
  }

  const sentRefs = new Set(sourceNodes.map((node) => node.ref));
  const existingById = new Map(existing.map((node) => [node.id, node]));
  const seenRefs = new Set<string>();
  const enrichedIds = new Set<string>();
  /** The depth each added ref will land at, so a chain of additions can be bounded. */
  const addDepthByRef = new Map<string, number>();

  items.forEach((item, index) => {
    const here = `merge.items[${index}]`;

    if (!sentRefs.has(item.ref)) {
      problems.push(
        `${here}.ref: names no extracted objective that was sent; return a verdict only for the refs listed`,
      );
    } else if (seenRefs.has(item.ref)) {
      problems.push(
        `${here}.ref: a second verdict for the same extracted objective; return exactly one verdict per ref`,
      );
    }

    seenRefs.add(item.ref);

    switch (item.kind) {
      case "ADD": {
        if (item.title.trim().length === 0) {
          problems.push(`${here}.title: must not be empty`);
        }

        if (item.parentExistingId !== null && item.parentRef !== null) {
          problems.push(
            `${here}: names both an existing parent and a parent among the additions; choose one or neither`,
          );
        }

        let parentDepth = 0;

        if (item.parentExistingId !== null) {
          const parent = existingById.get(item.parentExistingId);

          if (parent === undefined) {
            problems.push(
              `${here}.parentExistingId: names no objective in the list of existing objectives; use one of the ids given, the ref of another addition, or neither`,
            );
          } else {
            parentDepth = parent.depth;
          }
        } else if (item.parentRef !== null) {
          const parent = addDepthByRef.get(item.parentRef);

          if (parent === undefined) {
            problems.push(
              `${here}.parentRef: names no earlier addition; a parent among the additions must appear before its children`,
            );
          } else {
            parentDepth = parent;
          }
        }

        const depth = parentDepth + 1;

        if (depth > MAX_IMPORT_DEPTH) {
          problems.push(
            `${here}: would sit ${depth} levels deep but at most ${MAX_IMPORT_DEPTH} are accepted; nest it higher or fold it into its parent's description`,
          );
        }

        addDepthByRef.set(item.ref, depth);
        break;
      }
      case "ENRICH": {
        if (!existingById.has(item.existingId)) {
          problems.push(
            `${here}.existingId: names no objective in the list of existing objectives; enrich only an objective that was listed`,
          );
        }

        if (enrichedIds.has(item.existingId)) {
          problems.push(
            `${here}.existingId: a second enrichment of the same existing objective; combine them into one description`,
          );
        }

        enrichedIds.add(item.existingId);

        if (item.description.trim().length === 0) {
          problems.push(
            `${here}.description: must not be empty; an enrichment adds to what is recorded rather than clearing it`,
          );
        }
        break;
      }
      case "SKIP": {
        if (item.reason.trim().length === 0) {
          problems.push(
            `${here}.reason: must not be empty; say why this objective is already covered`,
          );
        }

        if (
          item.matchedExistingId !== null &&
          !existingById.has(item.matchedExistingId)
        ) {
          problems.push(
            `${here}.matchedExistingId: names no objective in the list of existing objectives; omit it when no single objective covers this one`,
          );
        }
        break;
      }
    }
  });

  return problems;
}

/**
 * The additions that can actually be written, given what the owner checked.
 *
 * Intra-batch parenting is the reason this is a function rather than a filter. An addition
 * may sit under another addition, so unchecking a parent leaves its children with nowhere to
 * go — and the two available answers are both worse than dropping them: reparenting them
 * onto the existing objective above would put a grammar point directly under `Grammar` when
 * the owner had just declined the category it belongs in, and refusing the whole apply would
 * make one unchecked box block everything. So a checked addition whose parent addition is
 * not being written is *omitted*, cascading, and reported as a count the confirm page states.
 *
 * Order is preserved, and parents precede their children by construction (the checks refuse
 * a forward reference), so one pass is enough.
 */
export function selectableMergeAdds(
  items: readonly MergeItem[],
  /** The keys the owner left checked. */
  checked: ReadonlySet<string>,
): {
  readonly adds: readonly MergeAdd[];
  /** Checked additions dropped because an ancestor addition was not checked. */
  readonly omitted: readonly MergeAdd[];
} {
  const adds: MergeAdd[] = [];
  const omitted: MergeAdd[] = [];
  const writable = new Set<string>();

  for (const item of items) {
    if (item.kind !== "ADD") {
      continue;
    }

    const key = mergeItemKey(item);

    if (key === null || !checked.has(key)) {
      continue;
    }

    if (item.parentRef !== null && !writable.has(item.parentRef)) {
      omitted.push(item);
      continue;
    }

    writable.add(item.ref);
    adds.push(item);
  }

  return { adds, omitted };
}

/** The enrichments the owner left checked, in order. */
export function selectedMergeEnriches(
  items: readonly MergeItem[],
  checked: ReadonlySet<string>,
): readonly MergeEnrich[] {
  return items.filter((item): item is MergeEnrich => {
    if (item.kind !== "ENRICH") {
      return false;
    }

    const key = mergeItemKey(item);

    return key !== null && checked.has(key);
  });
}

/**
 * Every actionable verdict's key, which is what the confirm page checks by default.
 *
 * Adds and enrichments start checked because they are the answer to what the owner asked
 * for — they uploaded the document in order to get them — and each one is individually
 * removable. Skips have no key and so cannot be checked: applying a duplicate is not a thing
 * the owner can ask for.
 */
export function defaultCheckedMergeKeys(
  items: readonly MergeItem[],
): readonly string[] {
  return items.flatMap((item) => {
    const key = mergeItemKey(item);

    return key === null ? [] : [key];
  });
}
