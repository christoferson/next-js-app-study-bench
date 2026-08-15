import { describe, expect, it } from "vitest";
import type { QuestionQualityStatus } from "@/modules/question-bank/domain/question";
import { QUESTION_QUALITY_STATUSES } from "@/modules/question-bank/domain/question";
import {
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
  REVIEW_ACTIONS,
  REVIEW_VERDICTS,
  checkReviewConsistency,
  describeFindingCategory,
  describeReviewAction,
  describeSeverity,
  describeVerdict,
  qualityStatusAfterReview,
  recommendsDispute,
} from "./question-review";
import type {
  FindingCategory,
  FindingSeverity,
  QuestionReview,
  ReviewFinding,
} from "./question-review";

/**
 * The two rules that make an AI review safe to act on.
 *
 * First, the verdict has to agree with the findings. A model asked to check work tends to
 * describe a problem and then reassure — a paragraph about a wrong answer under a `SOUND`
 * verdict — and reassurance is the one failure mode a review must not have. So the
 * consistency rules are tested as a matrix rather than case by case: each rule is checked
 * in the direction it holds, and the combinations that are legal are asserted legal so a
 * later tightening cannot quietly reject an honest review.
 *
 * Second, a review may only ever promote a question to `AI_REVIEWED`. Every other quality
 * state is either the owner's claim or carries information the reviewer does not have, so
 * the test enumerates the whole of `QUESTION_QUALITY_STATUSES` and pins the one that moves.
 */

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    severity: "MINOR",
    category: "OTHER",
    detail: "The wording of the second choice is loose.",
    ...overrides,
  };
}

function review(overrides: Partial<QuestionReview> = {}): QuestionReview {
  return {
    verdict: "SOUND",
    answerCorrect: true,
    findings: [],
    suggestedAction: "APPROVE",
    summary: "The marked answer is correct and only one choice is defensible.",
    ...overrides,
  };
}

describe("review consistency checks", () => {
  it("accepts a clean pass with no findings at all", () => {
    expect(checkReviewConsistency(review())).toEqual([]);
  });

  it("accepts a pass carrying only remarks", () => {
    // "This is fine, and here is something worth knowing" is a real answer, and refusing
    // it would push a reviewer into inventing a severity for a non-defect.
    expect(
      checkReviewConsistency(
        review({ findings: [finding({ severity: "INFO" })] }),
      ),
    ).toEqual([]);
  });

  it("refuses a MINOR finding under a SOUND verdict", () => {
    const problems = checkReviewConsistency(
      review({ findings: [finding({ severity: "MINOR" })] }),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /SOUND allows only findings with severity INFO/,
    );
  });

  it("refuses a MAJOR finding under a SOUND verdict", () => {
    expect(
      checkReviewConsistency(
        review({ findings: [finding({ severity: "MAJOR" })] }),
      ).join(" "),
    ).toMatch(/SOUND allows only findings with severity INFO/);
  });

  it("refuses a MAJOR finding under a MINOR_ISSUES verdict", () => {
    // The verdict must be at least as serious as its worst finding, or the summary the
    // owner skims understates what the reviewer actually found.
    const problems = checkReviewConsistency(
      review({
        verdict: "MINOR_ISSUES",
        suggestedAction: "REVISE",
        findings: [finding({ severity: "MAJOR" })],
      }),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/the verdict must be MAJOR_ISSUES/);
  });

  it("refuses MAJOR_ISSUES with nothing major written down", () => {
    const problems = checkReviewConsistency(
      review({
        verdict: "MAJOR_ISSUES",
        suggestedAction: "DISPUTE",
        findings: [finding({ severity: "MINOR" })],
      }),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/requires at least one finding with severity/);
  });

  it("refuses SOUND when the answer is judged wrong", () => {
    // The pairing that would promote a question to AI_REVIEWED on the strength of a
    // verdict its own answer flag contradicts.
    expect(
      checkReviewConsistency(review({ answerCorrect: false })).join(" "),
    ).toMatch(/SOUND is not available when answerCorrect is false/);
  });

  it("refuses a wrong answer with no finding that says why", () => {
    const problems = checkReviewConsistency(
      review({
        verdict: "MINOR_ISSUES",
        answerCorrect: false,
        suggestedAction: "REVISE",
        findings: [finding({ severity: "MINOR", category: "WEAK_DISTRACTOR" })],
      }),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /requires a WRONG_ANSWER or AMBIGUOUS finding of severity MINOR or MAJOR/,
    );
  });

  it("refuses a wrong answer whose only supporting finding is a remark", () => {
    // An INFO finding does not carry a wrong answer: the owner would see "answer looks
    // wrong" with nothing actionable beside it.
    expect(
      checkReviewConsistency(
        review({
          verdict: "MINOR_ISSUES",
          answerCorrect: false,
          suggestedAction: "REVISE",
          findings: [finding({ severity: "INFO", category: "WRONG_ANSWER" })],
        }),
      ).join(" "),
    ).toMatch(/requires a WRONG_ANSWER or AMBIGUOUS finding/);
  });

  it("accepts a wrong answer supported by either category, at either weight", () => {
    const supporting: readonly [FindingSeverity, FindingCategory][] = [
      ["MINOR", "WRONG_ANSWER"],
      ["MAJOR", "WRONG_ANSWER"],
      ["MINOR", "AMBIGUOUS"],
      ["MAJOR", "AMBIGUOUS"],
    ];

    for (const [severity, category] of supporting) {
      expect(
        checkReviewConsistency(
          review({
            verdict: severity === "MAJOR" ? "MAJOR_ISSUES" : "MINOR_ISSUES",
            answerCorrect: false,
            suggestedAction: "DISPUTE",
            findings: [finding({ severity, category })],
          }),
        ),
      ).toEqual([]);
    }
  });

  it("accepts a correct answer that is nonetheless ambiguous", () => {
    // The case ambiguity detection exists for: the marked answer is right and a second
    // choice is also defensible, so the question is still not fit to study
    // (`spec/AI-GUIDELINES.md` section 2.2).
    expect(
      checkReviewConsistency(
        review({
          verdict: "MAJOR_ISSUES",
          answerCorrect: true,
          suggestedAction: "DISPUTE",
          findings: [finding({ severity: "MAJOR", category: "AMBIGUOUS" })],
        }),
      ),
    ).toEqual([]);
  });

  it("reports every violation a single answer commits", () => {
    // Two independent rules broken at once, so a repair attempt is told about both rather
    // than fixing one and failing again on the other.
    const problems = checkReviewConsistency(
      review({
        answerCorrect: false,
        findings: [finding({ severity: "MAJOR" })],
      }),
    );

    expect(problems.length).toBeGreaterThan(1);
  });

  it("names fields and expectations only, never the owner's text", () => {
    // Every message travels back to the provider as repair feedback
    // (`spec/AI-GUIDELINES.md` section 1.7).
    const problems = checkReviewConsistency(
      review({
        answerCorrect: false,
        findings: [
          finding({ severity: "MAJOR", detail: "SECRET-STEM-TEXT is wrong" }),
        ],
      }),
    );

    expect(problems.join(" ")).not.toContain("SECRET-STEM-TEXT");
  });
});

describe("the quality state a review leaves behind", () => {
  it("promotes an unreviewed question when the review found nothing wrong", () => {
    expect(qualityStatusAfterReview(review(), "UNREVIEWED")).toBe(
      "AI_REVIEWED",
    );
  });

  it("changes nothing for any state the owner or a source reached", () => {
    // Enumerated over the whole closed list rather than the interesting few, so a new
    // quality state has to be decided about here rather than defaulting to promotable.
    const untouched = QUESTION_QUALITY_STATUSES.filter(
      (status) => status !== "UNREVIEWED",
    );

    for (const status of untouched) {
      expect(qualityStatusAfterReview(review(), status)).toBeNull();
    }
  });

  it("never demotes anything, whatever it found", () => {
    // The rule that keeps a model from pulling a question out of study on its own word:
    // a bad verdict leaves the state alone and offers the owner a dispute button.
    const bad = review({
      verdict: "MAJOR_ISSUES",
      answerCorrect: false,
      suggestedAction: "DISPUTE",
      findings: [finding({ severity: "MAJOR", category: "WRONG_ANSWER" })],
    });

    for (const status of QUESTION_QUALITY_STATUSES) {
      expect(qualityStatusAfterReview(bad, status)).toBeNull();
    }
  });

  it("refuses to promote on a SOUND verdict whose answer flag disagrees", () => {
    // Unreachable through the validator, which rejects the pairing, and checked anyway:
    // this function is the last gate before a write.
    expect(
      qualityStatusAfterReview(review({ answerCorrect: false }), "UNREVIEWED"),
    ).toBeNull();
  });

  it("is idempotent, so re-reviewing is free of side effects", () => {
    const first = qualityStatusAfterReview(review(), "UNREVIEWED");

    expect(first).toBe("AI_REVIEWED");
    expect(
      qualityStatusAfterReview(review(), first as QuestionQualityStatus),
    ).toBeNull();
  });

  it("leaves minor issues to the owner rather than promoting them", () => {
    expect(
      qualityStatusAfterReview(
        review({
          verdict: "MINOR_ISSUES",
          suggestedAction: "REVISE",
          findings: [finding()],
        }),
        "UNREVIEWED",
      ),
    ).toBeNull();
  });
});

describe("the dispute recommendation", () => {
  it("is exactly the DISPUTE action and nothing else", () => {
    expect(recommendsDispute(review({ suggestedAction: "DISPUTE" }))).toBe(
      true,
    );
    expect(recommendsDispute(review({ suggestedAction: "REVISE" }))).toBe(
      false,
    );
    expect(recommendsDispute(review({ suggestedAction: "APPROVE" }))).toBe(
      false,
    );
  });

  it("does not follow from the verdict on its own", () => {
    // A major issue the owner would rather fix than dispute is a legitimate answer, so
    // the recommendation is its own field rather than derived from the verdict.
    expect(
      recommendsDispute(
        review({
          verdict: "MAJOR_ISSUES",
          suggestedAction: "REVISE",
          findings: [finding({ severity: "MAJOR" })],
        }),
      ),
    ).toBe(false);
  });
});

describe("owner-facing labels", () => {
  it("labels every value of every closed list", () => {
    // A missing label would render as a raw enum name on the findings panel.
    for (const verdict of REVIEW_VERDICTS) {
      expect(describeVerdict(verdict).length).toBeGreaterThan(0);
    }

    for (const severity of FINDING_SEVERITIES) {
      expect(describeSeverity(severity).length).toBeGreaterThan(0);
    }

    for (const category of FINDING_CATEGORIES) {
      expect(describeFindingCategory(category).length).toBeGreaterThan(0);
    }

    for (const action of REVIEW_ACTIONS) {
      expect(describeReviewAction(action).length).toBeGreaterThan(0);
    }
  });

  it("says what an ambiguous finding actually means, in the owner's words", () => {
    expect(describeFindingCategory("AMBIGUOUS")).toBe(
      "More than one defensible answer",
    );
    expect(describeSeverity("INFO")).toBe("Note");
  });
});
