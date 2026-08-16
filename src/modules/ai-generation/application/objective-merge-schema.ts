import { z } from "zod";
import {
  MAX_MERGE_ITEMS,
  MERGE_CODE_LIMIT,
  MERGE_DESCRIPTION_LIMIT,
  MERGE_REASON_LIMIT,
  MERGE_REF_LIMIT,
  MERGE_SUMMARY_LIMIT,
  MERGE_TITLE_LIMIT,
  checkObjectiveMerge,
} from "@/modules/ai-generation/domain/objective-merge";
import type {
  ExistingObjectiveNode,
  MergeItem,
  MergeSourceNode,
  ObjectiveMergePlan,
} from "@/modules/ai-generation/domain/objective-merge";
import type {
  JsonSchema,
  StructuredValidation,
} from "@/modules/ai-generation/ports/language-model-gateway";

/**
 * Application-owned schema for the merge plan a model returns, and the same schema used
 * to read one back off the run row.
 *
 * Two directions, one schema, for the reason `objective-import-schema.ts` gives: the
 * model's answer and the stored row are the same untrusted value, and parsing both through
 * one schema means a plan the confirm page can render is a plan the apply step can act on.
 *
 * The one deliberate asymmetry is *which* checks run in each direction. Coming back from the
 * provider, the plan is checked against the tree that was sent and the existing objectives
 * that were described — that is `validateObjectiveMergePlan`, and a plan referencing an id
 * that was never sent is a plan that gets one repair attempt and then fails. Reading the
 * stored row back, only the shape is checked (`readStoredMergePlan`), because the *live*
 * hierarchy is allowed to have moved on: the owner may have archived or deleted an objective
 * between confirming and applying, and a payload that became unreadable because of that would
 * lose the whole proposal rather than the one verdict that no longer applies. The apply step
 * resolves ids against the rows it is about to write beside and drops what no longer
 * resolves, which is the honest place for that decision.
 */

const ITEM_KINDS = ["ADD", "ENRICH", "SKIP"] as const;

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

const requiredModelText = (limit: number) =>
  z
    .string({ message: "must be a string" })
    .max(limit, { message: `use ${limit} characters or fewer` })
    .transform((value) => value.trim());

/**
 * A weight as the model restates it.
 *
 * Coerced from a string as well as a number for the reason the import's own weight is: a
 * model asked for a percentage answers `22`, `"22"`, and `"22%"` about equally often, and
 * refusing the merge over a quoted number would waste a call. Range is left to
 * `checkObjectiveMerge`'s caller, which is the import's own node check applied to the
 * additions.
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

    return Number.isFinite(parsed) ? parsed : null;
  });

/**
 * One verdict, as a flat object with a `kind`.
 *
 * Flat rather than three arrays, and that is what preserves document order across the whole
 * plan: "the fifth grammar point is new, the sixth is a duplicate, the seventh enriches the
 * one you already had" is one sequence, and splitting it into three lists would lose the
 * interleaving the owner reads the document in.
 *
 * Every field of every kind is accepted on every item and then discarded by the transform,
 * because a model that returns `existingId: null` on an ADD is not making a mistake worth
 * failing a call over. What is *not* tolerated is a missing required field for the kind
 * claimed, which is what the switch below enforces.
 */
const itemSchema = z
  .object({
    kind: z.enum(ITEM_KINDS, {
      message: `must be one of ${ITEM_KINDS.join(", ")}`,
    }),
    ref: requiredModelText(MERGE_REF_LIMIT),
    parentExistingId: optionalModelText(MERGE_REF_LIMIT),
    parentRef: optionalModelText(MERGE_REF_LIMIT),
    existingId: optionalModelText(MERGE_REF_LIMIT),
    matchedExistingId: optionalModelText(MERGE_REF_LIMIT),
    code: optionalModelText(MERGE_CODE_LIMIT),
    title: optionalModelText(MERGE_TITLE_LIMIT),
    description: optionalModelText(MERGE_DESCRIPTION_LIMIT),
    weight: modelWeight,
    reason: optionalModelText(MERGE_REASON_LIMIT),
  })
  .superRefine((item, context) => {
    if (item.kind === "ADD" && (item.title ?? "").length === 0) {
      context.addIssue({
        code: "custom",
        path: ["title"],
        message: "an ADD must state the title of the objective to add",
      });
    }

    if (item.kind === "ENRICH") {
      if ((item.existingId ?? "").length === 0) {
        context.addIssue({
          code: "custom",
          path: ["existingId"],
          message:
            "an ENRICH must name the id of the existing objective it improves",
        });
      }

      if ((item.description ?? "").length === 0) {
        context.addIssue({
          code: "custom",
          path: ["description"],
          message:
            "an ENRICH must state the improved description; omit the item instead of clearing a description",
        });
      }
    }

    if (item.kind === "SKIP" && (item.reason ?? "").length === 0) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "a SKIP must say why the objective is already covered",
      });
    }
  })
  .transform((item): MergeItem => {
    switch (item.kind) {
      case "ADD":
        return {
          kind: "ADD",
          ref: item.ref,
          parentExistingId: item.parentExistingId,
          parentRef: item.parentRef,
          code: item.code,
          title: item.title ?? "",
          description: item.description,
          weight: item.weight,
        };
      case "ENRICH":
        return {
          kind: "ENRICH",
          ref: item.ref,
          existingId: item.existingId ?? "",
          description: item.description ?? "",
        };
      case "SKIP":
        return {
          kind: "SKIP",
          ref: item.ref,
          reason: item.reason ?? "",
          matchedExistingId: item.matchedExistingId,
        };
    }
  });

const MERGE_KEY = "merge";
const ITEMS_KEY = "items";
const SUMMARY_KEY = "summary";

const planSchema = z.object({
  [ITEMS_KEY]: z.array(itemSchema).max(MAX_MERGE_ITEMS, {
    message: `return ${MAX_MERGE_ITEMS} verdicts or fewer`,
  }),
  [SUMMARY_KEY]: requiredModelText(MERGE_SUMMARY_LIMIT),
});

/** Name of the tool the provider is asked to fill in. */
export const OBJECTIVE_MERGE_SCHEMA_NAME = "objective_merge_plan";

/**
 * The validator the gateway calls: shape, then the plan's applicability to what was sent.
 *
 * Curried over the sent tree and the described hierarchy rather than taking them as extra
 * arguments, because the gateway's `validate` callback takes one value — and because the two
 * lists are what "valid" *means* here: the same JSON is a good plan against one tree and an
 * unapplicable one against another.
 */
export function objectiveMergeValidator(
  sourceNodes: readonly MergeSourceNode[],
  existing: readonly ExistingObjectiveNode[],
): (payload: unknown) => StructuredValidation<ObjectiveMergePlan> {
  return (payload) =>
    validateObjectiveMergePlan(payload, sourceNodes, existing);
}

export function validateObjectiveMergePlan(
  payload: unknown,
  sourceNodes: readonly MergeSourceNode[],
  existing: readonly ExistingObjectiveNode[],
): StructuredValidation<ObjectiveMergePlan> {
  const result = planSchema.safeParse(payload);

  if (!result.success) {
    return { ok: false, errors: describeIssues(result.error) };
  }

  const plan: ObjectiveMergePlan = {
    items: result.data[ITEMS_KEY],
    summary: result.data[SUMMARY_KEY],
  };
  const problems = checkObjectiveMerge(plan, sourceNodes, existing);

  return problems.length > 0
    ? { ok: false, errors: problems }
    : { ok: true, value: plan };
}

/**
 * A stored plan, re-parsed for shape only.
 *
 * `null` for anything that is not a plan, so the confirm page can say the proposal can no
 * longer be read rather than returning a 500 for a hand-edited row. See the note at the top
 * of this file for why the applicability checks deliberately do not run here.
 */
export function readStoredMergePlan(value: unknown): ObjectiveMergePlan | null {
  const result = planSchema.safeParse(value);

  return result.success
    ? { items: result.data[ITEMS_KEY], summary: result.data[SUMMARY_KEY] }
    : null;
}

/** The key a merge plan is stored under inside the run's payload. */
export { MERGE_KEY as MERGE_PAYLOAD_KEY };

/**
 * The answer shape sent to the provider.
 *
 * One array of flat verdicts, and the descriptions are the contract rather than decoration:
 * they are where the model is told that an existing objective is referenced by the id it was
 * given, that an addition's parent is either one of those ids or another addition's ref, and
 * that an enrichment rewrites a description and nothing else.
 */
export function objectiveMergeJsonSchema(): JsonSchema {
  return {
    type: "object",
    description:
      "How each extracted objective reconciles with the objectives the track already has.",
    required: [ITEMS_KEY, SUMMARY_KEY],
    additionalProperties: false,
    properties: {
      [ITEMS_KEY]: {
        type: "array",
        description:
          "One verdict per extracted objective, in the order the extracted list gives them.",
        maxItems: MAX_MERGE_ITEMS,
        items: {
          type: "object",
          required: ["kind", "ref"],
          additionalProperties: false,
          properties: {
            kind: {
              type: "string",
              description:
                "ADD to write this extracted objective, ENRICH to improve an existing objective's description from it, SKIP when the track already covers it.",
              enum: [...ITEM_KINDS],
            },
            ref: {
              type: "string",
              description:
                "The ref of the extracted objective this verdict is about, copied exactly from the list of extracted objectives.",
            },
            parentExistingId: {
              type: "string",
              description:
                "ADD only. The id of the existing objective to nest this one under, copied exactly from the list of existing objectives. Omit for a new top-level objective or when the parent is another addition.",
              nullable: true,
            },
            parentRef: {
              type: "string",
              description:
                "ADD only. The ref of another objective being added in this same plan, when this one belongs under it. That addition must appear earlier in the list. Omit when the parent is an existing objective or when there is none.",
              nullable: true,
            },
            existingId: {
              type: "string",
              description:
                "ENRICH only. The id of the existing objective whose description is being improved, copied exactly from the list of existing objectives.",
              nullable: true,
            },
            matchedExistingId: {
              type: "string",
              description:
                "SKIP only. The id of the existing objective that already covers this one, when a single one does. Omit otherwise.",
              nullable: true,
            },
            code: {
              type: "string",
              description:
                "ADD only. The code of the extracted objective, copied exactly. Omit when it has none.",
              nullable: true,
            },
            title: {
              type: "string",
              description:
                "ADD only. The title of the extracted objective, copied exactly as extracted, without rewording or translation.",
              nullable: true,
            },
            description: {
              type: "string",
              description:
                "ADD: the extracted objective's own description, or omitted. ENRICH: the full description to store on the existing objective — what it already records, extended with what the new material adds. Never a replacement that drops what was there.",
              nullable: true,
            },
            weight: {
              type: "number",
              description:
                "ADD only. The percentage the document assigns this objective, from 0 to 100. Omit unless the extraction carried one.",
              minimum: 0,
              maximum: 100,
              nullable: true,
            },
            reason: {
              type: "string",
              description:
                "SKIP only. One short sentence saying what already covers this objective.",
              nullable: true,
            },
          },
        },
      },
      [SUMMARY_KEY]: {
        type: "string",
        description:
          "One sentence describing the reconciliation as a whole: roughly how much is new, how much extends what is there, and how much was already covered.",
      },
    },
  };
}

/**
 * Zod issues as repair feedback.
 *
 * Paths and expectations only, never the value that failed: the values here are the owner's
 * document text and their own objective titles, and a validation message travels back to the
 * provider (`spec/AI-GUIDELINES.md` section 1.7).
 */
function describeIssues(error: z.ZodError): readonly string[] {
  return error.issues.slice(0, 10).map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join(".");

    return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
  });
}
