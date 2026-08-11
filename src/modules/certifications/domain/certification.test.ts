import { describe, expect, it } from "vitest";
import {
  describeLifecycleStatus,
  describePriority,
  describeStudyType,
  isReservedSlug,
  SLUG_FALLBACK,
  slugify,
  slugWithSuffix,
} from "./certification";

describe("slugify", () => {
  it("produces a kebab-case slug from a track name", () => {
    expect(slugify("AWS Certified Cloud Practitioner")).toBe(
      "aws-certified-cloud-practitioner",
    );
  });

  it("collapses punctuation and separators into single hyphens", () => {
    expect(slugify("HSK Chinese — Demo Track (v2)")).toBe(
      "hsk-chinese-demo-track-v2",
    );
  });

  it("trims leading and trailing separators", () => {
    expect(slugify("  ...Azure Fundamentals!  ")).toBe("azure-fundamentals");
  });

  it("falls back to a neutral stem when no slug characters survive", () => {
    expect(slugify("汉语水平考试")).toBe(SLUG_FALLBACK);
    expect(slugify("!!!")).toBe(SLUG_FALLBACK);
  });

  it("bounds the slug length without leaving a trailing hyphen", () => {
    const slug = slugify("a".repeat(60) + " " + "b".repeat(60));

    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("is stable for the same input", () => {
    expect(slugify("Repeatable Name")).toBe(slugify("Repeatable Name"));
  });
});

describe("slugWithSuffix", () => {
  it("returns the stem unchanged for the first attempt", () => {
    expect(slugWithSuffix("aws-track", 1)).toBe("aws-track");
  });

  it("appends an increasing discriminator for later attempts", () => {
    expect(slugWithSuffix("aws-track", 2)).toBe("aws-track-2");
    expect(slugWithSuffix("aws-track", 7)).toBe("aws-track-7");
  });
});

describe("isReservedSlug", () => {
  it("reserves slugs that collide with a static route segment", () => {
    expect(isReservedSlug("new")).toBe(true);
    expect(isReservedSlug("aws-track")).toBe(false);
  });
});

describe("owner-facing labels", () => {
  it("labels every study type", () => {
    expect(describeStudyType("TECHNICAL_CERTIFICATION")).toBe(
      "Technical certification",
    );
    expect(describeStudyType("LANGUAGE_PROFICIENCY")).toBe(
      "Language proficiency",
    );
    expect(describeStudyType("GENERAL")).toBe("General");
  });

  it("labels lifecycle statuses", () => {
    expect(describeLifecycleStatus("ACTIVE")).toBe("Active");
    expect(describeLifecycleStatus("ARCHIVED")).toBe("Archived");
  });

  it("explains the extreme priority values", () => {
    expect(describePriority(1)).toBe("1 — highest");
    expect(describePriority(3)).toBe("3");
    expect(describePriority(5)).toBe("5 — lowest");
  });
});
