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
import { IMPORT_SOURCE_CHOICES } from "@/modules/ai-generation/domain/objective-import";
import { IMPORT_STRATEGY_KEYS } from "@/modules/ai-generation/domain/import-strategy";
import { MAX_MERGE_ITEMS } from "@/modules/ai-generation/domain/objective-merge";
import {
  TUTOR_ASK_KINDS,
  TUTOR_NOTE_LIMIT,
} from "@/modules/ai-generation/domain/tutor-exchange";
import { GRADED_ANSWER_LIMIT } from "@/modules/ai-generation/domain/answer-evaluation";
import {
  CHALLENGE_REASON_LIMIT,
  CHALLENGE_REASON_MIN,
} from "@/modules/ai-generation/domain/question-challenge";

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
function idListSchema(message: string) {
  return z
    .array(z.string().max(ID_LIMIT, { message }))
    .optional()
    .transform((values): readonly string[] => {
      const ids = (values ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0);

      return [...new Set(ids)];
    });
}

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
  objectiveIds: idListSchema("That objective is not valid."),
  additionalInstructions: optionalText(ADDITIONAL_INSTRUCTIONS_LIMIT),
  questionTypes: typeListSchema(QUESTION_TYPES),
  cardTypes: typeListSchema(CARD_TYPES),
  /**
   * One of the owner's stored personas, for this batch only.
   *
   * Shape only, and blank means "use the track's persona, or the built-in one for its
   * study type". Whether the identifier names a real persona of a suitable archetype is
   * the facade's to decide, which is why an unknown value is not rejected here: a
   * persona deleted in another tab falls back to the automatic choice rather than
   * failing a request the owner has just paid the wait for.
   */
  personaId: optionalText(ID_LIMIT),
  /**
   * Where the content comes from (`SPEC.md` section 26.2).
   *
   * Only the three modes generation can honestly produce are offered — `MANUAL` is the
   * owner's own writing and the rest belong to milestones that do not exist. Defaulting
   * to `MODEL_KNOWLEDGE` keeps every existing caller and every existing test correct,
   * and it is the safe default in the sense that matters: it is the mode that claims the
   * least.
   *
   * The pairing rule — grounded needs at least one source, and the sources must be the
   * track's and active — is the facade's, not this schema's. It needs the track.
   */
  generationMode: z
    .string()
    .optional()
    .transform((value): "MODEL_KNOWLEDGE" | "SOURCE_GROUNDED" | "HYBRID" => {
      const chosen = (value ?? "").trim();

      return chosen === "SOURCE_GROUNDED" || chosen === "HYBRID"
        ? chosen
        : "MODEL_KNOWLEDGE";
    }),
  /**
   * Which of the owner's sources this batch may be built from.
   *
   * Same treatment as `objectiveIds`: blanks dropped, duplicates collapsed, unknown
   * identifiers left for the facade — which scopes them to the track and refuses ones
   * that are not there, because a source silently ignored would produce a batch grounded
   * on less than the owner chose.
   */
  sourceIds: idListSchema("That source is not valid."),
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

/**
 * How much extracted text one import may send to a model.
 *
 * A hard cap rather than a warning, because this is the one input whose size the owner
 * does not choose directly: a 200-page PDF is one click. Text beyond the cap is
 * truncated with a notice on the confirm step rather than the upload being refused,
 * because a syllabus's outline is at the front of the document and refusing a long file
 * outright would be refusing the common case. 120k characters is roughly 30k input
 * tokens, which is a few cents on the configured model and comfortably inside its
 * context.
 */
export const MAX_SYLLABUS_CHARACTERS = 120_000;

/** The largest file the upload form accepts, before extraction. */
export const MAX_SYLLABUS_FILE_BYTES = 10 * 1024 * 1024;

/**
 * One objective-import request.
 *
 * Only the notes and the paste box are parsed here. The file itself never becomes a
 * schema field: bytes are not something zod should be carrying, and the size and type
 * checks a file needs are stated in `objective-import-facade.ts` where the extractor is,
 * so they hold for any caller rather than only for this form.
 */
export const objectiveImportRequestSchema = z.object({
  /**
   * Which reader runs. See `domain/import-strategy.ts`.
   *
   * Required rather than defaulted, so a form that stops sending it fails loudly instead
   * of silently reverting every import to the AI extractor. The page always renders a
   * checked radio, so an ordinary submission always carries one.
   */
  strategyKey: enumOf(
    IMPORT_STRATEGY_KEYS,
    "Choose how the documents should be read.",
  ),
  /**
   * Text the owner pasted instead of, or as well as, uploading a file.
   *
   * Bounded by the same cap the extracted text is, so a paste and an upload are the
   * same size of request.
   */
  pastedText: optionalText(MAX_SYLLABUS_CHARACTERS),
  additionalInstructions: optionalText(ADDITIONAL_INSTRUCTIONS_LIMIT),
  /** One of the owner's stored personas, for this import only. See above. */
  personaId: optionalText(ID_LIMIT),
});

export type ObjectiveImportRequestInput = z.output<
  typeof objectiveImportRequestSchema
>;

/** Applying one proposed outline, from the confirm page. */
export const applyObjectiveImportSchema = z.object({
  runId: z
    .string()
    .max(ID_LIMIT)
    .transform((value) => value.trim()),
  sourceType: enumOf(
    IMPORT_SOURCE_CHOICES,
    "Choose whether this outline is the official syllabus or unofficial.",
  ),
  /**
   * Which merge items the owner left checked, as `add:<ref>` / `enrich:<ref>` keys.
   *
   * `null` rather than an empty array when the form sent no checkbox at all, and the two mean
   * different things: a plain tree import has no checkboxes, so `null` is "apply the whole
   * proposal", while `[]` is a merge whose every box the owner cleared — which the facade
   * refuses rather than treating as "apply everything". Collapsing them would turn
   * "I unchecked all of it" into the largest possible write.
   *
   * The keys are matched against the stored plan at apply time, so an unrecognised one is
   * ignored there rather than rejected here: this schema's job is bounding the *size* of the
   * list, and the plan is the only thing that knows which keys are real.
   */
  itemKeys: z
    .array(
      z
        .string()
        .max(ID_LIMIT)
        .transform((value) => value.trim()),
    )
    .max(MAX_MERGE_ITEMS)
    .nullish()
    .transform((values): readonly string[] | null => values ?? null),
});

export type ApplyObjectiveImportInput = z.output<
  typeof applyObjectiveImportSchema
>;

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
 * Reviewing one question, from the question's own page.
 *
 * Only an identifier: the review takes no options at all. There is nothing to choose
 * because the reviewer is shown the question's current revision and asked one question
 * about it, and every knob a form could offer — the persona, the template, the token
 * ceiling — is resolved from the track so two reviews of the same revision are comparable.
 */
export const reviewQuestionSchema = z.object({
  questionId: z
    .string()
    .max(ID_LIMIT)
    .transform((value) => value.trim()),
});

export type ReviewQuestionInput = z.output<typeof reviewQuestionSchema>;

/**
 * One ask to the tutor, from the question's own page.
 *
 * Three fields rather than one, unlike the review, because a tutor ask genuinely has
 * options: *which* of the six asks, which choice for the choice-by-choice one, and the
 * owner's own note. Everything else — the persona, the template, the token ceiling, the
 * revision — is resolved from the track and the question, so two identical asks are
 * comparable.
 *
 * `choiceId` is shape-checked only. Whether it names a choice the question actually has
 * is the facade's to decide, because the facade is the only thing holding the revision,
 * and a stale page naming a choice that has since been edited away should get a sentence
 * about the question rather than a field error on a select the owner cannot fix.
 */
export const tutorAskSchema = z.object({
  questionId: z
    .string()
    .max(ID_LIMIT)
    .transform((value) => value.trim()),
  kind: enumOf(TUTOR_ASK_KINDS, "Choose what to ask the tutor."),
  choiceId: optionalText(ID_LIMIT),
  note: optionalText(TUTOR_NOTE_LIMIT),
});

export type TutorAskInput = z.output<typeof tutorAskSchema>;

/**
 * One request to grade a written answer, from a session's feedback screen.
 *
 * The answer text travels on the request rather than being read back from the attempt, and
 * that is the whole shape of the advisory design: the grading is about the text the owner
 * submitted, the page already has it, and reading it back through a second module would
 * make the generation facade depend on the study-sessions module for a string it was handed.
 *
 * Bounded by `GRADED_ANSWER_LIMIT`, which is the same bound the template truncates to, so
 * an over-long answer is refused on the form rather than silently cut.
 */
export const gradeAnswerSchema = z.object({
  questionId: z
    .string()
    .max(ID_LIMIT)
    .transform((value) => value.trim()),
  answerText: z
    .string()
    .max(GRADED_ANSWER_LIMIT, {
      message: `Use ${GRADED_ANSWER_LIMIT} characters or fewer.`,
    })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, {
      message: "There is no answer text to grade.",
    }),
});

export type GradeAnswerInput = z.output<typeof gradeAnswerSchema>;

/**
 * One challenge of one question, from the question's own page.
 *
 * The reason is required and has a floor as well as a ceiling: "wrong" is not an objection
 * a model can adjudicate, and spending a call to be told so is worse than a field error.
 * `CHALLENGE_REASON_MIN` is deliberately low — a real objection can be short — and the
 * message says what a usable one contains.
 */
export const challengeQuestionSchema = z.object({
  questionId: z
    .string()
    .max(ID_LIMIT)
    .transform((value) => value.trim()),
  reason: z
    .string()
    .max(CHALLENGE_REASON_LIMIT, {
      message: `Use ${CHALLENGE_REASON_LIMIT} characters or fewer.`,
    })
    .transform((value) => value.trim())
    .refine((value) => value.length >= CHALLENGE_REASON_MIN, {
      message:
        "Say what you disagree with and why, in a sentence or two. An objection with no reasoning cannot be judged.",
    }),
});

export type ChallengeQuestionInput = z.output<typeof challengeQuestionSchema>;

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
