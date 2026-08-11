import { describe, expect, it } from "vitest";
import { InvalidFlashcardLifecycleTransitionError } from "./errors";
import type { Flashcard, FlashcardLifecycleStatus } from "./flashcard";
import {
  CARD_TYPES,
  FLASHCARD_LIFECYCLE_STATUSES,
  describeCardPrompting,
  describeCardType,
  describeFlashcardLifecycleStatus,
  textExcerpt,
} from "./flashcard";
import {
  assertLifecycleTransition,
  canTransitionLifecycle,
  isReviewEligible,
} from "./flashcard-lifecycle";

function flashcardFixture(
  lifecycleStatus: FlashcardLifecycleStatus,
): Flashcard {
  return {
    id: "card-1",
    certificationId: "cert-1",
    currentRevisionId: "rev-1",
    lifecycleStatus,
    sourceQuestionId: null,
    createdAt: "2026-03-01T08:00:00.000Z",
    updatedAt: "2026-03-01T08:00:00.000Z",
  };
}

describe("canTransitionLifecycle", () => {
  const allowed: readonly [
    FlashcardLifecycleStatus,
    FlashcardLifecycleStatus,
  ][] = [
    ["DRAFT", "ACTIVE"],
    ["ACTIVE", "RETIRED"],
    ["RETIRED", "ACTIVE"],
  ];

  for (const [from, to] of allowed) {
    it(`allows ${from} → ${to}`, () => {
      expect(canTransitionLifecycle(from, to)).toBe(true);
    });
  }

  it("rejects every transition that is not explicitly allowed", () => {
    for (const from of FLASHCARD_LIFECYCLE_STATUSES) {
      for (const to of FLASHCARD_LIFECYCLE_STATUSES) {
        const isAllowed = allowed.some(
          ([allowedFrom, allowedTo]) =>
            allowedFrom === from && allowedTo === to,
        );

        expect(canTransitionLifecycle(from, to)).toBe(isAllowed);
      }
    }
  });

  it("rejects a transition to the same status", () => {
    for (const status of FLASHCARD_LIFECYCLE_STATUSES) {
      expect(canTransitionLifecycle(status, status)).toBe(false);
    }
  });

  it("does not allow a draft to be retired before it was ever active", () => {
    expect(canTransitionLifecycle("DRAFT", "RETIRED")).toBe(false);
  });

  it("treats ARCHIVED as terminal", () => {
    for (const to of FLASHCARD_LIFECYCLE_STATUSES) {
      expect(canTransitionLifecycle("ARCHIVED", to)).toBe(false);
    }
  });
});

describe("assertLifecycleTransition", () => {
  it("passes for an allowed move", () => {
    expect(() => assertLifecycleTransition("DRAFT", "ACTIVE")).not.toThrow();
  });

  it("throws a domain error naming both states", () => {
    try {
      assertLifecycleTransition("DRAFT", "RETIRED");
      throw new Error("Expected the transition to be rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidFlashcardLifecycleTransitionError);
      const invalid = error as InvalidFlashcardLifecycleTransitionError;
      expect(invalid.message).toContain("Draft");
      expect(invalid.message).toContain("Retired");
    }
  });
});

describe("isReviewEligible", () => {
  it("includes only active cards in the review pool", () => {
    for (const status of FLASHCARD_LIFECYCLE_STATUSES) {
      expect(isReviewEligible(flashcardFixture(status))).toBe(
        status === "ACTIVE",
      );
    }
  });

  it("excludes a retired card, as the acceptance criteria require", () => {
    expect(isReviewEligible(flashcardFixture("RETIRED"))).toBe(false);
  });
});

describe("descriptions", () => {
  it("names every card type and explains how it is studied", () => {
    for (const cardType of CARD_TYPES) {
      expect(describeCardType(cardType).length).toBeGreaterThan(0);
      expect(describeCardPrompting(cardType).length).toBeGreaterThan(0);
    }
  });

  it("distinguishes basic from reversed prompting in words", () => {
    expect(describeCardPrompting("BASIC")).not.toBe(
      describeCardPrompting("REVERSED"),
    );
  });

  it("names every lifecycle status", () => {
    expect(
      FLASHCARD_LIFECYCLE_STATUSES.map(describeFlashcardLifecycleStatus),
    ).toEqual(["Draft", "Active", "Retired", "Archived"]);
  });
});

describe("textExcerpt", () => {
  it("leaves short text untouched", () => {
    expect(textExcerpt("学习")).toBe("学习");
  });

  it("collapses whitespace", () => {
    expect(textExcerpt("a  b\n c")).toBe("a b c");
  });

  it("truncates long text on a word boundary", () => {
    const excerpt = textExcerpt(`${"word ".repeat(40)}end`, 20);

    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(21);
    expect(excerpt).not.toContain("  ");
  });
});
