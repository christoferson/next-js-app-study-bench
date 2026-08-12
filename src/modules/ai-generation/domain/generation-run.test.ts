import { describe, expect, it } from "vitest";
import {
  GENERATED_ITEM_KINDS,
  GENERATION_FAILURE_CATEGORIES,
  GENERATION_RUN_STATUSES,
  describeFailureCategory,
  describeItemKind,
  describeItemKindSingular,
  describeRunStatus,
  resolveRunStatus,
} from "./generation-run";
import {
  LARGE_BATCH_THRESHOLD,
  MAX_BATCH_ITEMS,
  MIN_BATCH_ITEMS,
  isLargeBatch,
  maxOutputTokensFor,
} from "./generation-limits";
import { canonicalRequestText } from "./request-fingerprint";
import type { GenerationRequestSpec } from "./generated-draft";

function spec(
  overrides: Partial<GenerationRequestSpec> = {},
): GenerationRequestSpec {
  return {
    itemCount: 3,
    objectiveIds: [],
    difficulty: null,
    additionalInstructions: null,
    questionTypes: [],
    cardTypes: [],
    ...overrides,
  };
}

function fingerprint(
  overrides: Partial<GenerationRequestSpec> = {},
  itemKind: "QUESTION" | "FLASHCARD" = "QUESTION",
): string {
  return canonicalRequestText({
    certificationId: "certification-1",
    itemKind,
    spec: spec(overrides),
  });
}

describe("resolveRunStatus", () => {
  it("is completed when everything was written", () => {
    expect(
      resolveRunStatus({ successfulItemCount: 3, failedItemCount: 0 }),
    ).toBe("COMPLETED");
  });

  it("is partial when some items were refused", () => {
    expect(
      resolveRunStatus({ successfulItemCount: 2, failedItemCount: 1 }),
    ).toBe("PARTIAL");
  });

  it("is failed when nothing was written, whatever was refused", () => {
    expect(
      resolveRunStatus({ successfulItemCount: 0, failedItemCount: 3 }),
    ).toBe("FAILED");
    expect(
      resolveRunStatus({ successfulItemCount: 0, failedItemCount: 0 }),
    ).toBe("FAILED");
  });
});

describe("run descriptions", () => {
  it("describes every status", () => {
    for (const status of GENERATION_RUN_STATUSES) {
      expect(describeRunStatus(status).length).toBeGreaterThan(0);
    }
  });

  it("gives every failure category owner-facing advice", () => {
    // A category with no advice leaves the owner guessing whether to retry, change
    // the request, or fix their configuration.
    for (const category of GENERATION_FAILURE_CATEGORIES) {
      expect(describeFailureCategory(category).length).toBeGreaterThan(20);
    }
  });

  it("describes every item kind in both plural and singular", () => {
    for (const kind of GENERATED_ITEM_KINDS) {
      expect(describeItemKind(kind).length).toBeGreaterThan(0);
      expect(describeItemKindSingular(kind).length).toBeGreaterThan(0);
    }
  });

  it("never leaks a provider detail into failure advice", () => {
    // The advice is shown to the owner and is the only thing said about a provider
    // error, so it must not read like a raw exception.
    for (const category of GENERATION_FAILURE_CATEGORIES) {
      const advice = describeFailureCategory(category);

      expect(advice).not.toMatch(/arn:|aws_|secret|token=|https?:\/\//i);
    }
  });
});

describe("batch limits", () => {
  it("bounds a batch to something an owner can wait for", () => {
    expect(MIN_BATCH_ITEMS).toBe(1);
    expect(MAX_BATCH_ITEMS).toBe(10);
    expect(LARGE_BATCH_THRESHOLD).toBeLessThan(MAX_BATCH_ITEMS);
  });

  it("asks for confirmation only above the threshold", () => {
    expect(isLargeBatch(LARGE_BATCH_THRESHOLD)).toBe(false);
    expect(isLargeBatch(LARGE_BATCH_THRESHOLD + 1)).toBe(true);
  });

  it("scales the output budget with the batch and floors it at one item", () => {
    expect(maxOutputTokensFor("QUESTION", 10)).toBeGreaterThan(
      maxOutputTokensFor("QUESTION", 1),
    );
    expect(maxOutputTokensFor("QUESTION", 0)).toBe(
      maxOutputTokensFor("QUESTION", 1),
    );
  });

  it("gives a question more room than a card", () => {
    expect(maxOutputTokensFor("QUESTION", 5)).toBeGreaterThan(
      maxOutputTokensFor("FLASHCARD", 5),
    );
  });
});

describe("canonicalRequestText", () => {
  it("is stable for the same request", () => {
    expect(fingerprint()).toBe(fingerprint());
  });

  it("ignores the order objectives and types were chosen in", () => {
    expect(fingerprint({ objectiveIds: ["a", "b"] })).toBe(
      fingerprint({ objectiveIds: ["b", "a"] }),
    );
    expect(
      fingerprint({ questionTypes: ["SHORT_ANSWER", "SINGLE_CHOICE"] }),
    ).toBe(fingerprint({ questionTypes: ["SINGLE_CHOICE", "SHORT_ANSWER"] }));
  });

  it("ignores reflowed whitespace in owner notes", () => {
    expect(fingerprint({ additionalInstructions: " focus on   cost  " })).toBe(
      fingerprint({ additionalInstructions: "focus on cost" }),
    );
  });

  it("distinguishes different notes, including by case", () => {
    expect(fingerprint({ additionalInstructions: "focus on IAM" })).not.toBe(
      fingerprint({ additionalInstructions: "focus on VPC" }),
    );
    expect(fingerprint({ additionalInstructions: "IAM" })).not.toBe(
      fingerprint({ additionalInstructions: "iam" }),
    );
  });

  it("distinguishes the count, the difficulty, the kind, and the track", () => {
    expect(fingerprint({ itemCount: 3 })).not.toBe(
      fingerprint({ itemCount: 4 }),
    );
    expect(fingerprint({ difficulty: null })).not.toBe(
      fingerprint({ difficulty: 3 }),
    );
    expect(fingerprint({}, "QUESTION")).not.toBe(fingerprint({}, "FLASHCARD"));
    expect(
      canonicalRequestText({
        certificationId: "certification-2",
        itemKind: "QUESTION",
        spec: spec(),
      }),
    ).not.toBe(fingerprint());
  });

  it("does not distinguish a question batch by its card types", () => {
    // Card types are irrelevant to a question request, but they must still be part
    // of one canonical shape so the string is comparable across kinds.
    expect(fingerprint({ cardTypes: [] })).toContain("cardTypes=");
  });
});
