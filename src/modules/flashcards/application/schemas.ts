import { z } from "zod";
import { enumOf, optionalText, requiredText } from "@/shared/schema-fields";
import {
  CARD_TYPES,
  FLASHCARD_LIFECYCLE_STATUSES,
} from "@/modules/flashcards/domain/flashcard";
import { RECALL_RATINGS } from "@/modules/flashcards/domain/review-scheduling";

/**
 * Authoritative input schemas for flashcards.
 *
 * The schemas cover shape and length: they turn form strings into domain values
 * and reject text that is missing or too long. They deliberately do not decide
 * whether a card is studiable — that is an invariant of the flashcard aggregate
 * and lives in `@/modules/flashcards/domain/flashcard-content`, so it holds for
 * every caller, not only for submissions that arrive through this form.
 */

const FACE_LIMIT = 2000;
const CLOZE_LIMIT = 2000;
const TERM_LIMIT = 200;
const READING_LIMIT = 200;
const MEANING_LIMIT = 1000;
const EXAMPLE_LIMIT = 1000;
const SCENARIO_LIMIT = 2000;
const NOTES_LIMIT = 4000;
const TAGS_LIMIT = 300;
const LANGUAGE_LIMIT = 20;

export const cardTypeSchema = enumOf(CARD_TYPES, "Choose a card type.");

export const recallRatingSchema = enumOf(
  RECALL_RATINGS,
  "Choose how well you recalled the card.",
);

const tagsSchema = z
  .string()
  .refine((value) => value.length <= TAGS_LIMIT, {
    message: `Use ${TAGS_LIMIT} characters or fewer.`,
  })
  .transform((value) => {
    const tags = value
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

    // Duplicates are collapsed rather than rejected: "hsk, HSK" is a typo, not an
    // error worth blocking a save for.
    return [...new Set(tags)];
  });

const commonCardFields = {
  notes: optionalText(NOTES_LIMIT),
  tags: tagsSchema,
  language: optionalText(LANGUAGE_LIMIT),
};

/**
 * Card input, discriminated by `cardType`.
 *
 * A discriminated union rather than one object with optional fields, so the parsed
 * value carries exactly the fields its type needs and the facade's switch over it
 * is exhaustive (`spec/CODING-STANDARDS.md` sections 1.3 and 1.4).
 *
 * `BASIC` and `REVERSED` take the same two fields but stay separate members: the
 * type is the owner's choice about how the card is studied, not a detail the
 * schema can merge away.
 */
export const flashcardInputSchema = z.discriminatedUnion("cardType", [
  z.object({
    ...commonCardFields,
    cardType: z.literal("BASIC"),
    front: requiredText("The front of the card", FACE_LIMIT),
    back: requiredText("The back of the card", FACE_LIMIT),
  }),
  z.object({
    ...commonCardFields,
    cardType: z.literal("REVERSED"),
    front: requiredText("The front of the card", FACE_LIMIT),
    back: requiredText("The back of the card", FACE_LIMIT),
  }),
  z.object({
    ...commonCardFields,
    cardType: z.literal("CLOZE"),
    text: requiredText("The sentence", CLOZE_LIMIT),
  }),
  z.object({
    ...commonCardFields,
    cardType: z.literal("VOCABULARY"),
    term: requiredText("A term", TERM_LIMIT),
    reading: optionalText(READING_LIMIT),
    meaning: requiredText("A meaning", MEANING_LIMIT),
    exampleSentence: optionalText(EXAMPLE_LIMIT),
  }),
  z.object({
    ...commonCardFields,
    cardType: z.literal("SCENARIO"),
    scenario: requiredText("A situation", SCENARIO_LIMIT),
    question: requiredText("A question", SCENARIO_LIMIT),
    answer: requiredText("An answer", SCENARIO_LIMIT),
  }),
]);

export type FlashcardInput = z.output<typeof flashcardInputSchema>;

export const objectiveLinkSchema = z.object({
  objectiveId: requiredText("An objective", 200),
});

/** Recording a review: which card, which revision was on screen, what rating. */
export const reviewInputSchema = z.object({
  flashcardId: requiredText("A card", 200),
  /**
   * The revision the owner actually read.
   *
   * Submitted with the rating rather than re-read on the server, so a review
   * records the text that was on screen even if the card was edited in another
   * tab while this one was open (`spec/DOMAIN-RULES.md` section 1.4).
   */
  flashcardRevisionId: requiredText("A revision", 200),
  rating: recallRatingSchema,
});

export type ReviewInput = z.output<typeof reviewInputSchema>;

/**
 * Bank filters, parsed from the query string.
 *
 * Every filter is optional and an unrecognised value is treated as "no filter"
 * rather than an error: a stale bookmark or a hand-edited URL should show the
 * unfiltered bank, not an error page.
 */
const FILTER_TEXT_LIMIT = 200;

const optionalFilterText = z
  .string()
  .optional()
  .transform((value): string | null => {
    const trimmed = (value ?? "").trim().slice(0, FILTER_TEXT_LIMIT);

    return trimmed.length === 0 ? null : trimmed;
  });

function optionalEnum<Value extends string>(values: readonly Value[]) {
  return z
    .string()
    .optional()
    .transform((value): Value | null => {
      const trimmed = (value ?? "").trim();

      return values.find((candidate) => candidate === trimmed) ?? null;
    });
}

export const flashcardFilterSchema = z.object({
  lifecycle: optionalEnum(FLASHCARD_LIFECYCLE_STATUSES),
  type: optionalEnum(CARD_TYPES),
  objective: optionalFilterText,
  q: optionalFilterText,
  page: z
    .string()
    .optional()
    .transform((value) => {
      const parsed = Number((value ?? "").trim());

      return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
    }),
});

export type FlashcardFilterInput = z.output<typeof flashcardFilterSchema>;
