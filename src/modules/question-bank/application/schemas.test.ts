import { describe, expect, it } from "vitest";
import { ValidationError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import {
  disputeInputSchema,
  disputeResolutionSchema,
  questionFilterSchema,
  questionInputSchema,
} from "./schemas";

const VALID_SINGLE_CHOICE = {
  questionType: "SINGLE_CHOICE",
  stem: "  Which service stores objects?  ",
  instructions: "",
  explanation: "",
  difficulty: "3",
  tags: "storage, s3, storage",
  language: "en",
  choiceTexts: [" Amazon S3 ", "Amazon EBS", ""],
  correctChoiceIndexes: ["0"],
};

function fieldsOf(input: unknown, schema: Parameters<typeof parseInput>[0]) {
  try {
    parseInput(schema, input);
    expect.unreachable("expected a validation error");
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);

    return Object.keys((error as ValidationError).fieldMessages());
  }

  return [];
}

describe("questionInputSchema", () => {
  it("accepts and normalises a single-choice submission", () => {
    const parsed = parseInput(questionInputSchema, VALID_SINGLE_CHOICE);

    expect(parsed).toEqual({
      questionType: "SINGLE_CHOICE",
      stem: "Which service stores objects?",
      instructions: null,
      explanation: null,
      difficulty: 3,
      // Duplicate tags collapse rather than blocking the save.
      tags: ["storage", "s3"],
      language: "en",
      choiceTexts: ["Amazon S3", "Amazon EBS", ""],
      correctChoiceIndexes: [0],
    });
  });

  it("requires question text", () => {
    expect(
      fieldsOf({ ...VALID_SINGLE_CHOICE, stem: "   " }, questionInputSchema),
    ).toContain("stem");
  });

  it("rejects a difficulty outside the band", () => {
    expect(
      fieldsOf(
        { ...VALID_SINGLE_CHOICE, difficulty: "9" },
        questionInputSchema,
      ),
    ).toContain("difficulty");
  });

  it("accepts a blank difficulty as not graded", () => {
    const parsed = parseInput(questionInputSchema, {
      ...VALID_SINGLE_CHOICE,
      difficulty: "",
    });

    expect(parsed.difficulty).toBeNull();
  });

  it("rejects an unknown question type", () => {
    expect(
      fieldsOf(
        { ...VALID_SINGLE_CHOICE, questionType: "ESSAY" },
        questionInputSchema,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("rejects a correct-answer index outside the choice grid", () => {
    expect(
      fieldsOf(
        { ...VALID_SINGLE_CHOICE, correctChoiceIndexes: ["99"] },
        questionInputSchema,
      ),
    ).toContain("correctChoiceIndexes");
  });

  it("splits short-answer concepts on newlines and drops blank lines", () => {
    const parsed = parseInput(questionInputSchema, {
      questionType: "SHORT_ANSWER",
      stem: "Describe durability.",
      instructions: "",
      explanation: "",
      difficulty: "",
      tags: "",
      language: "",
      expectedConcepts: " replication \n\n eleven nines \n",
    });

    expect(parsed).toEqual({
      questionType: "SHORT_ANSWER",
      stem: "Describe durability.",
      instructions: null,
      explanation: null,
      difficulty: null,
      tags: [],
      language: null,
      expectedConcepts: ["replication", "eleven nines"],
    });
  });

  it("leaves answerability to the domain, not the schema", () => {
    // No marked answer parses cleanly here; the facade's domain assertion is
    // what rejects it, so every caller is covered and not only this form.
    const parsed = parseInput(questionInputSchema, {
      ...VALID_SINGLE_CHOICE,
      correctChoiceIndexes: [],
    });

    expect(parsed.questionType).toBe("SINGLE_CHOICE");
  });
});

describe("disputeInputSchema", () => {
  it("requires a reason", () => {
    expect(fieldsOf({ reason: "  " }, disputeInputSchema)).toContain("reason");
  });

  it("trims the reason", () => {
    expect(parseInput(disputeInputSchema, { reason: "  stale  " })).toEqual({
      reason: "stale",
    });
  });
});

describe("disputeResolutionSchema", () => {
  it("accepts the allowed resolutions", () => {
    expect(parseInput(disputeResolutionSchema, "UNREVIEWED")).toBe(
      "UNREVIEWED",
    );
    expect(parseInput(disputeResolutionSchema, "USER_APPROVED")).toBe(
      "USER_APPROVED",
    );
  });

  it("rejects a quality state that is not a resolution", () => {
    expect(() => parseInput(disputeResolutionSchema, "OUTDATED")).toThrow(
      ValidationError,
    );
  });
});

describe("questionFilterSchema", () => {
  it("parses every filter", () => {
    expect(
      parseInput(questionFilterSchema, {
        lifecycle: "ACTIVE",
        quality: "DISPUTED",
        type: "SHORT_ANSWER",
        objective: "objective-1",
        q: "  buckets  ",
        page: "3",
      }),
    ).toEqual({
      lifecycle: "ACTIVE",
      quality: "DISPUTED",
      type: "SHORT_ANSWER",
      objective: "objective-1",
      q: "buckets",
      page: 3,
    });
  });

  it("treats missing filters as no filter", () => {
    expect(parseInput(questionFilterSchema, {})).toEqual({
      lifecycle: null,
      quality: null,
      type: null,
      objective: null,
      q: null,
      page: 1,
    });
  });

  it("ignores unrecognised filter values instead of failing", () => {
    // A stale bookmark should show the unfiltered bank, not an error page.
    expect(
      parseInput(questionFilterSchema, {
        lifecycle: "PUBLISHED",
        quality: "GREAT",
        type: "ESSAY",
        page: "0",
      }),
    ).toEqual({
      lifecycle: null,
      quality: null,
      type: null,
      objective: null,
      q: null,
      page: 1,
    });
  });
});
