import { describe, expect, it } from "vitest";
import {
  EVALUATION_CONCEPT_LIMIT,
  EVALUATION_FEEDBACK_LIMIT,
  MAX_EVALUATED_CONCEPTS,
  agreesWithSelfGrade,
  describeAnswerVerdict,
  recommendedSelfGrade,
} from "@/modules/ai-generation/domain/answer-evaluation";
import type { AnswerEvaluation } from "@/modules/ai-generation/domain/answer-evaluation";
import {
  answerEvaluationJsonSchema,
  answerEvaluationValidator,
  readAnswerEvaluation,
  serializeAnswerEvaluation,
} from "./answer-evaluation-schema";

/**
 * The grading output contract.
 *
 * Three properties are pinned. The concept lists must be about the concepts the *question*
 * recorded rather than ones the grader invented, because the whole use of the echo is that
 * the owner can line the two lists up against the list they wrote. The verdict must agree
 * with those lists, because "you missed the encryption requirement, and your answer is
 * fully correct" is the failure mode grading has. And there must be nowhere in the shape to
 * put a model answer or a corrected question, which is `spec/AI-GUIDELINES.md` section 1.10
 * held by construction.
 *
 * The advisory design is asserted too: nothing here produces a verdict for the *attempt*,
 * only a recommendation the owner may take or ignore.
 */

const CONCEPTS: readonly string[] = ["object storage", "eleven nines"];

function answer(overrides: Record<string, unknown> = {}): unknown {
  return {
    verdict: "CORRECT",
    conceptsCovered: ["object storage", "eleven nines"],
    conceptsMissed: [],
    feedback: "You named both the storage class and the durability figure.",
    ...overrides,
  };
}

function accepted(
  value: unknown,
  concepts: readonly string[] = CONCEPTS,
): AnswerEvaluation {
  const result = answerEvaluationValidator(concepts)(value);

  if (!result.ok) {
    throw new Error(
      `Expected a valid grading, got: ${result.errors.join("; ")}`,
    );
  }

  return result.value;
}

function rejection(
  value: unknown,
  concepts: readonly string[] = CONCEPTS,
): readonly string[] {
  const result = answerEvaluationValidator(concepts)(value);

  if (result.ok) {
    throw new Error("Expected the grading to be rejected.");
  }

  return result.errors;
}

describe("the grading schema", () => {
  it("accepts a well-formed grading and trims what the model sent", () => {
    const evaluation = accepted(
      answer({
        conceptsCovered: ["  object storage  "],
        conceptsMissed: ["eleven nines"],
        verdict: "PARTIALLY_CORRECT",
        feedback: "  Half of it.  ",
      }),
    );

    expect(evaluation.verdict).toBe("PARTIALLY_CORRECT");
    expect(evaluation.conceptsCovered).toEqual(["object storage"]);
    expect(evaluation.conceptsMissed).toEqual(["eleven nines"]);
    expect(evaluation.feedback).toBe("Half of it.");
  });

  it("treats both concept lists as optional, because covering nothing is an answer", () => {
    const evaluation = accepted(
      {
        verdict: "INCORRECT",
        feedback: "Nothing here addresses what was asked.",
      },
      [],
    );

    expect(evaluation.conceptsCovered).toEqual([]);
    expect(evaluation.conceptsMissed).toEqual([]);
  });

  it("drops padding empty strings rather than spending the repair attempt on them", () => {
    const evaluation = accepted(
      answer({ conceptsCovered: ["object storage", "", "   "] }),
    );

    expect(evaluation.conceptsCovered).toEqual(["object storage"]);
  });

  it("requires a verdict and feedback, because a grading with no conclusion is not one", () => {
    expect(rejection({ feedback: "words" }).join(" ")).toMatch(/verdict/);
    expect(rejection(answer({ feedback: "   " })).join(" ")).toMatch(
      /feedback/,
    );
    expect(rejection(answer({ verdict: "MOSTLY_FINE" })).join(" ")).toMatch(
      /verdict/,
    );
  });

  it("bounds the feedback and each concept", () => {
    expect(
      rejection(
        answer({ feedback: "x".repeat(EVALUATION_FEEDBACK_LIMIT + 1) }),
      ).join(" "),
    ).toMatch(/feedback/);
    expect(
      rejection(
        answer({
          conceptsCovered: ["y".repeat(EVALUATION_CONCEPT_LIMIT + 1)],
        }),
      ).join(" "),
    ).toMatch(/conceptsCovered/);
    expect(
      rejection(
        answer({
          conceptsCovered: Array.from(
            { length: MAX_EVALUATED_CONCEPTS + 1 },
            () => "object storage",
          ),
        }),
      ).join(" "),
    ).toMatch(/conceptsCovered/);
  });

  it("refuses CORRECT when a concept was missed", () => {
    // The reassurance failure mode: a grader that lists what the answer failed to say and
    // then marks it fully correct.
    expect(
      rejection(
        answer({
          verdict: "CORRECT",
          conceptsCovered: ["object storage"],
          conceptsMissed: ["eleven nines"],
        }),
      ).join(" "),
    ).toMatch(/CORRECT is not available/);
  });

  it("refuses INCORRECT when every expected concept was covered and none missed", () => {
    expect(
      rejection(
        answer({
          verdict: "INCORRECT",
          conceptsCovered: ["object storage", "eleven nines"],
          conceptsMissed: [],
        }),
      ).join(" "),
    ).toMatch(/INCORRECT is not available/);
  });

  it("refuses a concept that appears in both lists", () => {
    expect(
      rejection(
        answer({
          verdict: "PARTIALLY_CORRECT",
          conceptsCovered: ["object storage"],
          conceptsMissed: ["object storage"],
        }),
      ).join(" "),
    ).toMatch(/never both/);
  });

  it("refuses a concept the question never recorded", () => {
    // The echo is only useful if it is an echo. A paraphrase gets the repair attempt with a
    // message telling the model to copy the concept exactly.
    expect(
      rejection(
        answer({
          verdict: "PARTIALLY_CORRECT",
          conceptsCovered: ["blob storage"],
          conceptsMissed: ["eleven nines"],
        }),
      ).join(" "),
    ).toMatch(/copied exactly/);
  });

  it("is lenient about capitalisation and surrounding space in an echoed concept", () => {
    const evaluation = accepted(
      answer({
        verdict: "PARTIALLY_CORRECT",
        conceptsCovered: [" Object Storage "],
        conceptsMissed: ["ELEVEN NINES"],
      }),
    );

    expect(evaluation.conceptsCovered).toEqual(["Object Storage"]);
  });

  it("refuses any named concept when the question recorded none", () => {
    expect(
      rejection(
        {
          verdict: "PARTIALLY_CORRECT",
          conceptsCovered: ["something invented"],
          conceptsMissed: [],
          feedback: "Some of it.",
        },
        [],
      ).join(" "),
    ).toMatch(/copied exactly/);
  });

  it("carries none of the owner's answer in a message sent back to the provider", () => {
    // Repair feedback travels to the provider, so it may name a field and an expectation
    // and nothing else (`spec/AI-GUIDELINES.md` section 1.7).
    const errors = rejection(
      answer({
        conceptsCovered: ["a secret the owner typed"],
        conceptsMissed: [],
        verdict: "PARTIALLY_CORRECT",
        feedback: "another secret",
      }),
    ).join(" ");

    expect(errors).not.toContain("a secret the owner typed");
    expect(errors).not.toContain("another secret");
  });

  it("has nowhere to put a model answer or a corrected question", () => {
    // `spec/AI-GUIDELINES.md` section 1.10 by construction: the extra keys are dropped
    // rather than carried through to the panel.
    const evaluation = accepted(
      answer({
        modelAnswer: "Here is what you should have written.",
        correctedStem: "A better question would be…",
        correctedConcepts: ["a different list"],
      }),
    );

    expect(Object.keys(evaluation).sort()).toEqual([
      "conceptsCovered",
      "conceptsMissed",
      "feedback",
      "verdict",
    ]);
    expect(JSON.stringify(evaluation)).not.toContain("should have written");
  });
});

describe("reading a stored grading", () => {
  it("round-trips what was accepted", () => {
    const evaluation = accepted(answer());

    expect(readAnswerEvaluation(serializeAnswerEvaluation(evaluation))).toEqual(
      evaluation,
    );
  });

  it("returns null for an absent payload and for unreadable JSON", () => {
    expect(readAnswerEvaluation(null)).toBeNull();
    expect(readAnswerEvaluation("{ not json")).toBeNull();
  });

  it("returns null for a payload of the wrong shape", () => {
    expect(
      readAnswerEvaluation(JSON.stringify({ verdict: "CORRECT" })),
    ).toBeNull();
  });

  it("still reads a grading whose concepts the question no longer records", () => {
    // Shape only, deliberately: the consistency rules compare against the question's
    // expected concepts, and a question edited since would hide a grading that was valid
    // when it was given.
    const stored = JSON.stringify({
      verdict: "PARTIALLY_CORRECT",
      conceptsCovered: ["a concept since edited away"],
      conceptsMissed: ["another"],
      feedback: "Half of it.",
    });

    expect(readAnswerEvaluation(stored)?.verdict).toBe("PARTIALLY_CORRECT");
  });
});

describe("what a verdict recommends", () => {
  it("maps the two decided verdicts onto the owner's two buttons", () => {
    expect(recommendedSelfGrade("CORRECT")).toBe("CORRECT");
    expect(recommendedSelfGrade("INCORRECT")).toBe("INCORRECT");
  });

  it("recommends neither for a partly-correct answer", () => {
    // Guessing here would be putting words in the owner's mouth: "some of it" is exactly
    // the case a two-button record cannot express.
    expect(recommendedSelfGrade("PARTIALLY_CORRECT")).toBeNull();
  });

  it("says whether it agrees with the verdict the owner already recorded", () => {
    expect(agreesWithSelfGrade("CORRECT", true)).toBe(true);
    expect(agreesWithSelfGrade("CORRECT", false)).toBe(false);
    expect(agreesWithSelfGrade("INCORRECT", false)).toBe(true);
    expect(agreesWithSelfGrade("PARTIALLY_CORRECT", true)).toBeNull();
  });

  it("labels every verdict for the owner", () => {
    expect(describeAnswerVerdict("CORRECT")).toMatch(/Covers/);
    expect(describeAnswerVerdict("PARTIALLY_CORRECT")).toMatch(/some/);
    expect(describeAnswerVerdict("INCORRECT")).toMatch(/not/);
  });
});

describe("the shape sent to the provider", () => {
  const schema = answerEvaluationJsonSchema();

  it("requires only the verdict and the feedback", () => {
    expect(schema.required).toEqual(["verdict", "feedback"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("carries the rules the descriptions have to state", () => {
    const described = JSON.stringify(schema);

    expect(described).toContain(
      "copied exactly from the list given with the question",
    );
    expect(described).toMatch(/never both/);
    expect(described).toMatch(/do not rewrite the question/i);
  });

  it("offers no property that could carry replacement question content", () => {
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      "conceptsCovered",
      "conceptsMissed",
      "feedback",
      "verdict",
    ]);
  });
});
