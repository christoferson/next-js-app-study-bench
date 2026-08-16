import { describe, expect, it } from "vitest";
import {
  assertHskGrammarOutlineSize,
  HskGrammarParseError,
  parseHskGrammarOutline,
} from "./grammar-parser";

/**
 * Every fixture in this file is invented.
 *
 * The parser reads the owner's own copy of the HSK 5 syllabus grammar appendix,
 * which stays in `external/` and is never committed, so these fixtures imitate its
 * *shape* — four Chinese column names, one row per point — with made-up categories
 * and made-up points. The Chinese here is either a column name, which is
 * structural and appears in the parser itself, or an invented placeholder. No
 * grammar point from the real appendix is in this repository.
 */

interface Row {
  readonly 类别: string;
  readonly 类别名称: string;
  readonly 细目: string;
  readonly 语法内容: string;
}

function row(
  category: string,
  name: string,
  detail: string,
  content: string,
): Row {
  return {
    类别: category,
    类别名称: name,
    细目: detail,
    语法内容: content,
  };
}

/** Two categories, one of which has two sub-categories and one unnamed row. */
const FIXTURE: readonly Row[] = [
  row("甲类", "甲一", "细目甲", "第一条"),
  row("甲类", "甲一", "", "第二条"),
  row("甲类", "甲二", "细目乙", "第三条"),
  row("乙类", "", "", "第四条"),
];

function fixture(rows: readonly Row[] = FIXTURE): string {
  return JSON.stringify(rows);
}

describe("parseHskGrammarOutline", () => {
  it("groups points by category and sub-category together", () => {
    // Category alone would put unrelated sub-categories in one bucket, and 细目
    // is too fine to be a study objective.
    const outline = parseHskGrammarOutline(fixture());

    expect(
      outline.groups.map((group) => [
        group.category,
        group.name,
        group.points.length,
      ]),
    ).toEqual([
      ["甲类", "甲一", 2],
      ["甲类", "甲二", 1],
      ["乙类", "乙类", 1],
    ]);
  });

  it("keeps groups in the order they first appear", () => {
    const outline = parseHskGrammarOutline(
      fixture([
        row("乙类", "乙一", "", "第一条"),
        row("甲类", "甲一", "", "第二条"),
        row("乙类", "乙一", "", "第三条"),
      ]),
    );

    expect(outline.groups.map((group) => group.name)).toEqual(["乙一", "甲一"]);
    expect(outline.groups[0]?.points).toHaveLength(2);
  });

  it("names a group after its category when the appendix leaves the name empty", () => {
    // One category in the real appendix has no sub-category name at all. Falling
    // back to the category is better than inventing a label for it.
    const outline = parseHskGrammarOutline(fixture());

    expect(outline.groups[2]).toMatchObject({
      category: "乙类",
      name: "乙类",
    });
  });

  it("reads each point's content and finer label", () => {
    const outline = parseHskGrammarOutline(fixture());

    expect(outline.groups[0]?.points[0]).toMatchObject({
      content: "第一条",
      detail: "细目甲",
    });
  });

  it("keeps an empty finer label empty rather than inventing one", () => {
    const outline = parseHskGrammarOutline(fixture());

    expect(outline.groups[0]?.points[1]?.detail).toBe("");
  });

  it("records each point's position in the appendix, so it can be traced back", () => {
    const outline = parseHskGrammarOutline(fixture());

    expect(
      outline.groups.flatMap((group) =>
        group.points.map((point) => point.position),
      ),
    ).toEqual([1, 2, 3, 4]);
  });

  it("counts every point across every group", () => {
    expect(parseHskGrammarOutline(fixture()).pointCount).toBe(4);
  });

  it("trims the whitespace a re-export leaves in a column", () => {
    const outline = parseHskGrammarOutline(
      fixture([row("  甲类 ", " 甲一", " 细目甲 ", "  第一条 ")]),
    );

    expect(outline.groups[0]).toMatchObject({ category: "甲类", name: "甲一" });
    expect(outline.groups[0]?.points[0]).toMatchObject({
      detail: "细目甲",
      content: "第一条",
    });
  });

  it("ignores a column the appendix has gained", () => {
    const outline = parseHskGrammarOutline(
      JSON.stringify([
        { ...row("甲类", "甲一", "", "第一条"), 备注: "something" },
      ]),
    );

    expect(outline.pointCount).toBe(1);
  });

  it("rejects a file that is not JSON", () => {
    expect(() => parseHskGrammarOutline("not json at all")).toThrow(
      HskGrammarParseError,
    );
  });

  it("rejects a table whose columns have been renamed", () => {
    expect(() =>
      parseHskGrammarOutline(
        JSON.stringify([{ category: "甲类", content: "第一条" }]),
      ),
    ).toThrow(HskGrammarParseError);
  });

  it("rejects a row with no category, naming the column and the row", () => {
    expect(() =>
      parseHskGrammarOutline(fixture([row("", "甲一", "", "第一条")])),
    ).toThrow(/Row 1 .*类别/u);
  });

  it("rejects a row with no grammar point", () => {
    expect(() =>
      parseHskGrammarOutline(fixture([row("甲类", "甲一", "", "  ")])),
    ).toThrow(/语法内容/u);
  });

  it("quotes no column value when a column is missing", () => {
    // An import failure must not print the owner's document to a log.
    try {
      parseHskGrammarOutline(JSON.stringify([{ 类别: 42 }]));
      expect.unreachable("The parse should have failed.");
    } catch (error) {
      expect((error as Error).message).not.toContain("42");
    }
  });
});

describe("assertHskGrammarOutlineSize", () => {
  const expectations = { pointCount: 4 } as const;

  it("accepts an appendix of exactly the expected size", () => {
    expect(() =>
      assertHskGrammarOutlineSize(
        parseHskGrammarOutline(fixture()),
        expectations,
      ),
    ).not.toThrow();
  });

  it("rejects an appendix with a point missing", () => {
    expect(() =>
      assertHskGrammarOutlineSize(
        parseHskGrammarOutline(fixture(FIXTURE.slice(0, 3))),
        expectations,
      ),
    ).toThrow(/Read 3 grammar point/u);
  });

  it("rejects an appendix with a point too many", () => {
    expect(() =>
      assertHskGrammarOutlineSize(
        parseHskGrammarOutline(
          fixture([...FIXTURE, row("丙类", "丙一", "", "第五条")]),
        ),
        expectations,
      ),
    ).toThrow(/Read 5 grammar point/u);
  });

  it("rejects an empty appendix", () => {
    expect(() =>
      assertHskGrammarOutlineSize(parseHskGrammarOutline("[]"), {
        pointCount: 0,
      }),
    ).toThrow(/no groups/u);
  });
});
