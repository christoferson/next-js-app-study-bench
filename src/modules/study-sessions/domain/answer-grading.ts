import type { QuestionContent } from "@/modules/question-bank/domain/question";
import { InvalidSubmittedAnswerError } from "./errors";
import type { EvaluationMode, SubmittedAnswer } from "./question-attempt";

/**
 * Answer evaluation, isolated so it can be replaced
 * (`spec/ARCHITECTURE.md` section 5.3 lists answer evaluation as a strategy
 * candidate).
 *
 * D5 grades deterministically from the question's own recorded answer. The
 * functions here are pure: they take the frozen revision's content and the
 * submitted answer and return a verdict, with no clock, no database, and no
 * randomness, so the same submission against the same revision always grades the
 * same way and every rule is unit-testable without persistence.
 *
 * They are plain functions rather than a strategy interface because there is
 * exactly one implementation and no current variation requirement
 * (`spec/ARCHITECTURE.md` section 5.3 forbids the speculative interface). D7 adds
 * AI-assisted short-answer grading; that is a second caller of
 * `SELF_ASSESSED`-shaped input, not a rewrite of choice comparison.
 */

/** What grading concluded about one submission. */
export interface AnswerVerdict {
  readonly isCorrect: boolean;
  readonly evaluationMode: EvaluationMode;
}

/**
 * Grades a submitted answer against the content it was answered from.
 *
 * Exhaustive over `QuestionContent`, so a fourth question type cannot be added
 * without deciding how it is judged (`spec/CODING-STANDARDS.md` section 1.4).
 *
 * A submission whose type does not match the content's type is rejected rather
 * than graded as incorrect: it means the form and the frozen revision disagree,
 * which is a defect or tampering, not a wrong answer, and recording it as a
 * mistake would corrupt the accuracy figures.
 *
 * `selfAssessment` carries the owner's own verdict for a short-answer item. It is
 * required for that type and ignored for the others.
 */
export function gradeAnswer(
  content: QuestionContent,
  submitted: SubmittedAnswer,
  selfAssessment: boolean | null = null,
): AnswerVerdict {
  switch (content.type) {
    case "SINGLE_CHOICE": {
      const answer = requireType(submitted, "SINGLE_CHOICE");

      assertKnownChoices(content.choices, [answer.choiceId]);

      // Identity comparison against the one recorded correct choice. Nothing
      // else is correct, and there is no partial credit to consider.
      return {
        isCorrect: answer.choiceId === content.correctChoiceId,
        evaluationMode: "DETERMINISTIC",
      };
    }
    case "MULTIPLE_RESPONSE": {
      const answer = requireType(submitted, "MULTIPLE_RESPONSE");

      assertKnownChoices(content.choices, answer.choiceIds);

      // Exact set equality: no partial credit. A multiple-response question asks
      // which answers apply, so naming three of four correct options is a wrong
      // answer to that question, and half-marks would make "accuracy by
      // objective" mean something the owner cannot act on.
      return {
        isCorrect: isSameSet(answer.choiceIds, content.correctChoiceIds),
        evaluationMode: "DETERMINISTIC",
      };
    }
    case "SHORT_ANSWER": {
      requireType(submitted, "SHORT_ANSWER");

      if (selfAssessment === null) {
        throw new InvalidSubmittedAnswerError(
          "selfAssessment",
          "Mark your own answer as correct or incorrect.",
        );
      }

      // The owner is the judge. Substring-matching free text against the
      // expected concepts would report a confident verdict the application
      // cannot justify, which `SPEC.md` section 14.3 forbids.
      return { isCorrect: selfAssessment, evaluationMode: "SELF_ASSESSED" };
    }
  }
}

/**
 * Whether answering this content needs the owner's own verdict.
 *
 * The study screen uses it to decide between grading immediately and asking the
 * owner to mark their answer, so the two never disagree about which types are
 * self-assessed.
 */
export function requiresSelfAssessment(content: QuestionContent): boolean {
  switch (content.type) {
    case "SINGLE_CHOICE":
    case "MULTIPLE_RESPONSE":
      return false;
    case "SHORT_ANSWER":
      return true;
  }
}

/**
 * Asserts that a submission is answerable against this content at all.
 *
 * Used before recording an attempt, so an empty submission is refused with a
 * message on the answer control rather than stored as an incorrect answer the
 * owner never gave.
 */
export function assertAnswerable(
  content: QuestionContent,
  submitted: SubmittedAnswer,
): void {
  switch (content.type) {
    case "SINGLE_CHOICE": {
      const answer = requireType(submitted, "SINGLE_CHOICE");

      if (answer.choiceId.length === 0) {
        throw new InvalidSubmittedAnswerError(
          "choiceId",
          "Choose one answer before submitting.",
        );
      }

      return;
    }
    case "MULTIPLE_RESPONSE": {
      const answer = requireType(submitted, "MULTIPLE_RESPONSE");

      if (answer.choiceIds.length === 0) {
        throw new InvalidSubmittedAnswerError(
          "choiceIds",
          "Choose at least one answer before submitting.",
        );
      }

      if (new Set(answer.choiceIds).size !== answer.choiceIds.length) {
        throw new InvalidSubmittedAnswerError(
          "choiceIds",
          "Each choice may be selected only once.",
        );
      }

      return;
    }
    case "SHORT_ANSWER": {
      const answer = requireType(submitted, "SHORT_ANSWER");

      if (answer.text.trim().length === 0) {
        throw new InvalidSubmittedAnswerError(
          "text",
          "Write your answer before submitting.",
        );
      }

      return;
    }
  }
}

/**
 * Narrows a submission to the shape the content requires.
 *
 * The type parameter keeps the narrowing honest: the returned value is the member
 * of the union with that discriminator, so callers do not re-check it.
 */
function requireType<Type extends SubmittedAnswer["type"]>(
  submitted: SubmittedAnswer,
  type: Type,
): Extract<SubmittedAnswer, { readonly type: Type }> {
  if (submitted.type !== type) {
    throw new InvalidSubmittedAnswerError(
      "",
      "That answer does not match the question on screen. Reload the session and try again.",
    );
  }

  return submitted as Extract<SubmittedAnswer, { readonly type: Type }>;
}

/** Refuses a choice identifier the frozen revision does not contain. */
function assertKnownChoices(
  choices: readonly { readonly id: string }[],
  submitted: readonly string[],
): void {
  const known = new Set(choices.map((choice) => choice.id));

  if (!submitted.every((id) => known.has(id))) {
    throw new InvalidSubmittedAnswerError(
      "",
      "That answer does not match the question on screen. Reload the session and try again.",
    );
  }
}

function isSameSet(left: readonly string[], right: readonly string[]): boolean {
  const selected = new Set(left);
  const expected = new Set(right);

  return (
    selected.size === expected.size &&
    [...expected].every((id) => selected.has(id))
  );
}
