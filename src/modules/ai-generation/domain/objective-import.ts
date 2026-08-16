/**
 * The objective tree a model proposes from an uploaded syllabus, and the pure rules
 * that decide whether it is usable.
 *
 * Domain code: no framework, no database, no zod, no environment. The zod schema that
 * parses the provider's answer lives in the application layer
 * (`application/objective-import-schema.ts`) and calls the checks here, so "what shape
 * did the model send" and "is this tree acceptable" stay separable — the first is a
 * parsing question about untrusted JSON, the second is a statement about objective
 * hierarchies that would hold if the tree arrived by any other route.
 *
 * The caps are the interesting part. An extraction is one synchronous request the owner
 * waits on, and its result is a single transaction against the objective hierarchy, so
 * an unbounded tree is both an unbounded model call and an unbounded write. Depth is
 * capped at three because that is what an exam guide actually has — domain, task
 * statement, knowledge item — and a fourth level in an extracted tree is far more often
 * a model turning a bulleted sentence into a subtree than a real syllabus level.
 */

/** The deepest tree the import accepts: roots are depth 1. */
export const MAX_IMPORT_DEPTH = 3;

/**
 * The most objectives one *model-proposed* import may carry, counting every level.
 *
 * The default, and the only cap that applies to an extraction: an over-long tree is the
 * shape a hallucinating extraction takes, so 150 is as much a plausibility check as a
 * size limit. A deterministic strategy passes its own, higher cap
 * (`domain/import-strategy.ts` explains why the number differs by how much the input is
 * trusted).
 */
export const MAX_IMPORT_NODES = 150;

/** Field limits, matching what the objective form itself accepts. */
export const IMPORT_CODE_LIMIT = 200;
export const IMPORT_TITLE_LIMIT = 200;
export const IMPORT_DESCRIPTION_LIMIT = 2000;

/** The weight range an objective may claim, as a percentage of the examination. */
export const MIN_IMPORT_WEIGHT = 0;
export const MAX_IMPORT_WEIGHT = 100;

/**
 * One proposed objective and its children.
 *
 * Deliberately *not* an `Objective`: nothing here has an identifier, a display order,
 * a certification, or a lifecycle, because none of that exists until the owner
 * applies the proposal. Keeping the proposal a different type is what makes it
 * impossible to store one by accident.
 */
export interface ProposedObjective {
  readonly code: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly weight: number | null;
  readonly children: readonly ProposedObjective[];
}

export interface ProposedObjectiveTree {
  readonly roots: readonly ProposedObjective[];
}

/** How many objectives a proposal contains, at every level. */
export function countProposedObjectives(
  nodes: readonly ProposedObjective[],
): number {
  return nodes.reduce(
    (total, node) => total + 1 + countProposedObjectives(node.children),
    0,
  );
}

/** How deep a proposal goes. An empty list is depth zero. */
export function proposedTreeDepth(nodes: readonly ProposedObjective[]): number {
  return nodes.reduce(
    (deepest, node) => Math.max(deepest, 1 + proposedTreeDepth(node.children)),
    0,
  );
}

/**
 * Everything wrong with a proposed tree, in messages safe to send back to the model.
 *
 * A list rather than the first failure, because the messages drive the one repair
 * attempt and a model that is told about one problem tends to return an answer with
 * the next one. Every message names a path and an expectation and contains no
 * syllabus text, so nothing the owner uploaded can travel back to the provider by way
 * of a validation message (`spec/AI-GUIDELINES.md` section 1.7).
 */
export function checkProposedTree(
  nodes: readonly ProposedObjective[],
  /**
   * The node cap in force, which the strategy decides.
   *
   * A parameter rather than a constant so the same checks serve both a model's answer
   * and a deterministic parse of a published document, without the second having to
   * skip validation to be allowed to be bigger. Depth and the per-node rules are
   * unconditional: three levels and a non-empty title are statements about objective
   * hierarchies, not about how much the source is trusted.
   */
  maxNodes: number = MAX_IMPORT_NODES,
): readonly string[] {
  const problems: string[] = [];
  const count = countProposedObjectives(nodes);
  const depth = proposedTreeDepth(nodes);

  // An empty list is *valid*, and that is a correction of an earlier mistake here.
  //
  // Requiring at least one objective looks like the safer rule and is the opposite. A
  // document with no outline in it — a scan with no text layer, a covering letter, the
  // wrong PDF — has no objectives to find, and a model told it must return one will
  // invent one rather than fail: a live extraction against a page of prose produced a
  // single objective titled "No objectives found in document", which the confirm page
  // then dutifully offered to add to the owner's track. Accepting emptiness lets the
  // truthful answer be expressible, and the confirm page has a state that says so.

  if (count > maxNodes) {
    problems.push(
      `objectives: ${count} objectives were proposed but at most ${maxNodes} are accepted; merge the finest-grained items into their parents`,
    );
  }

  if (depth > MAX_IMPORT_DEPTH) {
    problems.push(
      `objectives: the tree is ${depth} levels deep but at most ${MAX_IMPORT_DEPTH} are accepted; flatten the deepest level into its parent's description`,
    );
  }

  collectProblems(nodes, "objectives", problems);

  return problems;
}

/**
 * Per-node checks, and the sibling-level duplicate-code check.
 *
 * Duplicate codes are checked *among siblings* rather than across the whole tree,
 * because that is what a syllabus actually guarantees: `1.1` under domain 1 and `1.1`
 * under domain 2 are different objectives in many real guides, while two `1.1`s in
 * the same group means the model repeated itself or merged two pages.
 */
function collectProblems(
  nodes: readonly ProposedObjective[],
  path: string,
  problems: string[],
): void {
  const seenCodes = new Set<string>();

  nodes.forEach((node, index) => {
    const here = `${path}[${index}]`;

    if (node.title.trim().length === 0) {
      problems.push(`${here}.title: must not be empty`);
    }

    if (node.weight !== null) {
      if (!Number.isFinite(node.weight)) {
        problems.push(`${here}.weight: must be a number or omitted`);
      } else if (
        node.weight < MIN_IMPORT_WEIGHT ||
        node.weight > MAX_IMPORT_WEIGHT
      ) {
        problems.push(
          `${here}.weight: must be between ${MIN_IMPORT_WEIGHT} and ${MAX_IMPORT_WEIGHT}, or omitted`,
        );
      }
    }

    if (node.code !== null) {
      const code = node.code.trim().toLowerCase();

      if (code.length > 0 && seenCodes.has(code)) {
        problems.push(
          `${here}.code: two objectives in the same group share one code; give each sibling a distinct code or omit it`,
        );
      }

      seenCodes.add(code);
    }

    collectProblems(node.children, `${here}.children`, problems);
  });
}

/**
 * The source types an import may claim.
 *
 * Two, and the choice is the owner's: a tree extracted from the official exam guide
 * is `OFFICIAL_SYLLABUS`, and anything else a model produced is `AI_PROPOSED`.
 * `OFFICIAL` is not offered, because a model reading a PDF is not the authority that
 * makes an objective official, and `IMPORTED` is not offered because it means a
 * deterministic import of a known format rather than an extraction
 * (`SPEC.md` section 6.2). Which of the two applies is a fact about the *document*,
 * which only the owner knows, so it is asked on the confirm step rather than guessed.
 */
export type ImportSourceChoice = "OFFICIAL_SYLLABUS" | "AI_PROPOSED";

export const IMPORT_SOURCE_CHOICES: readonly ImportSourceChoice[] = [
  "OFFICIAL_SYLLABUS",
  "AI_PROPOSED",
];

export function describeImportSourceChoice(choice: ImportSourceChoice): string {
  switch (choice) {
    case "OFFICIAL_SYLLABUS":
      return "Official syllabus";
    case "AI_PROPOSED":
      return "Unofficial or AI-assisted";
  }
}
