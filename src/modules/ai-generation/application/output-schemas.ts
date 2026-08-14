import { z } from "zod";
import { QUESTION_TYPES } from "@/modules/question-bank/domain/question";
import type {
  QuestionContent,
  QuestionType,
} from "@/modules/question-bank/domain/question";
import { choiceId } from "@/modules/question-bank/domain/question-content";
import { CARD_TYPES } from "@/modules/flashcards/domain/flashcard";
import type {
  CardType,
  FlashcardContent,
} from "@/modules/flashcards/domain/flashcard";
import type {
  GeneratedFlashcardDraft,
  GeneratedQuestionDraft,
  VocabularyEnrichmentDraft,
} from "@/modules/ai-generation/domain/generated-draft";
import type {
  JsonSchema,
  StructuredValidation,
} from "@/modules/ai-generation/ports/language-model-gateway";

/**
 * Application-owned schemas for model output (`SPEC.md` section 11.2).
 *
 * The model's answer is external input and is never trusted as typed
 * (`spec/CODING-STANDARDS.md` section 2). Two artefacts describe the same answer
 * shape from opposite sides:
 *
 * - `questionOutputJsonSchema` / `flashcardOutputJsonSchema` are sent to the
 *   provider as the shape to fill in. They are a permissive superset: one object
 *   per item with every field the union might need, because the port's `JsonSchema`
 *   describes plain objects and a provider tool schema cannot express "these three
 *   fields only when the type is VOCABULARY" in a way every model honours.
 * - `validateQuestionOutput` / `validateFlashcardOutput` are the authority. They are
 *   strict discriminated unions, so a card that says `VOCABULARY` and carries a
 *   `front` is rejected rather than half-read.
 *
 * The gap between the two is deliberate and is what the bounded repair attempt is
 * for: the validator's messages name the field path and what was expected, which is
 * exactly what a model needs to correct its own answer, and they contain no owner
 * data and no provider detail, so they are safe to send back
 * (`spec/AI-GUIDELINES.md` section 1.7).
 *
 * Choice identifiers are assigned here by position rather than read from the model,
 * using the same `choiceId` helper the manual authoring path uses. The model marks
 * correct answers by index, which is a thing it can get right; inventing stable
 * identifiers is not.
 */

/** Length limits, matching the manual authoring schemas. */
const STEM_LIMIT = 2000;
const CHOICE_TEXT_LIMIT = 500;
const INSTRUCTIONS_LIMIT = 500;
const EXPLANATION_LIMIT = 4000;
const CONCEPT_LIMIT = 500;
const FACE_LIMIT = 2000;
const TERM_LIMIT = 200;
const READING_LIMIT = 200;
const MEANING_LIMIT = 1000;
const EXAMPLE_LIMIT = 1000;
const SCENARIO_LIMIT = 2000;
const NOTES_LIMIT = 4000;
const TAG_LIMIT = 60;

/** The most tags one generated item may carry, so a tag list cannot run away. */
const MAX_TAGS = 8;

/** The most items one response may contain, whatever was asked for. */
const MAX_ITEMS_PER_RESPONSE = 25;

/** The most choices or concepts one generated item may list. */
const MAX_LIST_ENTRIES = 12;

/**
 * Text that may be absent, null, or blank, all meaning "not provided".
 *
 * Models express an omitted optional field all three ways, and treating them as
 * three different answers would fail a response that is materially correct.
 */
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

const modelTags = z
  .array(
    z
      .string()
      .max(TAG_LIMIT, { message: `use ${TAG_LIMIT} characters or fewer` }),
  )
  .max(MAX_TAGS, { message: `list ${MAX_TAGS} tags or fewer` })
  .nullish()
  .transform((values): readonly string[] => {
    const tags = (values ?? [])
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

    return [...new Set(tags)];
  });

const modelObjectiveIds = z
  .array(z.string().max(200))
  .max(MAX_LIST_ENTRIES, {
    message: `list ${MAX_LIST_ENTRIES} objectives or fewer`,
  })
  .nullish()
  .transform((values): readonly string[] =>
    (values ?? []).map((id) => id.trim()).filter((id) => id.length > 0),
  );

/**
 * Difficulty as the model states it.
 *
 * The range is checked by the deterministic checks rather than here, so an
 * out-of-range difficulty costs one item instead of failing the batch: it is a
 * wrong value in a well-formed answer, which is what per-item rejection is for.
 */
const modelDifficulty = z
  .number()
  .nullish()
  .transform((value): number | null => value ?? null);

const questionItemSchema = z.object({
  questionType: z.enum(["SINGLE_CHOICE", "MULTIPLE_RESPONSE", "SHORT_ANSWER"], {
    message: `must be one of ${QUESTION_TYPES.join(", ")}`,
  }),
  stem: requiredModelText(STEM_LIMIT),
  instructions: optionalModelText(INSTRUCTIONS_LIMIT),
  choices: z
    .array(requiredModelText(CHOICE_TEXT_LIMIT))
    .max(MAX_LIST_ENTRIES, {
      message: `list ${MAX_LIST_ENTRIES} choices or fewer`,
    })
    .nullish()
    .transform((values): readonly string[] => values ?? []),
  correctChoiceIndexes: z
    .array(z.number())
    .max(MAX_LIST_ENTRIES)
    .nullish()
    .transform((values): readonly number[] => values ?? []),
  expectedConcepts: z
    .array(requiredModelText(CONCEPT_LIMIT))
    .max(MAX_LIST_ENTRIES, {
      message: `list ${MAX_LIST_ENTRIES} expected concepts or fewer`,
    })
    .nullish()
    .transform((values): readonly string[] =>
      (values ?? []).filter((concept) => concept.length > 0),
    ),
  explanation: optionalModelText(EXPLANATION_LIMIT),
  difficulty: modelDifficulty,
  tags: modelTags,
  objectiveIds: modelObjectiveIds,
});

const questionResponseSchema = z.object({
  questions: z.array(questionItemSchema).max(MAX_ITEMS_PER_RESPONSE, {
    message: `return ${MAX_ITEMS_PER_RESPONSE} questions or fewer`,
  }),
});

const commonCardFields = {
  notes: optionalModelText(NOTES_LIMIT),
  tags: modelTags,
  objectiveIds: modelObjectiveIds,
};

/**
 * Card output as a discriminated union on `cardType`.
 *
 * Strict per type, so the fields a card carries are the fields its type defines
 * (`spec/CODING-STANDARDS.md` section 1.3). `BASIC` and `REVERSED` stay separate
 * members even though their fields match: the type says how the card is studied,
 * which the validator has no business merging away.
 */
const cardItemSchema = z.discriminatedUnion("cardType", [
  z.object({
    ...commonCardFields,
    cardType: z.literal("BASIC"),
    front: requiredModelText(FACE_LIMIT),
    back: requiredModelText(FACE_LIMIT),
  }),
  z.object({
    ...commonCardFields,
    cardType: z.literal("REVERSED"),
    front: requiredModelText(FACE_LIMIT),
    back: requiredModelText(FACE_LIMIT),
  }),
  z.object({
    ...commonCardFields,
    cardType: z.literal("CLOZE"),
    text: requiredModelText(FACE_LIMIT),
  }),
  z.object({
    ...commonCardFields,
    cardType: z.literal("VOCABULARY"),
    term: requiredModelText(TERM_LIMIT),
    reading: optionalModelText(READING_LIMIT),
    meaning: requiredModelText(MEANING_LIMIT),
    exampleSentence: optionalModelText(EXAMPLE_LIMIT),
  }),
  z.object({
    ...commonCardFields,
    cardType: z.literal("SCENARIO"),
    scenario: requiredModelText(SCENARIO_LIMIT),
    question: requiredModelText(SCENARIO_LIMIT),
    answer: requiredModelText(SCENARIO_LIMIT),
  }),
]);

const cardResponseSchema = z.object({
  flashcards: z.array(cardItemSchema).max(MAX_ITEMS_PER_RESPONSE, {
    message: `return ${MAX_ITEMS_PER_RESPONSE} flashcards or fewer`,
  }),
});

/**
 * A list of short model-written strings, blanks and duplicates removed.
 *
 * Absent, null, and empty all mean "the word has none of these", which is a real
 * answer for an antonym rather than a failure: refusing it would cost a card for
 * being honest. Duplicates are collapsed here because the domain refuses a list
 * that repeats itself, and a model listing one synonym twice has still told the
 * truth about the word.
 */
const modelEntryList = (limit: number, maxEntries: number) =>
  z
    .array(
      z.string().max(limit, { message: `use ${limit} characters or fewer` }),
    )
    .max(maxEntries, { message: `list ${maxEntries} entries or fewer` })
    .nullish()
    .transform((values): readonly string[] => {
      const entries = (values ?? [])
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      const seen = new Set<string>();

      return entries.filter((entry) => {
        const key = entry.toLowerCase();

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);

        return true;
      });
    });

const enrichmentItemSchema = z.object({
  term: requiredModelText(TERM_LIMIT),
  meanings: modelEntryList(MEANING_LIMIT, MAX_LIST_ENTRIES),
  synonyms: modelEntryList(TERM_LIMIT, MAX_LIST_ENTRIES),
  antonyms: modelEntryList(TERM_LIMIT, MAX_LIST_ENTRIES),
  examples: z
    .array(
      z.object({
        text: requiredModelText(EXAMPLE_LIMIT),
        reading: optionalModelText(EXAMPLE_LIMIT),
        translation: optionalModelText(EXAMPLE_LIMIT),
      }),
    )
    .max(MAX_LIST_ENTRIES, {
      message: `list ${MAX_LIST_ENTRIES} examples or fewer`,
    })
    .nullish()
    .transform((values) => values ?? []),
  usageNotes: optionalModelText(NOTES_LIMIT),
});

const enrichmentResponseSchema = z.object({
  words: z.array(enrichmentItemSchema).max(MAX_ITEMS_PER_RESPONSE, {
    message: `return ${MAX_ITEMS_PER_RESPONSE} words or fewer`,
  }),
});

/** What a validated question response contributes to the draft, before checks. */
export interface QuestionOutputContext {
  /** The language the persona writes in, recorded on the revision. */
  readonly contentLanguage: string | null;
}

export function validateQuestionOutput(
  payload: unknown,
  context: QuestionOutputContext,
): StructuredValidation<readonly GeneratedQuestionDraft[]> {
  const result = questionResponseSchema.safeParse(payload);

  if (!result.success) {
    return { ok: false, errors: describeIssues(result.error) };
  }

  return {
    ok: true,
    value: result.data.questions.map((item) => ({
      stem: item.stem,
      instructions: item.instructions,
      questionType: item.questionType,
      content: toQuestionContent(item),
      explanation: item.explanation,
      difficulty: item.difficulty,
      tags: item.tags,
      language: context.contentLanguage,
      objectiveIds: item.objectiveIds,
    })),
  };
}

export function validateFlashcardOutput(
  payload: unknown,
  context: QuestionOutputContext,
): StructuredValidation<readonly GeneratedFlashcardDraft[]> {
  const result = cardResponseSchema.safeParse(payload);

  if (!result.success) {
    return { ok: false, errors: describeIssues(result.error) };
  }

  return {
    ok: true,
    value: result.data.flashcards.map((item) => ({
      cardType: item.cardType,
      content: toCardContent(item),
      notes: item.notes,
      tags: item.tags,
      language: context.contentLanguage,
      objectiveIds: item.objectiveIds,
    })),
  };
}

/**
 * Enrichment output.
 *
 * No `context` parameter: enrichment adds fields to a card that already records
 * its language, so there is nothing here for the persona's language to set.
 */
export function validateEnrichmentOutput(
  payload: unknown,
): StructuredValidation<readonly VocabularyEnrichmentDraft[]> {
  const result = enrichmentResponseSchema.safeParse(payload);

  if (!result.success) {
    return { ok: false, errors: describeIssues(result.error) };
  }

  return {
    ok: true,
    value: result.data.words.map((item) => ({
      term: item.term,
      meanings: item.meanings,
      synonyms: item.synonyms,
      antonyms: item.antonyms,
      examples: item.examples,
      usageNotes: item.usageNotes,
    })),
  };
}

/**
 * The answer shape sent to the provider for questions.
 *
 * Built from the allowed types rather than fixed, so a request for single-choice
 * questions does not describe short-answer fields the model must then be told to
 * ignore.
 */
export function questionOutputJsonSchema(
  allowedTypes: readonly QuestionType[],
): JsonSchema {
  const types = allowedTypes.length > 0 ? allowedTypes : QUESTION_TYPES;

  return {
    type: "object",
    description: "A batch of practice questions.",
    required: ["questions"],
    additionalProperties: false,
    properties: {
      questions: {
        type: "array",
        description: "One entry per question, in the order they were written.",
        maxItems: MAX_ITEMS_PER_RESPONSE,
        items: {
          type: "object",
          required: ["questionType", "stem", "objectiveIds"],
          additionalProperties: false,
          properties: {
            questionType: {
              type: "string",
              description: "The kind of question this entry is.",
              enum: [...types],
            },
            stem: {
              type: "string",
              description: "The question itself, as the learner reads it.",
            },
            instructions: {
              type: "string",
              description:
                "How to answer, for example how many choices to pick. Omit when the question type makes it obvious.",
              nullable: true,
            },
            choices: {
              type: "array",
              description:
                "Answer options for SINGLE_CHOICE and MULTIPLE_RESPONSE. Omit for SHORT_ANSWER.",
              maxItems: MAX_LIST_ENTRIES,
              items: { type: "string" },
            },
            correctChoiceIndexes: {
              type: "array",
              description:
                "Zero-based positions in `choices` that are correct. Exactly one entry for SINGLE_CHOICE, two or more for MULTIPLE_RESPONSE, omitted for SHORT_ANSWER.",
              maxItems: MAX_LIST_ENTRIES,
              items: { type: "integer" },
            },
            expectedConcepts: {
              type: "array",
              description:
                "For SHORT_ANSWER only: the concepts a written answer must mention. Not a model answer.",
              maxItems: MAX_LIST_ENTRIES,
              items: { type: "string" },
            },
            explanation: {
              type: "string",
              description:
                "Why the correct answer is correct, and what makes the others wrong.",
              nullable: true,
            },
            difficulty: {
              type: "integer",
              description: "Whole number from 1 (easiest) to 5 (hardest).",
              minimum: 1,
              maximum: 5,
              nullable: true,
            },
            tags: {
              type: "array",
              description:
                "Short topic keywords. Never a URL, a citation, or a source reference.",
              maxItems: MAX_TAGS,
              items: { type: "string" },
            },
            objectiveIds: {
              type: "array",
              description:
                "Objective identifiers copied verbatim from the request. Empty when none applies.",
              maxItems: MAX_LIST_ENTRIES,
              items: { type: "string" },
            },
          },
        },
      },
    },
  };
}

export function flashcardOutputJsonSchema(
  allowedTypes: readonly CardType[],
): JsonSchema {
  const types = allowedTypes.length > 0 ? allowedTypes : CARD_TYPES;

  return {
    type: "object",
    description: "A batch of flashcards.",
    required: ["flashcards"],
    additionalProperties: false,
    properties: {
      flashcards: {
        type: "array",
        description: "One entry per card, in the order they were written.",
        maxItems: MAX_ITEMS_PER_RESPONSE,
        items: {
          type: "object",
          required: ["cardType", "objectiveIds"],
          additionalProperties: false,
          properties: {
            cardType: {
              type: "string",
              description:
                "The kind of card. Each kind requires its own fields: BASIC and REVERSED need front and back; CLOZE needs text; VOCABULARY needs term and meaning; SCENARIO needs scenario, question, and answer.",
              enum: [...types],
            },
            front: {
              type: "string",
              description: "BASIC and REVERSED: the prompting side.",
              nullable: true,
            },
            back: {
              type: "string",
              description: "BASIC and REVERSED: the answering side.",
              nullable: true,
            },
            text: {
              type: "string",
              description:
                "CLOZE: one sentence with the parts to blank out wrapped in {{double braces}}.",
              nullable: true,
            },
            term: {
              type: "string",
              description: "VOCABULARY: the word or phrase being learned.",
              nullable: true,
            },
            reading: {
              type: "string",
              description:
                "VOCABULARY: pronunciation, with tone marks where the language uses them.",
              nullable: true,
            },
            meaning: {
              type: "string",
              description:
                "VOCABULARY: the meaning, listing equivalents where several are correct.",
              nullable: true,
            },
            exampleSentence: {
              type: "string",
              description: "VOCABULARY: one natural sentence using the term.",
              nullable: true,
            },
            scenario: {
              type: "string",
              description: "SCENARIO: the situation to reason about.",
              nullable: true,
            },
            question: {
              type: "string",
              description: "SCENARIO: what to decide about the situation.",
              nullable: true,
            },
            answer: {
              type: "string",
              description: "SCENARIO: the decision and why.",
              nullable: true,
            },
            notes: {
              type: "string",
              description: "Optional study note shown with the answer.",
              nullable: true,
            },
            tags: {
              type: "array",
              description:
                "Short topic keywords. Never a URL, a citation, or a source reference.",
              maxItems: MAX_TAGS,
              items: { type: "string" },
            },
            objectiveIds: {
              type: "array",
              description:
                "Objective identifiers copied verbatim from the request. Empty when none applies.",
              maxItems: MAX_LIST_ENTRIES,
              items: { type: "string" },
            },
          },
        },
      },
    },
  };
}

/**
 * The answer shape sent to the provider for enrichment.
 *
 * Not built from allowed types, because there is only one shape: unlike a card
 * batch, every entry has the same fields whatever the word is. `term` is required
 * even though the model was given it, because it is the join key back to the card.
 */
export function enrichmentOutputJsonSchema(): JsonSchema {
  return {
    type: "object",
    description: "Dictionary detail for words already being studied.",
    required: ["words"],
    additionalProperties: false,
    properties: {
      words: {
        type: "array",
        description:
          "One entry per word given, in the order the words were given.",
        maxItems: MAX_ITEMS_PER_RESPONSE,
        items: {
          type: "object",
          required: ["term", "meanings", "examples"],
          additionalProperties: false,
          properties: {
            term: {
              type: "string",
              description:
                "The word being described, copied exactly as it was given. The entry is matched to its card by this text.",
            },
            meanings: {
              type: "array",
              description:
                "The senses of the word, most common first, each a short gloss rather than an essay.",
              maxItems: MAX_LIST_ENTRIES,
              items: { type: "string" },
            },
            synonyms: {
              type: "array",
              description:
                "Words with a close meaning. Omit or leave empty when the word has none.",
              maxItems: MAX_LIST_ENTRIES,
              items: { type: "string" },
            },
            antonyms: {
              type: "array",
              description:
                "Words with an opposite meaning. Omit or leave empty when the word has none.",
              maxItems: MAX_LIST_ENTRIES,
              items: { type: "string" },
            },
            examples: {
              type: "array",
              description:
                "At least two complete sentences using the word, each with its reading and an English translation.",
              maxItems: MAX_LIST_ENTRIES,
              items: {
                type: "object",
                required: ["text"],
                additionalProperties: false,
                properties: {
                  text: {
                    type: "string",
                    description: "The sentence, in the language being studied.",
                  },
                  reading: {
                    type: "string",
                    description:
                      "Pronunciation of the sentence, with tone marks where the language uses them.",
                    nullable: true,
                  },
                  translation: {
                    type: "string",
                    description: "An English translation of the sentence.",
                    nullable: true,
                  },
                },
              },
            },
            usageNotes: {
              type: "string",
              description:
                "Register, collocation, and the mistakes learners make with this word. Omit when there is nothing worth saying.",
              nullable: true,
            },
          },
        },
      },
    },
  };
}

/** Names of the tool the provider is asked to fill in, per item kind. */
export const QUESTION_SCHEMA_NAME = "practice_questions";
export const FLASHCARD_SCHEMA_NAME = "study_flashcards";
export const ENRICHMENT_SCHEMA_NAME = "enriched_vocabulary";

type QuestionItem = z.output<typeof questionItemSchema>;
type CardItem = z.output<typeof cardItemSchema>;

/**
 * Turns one validated entry into domain content.
 *
 * Choice identifiers come from the position, so they are stable and never
 * model-supplied. An index outside the choice list produces an identifier no choice
 * has, which the deterministic checks reject as a correct answer that refers to
 * nothing — the failure the model actually made, rather than a silently dropped
 * answer.
 */
function toQuestionContent(item: QuestionItem): QuestionContent {
  switch (item.questionType) {
    case "SINGLE_CHOICE":
      return {
        type: "SINGLE_CHOICE",
        choices: item.choices.map((text, index) => ({
          id: choiceId(index),
          text,
        })),
        correctChoiceId: choiceId(item.correctChoiceIndexes[0] ?? -1),
      };
    case "MULTIPLE_RESPONSE":
      return {
        type: "MULTIPLE_RESPONSE",
        choices: item.choices.map((text, index) => ({
          id: choiceId(index),
          text,
        })),
        correctChoiceIds: [
          ...new Set(item.correctChoiceIndexes.map((index) => choiceId(index))),
        ],
      };
    case "SHORT_ANSWER":
      return {
        type: "SHORT_ANSWER",
        expectedConcepts: item.expectedConcepts,
      };
  }
}

function toCardContent(item: CardItem): FlashcardContent {
  switch (item.cardType) {
    case "BASIC":
      return { type: "BASIC", front: item.front, back: item.back };
    case "REVERSED":
      return { type: "REVERSED", front: item.front, back: item.back };
    case "CLOZE":
      return { type: "CLOZE", text: item.text };
    case "VOCABULARY":
      return {
        type: "VOCABULARY",
        term: item.term,
        reading: item.reading,
        meaning: item.meaning,
        exampleSentence: item.exampleSentence,
      };
    case "SCENARIO":
      return {
        type: "SCENARIO",
        scenario: item.scenario,
        question: item.question,
        answer: item.answer,
      };
  }
}

/**
 * Validation issues as repair feedback.
 *
 * Field path and expectation only. The offending value is never echoed: it can
 * contain the owner's text, and a repair message is sent straight back to the
 * provider.
 */
function describeIssues(error: z.ZodError): readonly string[] {
  const messages = error.issues.map((issue) => {
    const path =
      issue.path.length === 0 ? "the response" : issue.path.join(".");

    return `${path}: ${issue.message}`;
  });

  // Bounded: a badly shaped batch can produce an issue per field per item, and a
  // thousand-line repair message is worse feedback than the first few.
  return messages.slice(0, 12);
}
