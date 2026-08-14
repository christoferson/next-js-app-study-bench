import { z } from "zod";
import {
  enumOf,
  integerInRange,
  optionalIntegerInRange,
  optionalText,
} from "@/shared/schema-fields";
import {
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  QUESTION_TYPES,
} from "@/modules/question-bank/domain/question";
import { CARD_TYPES } from "@/modules/flashcards/domain/flashcard";
import { GENERATED_ITEM_KINDS } from "@/modules/ai-generation/domain/generation-run";
import {
  MAX_BATCH_ITEMS,
  MAX_ENRICHMENT_ITEMS,
  MIN_BATCH_ITEMS,
} from "@/modules/ai-generation/domain/generation-limits";

/**
 * Authoritative input schemas for generation requests.
 *
 * The schemas cover shape and bounds: they turn form strings into domain values,
 * reject a batch larger than the cost limit allows, and reject text that is too
 * long. They deliberately do not decide whether the request is affordable in
 * total, whether an equivalent batch already exists, or which persona applies —
 * those are facade concerns, so they hold for every caller rather than only for
 * submissions that arrive through this form.
 *
 * The batch limit is enforced here *and* in the facade
 * (`GenerationBatchTooLargeError`). Two enforcement points is deliberate: cost
 * control must not depend on one layer being reached (`SPEC.md` section 11.6).
 */

const ID_LIMIT = 200;

/**
 * How much free text the owner may add to one request.
 *
 * Bounded because it is carried into the prompt, and an unbounded note would put
 * the request's size — and its cost — outside the batch limit's control.
 */
const ADDITIONAL_INSTRUCTIONS_LIMIT = 1000;

export const itemKindSchema = enumOf(
  GENERATED_ITEM_KINDS,
  "Choose what to generate.",
);

/**
 * Identifier list from a set of checkboxes.
 *
 * Blank values are dropped and duplicates collapsed: a repeated or empty checkbox
 * value is a form quirk, not a mistake worth refusing a request for. An identifier
 * that does not belong to the track is not rejected here — the facade scopes the
 * offered objectives to the track, so an unknown one simply selects nothing.
 */
const objectiveIdsSchema = z
  .array(z.string().max(ID_LIMIT, { message: "That objective is not valid." }))
  .optional()
  .transform((values): readonly string[] => {
    const ids = (values ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    return [...new Set(ids)];
  });

/**
 * A multi-select over a closed list of content types.
 *
 * An unrecognised value is dropped rather than rejected: the list is rendered from
 * the same constant it is matched against, so an unrecognised value means a stale
 * page, and an empty selection already has a defined meaning — "let the persona
 * decide" (`prompt-templates.ts`). Refusing the request would make a stale tab
 * fail instead of falling back to a sensible default.
 */
function typeListSchema<Value extends string>(values: readonly Value[]) {
  return z
    .array(z.string())
    .optional()
    .transform((submitted): readonly Value[] => {
      const chosen = (submitted ?? []).map((value) => value.trim());

      return values.filter((value) => chosen.includes(value));
    });
}

/**
 * A checkbox the owner ticks to proceed anyway.
 *
 * Browsers submit nothing at all for an unticked checkbox, so absence is `false`.
 * Any submitted value counts as ticked: the value attribute is a rendering detail
 * and `"on"` is only the default.
 */
const confirmationSchema = z
  .string()
  .optional()
  .transform((value) => (value ?? "").trim().length > 0);

/**
 * One generation request.
 *
 * `itemCount` is required and bounded rather than optional-with-a-default: the
 * owner is spending a model call, so how many items it will produce is not
 * something the application should assume on their behalf.
 *
 * Both type lists are always present in the parsed value, and the facade uses only
 * the one matching `itemKind`. Keeping them as one object rather than a
 * discriminated union on `itemKind` is deliberate: the two kinds share every other
 * field, and the form renders one control set with the irrelevant list hidden, so a
 * union would split the schema without splitting the request.
 */
export const generationRequestSchema = z.object({
  itemKind: itemKindSchema,
  itemCount: integerInRange({
    message: `Ask for between ${MIN_BATCH_ITEMS} and ${MAX_BATCH_ITEMS} items.`,
    min: MIN_BATCH_ITEMS,
    max: MAX_BATCH_ITEMS,
  }),
  difficulty: optionalIntegerInRange({
    message: `Choose a difficulty between ${MIN_DIFFICULTY} and ${MAX_DIFFICULTY}, or leave it blank.`,
    min: MIN_DIFFICULTY,
    max: MAX_DIFFICULTY,
  }),
  objectiveIds: objectiveIdsSchema,
  additionalInstructions: optionalText(ADDITIONAL_INSTRUCTIONS_LIMIT),
  questionTypes: typeListSchema(QUESTION_TYPES),
  cardTypes: typeListSchema(CARD_TYPES),
  /**
   * Set when the owner has seen the duplicate-batch notice and asked for the
   * batch anyway (`SPEC.md` section 11.6).
   */
  generateAnyway: confirmationSchema,
});

export type GenerationRequestInput = z.output<typeof generationRequestSchema>;

/**
 * One vocabulary-enrichment request.
 *
 * Its own schema rather than a variant of `generationRequestSchema`, because almost
 * nothing carries over: enrichment chooses no objective, no difficulty, and no
 * content type — the cards it works on are chosen by the bank's own order, not by
 * the owner. What is left is how many to do and whether to proceed after a duplicate
 * notice.
 *
 * `count` is bounded by the enrichment cap rather than the batch limit, for the
 * reason `MAX_ENRICHMENT_ITEMS` documents.
 */
export const enrichmentRequestSchema = z.object({
  count: integerInRange({
    message: `Enrich between ${MIN_BATCH_ITEMS} and ${MAX_ENRICHMENT_ITEMS} cards.`,
    min: MIN_BATCH_ITEMS,
    max: MAX_ENRICHMENT_ITEMS,
  }),
  additionalInstructions: optionalText(ADDITIONAL_INSTRUCTIONS_LIMIT),
  generateAnyway: confirmationSchema,
});

export type EnrichmentRequestInput = z.output<typeof enrichmentRequestSchema>;

/** Rejecting one generated draft from the run review screen. */
export const rejectDraftSchema = z.object({
  runId: z
    .string()
    .max(ID_LIMIT)
    .transform((value) => value.trim()),
  itemId: z
    .string()
    .max(ID_LIMIT)
    .transform((value) => value.trim()),
});

export type RejectDraftInput = z.output<typeof rejectDraftSchema>;

/**
 * Run-history paging, parsed from the query string.
 *
 * Only a page number: the history is one bounded list per track, and the run
 * repository offers no filters, so a filter control here would be a dead one.
 * An unusable page value falls back to page 1 rather than erroring, because a
 * stale bookmark or a hand-edited URL should show the history, not an error page.
 */
export const generationRunFilterSchema = z.object({
  page: z
    .string()
    .optional()
    .transform((value) => {
      const parsed = Number((value ?? "").trim());

      return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
    }),
});

export type GenerationRunFilterInput = z.output<
  typeof generationRunFilterSchema
>;
