import { z } from "zod";
import {
  IMPORT_CODE_LIMIT,
  IMPORT_DESCRIPTION_LIMIT,
  IMPORT_TITLE_LIMIT,
  MAX_IMPORT_DEPTH,
  MAX_IMPORT_NODES,
  checkProposedTree,
} from "@/modules/ai-generation/domain/objective-import";
import type {
  ProposedObjective,
  ProposedObjectiveTree,
} from "@/modules/ai-generation/domain/objective-import";
import type {
  JsonSchema,
  StructuredValidation,
} from "@/modules/ai-generation/ports/language-model-gateway";

/**
 * Application-owned schema for the objective tree a model proposes, and the same
 * schema used to read one back out of the run row.
 *
 * Two directions, one schema, deliberately. The model's answer is untrusted input and
 * so is a stored row (`spec/CODING-STANDARDS.md` section 2), and they are the *same*
 * value: what is written to `generation_runs.proposed_payload` is exactly what the
 * validator accepted. Parsing both through one schema means a payload the confirm page
 * can render is a payload the apply step can insert, and a hand-edited row fails at the
 * same place a bad model answer does.
 *
 * The shape is recursive, and that is the one thing the provider tool schema cannot
 * express: JSON Schema `$ref` is not part of the port's `JsonSchema` type, and models
 * honour a self-reference unevenly. So `objectiveImportJsonSchema` describes the nesting
 * *by writing it out* to the maximum depth, with the deepest level carrying no children
 * at all. The model is therefore shown a shape that cannot be too deep, and
 * `checkProposedTree` still enforces the cap for the case where it ignores the shape.
 *
 * A too-deep answer is *rejected*, not trimmed, and that is worth being deliberate
 * about. Stripping the fourth level would be the easy behaviour and the wrong one: the
 * owner would be shown a tree that looks complete, confirm it, and discover months later
 * that every knowledge statement under every task had been dropped. Rejecting spends the
 * one repair attempt telling the model to flatten instead, and failing that, says so.
 */

const OBJECTIVES_KEY = "objectives";

/** Text that may be absent, null, or blank, all meaning "not provided". */
const optionalModelText = (limit: number) =>
  z
    .string()
    .max(limit, { message: `use ${limit} characters or fewer` })
    .nullish()
    .transform((value): string | null => {
      const trimmed = (value ?? "").trim();

      return trimmed.length === 0 ? null : trimmed;
    });

/**
 * A weight as the model states it.
 *
 * Coerced from a string as well as a number, because a model asked for a percentage
 * answers `22` about as often as `"22"` and `"22%"`, and refusing the batch over a
 * quoted number would waste a call over nothing. The *range* is not checked here: that
 * is `checkProposedTree`'s job, so the message the model gets back names the node.
 */
const modelWeight = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((value): number | null => {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    const cleaned = value.trim().replace(/%$/, "").trim();

    if (cleaned.length === 0) {
      return null;
    }

    const parsed = Number(cleaned);

    return Number.isFinite(parsed) ? parsed : Number.NaN;
  });

/**
 * One proposed objective, at a stated depth.
 *
 * Built by a function rather than with `z.lazy` so the recursion terminates at
 * `MAX_IMPORT_DEPTH` in the *schema* as well as in the checks, which is what lets the
 * provider be shown a shape that cannot be too deep.
 *
 * At the deepest level a `children` array is *refused* rather than ignored. Zod would
 * otherwise strip the unknown key and report nothing, and a silently pruned level is
 * exactly the failure the confirm step cannot catch — the tree on screen would look
 * whole. The message names the cap so the repair attempt can flatten instead.
 *
 * `title` is required and non-empty; everything else may be omitted. A node with no
 * title is the one thing that cannot be repaired locally, because an objective is its
 * title.
 */
function nodeSchema(remainingDepth: number): z.ZodType<ProposedObjective> {
  const base = {
    code: optionalModelText(IMPORT_CODE_LIMIT),
    title: z
      .string({ message: "must be a string" })
      .max(IMPORT_TITLE_LIMIT, {
        message: `use ${IMPORT_TITLE_LIMIT} characters or fewer`,
      })
      .transform((value) => value.trim()),
    description: optionalModelText(IMPORT_DESCRIPTION_LIMIT),
    weight: modelWeight,
  };

  if (remainingDepth <= 1) {
    return z
      .object({
        ...base,
        children: z
          .array(z.unknown())
          .max(0, {
            message: `nests deeper than the ${MAX_IMPORT_DEPTH} levels accepted; flatten it into this objective's description`,
          })
          .nullish(),
      })
      .transform((node): ProposedObjective => ({
        code: node.code,
        title: node.title,
        description: node.description,
        weight: node.weight,
        children: [],
      }));
  }

  return z
    .object({
      ...base,
      children: z
        .array(nodeSchema(remainingDepth - 1))
        .max(MAX_IMPORT_NODES, {
          message: `list ${MAX_IMPORT_NODES} objectives or fewer`,
        })
        .nullish()
        .transform((values): readonly ProposedObjective[] => values ?? []),
    })
    .transform((node): ProposedObjective => ({
      code: node.code,
      title: node.title,
      description: node.description,
      weight: node.weight,
      children: node.children,
    }));
}

const responseSchema = z.object({
  [OBJECTIVES_KEY]: z
    .array(nodeSchema(MAX_IMPORT_DEPTH))
    .max(MAX_IMPORT_NODES, {
      message: `list ${MAX_IMPORT_NODES} objectives or fewer`,
    }),
});

/**
 * The validator the gateway calls, and the reader the confirm and apply steps call.
 *
 * Schema parsing and the domain checks in one function, in that order, because they are
 * not independent: the checks assume a tree of the right shape, and the messages from
 * both are the same kind of thing — a path and an expectation, safe to send back as
 * repair feedback and safe to show the owner.
 */
export function validateProposedObjectives(
  payload: unknown,
): StructuredValidation<ProposedObjectiveTree> {
  const result = responseSchema.safeParse(payload);

  if (!result.success) {
    return { ok: false, errors: describeIssues(result.error) };
  }

  const roots = result.data[OBJECTIVES_KEY];
  const problems = checkProposedTree(roots);

  if (problems.length > 0) {
    return { ok: false, errors: problems };
  }

  return { ok: true, value: { roots } };
}

/**
 * The tree as stored on the run row.
 *
 * The same key the provider answers with, so the stored payload and the model's answer
 * are one shape rather than two that have to be kept in step.
 */
export function serializeProposedTree(tree: ProposedObjectiveTree): string {
  return JSON.stringify({ [OBJECTIVES_KEY]: tree.roots });
}

/**
 * A stored payload, re-validated.
 *
 * Returns `null` rather than throwing for unreadable JSON *and* for a payload that no
 * longer validates, so the confirm page can say "this proposal can no longer be read"
 * instead of returning a 500 for a row somebody edited by hand.
 */
export function readProposedTree(
  payload: string | null,
): ProposedObjectiveTree | null {
  if (payload === null) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  const result = validateProposedObjectives(parsed);

  return result.ok ? result.value : null;
}

/** Name of the tool the provider is asked to fill in. */
export const OBJECTIVE_IMPORT_SCHEMA_NAME = "syllabus_objectives";

/**
 * The answer shape sent to the provider.
 *
 * Written out level by level, for the reason at the top of this file. The descriptions
 * are part of the contract, not decoration: they are where the model is told that a code
 * is copied rather than composed and that a weight is only ever one the document states.
 */
export function objectiveImportJsonSchema(): JsonSchema {
  return {
    type: "object",
    description:
      "The study outline stated by an uploaded syllabus, as a tree of objectives.",
    required: [OBJECTIVES_KEY],
    additionalProperties: false,
    properties: {
      [OBJECTIVES_KEY]: {
        type: "array",
        description:
          "The top-level objectives, domains, or sections, in the order the document presents them.",
        maxItems: MAX_IMPORT_NODES,
        items: nodeJsonSchema(MAX_IMPORT_DEPTH),
      },
    },
  };
}

function nodeJsonSchema(remainingDepth: number): JsonSchema {
  const properties: Record<string, JsonSchema> = {
    code: {
      type: "string",
      description:
        'The identifier the document gives this objective, such as "1.2" or "Domain 3", copied exactly. Omit when the document gives none.',
      nullable: true,
    },
    title: {
      type: "string",
      description:
        "The objective as the document words it, without rewording, translation, or summary.",
    },
    description: {
      type: "string",
      description:
        "What the document says about this objective beyond its title. Omit when it says nothing further.",
      nullable: true,
    },
    weight: {
      type: "number",
      description:
        "The percentage of the examination the document assigns to this objective, from 0 to 100. Omit unless the document states one.",
      minimum: 0,
      maximum: 100,
      nullable: true,
    },
  };

  if (remainingDepth > 1) {
    properties.children = {
      type: "array",
      description:
        "The objectives the document nests under this one, in document order. Omit or leave empty when it nests none.",
      maxItems: MAX_IMPORT_NODES,
      items: nodeJsonSchema(remainingDepth - 1),
    };
  }

  return {
    type: "object",
    required: ["title"],
    additionalProperties: false,
    properties,
  };
}

/**
 * Zod issues as repair feedback.
 *
 * Paths and expectations only. Never the value that failed: the value here is text out
 * of the owner's document, and a validation message travels back to the provider
 * (`spec/AI-GUIDELINES.md` section 1.7).
 */
function describeIssues(error: z.ZodError): readonly string[] {
  return error.issues.slice(0, 10).map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join(".");

    return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
  });
}
