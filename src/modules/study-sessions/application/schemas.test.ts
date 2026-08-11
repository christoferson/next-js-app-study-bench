import { describe, expect, it } from "vitest";
import { ValidationError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import {
  finishSessionSchema,
  rateSessionCardSchema,
  sessionItemSchema,
  startSessionSchema,
  submitAnswerSchema,
} from "./schemas";

/**
 * The D5 input boundary.
 *
 * These schemas are what stands between a hand-built POST and the session tables, so
 * the tests are about what is accepted and what is refused, not about the happy path
 * the forms happen to submit.
 */

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

const VALID_START = {
  mode: "SINGLE_TRACK",
  certificationIds: ["certification-1"],
  targetMinutes: " 10 ",
};

const ANSWER_FIELDS = {
  sessionId: "session-1",
  itemId: "item-1",
  confidence: "FAIRLY_SURE",
};

describe("startSessionSchema", () => {
  it("accepts a session request and converts the minutes", () => {
    expect(parseInput(startSessionSchema, VALID_START)).toEqual({
      mode: "SINGLE_TRACK",
      certificationIds: ["certification-1"],
      targetMinutes: 10,
    });
  });

  it("collapses a repeated track rather than refusing the session", () => {
    const parsed = parseInput(startSessionSchema, {
      ...VALID_START,
      mode: "MIXED_TRACKS",
      certificationIds: [
        "certification-1",
        "certification-2",
        "certification-1",
      ],
    });

    expect(parsed.certificationIds).toEqual([
      "certification-1",
      "certification-2",
    ]);
  });

  it("refuses a session with no track", () => {
    expect(
      fieldsOf({ ...VALID_START, certificationIds: [] }, startSessionSchema),
    ).toContain("certificationIds");
  });

  it("refuses a mode it does not know", () => {
    expect(
      fieldsOf({ ...VALID_START, mode: "EXAM_SIMULATION" }, startSessionSchema),
    ).toContain("mode");
  });

  it("refuses a length outside the plausible range", () => {
    for (const targetMinutes of ["0", "1", "600", "ten", "10.5", ""]) {
      expect(
        fieldsOf({ ...VALID_START, targetMinutes }, startSessionSchema),
      ).toContain("targetMinutes");
    }
  });
});

describe("submitAnswerSchema", () => {
  it("accepts a single-choice answer", () => {
    expect(
      parseInput(submitAnswerSchema, {
        ...ANSWER_FIELDS,
        type: "SINGLE_CHOICE",
        choiceId: "choice-1",
        durationSeconds: "18",
      }),
    ).toEqual({
      ...ANSWER_FIELDS,
      type: "SINGLE_CHOICE",
      choiceId: "choice-1",
      durationSeconds: 18,
    });
  });

  it("records no duration when the page measured nothing", () => {
    // A page restored from history submits an empty field. `Number("")` is 0, so an
    // empty value must be read as "not measured" rather than as a zero-second
    // answer, which would corrupt every timing figure derived from attempts.
    for (const durationSeconds of ["", "   ", undefined]) {
      expect(
        parseInput(submitAnswerSchema, {
          ...ANSWER_FIELDS,
          type: "SINGLE_CHOICE",
          choiceId: "choice-1",
          durationSeconds,
        }),
      ).toMatchObject({ durationSeconds: null });
    }
  });

  it("keeps a genuinely measured zero", () => {
    expect(
      parseInput(submitAnswerSchema, {
        ...ANSWER_FIELDS,
        type: "SINGLE_CHOICE",
        choiceId: "choice-1",
        durationSeconds: "0",
      }),
    ).toMatchObject({ durationSeconds: 0 });
  });

  it("discards an implausible duration instead of refusing the answer", () => {
    // The answer is the evidence worth keeping; a nonsense timing is dropped rather
    // than costing the owner their answer.
    for (const durationSeconds of ["-1", "999999", "abc"]) {
      expect(
        parseInput(submitAnswerSchema, {
          ...ANSWER_FIELDS,
          type: "SINGLE_CHOICE",
          choiceId: "choice-1",
          durationSeconds,
        }),
      ).toMatchObject({ durationSeconds: null });
    }
  });

  it("requires a confidence with every answer", () => {
    expect(
      fieldsOf(
        {
          ...ANSWER_FIELDS,
          confidence: "",
          type: "SINGLE_CHOICE",
          choiceId: "choice-1",
        },
        submitAnswerSchema,
      ),
    ).toContain("confidence");
  });

  it("accepts a multiple response and collapses repeated choices", () => {
    expect(
      parseInput(submitAnswerSchema, {
        ...ANSWER_FIELDS,
        type: "MULTIPLE_RESPONSE",
        choiceIds: ["choice-1", "choice-2", "choice-1"],
      }),
    ).toMatchObject({ choiceIds: ["choice-1", "choice-2"] });
  });

  it("refuses a multiple response that chose nothing", () => {
    expect(
      fieldsOf(
        { ...ANSWER_FIELDS, type: "MULTIPLE_RESPONSE", choiceIds: [] },
        submitAnswerSchema,
      ),
    ).toContain("choiceIds");
  });

  it("accepts a short answer with the owner's own verdict", () => {
    expect(
      parseInput(submitAnswerSchema, {
        ...ANSWER_FIELDS,
        type: "SHORT_ANSWER",
        text: "  It stores objects.  ",
        selfAssessment: "INCORRECT",
      }),
    ).toMatchObject({ text: "It stores objects.", selfAssessment: false });
  });

  it("refuses a short answer with no verdict", () => {
    // Neither button was pressed, which cannot be recorded as either outcome.
    expect(
      fieldsOf(
        {
          ...ANSWER_FIELDS,
          type: "SHORT_ANSWER",
          text: "Objects.",
          selfAssessment: "",
        },
        submitAnswerSchema,
      ),
    ).toContain("selfAssessment");
  });

  it("refuses an empty short answer", () => {
    expect(
      fieldsOf(
        {
          ...ANSWER_FIELDS,
          type: "SHORT_ANSWER",
          text: "   ",
          selfAssessment: "CORRECT",
        },
        submitAnswerSchema,
      ),
    ).toContain("text");
  });

  it("refuses an answer that names no item", () => {
    expect(
      fieldsOf(
        { ...ANSWER_FIELDS, itemId: "", type: "SINGLE_CHOICE", choiceId: "c" },
        submitAnswerSchema,
      ),
    ).toContain("itemId");
  });

  it("refuses an answer of a type it does not know", () => {
    expect(() =>
      parseInput(submitAnswerSchema, { ...ANSWER_FIELDS, type: "ESSAY" }),
    ).toThrow(ValidationError);
  });
});

describe("rateSessionCardSchema", () => {
  it("accepts a rating for one item of one session", () => {
    expect(
      parseInput(rateSessionCardSchema, {
        sessionId: "session-1",
        itemId: "item-1",
        rating: "GOOD",
      }),
    ).toEqual({ sessionId: "session-1", itemId: "item-1", rating: "GOOD" });
  });

  it("refuses a rating it does not know", () => {
    expect(
      fieldsOf(
        { sessionId: "s", itemId: "i", rating: "PERFECT" },
        rateSessionCardSchema,
      ),
    ).toContain("rating");
  });
});

describe("sessionItemSchema and finishSessionSchema", () => {
  it("accept the identifiers they act on", () => {
    expect(
      parseInput(sessionItemSchema, { sessionId: "s", itemId: "i" }),
    ).toEqual({ sessionId: "s", itemId: "i" });
    expect(parseInput(finishSessionSchema, { sessionId: "s" })).toEqual({
      sessionId: "s",
    });
  });

  it("refuse a blank identifier", () => {
    expect(
      fieldsOf({ sessionId: "", itemId: "i" }, sessionItemSchema),
    ).toContain("sessionId");
    expect(fieldsOf({ sessionId: "  " }, finishSessionSchema)).toContain(
      "sessionId",
    );
  });
});
