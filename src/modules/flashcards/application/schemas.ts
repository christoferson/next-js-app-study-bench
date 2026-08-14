import { z } from "zod";
import { enumOf, optionalText, requiredText } from "@/shared/schema-fields";
import {
  CARD_TYPES,
  FLASHCARD_LIFECYCLE_STATUSES,
} from "@/modules/flashcards/domain/flashcard";
import {
  MAX_VOCABULARY_ANTONYMS,
  MAX_VOCABULARY_EXAMPLES,
  MAX_VOCABULARY_MEANINGS,
  MAX_VOCABULARY_SYNONYMS,
} from "@/modules/flashcards/domain/flashcard-content";
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
const USAGE_NOTES_LIMIT = 2000;
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
 * A textarea holding one entry per line.
 *
 * One field per list rather than a repeating fieldset with add and remove
 * buttons: a list of short strings is faster to type and to re-order as text, and
 * it needs no client state, which keeps the whole form uncontrolled and usable
 * without JavaScript (`spec/UI-GUIDELINES.md` section 1.1).
 *
 * Blank lines are dropped rather than rejected, because a trailing newline is how
 * a textarea normally ends. An entirely blank field is `[]`, which the facade
 * turns into an absent field rather than an empty list.
 */
const linesSchema = (options: {
  readonly label: string;
  readonly limit: number;
  readonly entryLimit: number;
}) =>
  z
    .string()
    .transform((value): readonly string[] =>
      value
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    )
    .refine((lines) => lines.length <= options.limit, {
      message: `List ${options.limit} ${options.label} or fewer.`,
    })
    .refine(
      (lines) => lines.every((line) => line.length <= options.entryLimit),
      {
        message: `Keep each entry to ${options.entryLimit} characters or fewer.`,
      },
    );

/**
 * Examples typed as one per line, each `sentence | reading | translation`.
 *
 * The pipe is the same separator a cloze hint uses, so the owner learns one
 * convention rather than two. Reading and translation are optional, so a line
 * with no pipe is a bare sentence.
 */
const exampleLinesSchema = z
  .string()
  .transform((value) =>
    value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [text = "", reading = "", translation = ""] = line
          .split("|")
          .map((part) => part.trim());

        return {
          text,
          ...(reading.length === 0 ? {} : { reading }),
          ...(translation.length === 0 ? {} : { translation }),
        };
      }),
  )
  .refine((examples) => examples.length <= MAX_VOCABULARY_EXAMPLES, {
    message: `List ${MAX_VOCABULARY_EXAMPLES} examples or fewer.`,
  })
  .refine(
    (examples) =>
      examples.every(
        (example) =>
          example.text.length > 0 && example.text.length <= EXAMPLE_LIMIT,
      ),
    {
      message: `Each example needs a sentence of ${EXAMPLE_LIMIT} characters or fewer before the first "|".`,
    },
  );

/** Parsed examples, as the facade assembles them into card content. */
export type VocabularyExampleInput = z.output<
  typeof exampleLinesSchema
>[number];

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
    // The richer fields, which the form keeps behind a disclosure.
    //
    // Optional in the schema as well as on the card, so a caller that assembles
    // input in code — the content importer, the demo seed — writes the four
    // fields a vocabulary card has always had and nothing more. The form always
    // submits all five, blank when the owner left them alone, and a blank one
    // parses to an empty list meaning "this card does not carry that field".
    meanings: linesSchema({
      label: "further meanings",
      limit: MAX_VOCABULARY_MEANINGS - 1,
      entryLimit: MEANING_LIMIT,
    }).optional(),
    synonyms: linesSchema({
      label: "synonyms",
      limit: MAX_VOCABULARY_SYNONYMS,
      entryLimit: TERM_LIMIT,
    }).optional(),
    antonyms: linesSchema({
      label: "antonyms",
      limit: MAX_VOCABULARY_ANTONYMS,
      entryLimit: TERM_LIMIT,
    }).optional(),
    examples: exampleLinesSchema.optional(),
    usageNotes: optionalText(USAGE_NOTES_LIMIT).optional(),
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
