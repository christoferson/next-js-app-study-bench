import { describe, expect, it } from "vitest";
import { questionFixture } from "@/modules/question-bank/infrastructure/test-support";
import {
  InvalidLifecycleTransitionError,
  InvalidQualityTransitionError,
} from "./errors";
import {
  describeGenerationMode,
  describeLifecycleStatus,
  describeQualityStatus,
  describeQuestionType,
  QUESTION_LIFECYCLE_STATUSES,
  QUESTION_QUALITY_STATUSES,
  QUESTION_TYPES,
  GENERATION_MODES,
} from "./question";
import {
  DISPUTE_RESOLUTIONS,
  assertCanApprove,
  assertCanDispute,
  assertCanResolveDispute,
  assertLifecycleTransition,
  canTransitionLifecycle,
  isStudyEligible,
} from "./question-lifecycle";

describe("lifecycle transitions", () => {
  it("allows a draft to become active", () => {
    expect(canTransitionLifecycle("DRAFT", "ACTIVE")).toBe(true);
  });

  it("allows retiring an active question and restoring a retired one", () => {
    expect(canTransitionLifecycle("ACTIVE", "RETIRED")).toBe(true);
    expect(canTransitionLifecycle("RETIRED", "ACTIVE")).toBe(true);
  });

  it("refuses to activate an already active question", () => {
    expect(() => assertLifecycleTransition("ACTIVE", "ACTIVE")).toThrow(
      InvalidLifecycleTransitionError,
    );
  });

  it("refuses to retire a draft, because a draft was never in study", () => {
    expect(() => assertLifecycleTransition("DRAFT", "RETIRED")).toThrow(
      InvalidLifecycleTransitionError,
    );
  });

  it("treats archived as terminal", () => {
    for (const status of QUESTION_LIFECYCLE_STATUSES) {
      expect(canTransitionLifecycle("ARCHIVED", status)).toBe(false);
    }
  });

  it("names the states in the message so the owner sees why", () => {
    const error = new InvalidLifecycleTransitionError("DRAFT", "RETIRED");

    expect(error.fieldMessages()[""]?.[0]).toContain("draft");
    expect(error.code).toBe("INVALID_LIFECYCLE_TRANSITION");
  });
});

describe("dispute rules", () => {
  it("allows disputing a draft, because a dispute is a note about content", () => {
    expect(() =>
      assertCanDispute(questionFixture({ lifecycleStatus: "DRAFT" })),
    ).not.toThrow();
  });

  it("allows disputing an active question without retiring it", () => {
    const question = questionFixture({ lifecycleStatus: "ACTIVE" });

    expect(() => assertCanDispute(question)).not.toThrow();
    // Disputing changes only the quality dimension; the caller keeps the
    // lifecycle status it read.
    expect(question.lifecycleStatus).toBe("ACTIVE");
  });

  it("refuses to dispute an already disputed question", () => {
    expect(() =>
      assertCanDispute(questionFixture({ qualityStatus: "DISPUTED" })),
    ).toThrow(InvalidQualityTransitionError);
  });

  it("resolves a dispute into an allowed quality state", () => {
    const disputed = questionFixture({ qualityStatus: "DISPUTED" });

    for (const resolution of DISPUTE_RESOLUTIONS) {
      expect(() => assertCanResolveDispute(disputed, resolution)).not.toThrow();
    }
  });

  it("refuses to resolve a question that is not disputed", () => {
    expect(() =>
      assertCanResolveDispute(
        questionFixture({ qualityStatus: "UNREVIEWED" }),
        "USER_APPROVED",
      ),
    ).toThrow(InvalidQualityTransitionError);
  });

  it("refuses a resolution outside the allowed set", () => {
    expect(() =>
      assertCanResolveDispute(
        questionFixture({ qualityStatus: "DISPUTED" }),
        "OUTDATED",
      ),
    ).toThrow(InvalidQualityTransitionError);
  });

  it("refuses to approve a disputed question directly", () => {
    expect(() =>
      assertCanApprove(questionFixture({ qualityStatus: "DISPUTED" })),
    ).toThrow(InvalidQualityTransitionError);
  });

  it("approves a question that is not disputed", () => {
    expect(() =>
      assertCanApprove(questionFixture({ qualityStatus: "UNREVIEWED" })),
    ).not.toThrow();
  });
});

describe("study eligibility", () => {
  it("includes only active, undisputed questions", () => {
    expect(
      isStudyEligible(
        questionFixture({
          lifecycleStatus: "ACTIVE",
          qualityStatus: "UNREVIEWED",
        }),
      ),
    ).toBe(true);
    expect(isStudyEligible(questionFixture({ lifecycleStatus: "DRAFT" }))).toBe(
      false,
    );
    expect(
      isStudyEligible(questionFixture({ lifecycleStatus: "RETIRED" })),
    ).toBe(false);
    expect(
      isStudyEligible(
        questionFixture({
          lifecycleStatus: "ACTIVE",
          qualityStatus: "DISPUTED",
        }),
      ),
    ).toBe(false);
  });
});

describe("enum descriptions", () => {
  it("describes every value of every enum", () => {
    for (const value of QUESTION_TYPES) {
      expect(describeQuestionType(value).length).toBeGreaterThan(0);
    }
    for (const value of QUESTION_LIFECYCLE_STATUSES) {
      expect(describeLifecycleStatus(value).length).toBeGreaterThan(0);
    }
    for (const value of QUESTION_QUALITY_STATUSES) {
      expect(describeQualityStatus(value).length).toBeGreaterThan(0);
    }
    for (const value of GENERATION_MODES) {
      expect(describeGenerationMode(value).length).toBeGreaterThan(0);
    }
  });
});
