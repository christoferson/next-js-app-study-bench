import { InvalidQuestionContentError } from "./errors";
import type { Choice, QuestionContent, QuestionType } from "./question";

/**
 * Content invariants for each question type.
 *
 * These are the rules that make a question answerable at all, so they live in
 * the domain and run on every create and every edit — not only in a form schema.
 * The switches are exhaustive over `QuestionType`, so adding a fourth type fails
 * to compile until its rules are written (`spec/CODING-STANDARDS.md`
 * section 1.4).
 */

/** Below two choices there is nothing to choose between. */
export const MIN_CHOICES = 2;
export const MAX_CHOICES = 8;
export const MAX_EXPECTED_CONCEPTS = 12;

/**
 * Asserts that `content` is a usable question of its declared type.
 *
 * Every failure names the field the owner can correct so the form can render the
 * message next to its cause.
 */
export function assertValidContent(content: QuestionContent): void {
  switch (content.type) {
    case "SINGLE_CHOICE": {
      assertValidChoices(content.choices);

      if (
        !content.choices.some((choice) => choice.id === content.correctChoiceId)
      ) {
        throw new InvalidQuestionContentError(
          "correctChoiceId",
          "Mark exactly one of the choices as the correct answer.",
        );
      }

      return;
    }
    case "MULTIPLE_RESPONSE": {
      assertValidChoices(content.choices);

      if (content.correctChoiceIds.length === 0) {
        throw new InvalidQuestionContentError(
          "correctChoiceIds",
          "Mark at least one choice as correct.",
        );
      }

      if (
        new Set(content.correctChoiceIds).size !==
        content.correctChoiceIds.length
      ) {
        throw new InvalidQuestionContentError(
          "correctChoiceIds",
          "Each correct choice may be marked only once.",
        );
      }

      const choiceIds = new Set(content.choices.map((choice) => choice.id));

      if (!content.correctChoiceIds.every((id) => choiceIds.has(id))) {
        throw new InvalidQuestionContentError(
          "correctChoiceIds",
          "Every correct answer must be one of this question's choices.",
        );
      }

      return;
    }
    case "SHORT_ANSWER": {
      if (content.expectedConcepts.length === 0) {
        throw new InvalidQuestionContentError(
          "expectedConcepts",
          "List at least one concept the answer must mention.",
        );
      }

      if (content.expectedConcepts.length > MAX_EXPECTED_CONCEPTS) {
        throw new InvalidQuestionContentError(
          "expectedConcepts",
          `List ${MAX_EXPECTED_CONCEPTS} expected concepts or fewer.`,
        );
      }

      if (content.expectedConcepts.some((concept) => concept.length === 0)) {
        throw new InvalidQuestionContentError(
          "expectedConcepts",
          "Remove blank expected concepts.",
        );
      }

      return;
    }
  }
}

function assertValidChoices(choices: readonly Choice[]): void {
  if (choices.length < MIN_CHOICES) {
    throw new InvalidQuestionContentError(
      "choices",
      `Give this question at least ${MIN_CHOICES} choices.`,
    );
  }

  if (choices.length > MAX_CHOICES) {
    throw new InvalidQuestionContentError(
      "choices",
      `Give this question at most ${MAX_CHOICES} choices.`,
    );
  }

  if (choices.some((choice) => choice.text.length === 0)) {
    throw new InvalidQuestionContentError(
      "choices",
      "Every choice needs text. Remove any blank choice.",
    );
  }

  if (new Set(choices.map((choice) => choice.id)).size !== choices.length) {
    throw new InvalidQuestionContentError(
      "choices",
      "Each choice needs its own identifier.",
    );
  }
}

/**
 * Whether the type keeps a list of choices.
 *
 * Exhaustive so a future type must decide; used by the forms and the renderer to
 * choose between choice rows and free-text fields.
 */
export function isChoiceBased(questionType: QuestionType): boolean {
  switch (questionType) {
    case "SINGLE_CHOICE":
      return true;
    case "MULTIPLE_RESPONSE":
      return true;
    case "SHORT_ANSWER":
      return false;
  }
}

/** Owner-facing instruction describing how the type is answered. */
export function describeAnswerRule(questionType: QuestionType): string {
  switch (questionType) {
    case "SINGLE_CHOICE":
      return "Choose one answer.";
    case "MULTIPLE_RESPONSE":
      return "Choose all answers that apply.";
    case "SHORT_ANSWER":
      return "Answer in your own words.";
  }
}

/** Stable choice identifiers, so a revision's ids do not depend on ordering. */
export function choiceId(index: number): string {
  return `choice-${index + 1}`;
}
