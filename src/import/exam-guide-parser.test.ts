import { describe, expect, it } from "vitest";
import {
  assertExamGuideOutlineSize,
  ExamGuideParseError,
  parseExamGuideOutline,
  toOutlineLines,
} from "./exam-guide-parser";

/**
 * Every fixture in this file is invented.
 *
 * The parser reads the owner's own copy of an official exam guide, which stays in
 * `external/` and is never committed, so these fixtures imitate its *layout* with
 * made-up domains ("Widget Design"), made-up tasks, and made-up skills. Nothing
 * here is real exam content, and a test that passed against real wording would be
 * a test that put that wording in the repository.
 */

/** A minimal guide: one domain, one task, one skill. */
function fixture(body: string): string {
  return [
    "Content outline",
    "This exam guide includes weightings, content domains, and tasks.",
    "•Content Domain 1: Widget Design (60% of scored content)",
    "•Content Domain 2: Widget Operations (40% of scored content)",
    body,
    "Technologies and concepts that might appear on the exam",
    "The following list contains technologies and concepts.",
  ].join("\n");
}

const TWO_DOMAIN_BODY = [
  "Content Domain 1: Widget Design",
  "Task 1.1: Choose a widget shape.",
  "•Skill 1.1.1: Comparing round and square widgets.",
  "Task 1.2: Size a widget.",
  "•Skill 1.2.1: Measuring a widget.",
  "Content Domain 2: Widget Operations",
  "Task 2.1: Operate a widget.",
  "•Skill 2.1.1: Turning a widget on.",
].join("\n");

describe("parseExamGuideOutline", () => {
  it("reads domains with their code, title, and stated weighting", () => {
    const outline = parseExamGuideOutline(fixture(TWO_DOMAIN_BODY));

    expect(outline.domains).toHaveLength(2);
    expect(outline.domains[0]).toMatchObject({
      code: "Domain 1",
      title: "Widget Design",
      weight: 60,
    });
    expect(outline.domains[1]).toMatchObject({
      code: "Domain 2",
      title: "Widget Operations",
      weight: 40,
    });
  });

  it("reads each task as a child of its domain", () => {
    const outline = parseExamGuideOutline(fixture(TWO_DOMAIN_BODY));

    expect(outline.domains[0]?.tasks.map((task) => task.code)).toEqual([
      "Task 1.1",
      "Task 1.2",
    ]);
    expect(outline.domains[1]?.tasks.map((task) => task.code)).toEqual([
      "Task 2.1",
    ]);
  });

  it("reads a task title verbatim", () => {
    const outline = parseExamGuideOutline(fixture(TWO_DOMAIN_BODY));

    expect(outline.domains[0]?.tasks[0]?.title).toBe("Choose a widget shape.");
  });

  it("flattens every task of every domain in guide order", () => {
    const outline = parseExamGuideOutline(fixture(TWO_DOMAIN_BODY));

    expect(outline.tasks.map((task) => task.code)).toEqual([
      "Task 1.1",
      "Task 1.2",
      "Task 2.1",
    ]);
  });

  it("keeps a fractional weighting as stated", () => {
    const text = [
      "Content outline",
      "This exam guide includes weightings and tasks.",
      "•Content Domain 1: Widget Design (12.5% of scored content)",
      "Content Domain 1: Widget Design",
      "Task 1.1: Choose a shape.",
      "Technologies and concepts that might appear on the exam",
    ].join("\n");

    expect(parseExamGuideOutline(text).domains[0]?.weight).toBe(12.5);
  });

  it("joins a domain title that wrapped across two lines", () => {
    const text = [
      "Content outline",
      "This exam guide includes weightings and tasks.",
      "•Content Domain 1: Widget Design and Assembly (100% of scored content)",
      "Content Domain 1: Widget Design and",
      "Assembly",
      "Task 1.1: Choose a shape.",
      "Technologies and concepts that might appear on the exam",
    ].join("\n");

    expect(parseExamGuideOutline(text).domains[0]?.title).toBe(
      "Widget Design and Assembly",
    );
  });

  it("joins a task title that wrapped across two lines", () => {
    const body = [
      "Content Domain 1: Widget Design",
      "Task 1.1: Choose a widget shape and justify the choice for",
      "downstream assembly.",
      "•Skill 1.1.1: Comparing shapes.",
    ].join("\n");

    expect(parseExamGuideOutline(fixture(body)).tasks[0]?.title).toBe(
      "Choose a widget shape and justify the choice for downstream assembly.",
    );
  });

  it("collects each task's skill statements as its description", () => {
    const body = [
      "Content Domain 1: Widget Design",
      "Task 1.1: Choose a widget shape.",
      "•Skill 1.1.1: Comparing round and square widgets.",
      "•Skill 1.1.2: Choosing a material.",
    ].join("\n");

    expect(parseExamGuideOutline(fixture(body)).tasks[0]?.description).toBe(
      "Comparing round and square widgets.\nChoosing a material.",
    );
  });

  it("drops the trailing example list from a skill statement", () => {
    // The guide appends a long service list to most skills. It is the bulk of its
    // verbatim wording and would overflow the objective description limit.
    const body = [
      "Content Domain 1: Widget Design",
      "Task 1.1: Choose a widget shape.",
      "•Skill 1.1.1: Comparing widget shapes (for example, by using a caliper, a ruler, or a template).",
    ].join("\n");

    expect(parseExamGuideOutline(fixture(body)).tasks[0]?.description).toBe(
      "Comparing widget shapes.",
    );
  });

  it("keeps a statement that mentions an example mid-sentence", () => {
    const body = [
      "Content Domain 1: Widget Design",
      "Task 1.1: Choose a widget shape.",
      "•Skill 1.1.1: Explaining the reference example to a colleague.",
    ].join("\n");

    expect(parseExamGuideOutline(fixture(body)).tasks[0]?.description).toBe(
      "Explaining the reference example to a colleague.",
    );
  });

  it("repairs ligatures in a title", () => {
    const body = [
      "Content Domain 1: Widget Design",
      "Task 1.1: Conﬁgure an eﬃcient widget.",
      "•Skill 1.1.1: Comparing shapes.",
    ].join("\n");

    expect(parseExamGuideOutline(fixture(body)).tasks[0]?.title).toBe(
      "Configure an efficient widget.",
    );
  });

  it("ignores a skill bullet that appears before any task", () => {
    const body = [
      "Content Domain 1: Widget Design",
      "•Skill 0.0.1: An orphan skill.",
      "Task 1.1: Choose a widget shape.",
      "•Skill 1.1.1: Comparing shapes.",
    ].join("\n");

    expect(parseExamGuideOutline(fixture(body)).tasks[0]?.description).toBe(
      "Comparing shapes.",
    );
  });

  it("rejects text with no outline section", () => {
    expect(() => parseExamGuideOutline("Some other document.")).toThrow(
      ExamGuideParseError,
    );
  });

  it("rejects an outline with no closing heading, rather than reading the appendix", () => {
    const text = [
      "Content outline",
      "This exam guide includes weightings and tasks.",
      "•Content Domain 1: Widget Design (100% of scored content)",
      "Content Domain 1: Widget Design",
      "Task 1.1: Choose a shape.",
    ].join("\n");

    expect(() => parseExamGuideOutline(text)).toThrow(ExamGuideParseError);
  });

  it("rejects an outline with no weighting bullets", () => {
    const text = [
      "Content outline",
      "This exam guide includes weightings and tasks.",
      "Content Domain 1: Widget Design",
      "Task 1.1: Choose a shape.",
      "Technologies and concepts that might appear on the exam",
    ].join("\n");

    expect(() => parseExamGuideOutline(text)).toThrow(ExamGuideParseError);
  });

  it("rejects a domain whose weighting was never stated", () => {
    const body = [
      "Content Domain 1: Widget Design",
      "Task 1.1: Choose a shape.",
      "Content Domain 3: Widget Disposal",
      "Task 3.1: Dispose of a widget.",
    ].join("\n");

    expect(() => parseExamGuideOutline(fixture(body))).toThrow(
      /Domain 3 has no stated weighting/,
    );
  });

  it("rejects a task numbered for a different domain than the one it sits in", () => {
    const body = [
      "Content Domain 1: Widget Design",
      "Task 2.1: Operate a widget.",
    ].join("\n");

    expect(() => parseExamGuideOutline(fixture(body))).toThrow(
      /Task 2.1 appears outside its content domain/,
    );
  });
});

describe("toOutlineLines", () => {
  it("drops the running page header", () => {
    const body = [
      "Content Domain 1: Widget Design",
      "AWS Certified Widget Design - Professional Exam Guide (WID-C01)",
      "Task 1.1: Choose a widget shape.",
    ].join("\n");

    expect(toOutlineLines(fixture(body))).not.toContain(
      "AWS Certified Widget Design - Professional Exam Guide (WID-C01)",
    );
  });

  it("drops a footer that repeats a heading with a page number", () => {
    const body = [
      "Content Domain 1: Widget Design",
      "Task 1.1: Choose a widget shape.",
      "Task 1.1: Choose a widget shape. 14",
      "•Skill 1.1.1: Comparing shapes.",
    ].join("\n");
    const lines = toOutlineLines(fixture(body));

    expect(lines).toContain("Task 1.1: Choose a widget shape.");
    expect(lines).not.toContain("Task 1.1: Choose a widget shape. 14");
  });

  it("drops a footer that repeats the outline heading with a page number", () => {
    const body = [
      "Content outline 7",
      "Content Domain 1: Widget Design",
      "Task 1.1: Choose a widget shape.",
    ].join("\n");

    expect(toOutlineLines(fixture(body))).not.toContain("Content outline 7");
  });

  it("keeps a wrapped line that legitimately ends in a number", () => {
    // The footer rule is narrow on purpose: only lines that already look like a
    // heading are dropped, so an ordinary sentence keeps its trailing figure.
    const body = [
      "Content Domain 1: Widget Design",
      "Task 1.1: Choose a widget shape.",
      "•Skill 1.1.1: Comparing widgets against reference model 42",
    ].join("\n");

    expect(toOutlineLines(fixture(body))).toContain(
      "•Skill 1.1.1: Comparing widgets against reference model 42",
    );
  });

  it("treats a page break as a line break rather than as content", () => {
    const text = fixture(
      [
        "Content Domain 1: Widget Design",
        "Task 1.1: Choose a widget shape and justify the choice for\fdownstream assembly.",
      ].join("\n"),
    );

    expect(parseExamGuideOutline(text).tasks[0]?.title).toBe(
      "Choose a widget shape and justify the choice for downstream assembly.",
    );
  });

  it("ignores an identical heading earlier in the table of contents", () => {
    // "Content outline" also appears as a contents entry, so the region is found
    // by the heading plus the sentence that follows it in the body.
    const text = [
      "Table of contents",
      "Content outline",
      "3",
      "Content outline",
      "This exam guide includes weightings and tasks.",
      "•Content Domain 1: Widget Design (100% of scored content)",
      "Content Domain 1: Widget Design",
      "Task 1.1: Choose a shape.",
      "Technologies and concepts that might appear on the exam",
    ].join("\n");

    expect(parseExamGuideOutline(text).domains).toHaveLength(1);
  });
});

describe("assertExamGuideOutlineSize", () => {
  const expectations = {
    domainCount: 2,
    minimumTaskCount: 2,
    maximumTaskCount: 4,
  };

  it("accepts an outline of the expected size", () => {
    const outline = parseExamGuideOutline(fixture(TWO_DOMAIN_BODY));

    expect(() =>
      assertExamGuideOutlineSize(outline, expectations),
    ).not.toThrow();
  });

  it("rejects an outline with the wrong number of domains", () => {
    const outline = parseExamGuideOutline(fixture(TWO_DOMAIN_BODY));

    expect(() =>
      assertExamGuideOutlineSize(outline, { ...expectations, domainCount: 5 }),
    ).toThrow(/Expected 5 content domains/);
  });

  it("rejects an outline with too few tasks", () => {
    const outline = parseExamGuideOutline(fixture(TWO_DOMAIN_BODY));

    expect(() =>
      assertExamGuideOutlineSize(outline, {
        ...expectations,
        minimumTaskCount: 10,
        maximumTaskCount: 20,
      }),
    ).toThrow(/Expected between 10 and 20 tasks/);
  });

  it("rejects an outline with too many tasks", () => {
    const outline = parseExamGuideOutline(fixture(TWO_DOMAIN_BODY));

    expect(() =>
      assertExamGuideOutlineSize(outline, {
        ...expectations,
        minimumTaskCount: 1,
        maximumTaskCount: 2,
      }),
    ).toThrow(/Expected between 1 and 2 tasks/);
  });

  it("rejects a domain that parsed with no tasks at all", () => {
    const body = [
      "Content Domain 1: Widget Design",
      "Task 1.1: Choose a widget shape.",
      "Task 1.2: Size a widget.",
      "Content Domain 2: Widget Operations",
    ].join("\n");
    const outline = parseExamGuideOutline(fixture(body));

    expect(() => assertExamGuideOutlineSize(outline, expectations)).toThrow(
      /Domain 2/,
    );
  });
});
