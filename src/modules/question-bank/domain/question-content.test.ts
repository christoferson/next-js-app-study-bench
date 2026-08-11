import { describe, expect, it } from "vitest";
import { InvalidQuestionContentError } from "./errors";
import type { QuestionContent } from "./question";
import {
  contentChoices,
  correctChoiceIds,
  describeExpectedAnswer,
  stemExcerpt,
} from "./question";
import {
  MAX_CHOICES,
  MAX_EXPECTED_CONCEPTS,
  MIN_CHOICES,
  assertValidContent,
  choiceId,
  isChoiceBased,
} from "./question-content";

/**
 * Content invariants (`SPEC.md` section 21.3, criterion 3).
 *
 * Each case is a configuration that cannot represent an answerable question, and
 * each assertion names the field the owner has to fix, because the form renders
 * the message beside that field.
 */

function choices(count: number) {
  return Array.from({ length: count }, (_unused, index) => ({
    id: choiceId(index),
    text: `Choice ${index + 1}`,
  }));
}

function expectRejected(content: QuestionContent, field: string) {
  try {
    assertValidContent(content);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidQuestionContentError);
    expect((error as InvalidQuestionContentError).field).toBe(field);
    expect(
      Object.keys((error as InvalidQuestionContentError).fieldMessages()),
    ).toContain(field);
    return;
  }

  throw new Error("Expected the content to be rejected.");
}

describe("single choice content", () => {
  it("accepts two choices with one of them marked correct", () => {
    expect(() =>
      assertValidContent({
        type: "SINGLE_CHOICE",
        choices: choices(2),
        correctChoiceId: "choice-2",
      }),
    ).not.toThrow();
  });

  it("rejects fewer than the minimum number of choices", () => {
    expectRejected(
      {
        type: "SINGLE_CHOICE",
        choices: choices(MIN_CHOICES - 1),
        correctChoiceId: "choice-1",
      },
      "choices",
    );
  });

  it("rejects more than the maximum number of choices", () => {
    expectRejected(
      {
        type: "SINGLE_CHOICE",
        choices: choices(MAX_CHOICES + 1),
        correctChoiceId: "choice-1",
      },
      "choices",
    );
  });

  it("rejects a blank choice", () => {
    expectRejected(
      {
        type: "SINGLE_CHOICE",
        choices: [
          { id: "choice-1", text: "Present" },
          { id: "choice-2", text: "" },
        ],
        correctChoiceId: "choice-1",
      },
      "choices",
    );
  });

  it("rejects duplicate choice identifiers", () => {
    expectRejected(
      {
        type: "SINGLE_CHOICE",
        choices: [
          { id: "choice-1", text: "First" },
          { id: "choice-1", text: "Second" },
        ],
        correctChoiceId: "choice-1",
      },
      "choices",
    );
  });

  it("rejects no correct answer", () => {
    expectRejected(
      {
        type: "SINGLE_CHOICE",
        choices: choices(3),
        correctChoiceId: "",
      },
      "correctChoiceId",
    );
  });

  it("rejects a correct answer that is not one of the choices", () => {
    expectRejected(
      {
        type: "SINGLE_CHOICE",
        choices: choices(3),
        correctChoiceId: "choice-9",
      },
      "correctChoiceId",
    );
  });
});

describe("multiple response content", () => {
  it("accepts several correct answers drawn from the choices", () => {
    expect(() =>
      assertValidContent({
        type: "MULTIPLE_RESPONSE",
        choices: choices(4),
        correctChoiceIds: ["choice-1", "choice-3"],
      }),
    ).not.toThrow();
  });

  it("rejects fewer than the minimum number of choices", () => {
    expectRejected(
      {
        type: "MULTIPLE_RESPONSE",
        choices: choices(1),
        correctChoiceIds: ["choice-1"],
      },
      "choices",
    );
  });

  it("rejects zero correct answers", () => {
    expectRejected(
      {
        type: "MULTIPLE_RESPONSE",
        choices: choices(3),
        correctChoiceIds: [],
      },
      "correctChoiceIds",
    );
  });

  it("rejects the same correct answer marked twice", () => {
    expectRejected(
      {
        type: "MULTIPLE_RESPONSE",
        choices: choices(3),
        correctChoiceIds: ["choice-1", "choice-1"],
      },
      "correctChoiceIds",
    );
  });

  it("rejects correct answers that are not a subset of the choices", () => {
    expectRejected(
      {
        type: "MULTIPLE_RESPONSE",
        choices: choices(3),
        correctChoiceIds: ["choice-1", "choice-7"],
      },
      "correctChoiceIds",
    );
  });
});

describe("short answer content", () => {
  it("accepts a list of expected concepts", () => {
    expect(() =>
      assertValidContent({
        type: "SHORT_ANSWER",
        expectedConcepts: ["durability"],
      }),
    ).not.toThrow();
  });

  it("rejects no expected concepts", () => {
    expectRejected(
      { type: "SHORT_ANSWER", expectedConcepts: [] },
      "expectedConcepts",
    );
  });

  it("rejects more expected concepts than the limit", () => {
    expectRejected(
      {
        type: "SHORT_ANSWER",
        expectedConcepts: Array.from(
          { length: MAX_EXPECTED_CONCEPTS + 1 },
          (_unused, index) => `concept ${index}`,
        ),
      },
      "expectedConcepts",
    );
  });

  it("rejects a blank expected concept", () => {
    expectRejected(
      { type: "SHORT_ANSWER", expectedConcepts: ["durability", ""] },
      "expectedConcepts",
    );
  });
});

describe("content helpers", () => {
  it("reports which types keep choices", () => {
    expect(isChoiceBased("SINGLE_CHOICE")).toBe(true);
    expect(isChoiceBased("MULTIPLE_RESPONSE")).toBe(true);
    expect(isChoiceBased("SHORT_ANSWER")).toBe(false);
  });

  it("exposes choices and correct ids per type", () => {
    expect(
      contentChoices({ type: "SHORT_ANSWER", expectedConcepts: ["a"] }),
    ).toEqual([]);
    expect(
      correctChoiceIds({
        type: "SINGLE_CHOICE",
        choices: choices(2),
        correctChoiceId: "choice-2",
      }),
    ).toEqual(["choice-2"]);
    expect(
      correctChoiceIds({ type: "SHORT_ANSWER", expectedConcepts: ["a"] }),
    ).toEqual([]);
  });

  it("summarises the expected answer for the owner panel", () => {
    expect(
      describeExpectedAnswer({
        type: "MULTIPLE_RESPONSE",
        choices: choices(3),
        correctChoiceIds: ["choice-1", "choice-3"],
      }),
    ).toBe("Choice 1; Choice 3");
    expect(
      describeExpectedAnswer({
        type: "SHORT_ANSWER",
        expectedConcepts: ["a", "b"],
      }),
    ).toBe("a; b");
  });

  it("shortens a long stem on a word boundary", () => {
    const excerpt = stemExcerpt(
      "Which AWS service provides durable object storage for static assets across many availability zones?",
      40,
    );

    expect(excerpt.length).toBeLessThanOrEqual(41);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt).not.toContain("  ");
  });

  it("leaves a short stem untouched", () => {
    expect(stemExcerpt("Short stem.", 40)).toBe("Short stem.");
  });
});
