import { describe, expect, it } from "vitest";
import {
  CHALLENGE_NOTE_LIMIT,
  CHALLENGE_REASONING_LIMIT,
  describeChallengeRecommendation,
  describeChallengeVerdict,
  recommendsDispute,
  recommendsRevision,
} from "@/modules/ai-generation/domain/question-challenge";
import type { QuestionChallenge } from "@/modules/ai-generation/domain/question-challenge";
import {
  questionChallengeJsonSchema,
  readQuestionChallenge,
  serializeQuestionChallenge,
  validateQuestionChallenge,
} from "./question-challenge-schema";

/**
 * The challenge output contract.
 *
 * The acceptance criterion of this slice lives here twice over. A challenge has to produce a
 * *structured quality finding* — a verdict, an argument, and a recommendation the owner can
 * act on with one click — and it has to be incapable of carrying a revision, because the
 * revision is the owner's to write (`spec/AI-GUIDELINES.md` section 1.10). The second half is
 * asserted by construction: a payload containing a rewritten stem loses it.
 *
 * The consistency rules exist for the specific failure mode a challenge has, which is
 * soothing: concluding the stored answer is wrong and then recommending it be kept reads as
 * agreement and is unactionable.
 */

function answer(overrides: Record<string, unknown> = {}): unknown {
  return {
    verdict: "STORED_ANSWER_STANDS",
    reasoning:
      "Block storage is durable, but the question asks which service stores objects, and only one of the choices does.",
    recommendation: "KEEP",
    ...overrides,
  };
}

function accepted(value: unknown): QuestionChallenge {
  const result = validateQuestionChallenge(value);

  if (!result.ok) {
    throw new Error(
      `Expected a valid challenge, got: ${result.errors.join("; ")}`,
    );
  }

  return result.value;
}

function rejection(value: unknown): readonly string[] {
  const result = validateQuestionChallenge(value);

  if (result.ok) {
    throw new Error("Expected the challenge to be rejected.");
  }

  return result.errors;
}

describe("the challenge schema", () => {
  it("accepts a well-formed outcome and trims what the model sent", () => {
    const challenge = accepted(answer({ reasoning: "  The answer stands.  " }));

    expect(challenge.verdict).toBe("STORED_ANSWER_STANDS");
    expect(challenge.recommendation).toBe("KEEP");
    expect(challenge.reasoning).toBe("The answer stands.");
    expect(challenge.suggestedRevisionNote).toBeNull();
  });

  it("normalises an omitted, null, or blank revision note to null", () => {
    // Two spellings of the same absence would make the REVISE-needs-a-note rule depend on
    // which one arrived.
    expect(accepted(answer()).suggestedRevisionNote).toBeNull();
    expect(
      accepted(answer({ suggestedRevisionNote: null })).suggestedRevisionNote,
    ).toBeNull();
    expect(
      accepted(answer({ suggestedRevisionNote: "   " })).suggestedRevisionNote,
    ).toBeNull();
  });

  it("requires a verdict, an argument, and a recommendation", () => {
    expect(rejection({ reasoning: "words" }).join(" ")).toMatch(/verdict/);
    expect(rejection(answer({ reasoning: "  " })).join(" ")).toMatch(
      /reasoning/,
    );
    expect(rejection(answer({ recommendation: "PONDER" })).join(" ")).toMatch(
      /recommendation/,
    );
    expect(rejection(answer({ verdict: "MAYBE" })).join(" ")).toMatch(
      /verdict/,
    );
  });

  it("bounds the argument and the note", () => {
    expect(
      rejection(
        answer({ reasoning: "x".repeat(CHALLENGE_REASONING_LIMIT + 1) }),
      ).join(" "),
    ).toMatch(/reasoning/);
    expect(
      rejection(
        answer({
          verdict: "STORED_ANSWER_WRONG",
          recommendation: "REVISE",
          suggestedRevisionNote: "y".repeat(CHALLENGE_NOTE_LIMIT + 1),
        }),
      ).join(" "),
    ).toMatch(/suggestedRevisionNote/);
  });

  it("refuses KEEP when the stored answer was found wrong", () => {
    expect(
      rejection(
        answer({ verdict: "STORED_ANSWER_WRONG", recommendation: "KEEP" }),
      ).join(" "),
    ).toMatch(/KEEP is not available/);
  });

  it("refuses KEEP when the objection was found to have a point", () => {
    // That verdict's entire content is that the question is not as clear as it looks, so
    // recommending no change contradicts it.
    expect(
      rejection(
        answer({ verdict: "OWNER_HAS_A_POINT", recommendation: "KEEP" }),
      ).join(" "),
    ).toMatch(/KEEP is not available/);
  });

  it("refuses a revision note alongside a KEEP recommendation", () => {
    expect(
      rejection(
        answer({ suggestedRevisionNote: "the stem should name the region" }),
      ).join(" "),
    ).toMatch(/leave it out when the recommendation is KEEP/);
  });

  it("refuses REVISE with nothing to revise", () => {
    // A recommendation to revise with no note leaves the owner at an edit form with no idea
    // what the model meant.
    expect(
      rejection(
        answer({ verdict: "OWNER_HAS_A_POINT", recommendation: "REVISE" }),
      ).join(" "),
    ).toMatch(/required when the recommendation is REVISE/);
  });

  it("allows a REVISE recommendation for a question whose answer stands", () => {
    // Real and useful: the marked answer is right and the stem is still sloppy. Forbidding
    // it would push a genuine finding into a wrong verdict.
    const challenge = accepted(
      answer({
        recommendation: "REVISE",
        suggestedRevisionNote: "The stem has to say the bucket is in-region.",
      }),
    );

    expect(challenge.recommendation).toBe("REVISE");
  });

  it("allows DISPUTE for every verdict that found something", () => {
    for (const verdict of ["OWNER_HAS_A_POINT", "STORED_ANSWER_WRONG"]) {
      expect(
        accepted(answer({ verdict, recommendation: "DISPUTE" })).recommendation,
      ).toBe("DISPUTE");
    }
  });

  it("carries none of the owner's text in a message sent back to the provider", () => {
    const errors = rejection(
      answer({
        verdict: "STORED_ANSWER_WRONG",
        recommendation: "KEEP",
        reasoning: "a secret the owner typed into the objection box",
      }),
    ).join(" ");

    expect(errors).not.toContain("a secret the owner typed");
  });

  it("has nowhere to put a replacement question", () => {
    // The acceptance criterion held by construction: the AI never writes the revision,
    // because there is no field to carry one (`spec/AI-GUIDELINES.md` section 1.10).
    const challenge = accepted(
      answer({
        correctedStem: "Which service stores objects, in the same region?",
        replacementChoices: ["Amazon S3", "Amazon EBS"],
        correctChoiceId: "choice-2",
        rewrittenExplanation: "Because objects live in buckets.",
      }),
    );

    expect(Object.keys(challenge).sort()).toEqual([
      "reasoning",
      "recommendation",
      "suggestedRevisionNote",
      "verdict",
    ]);
    expect(JSON.stringify(challenge)).not.toContain("choice-2");
  });
});

describe("reading a stored challenge", () => {
  it("round-trips what was accepted", () => {
    const challenge = accepted(
      answer({
        verdict: "OWNER_HAS_A_POINT",
        recommendation: "DISPUTE",
      }),
    );

    expect(
      readQuestionChallenge(serializeQuestionChallenge(challenge)),
    ).toEqual(challenge);
  });

  it("returns null for an absent payload and for unreadable JSON", () => {
    expect(readQuestionChallenge(null)).toBeNull();
    expect(readQuestionChallenge("{ not json")).toBeNull();
  });

  it("returns null for a stored outcome that would not be accepted now", () => {
    // Re-validated in full, unlike a grading: every rule a challenge has is about the
    // outcome itself, so nothing about an edited question can invalidate one.
    const stored = JSON.stringify({
      verdict: "STORED_ANSWER_WRONG",
      reasoning: "The marked answer is wrong.",
      recommendation: "KEEP",
    });

    expect(readQuestionChallenge(stored)).toBeNull();
  });
});

describe("what a challenge argues for", () => {
  it("recognises the dispute path", () => {
    expect(recommendsDispute(accepted(answer()))).toBe(false);
    expect(
      recommendsDispute(
        accepted(
          answer({ verdict: "STORED_ANSWER_WRONG", recommendation: "DISPUTE" }),
        ),
      ),
    ).toBe(true);
  });

  it("recognises the revise path only when there is a note to show", () => {
    expect(
      recommendsRevision(
        accepted(
          answer({
            recommendation: "REVISE",
            suggestedRevisionNote: "Name the region in the stem.",
          }),
        ),
      ),
    ).toBe(true);
    // The guard for a payload read back from a row: a heading over nothing is worse than
    // no heading.
    expect(
      recommendsRevision({
        verdict: "STORED_ANSWER_STANDS",
        reasoning: "…",
        recommendation: "REVISE",
        suggestedRevisionNote: null,
      }),
    ).toBe(false);
  });

  it("labels every verdict and every recommendation for the owner", () => {
    expect(describeChallengeVerdict("STORED_ANSWER_STANDS")).toMatch(/stands/);
    expect(describeChallengeVerdict("OWNER_HAS_A_POINT")).toMatch(/point/);
    expect(describeChallengeVerdict("STORED_ANSWER_WRONG")).toMatch(/wrong/);
    expect(describeChallengeRecommendation("KEEP")).toMatch(/Keep/);
    expect(describeChallengeRecommendation("DISPUTE")).toMatch(/out of study/);
    expect(describeChallengeRecommendation("REVISE")).toMatch(/new revision/);
  });
});

describe("the shape sent to the provider", () => {
  const schema = questionChallengeJsonSchema();

  it("requires the verdict, the argument, and the recommendation", () => {
    expect(schema.required).toEqual(["verdict", "reasoning", "recommendation"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("says at the note's own field that it is a note and not the revision", () => {
    const note = schema.properties?.suggestedRevisionNote?.description ?? "";

    expect(note).toMatch(/not the new question/);
    expect(note).toMatch(/do not write a replacement stem/i);
    expect(note).toMatch(/They write the new version themselves/);
  });

  it("asks for both readings to be argued before either is decided", () => {
    expect(schema.properties?.reasoning?.description ?? "").toMatch(
      /strongest case for their objection first/,
    );
  });

  it("offers no property that could carry replacement question content", () => {
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      "reasoning",
      "recommendation",
      "suggestedRevisionNote",
      "verdict",
    ]);
  });
});
