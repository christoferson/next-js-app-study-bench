import { z } from "zod";
import {
  enumOf,
  optionalIntegerInRange,
  optionalText,
  requiredText,
} from "@/shared/schema-fields";
import {
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  QUESTION_LIFECYCLE_STATUSES,
  QUESTION_QUALITY_STATUSES,
  QUESTION_TYPES,
} from "@/modules/question-bank/domain/question";
import {
  MAX_CHOICES,
  MAX_EXPECTED_CONCEPTS,
} from "@/modules/question-bank/domain/question-content";
import { DISPUTE_RESOLUTIONS } from "@/modules/question-bank/domain/question-lifecycle";

/**
 * Authoritative input schemas for the question bank.
 *
 * The schemas cover shape and length: they turn form strings into domain values
 * and reject text that is missing or too long. They deliberately do not decide
 * whether a choice configuration is answerable — that is an invariant of the
 * question aggregate and lives in
 * `@/modules/question-bank/domain/question-content`, so it holds for every
 * caller, not only for submissions that arrive through this form.
 */

const STEM_LIMIT = 2000;
const TEXT_LIMIT = 500;
const EXPLANATION_LIMIT = 4000;
const TAGS_LIMIT = 300;
const LANGUAGE_LIMIT = 20;
const DISPUTE_REASON_LIMIT = 1000;

export const questionTypeSchema = enumOf(
  QUESTION_TYPES,
  "Choose a question type.",
);

/**
 * Choice rows as the form submits them: parallel `choiceText` values plus the
 * indexes marked correct.
 *
 * Blank rows are dropped rather than rejected, so the owner can leave unused
 * rows of a fixed-size choice grid empty. Identifiers are assigned by index in
 * the facade, keeping them stable and free of owner input.
 */
const choiceTextsSchema = z
  .array(z.string())
  .transform((values) => values.map((value) => value.trim()))
  .refine((values) => values.every((value) => value.length <= TEXT_LIMIT), {
    message: `Use ${TEXT_LIMIT} characters or fewer per choice.`,
  })
  .refine((values) => values.length <= MAX_CHOICES, {
    message: `Use ${MAX_CHOICES} choices or fewer.`,
  });

const correctIndexesSchema = z
  .array(z.string())
  .transform((values, context) => {
    const indexes: number[] = [];

    for (const value of values) {
      const parsed = Number(value.trim());

      if (!Number.isInteger(parsed) || parsed < 0 || parsed >= MAX_CHOICES) {
        context.addIssue({
          code: "custom",
          message: "Mark a correct answer using the choices shown.",
        });
        return z.NEVER;
      }

      indexes.push(parsed);
    }

    return indexes;
  });

/** Free-text list split on newlines, with blank lines dropped. */
const linesSchema = (limit: number, message: string) =>
  z
    .string()
    .transform((value) =>
      value
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    )
    .refine((lines) => lines.length <= limit, { message });

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

    // Duplicates are collapsed rather than rejected: "aws, AWS" is a typo, not
    // an error worth blocking a save for.
    return [...new Set(tags)];
  });

const commonQuestionFields = {
  stem: requiredText("Question text", STEM_LIMIT),
  instructions: optionalText(TEXT_LIMIT),
  explanation: optionalText(EXPLANATION_LIMIT),
  difficulty: optionalIntegerInRange({
    message: `Choose a difficulty between ${MIN_DIFFICULTY} and ${MAX_DIFFICULTY}, or leave it blank.`,
    min: MIN_DIFFICULTY,
    max: MAX_DIFFICULTY,
  }),
  tags: tagsSchema,
  language: optionalText(LANGUAGE_LIMIT),
};

/**
 * Question input, discriminated by `questionType`.
 *
 * A discriminated union rather than one object with optional fields, so the
 * parsed value carries exactly the fields its type needs and the facade's switch
 * over it is exhaustive (`spec/CODING-STANDARDS.md` sections 1.3 and 1.4).
 */
export const questionInputSchema = z.discriminatedUnion("questionType", [
  z.object({
    ...commonQuestionFields,
    questionType: z.literal("SINGLE_CHOICE"),
    choiceTexts: choiceTextsSchema,
    correctChoiceIndexes: correctIndexesSchema,
  }),
  z.object({
    ...commonQuestionFields,
    questionType: z.literal("MULTIPLE_RESPONSE"),
    choiceTexts: choiceTextsSchema,
    correctChoiceIndexes: correctIndexesSchema,
  }),
  z.object({
    ...commonQuestionFields,
    questionType: z.literal("SHORT_ANSWER"),
    expectedConcepts: linesSchema(
      MAX_EXPECTED_CONCEPTS,
      `List ${MAX_EXPECTED_CONCEPTS} expected concepts or fewer.`,
    ),
  }),
]);

export type QuestionInput = z.output<typeof questionInputSchema>;

export const disputeInputSchema = z.object({
  reason: requiredText("A reason", DISPUTE_REASON_LIMIT),
});

export type DisputeInput = z.output<typeof disputeInputSchema>;

export const disputeResolutionSchema = enumOf(
  DISPUTE_RESOLUTIONS,
  "Choose how the dispute was resolved.",
);

export const objectiveLinkSchema = z.object({
  objectiveId: requiredText("An objective", 200),
});

/**
 * Bank filters, parsed from the query string.
 *
 * Every filter is optional and an unrecognised value is treated as "no filter"
 * rather than an error: a stale bookmark or a hand-edited URL should show the
 * unfiltered bank, not an error page.
 */
/**
 * Filter text: absent, empty, and whitespace-only all mean "no filter".
 *
 * Unlike a form field, a query-string key may simply be missing, and an
 * over-long value is truncated rather than rejected, because a filter the owner
 * cannot see the source of should never produce an error page.
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

export const questionFilterSchema = z.object({
  lifecycle: optionalEnum(QUESTION_LIFECYCLE_STATUSES),
  quality: optionalEnum(QUESTION_QUALITY_STATUSES),
  type: optionalEnum(QUESTION_TYPES),
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

export type QuestionFilterInput = z.output<typeof questionFilterSchema>;
