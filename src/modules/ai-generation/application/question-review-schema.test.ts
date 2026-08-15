import { describe, expect, it } from "vitest";
import {
  MAX_REVIEW_FINDINGS,
  REVIEW_DETAIL_LIMIT,
  REVIEW_SUMMARY_LIMIT,
} from "@/modules/ai-generation/domain/question-review";
import type { QuestionReview } from "@/modules/ai-generation/domain/question-review";
import {
  questionReviewJsonSchema,
  readQuestionReview,
  serializeQuestionReview,
  validateQuestionReview,
} from "./question-review-schema";

/**
 * The review output contract.
 *
 * Three properties matter here. The schema is the *only* gate between a model's answer and
 * a page the owner will act on, so it has to reject an inconsistent verdict rather than
 * render it. It is also the reader for the stored payload, so a row it would not have
 * accepted must come back as `null` rather than as a half-review. And it must have nowhere
 * to put replacement question content, which is `spec/AI-GUIDELINES.md` section 1.10 held
 * by construction rather than by instruction — so an answer carrying a rewritten stem is
 * asserted to lose it.
 */

function answer(overrides: Record<string, unknown> = {}): unknown {
  return {
    verdict: "SOUND",
    answerCorrect: true,
    findings: [],
    suggestedAction: "APPROVE",
    summary: "The marked answer is correct and no other choice is defensible.",
    ...overrides,
  };
}

function finding(overrides: Record<string, unknown> = {}): unknown {
  return {
    severity: "MAJOR",
    category: "WRONG_ANSWER",
    detail: "The marked choice describes block storage, not object storage.",
    ...overrides,
  };
}

function accepted(value: unknown): QuestionReview {
  const result = validateQuestionReview(value);

  if (!result.ok) {
    throw new Error(
      `Expected a valid review, got: ${result.errors.join("; ")}`,
    );
  }

  return result.value;
}

function rejection(value: unknown): readonly string[] {
  const result = validateQuestionReview(value);

  if (result.ok) {
    throw new Error("Expected the review to be rejected.");
  }

  return result.errors;
}

describe("validateQuestionReview", () => {
  it("accepts a clean pass", () => {
    const review = accepted(answer());

    expect(review.verdict).toBe("SOUND");
    expect(review.answerCorrect).toBe(true);
    expect(review.findings).toEqual([]);
    expect(review.suggestedAction).toBe("APPROVE");
  });

  it("accepts a review with findings and keeps their order", () => {
    const review = accepted(
      answer({
        verdict: "MAJOR_ISSUES",
        answerCorrect: false,
        suggestedAction: "DISPUTE",
        summary:
          "The stated answer is wrong and one distractor is implausible.",
        findings: [
          finding(),
          finding({
            severity: "MINOR",
            category: "WEAK_DISTRACTOR",
            detail: "Nobody would pick the third choice.",
          }),
        ],
      }),
    );

    expect(review.findings).toHaveLength(2);
    expect(review.findings[0]?.category).toBe("WRONG_ANSWER");
    expect(review.findings[1]?.category).toBe("WEAK_DISTRACTOR");
  });

  it("treats a missing findings list as no findings", () => {
    // "Nothing wrong with it" is a real answer, and a model that omits the key rather than
    // sending an empty array has said the same thing.
    const omitted = answer();

    delete (omitted as Record<string, unknown>).findings;

    expect(accepted(omitted).findings).toEqual([]);
    expect(accepted(answer({ findings: null })).findings).toEqual([]);
  });

  it("drops any field that would carry replacement content", () => {
    // The structural half of `spec/AI-GUIDELINES.md` section 1.10: a rewrite is not
    // rejected, it is simply unrepresentable, so it cannot reach a page where the owner
    // might mistake it for their own question.
    const review = accepted(
      answer({
        correctedStem: "What is the best object storage service?",
        correctAnswer: "choice-2",
        replacementChoices: ["Amazon S3", "Amazon Glacier"],
      }),
    );

    expect(Object.keys(review).sort()).toEqual([
      "answerCorrect",
      "findings",
      "suggestedAction",
      "summary",
      "verdict",
    ]);
  });

  it("rejects an unknown verdict, severity, category, or action", () => {
    expect(rejection(answer({ verdict: "PERFECT" })).join(" ")).toMatch(
      /verdict: must be one of SOUND, MINOR_ISSUES, MAJOR_ISSUES/,
    );
    expect(
      rejection(
        answer({
          verdict: "MAJOR_ISSUES",
          findings: [finding({ severity: "FATAL" })],
        }),
      ).join(" "),
    ).toMatch(/findings\.0\.severity: must be one of INFO, MINOR, MAJOR/);
    expect(
      rejection(
        answer({
          verdict: "MAJOR_ISSUES",
          answerCorrect: false,
          findings: [finding({ category: "TYPO" })],
        }),
      ).join(" "),
    ).toMatch(/findings\.0\.category: must be one of/);
    expect(rejection(answer({ suggestedAction: "DELETE" })).join(" ")).toMatch(
      /suggestedAction: must be one of APPROVE, REVISE, DISPUTE/,
    );
  });

  it("rejects a review with no conclusion in it", () => {
    for (const key of [
      "verdict",
      "answerCorrect",
      "suggestedAction",
      "summary",
    ]) {
      const missing = answer() as Record<string, unknown>;

      delete missing[key];

      // No local repair exists for a missing conclusion: the one thing a review has to do
      // is conclude something.
      expect(rejection(missing).join(" ")).toContain(key);
    }
  });

  it("rejects an empty or whitespace-only summary and detail", () => {
    expect(rejection(answer({ summary: "   " })).join(" ")).toMatch(
      /summary: must not be empty/,
    );
    expect(
      rejection(
        answer({
          verdict: "MAJOR_ISSUES",
          answerCorrect: false,
          findings: [finding({ detail: "" })],
        }),
      ).join(" "),
    ).toMatch(/findings\.0\.detail: must not be empty/);
  });

  it("trims the text it accepts", () => {
    const review = accepted(answer({ summary: "  Looks correct.  " }));

    expect(review.summary).toBe("Looks correct.");
  });

  it("rejects text past its bound rather than truncating it", () => {
    // Truncation would produce a finding that stops mid-sentence and reads as a complete
    // thought, which is worse than asking again.
    expect(
      rejection(answer({ summary: "x".repeat(REVIEW_SUMMARY_LIMIT + 1) })).join(
        " ",
      ),
    ).toMatch(new RegExp(`summary: use ${REVIEW_SUMMARY_LIMIT} characters`));
    expect(
      rejection(
        answer({
          verdict: "MAJOR_ISSUES",
          answerCorrect: false,
          findings: [finding({ detail: "x".repeat(REVIEW_DETAIL_LIMIT + 1) })],
        }),
      ).join(" "),
    ).toMatch(new RegExp(`use ${REVIEW_DETAIL_LIMIT} characters`));
  });

  it("rejects more findings than the cap allows", () => {
    expect(
      rejection(
        answer({
          verdict: "MAJOR_ISSUES",
          answerCorrect: false,
          findings: Array.from({ length: MAX_REVIEW_FINDINGS + 1 }, () =>
            finding(),
          ),
        }),
      ).join(" "),
    ).toMatch(new RegExp(`report ${MAX_REVIEW_FINDINGS} findings or fewer`));
  });

  it("runs the domain's consistency rules after the shape", () => {
    // The check a JSON Schema cannot express, and the one that matters most: a verdict that
    // reassures the owner about findings that contradict it.
    expect(
      rejection(answer({ findings: [finding({ severity: "MAJOR" })] })).join(
        " ",
      ),
    ).toMatch(/SOUND allows only findings with severity INFO/);
    expect(rejection(answer({ answerCorrect: false })).join(" ")).toMatch(
      /SOUND is not available when answerCorrect is false/,
    );
  });

  it("never puts the answer's own text in a validation message", () => {
    // Every message here travels back to the provider as repair feedback
    // (`spec/AI-GUIDELINES.md` section 1.7), and the model's answer quotes the owner's
    // question.
    const messages = rejection(
      answer({
        verdict: "PERFECT",
        summary: "SECRET-STEM-TEXT is a fine question.",
        findings: [finding({ detail: "SECRET-STEM-TEXT is wrong" })],
      }),
    ).join(" ");

    expect(messages).not.toContain("SECRET-STEM-TEXT");
  });

  it("rejects an answer that is not an object at all", () => {
    expect(rejection(null).length).toBeGreaterThan(0);
    expect(rejection("SOUND").length).toBeGreaterThan(0);
    expect(rejection([answer()]).length).toBeGreaterThan(0);
  });
});

describe("storing and reading a review", () => {
  it("round-trips through the same schema that accepted it", () => {
    const stored = serializeQuestionReview(
      accepted(
        answer({
          verdict: "MINOR_ISSUES",
          suggestedAction: "REVISE",
          summary: "Correct, but the third choice is implausible.",
          findings: [
            finding({
              severity: "MINOR",
              category: "WEAK_DISTRACTOR",
              detail: "Nobody would pick the third choice.",
            }),
          ],
        }),
      ),
    );

    expect(readQuestionReview(stored)?.verdict).toBe("MINOR_ISSUES");
    expect(readQuestionReview(stored)?.findings).toHaveLength(1);
  });

  it("returns null for a run that has no payload", () => {
    // A failed review, or a pending one: the panel says nothing rather than erroring.
    expect(readQuestionReview(null)).toBeNull();
  });

  it("returns null for unreadable JSON rather than throwing", () => {
    expect(readQuestionReview("{not json")).toBeNull();
  });

  it("returns null for a stored row the schema would no longer accept", () => {
    // The database is an external boundary (`spec/CODING-STANDARDS.md` section 2): a
    // hand-edited row must not become a rendered verdict.
    expect(
      readQuestionReview(
        JSON.stringify({ verdict: "SOUND", answerCorrect: false }),
      ),
    ).toBeNull();
    expect(
      readQuestionReview(
        JSON.stringify(answer({ findings: [finding({ severity: "MAJOR" })] })),
      ),
    ).toBeNull();
  });
});

describe("the JSON schema sent to the provider", () => {
  const schema = questionReviewJsonSchema();

  it("requires every field that has no sensible default", () => {
    expect(schema.required).toEqual([
      "verdict",
      "answerCorrect",
      "suggestedAction",
      "summary",
    ]);
    // `findings` is deliberately absent: omitting it means none.
    expect(schema.required).not.toContain("findings");
  });

  it("offers exactly the closed lists the validator accepts", () => {
    expect(schema.properties?.verdict?.enum).toEqual([
      "SOUND",
      "MINOR_ISSUES",
      "MAJOR_ISSUES",
    ]);
    expect(schema.properties?.suggestedAction?.enum).toEqual([
      "APPROVE",
      "REVISE",
      "DISPUTE",
    ]);
    expect(
      schema.properties?.findings?.items?.properties?.severity?.enum,
    ).toEqual(["INFO", "MINOR", "MAJOR"]);
  });

  it("describes no field that could carry a rewrite", () => {
    // The provider is never even offered a place to put one.
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      "answerCorrect",
      "findings",
      "suggestedAction",
      "summary",
      "verdict",
    ]);
  });

  it("tells the model, at the field, to describe rather than fix", () => {
    // The descriptions are part of the prompt, and this is the one place a helpful model
    // would otherwise try to supply corrected text.
    expect(
      schema.properties?.findings?.items?.properties?.detail?.description,
    ).toMatch(/do not supply corrected text/);
  });

  it("states the length bounds it cannot express as keywords", () => {
    // The port's `JsonSchema` has no `maxLength`, so the bound is stated in words and zod
    // remains the authority.
    expect(schema.properties?.summary?.description).toContain(
      `${REVIEW_SUMMARY_LIMIT} characters or fewer`,
    );
    expect(schema.properties?.findings?.maxItems).toBe(MAX_REVIEW_FINDINGS);
  });
});
