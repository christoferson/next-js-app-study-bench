import { describe, expect, it } from "vitest";
import {
  assertHskExamStructureSize,
  HskExamStructureParseError,
  parseHskExamStructure,
  toStructureLines,
} from "./exam-structure-parser";

/**
 * Every fixture in this file is invented.
 *
 * The parser reads the owner's own copy of the HSK 5 syllabus, which stays in
 * `external/` and is never committed, so these fixtures imitate its *layout* — a
 * numbered heading per skill, then one `◎` bullet per part — with made-up format
 * descriptions. The Chinese that appears is either structural (the three skill
 * names and the part ordinals, both of which the parser itself anchors on) or an
 * invented placeholder sentence. No sentence of the real syllabus is here.
 */

/** An invented part description, ending in the full stop that closes a bullet. */
const DESCRIPTION = "考生做这一部分的题。";

function bullet(
  ordinal: string,
  itemCount: number,
  tail = DESCRIPTION,
): string {
  return `◎ 第${ordinal}部分，共${itemCount}题。${tail}`;
}

/**
 * The same bullet as a `pdf.js` extraction writes it.
 *
 * The two extractions of a CJK page do not agree about spacing around a number:
 * `pypdf` writes `共20题`, and `pdf.js` — which is what the web upload path uses via
 * `unpdf` — puts a space either side of the digits, because the font switches for
 * them and that ends a text item. This was a real import failure: the parser matched
 * one flavour and not the other, so an uploaded syllabus produced three skill
 * headings with no parts under them.
 */
function spacedBullet(
  ordinal: string,
  itemCount: number,
  tail = DESCRIPTION,
): string {
  return `◎ 第${ordinal}部分，共 ${itemCount} 题。${tail}`;
}

const LISTENING = ["1． 听力", bullet("一", 20), bullet("二", 25)];
const READING = [
  "2． 阅读",
  bullet("一", 15),
  bullet("二", 10),
  bullet("三", 20),
];
const WRITING = ["3． 书写", bullet("一", 8), bullet("二", 2)];

const EXPECTATIONS = {
  partCounts: { LISTENING: 2, READING: 3, WRITING: 2 },
  totalItemCount: 100,
} as const;

function fixture(lines: readonly string[]): string {
  return lines.join("\n");
}

const WHOLE = fixture([...LISTENING, ...READING, ...WRITING]);

/** The whole document in the other extraction's spacing, and nothing else changed. */
const WHOLE_SPACED = fixture([
  "1． 听力",
  spacedBullet("一", 20),
  spacedBullet("二", 25),
  "2． 阅读",
  spacedBullet("一", 15),
  spacedBullet("二", 10),
  spacedBullet("三", 20),
  "3． 书写",
  spacedBullet("一", 8),
  spacedBullet("二", 2),
]);

describe("parseHskExamStructure", () => {
  it("reads the three skill sections in document order", () => {
    const structure = parseHskExamStructure(WHOLE);

    expect(structure.skills.map((skill) => skill.kind)).toEqual([
      "LISTENING",
      "READING",
      "WRITING",
    ]);
  });

  it("records each skill under the syllabus's own name for it", () => {
    const structure = parseHskExamStructure(WHOLE);

    expect(structure.skills.map((skill) => skill.code)).toEqual([
      "听力",
      "阅读",
      "书写",
    ]);
  });

  it("reads each part's ordinal as a position", () => {
    const structure = parseHskExamStructure(WHOLE);

    expect(structure.skills[1]?.parts.map((part) => part.position)).toEqual([
      1, 2, 3,
    ]);
  });

  it("reads each part's stated item count", () => {
    const structure = parseHskExamStructure(WHOLE);

    expect(structure.skills[0]?.parts.map((part) => part.itemCount)).toEqual([
      20, 25,
    ]);
  });

  it("adds every part's item count up", () => {
    expect(parseHskExamStructure(WHOLE).totalItemCount).toBe(100);
  });

  it("keeps the part's format description, without the bullet marker", () => {
    const structure = parseHskExamStructure(WHOLE);

    expect(structure.skills[2]?.parts[0]?.description).toBe(
      `第一部分，共8题。${DESCRIPTION}`,
    );
  });

  it("rejoins a description that wrapped across lines", () => {
    // A continuation line carries nothing identifying it, so a bullet is treated
    // as continuing until its text ends in a full stop.
    const structure = parseHskExamStructure(
      fixture([
        "1． 听力",
        // The first bullet's sentence is left open, so the next two lines belong
        // to it.
        bullet("一", 20, "考生先做这一部分，"),
        "然后再做下一部分，",
        "最后交卷。",
        bullet("二", 25),
        ...READING,
        ...WRITING,
      ]),
    );

    expect(structure.skills[0]?.parts).toHaveLength(2);
    expect(structure.skills[0]?.parts[0]?.description).toBe(
      "第一部分，共20题。考生先做这一部分，然后再做下一部分，最后交卷。",
    );
  });

  it("ignores a later mention of a skill name in the prose", () => {
    // The skill names recur in the invigilation script further down the document.
    // A heading for a skill that already has parts must not append to it.
    const structure = parseHskExamStructure(
      fixture([
        ...LISTENING,
        ...READING,
        ...WRITING,
        "现在开始听力",
        "考生请注意这一句不属于任何部分。",
      ]),
    );

    expect(structure.skills[0]?.parts).toHaveLength(2);
    expect(structure.totalItemCount).toBe(100);
  });

  it("ignores a bullet before any skill heading", () => {
    const structure = parseHskExamStructure(
      fixture([bullet("一", 99), ...LISTENING, ...READING, ...WRITING]),
    );

    expect(structure.totalItemCount).toBe(100);
  });

  it("reads a heading with the running header glued to the front of it", () => {
    const structure = parseHskExamStructure(
      fixture([
        `│HSK考试大纲  五级│ 41． 听力`,
        bullet("一", 20),
        bullet("二", 25),
        ...READING,
        ...WRITING,
      ]),
    );

    expect(structure.skills[0]?.parts).toHaveLength(2);
  });

  it("rejects a part numbered with an ordinal it does not know", () => {
    expect(() =>
      parseHskExamStructure(
        fixture(["1． 听力", "◎ 第十一部分，共20题。考生做题。"]),
      ),
    ).toThrow(HskExamStructureParseError);
  });
});

describe("toStructureLines", () => {
  it("strips a running header and the page number after it", () => {
    expect(toStructureLines("│HSK考试大纲  五级│ 41． 听力")).toEqual([
      "． 听力",
    ]);
  });

  it("drops a line that is only a page number", () => {
    expect(toStructureLines("42\n听力")).toEqual(["听力"]);
  });

  it("treats a form feed as a line break rather than content", () => {
    expect(toStructureLines("听力\f阅读")).toEqual(["听力", "阅读"]);
  });

  it("collapses the tabs and doubled spaces the extraction leaves behind", () => {
    expect(toStructureLines("◎ 第一部分，\t共20题。")).toEqual([
      "◎ 第一部分， 共20题。",
    ]);
  });
});

describe("assertHskExamStructureSize", () => {
  it("accepts a structure that matches what the examination states", () => {
    expect(() =>
      assertHskExamStructureSize(parseHskExamStructure(WHOLE), EXPECTATIONS),
    ).not.toThrow();
  });

  it("rejects a document with a skill section missing", () => {
    expect(() =>
      assertHskExamStructureSize(
        parseHskExamStructure(fixture([...LISTENING, ...READING])),
        EXPECTATIONS,
      ),
    ).toThrow(/Expected 3 skill sections/u);
  });

  it("rejects a skill with the wrong number of parts", () => {
    expect(() =>
      assertHskExamStructureSize(
        parseHskExamStructure(
          fixture(["1． 听力", bullet("一", 45), ...READING, ...WRITING]),
        ),
        EXPECTATIONS,
      ),
    ).toThrow(/Expected 2 part\(s\) in the listening section/u);
  });

  it("rejects parts numbered out of sequence", () => {
    expect(() =>
      assertHskExamStructureSize(
        parseHskExamStructure(
          fixture([
            "1． 听力",
            bullet("一", 20),
            bullet("三", 25),
            ...READING,
            ...WRITING,
          ]),
        ),
        EXPECTATIONS,
      ),
    ).toThrow(/numbered 1, 3/u);
  });

  it("rejects a structure whose parts do not add up to the examination's length", () => {
    expect(() =>
      assertHskExamStructureSize(
        parseHskExamStructure(
          fixture([
            "1． 听力",
            bullet("一", 20),
            bullet("二", 24),
            ...READING,
            ...WRITING,
          ]),
        ),
        EXPECTATIONS,
      ),
    ).toThrow(/add up to 99 items, not the 100/u);
  });

  it("rejects a skill section that has no parts under it", () => {
    // The exact shape the failed web import produced: three headings found, no
    // bullets read. It must name itself rather than arrive as a part count.
    expect(() =>
      assertHskExamStructureSize(
        parseHskExamStructure(fixture(["1． 听力", "2． 阅读", "3． 书写"])),
        EXPECTATIONS,
      ),
    ).toThrow(/listening section was found but no part bullets/u);
  });

  it("rejects a structure whose parts state no items at all", () => {
    expect(() =>
      assertHskExamStructureSize(
        {
          skills: [
            { kind: "LISTENING", code: "听力", parts: zeroParts(2) },
            { kind: "READING", code: "阅读", parts: zeroParts(3) },
            { kind: "WRITING", code: "书写", parts: zeroParts(2) },
          ],
          totalItemCount: 0,
        },
        EXPECTATIONS,
      ),
    ).toThrow(/add up to no items at all/u);
  });
});

/** Parts that parsed but carry no count, for the zero-item assertion. */
function zeroParts(count: number): readonly {
  code: string;
  position: number;
  itemCount: number;
  description: string;
}[] {
  return Array.from({ length: count }, (_unused, index) => ({
    code: `第${ORDINALS_FOR_TEST[index] ?? "一"}部分`,
    position: index + 1,
    itemCount: 0,
    description: DESCRIPTION,
  }));
}

const ORDINALS_FOR_TEST = ["一", "二", "三"];

/**
 * The same document in both extractions' spacing.
 *
 * The point of this block is the last assertion: the two flavours must parse to the
 * *identical* structure, not merely both parse. Anything less and the import would
 * still depend on which library read the PDF.
 */
describe("parseHskExamStructure across extraction flavours", () => {
  it("reads the parts of a pdf.js extraction that spaces its item counts", () => {
    const structure = parseHskExamStructure(WHOLE_SPACED);

    expect(structure.skills.map((skill) => skill.parts.length)).toEqual([
      2, 3, 2,
    ]);
  });

  it("reads the item counts a pdf.js extraction spaces apart", () => {
    expect(parseHskExamStructure(WHOLE_SPACED).totalItemCount).toBe(100);
  });

  it("parses both extractions to the identical structure", () => {
    expect(parseHskExamStructure(WHOLE_SPACED)).toEqual(
      parseHskExamStructure(WHOLE),
    );
  });

  it("accepts a pdf.js extraction against the examination's own counts", () => {
    expect(() =>
      assertHskExamStructureSize(
        parseHskExamStructure(WHOLE_SPACED),
        EXPECTATIONS,
      ),
    ).not.toThrow();
  });

  it("closes the spacing before a part bullet is matched", () => {
    expect(toStructureLines("◎ 第一部分，共 20 题。")).toEqual([
      "◎ 第一部分，共20题。",
    ]);
  });

  it("leaves a Latin heading's spacing alone", () => {
    expect(toStructureLines("HSK 5 syllabus, Domain 1: 22%")).toEqual([
      "HSK 5 syllabus, Domain 1: 22%",
    ]);
  });
});
