import { describe, expect, it } from "vitest";
import type { QuestionContent } from "@/modules/question-bank/domain/question";
import {
  multipleResponseContent,
  shortAnswerContent,
  singleChoiceContent,
} from "@/modules/question-bank/infrastructure/test-support";
import {
  assertAnswerable,
  gradeAnswer,
  requiresSelfAssessment,
} from "./answer-grading";
import { InvalidSubmittedAnswerError } from "./errors";

/**
 * Grading rules, tested without a database.
 *
 * Grading is pure domain logic over the frozen revision's content, so every rule is
 * asserted directly: nothing here opens a connection, and no test needs a session.
 */

describe("gradeAnswer", () => {
  describe("SINGLE_CHOICE", () => {
    const content = singleChoiceContent();

    it("marks the recorded correct choice correct", () => {
      expect(
        gradeAnswer(content, { type: "SINGLE_CHOICE", choiceId: "choice-1" }),
      ).toEqual({ isCorrect: true, evaluationMode: "DETERMINISTIC" });
    });

    it("marks any other choice incorrect", () => {
      expect(
        gradeAnswer(content, { type: "SINGLE_CHOICE", choiceId: "choice-2" }),
      ).toEqual({ isCorrect: false, evaluationMode: "DETERMINISTIC" });
    });

    it("refuses a choice the revision does not contain", () => {
      expect(() =>
        gradeAnswer(content, { type: "SINGLE_CHOICE", choiceId: "choice-9" }),
      ).toThrow(InvalidSubmittedAnswerError);
    });
  });

  describe("MULTIPLE_RESPONSE", () => {
    const content = multipleResponseContent();

    it("requires the exact set of correct choices", () => {
      expect(
        gradeAnswer(content, {
          type: "MULTIPLE_RESPONSE",
          choiceIds: ["choice-1", "choice-2"],
        }),
      ).toEqual({ isCorrect: true, evaluationMode: "DETERMINISTIC" });
    });

    it("ignores the order the choices were selected in", () => {
      expect(
        gradeAnswer(content, {
          type: "MULTIPLE_RESPONSE",
          choiceIds: ["choice-2", "choice-1"],
        }).isCorrect,
      ).toBe(true);
    });

    it("gives no partial credit for a subset of the correct choices", () => {
      expect(
        gradeAnswer(content, {
          type: "MULTIPLE_RESPONSE",
          choiceIds: ["choice-1"],
        }),
      ).toEqual({ isCorrect: false, evaluationMode: "DETERMINISTIC" });
    });

    it("gives no partial credit for the correct choices plus a wrong one", () => {
      expect(
        gradeAnswer(content, {
          type: "MULTIPLE_RESPONSE",
          choiceIds: ["choice-1", "choice-2", "choice-3"],
        }).isCorrect,
      ).toBe(false);
    });

    it("refuses a choice the revision does not contain", () => {
      expect(() =>
        gradeAnswer(content, {
          type: "MULTIPLE_RESPONSE",
          choiceIds: ["choice-1", "choice-9"],
        }),
      ).toThrow(InvalidSubmittedAnswerError);
    });
  });

  describe("SHORT_ANSWER", () => {
    const content = shortAnswerContent();

    it("records the owner's own verdict when they mark it right", () => {
      expect(
        gradeAnswer(
          content,
          { type: "SHORT_ANSWER", text: "object storage" },
          true,
        ),
      ).toEqual({ isCorrect: true, evaluationMode: "SELF_ASSESSED" });
    });

    it("records the owner's own verdict when they mark it wrong", () => {
      expect(
        gradeAnswer(
          content,
          // Text that would match an expected concept by substring is still
          // incorrect if the owner says it was: the application does not overrule
          // the only judge it has.
          { type: "SHORT_ANSWER", text: "object storage" },
          false,
        ),
      ).toEqual({ isCorrect: false, evaluationMode: "SELF_ASSESSED" });
    });

    it("refuses to grade without a verdict rather than guessing one", () => {
      expect(() =>
        gradeAnswer(content, { type: "SHORT_ANSWER", text: "something" }),
      ).toThrow(InvalidSubmittedAnswerError);
    });
  });

  it("refuses a submission whose type disagrees with the content", () => {
    expect(() =>
      gradeAnswer(singleChoiceContent(), {
        type: "MULTIPLE_RESPONSE",
        choiceIds: ["choice-1"],
      }),
    ).toThrow(InvalidSubmittedAnswerError);
    expect(() =>
      gradeAnswer(shortAnswerContent(), {
        type: "SINGLE_CHOICE",
        choiceId: "choice-1",
      }),
    ).toThrow(InvalidSubmittedAnswerError);
  });

  it("grades the same submission the same way every time", () => {
    const content = multipleResponseContent();
    const submitted = {
      type: "MULTIPLE_RESPONSE" as const,
      choiceIds: ["choice-1", "choice-2"],
    };

    expect(gradeAnswer(content, submitted)).toEqual(
      gradeAnswer(content, submitted),
    );
  });
});

describe("requiresSelfAssessment", () => {
  it("is true only for short answers", () => {
    expect(requiresSelfAssessment(singleChoiceContent())).toBe(false);
    expect(requiresSelfAssessment(multipleResponseContent())).toBe(false);
    expect(requiresSelfAssessment(shortAnswerContent())).toBe(true);
  });
});

describe("assertAnswerable", () => {
  it("refuses an empty single choice", () => {
    expect(() =>
      assertAnswerable(singleChoiceContent(), {
        type: "SINGLE_CHOICE",
        choiceId: "",
      }),
    ).toThrow(InvalidSubmittedAnswerError);
  });

  it("refuses an empty multiple response", () => {
    expect(() =>
      assertAnswerable(multipleResponseContent(), {
        type: "MULTIPLE_RESPONSE",
        choiceIds: [],
      }),
    ).toThrow(InvalidSubmittedAnswerError);
  });

  it("refuses the same choice twice", () => {
    expect(() =>
      assertAnswerable(multipleResponseContent(), {
        type: "MULTIPLE_RESPONSE",
        choiceIds: ["choice-1", "choice-1"],
      }),
    ).toThrow(InvalidSubmittedAnswerError);
  });

  it("refuses whitespace as a short answer", () => {
    expect(() =>
      assertAnswerable(shortAnswerContent(), {
        type: "SHORT_ANSWER",
        text: "   ",
      }),
    ).toThrow(InvalidSubmittedAnswerError);
  });

  it("accepts a real answer of each type", () => {
    const cases: readonly {
      readonly content: QuestionContent;
      readonly submitted: Parameters<typeof assertAnswerable>[1];
    }[] = [
      {
        content: singleChoiceContent(),
        submitted: { type: "SINGLE_CHOICE", choiceId: "choice-1" },
      },
      {
        content: multipleResponseContent(),
        submitted: { type: "MULTIPLE_RESPONSE", choiceIds: ["choice-1"] },
      },
      {
        content: shortAnswerContent(),
        submitted: { type: "SHORT_ANSWER", text: "an answer" },
      },
    ];

    for (const { content, submitted } of cases) {
      expect(() => assertAnswerable(content, submitted)).not.toThrow();
    }
  });
});
