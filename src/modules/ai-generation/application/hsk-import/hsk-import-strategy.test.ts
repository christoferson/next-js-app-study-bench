import { describe, expect, it } from "vitest";
import { MAX_DETERMINISTIC_IMPORT_NODES } from "@/modules/ai-generation/domain/import-strategy";
import { checkProposedTree } from "@/modules/ai-generation/domain/objective-import";
import type { ProposedObjective } from "@/modules/ai-generation/domain/objective-import";
import { classifyHskFile, readHskImportFiles } from "./hsk-import-strategy";
import type { HskImportFile } from "./hsk-import-strategy";

/**
 * The HSK strategy: several uploaded files in, one proposed tree out.
 *
 * Every fixture here is invented, for the reason each parser's own test states: the
 * owner's syllabus, its grammar appendix, and their notes all stay in `external/` and are
 * never committed. What these fixtures imitate is the *layout* the parsers anchor on — a
 * numbered heading per skill with `◎` part bullets, four Chinese column names in a JSON
 * array, and two numbered lists under counted headings — with made-up content throughout.
 *
 * Three properties matter on this seam and none of them is a parser's job:
 *
 * - a file is recognised by its own contents, and an owner's explicit choice always wins;
 * - any subset of the three documents is a complete import, grammar alone included;
 * - the result is a `ProposedObjectiveTree` the ordinary confirm page can render, which
 *   means it has to satisfy the same validation an AI extraction's output does.
 */

const SYLLABUS = [
  "1． 听力",
  "◎ 第一部分，共20题。考生做这一部分的题。",
  "◎ 第二部分，共25题。考生做这一部分的题。",
  "2． 阅读",
  "◎ 第一部分，共15题。考生做这一部分的题。",
  "3． 书写",
  "◎ 第一部分，共10题。考生做这一部分的题。",
].join("\n");

const GRAMMAR = JSON.stringify([
  { 类别: "甲类", 类别名称: "甲一", 细目: "细目甲", 语法内容: "第一条" },
  { 类别: "甲类", 类别名称: "甲一", 细目: "", 语法内容: "第二条" },
  { 类别: "乙类", 类别名称: "乙一", 细目: "细目乙", 语法内容: "第三条" },
]);

const THEMES = [
  "Some preamble the parser skips.",
  "## The 2 Core Topic Areas",
  "",
  "   1. Widget Care (甲甲甲): Cleaning widgets and storing widgets.",
  "   2. Widget Trade (乙乙乙): Buying widgets and selling widgets.",
  "## The 2 Core Language Tasks (Communication Objectives)",
  "",
  "   1. 丙丙丙 (Ordering Widgets): Asking for a widget by size.",
  "   2. 丁丁丁 (Returning Widgets): Explaining a fault.",
].join("\n");

function file(
  filename: string,
  text: string,
  role: HskImportFile["role"] = null,
): HskImportFile {
  return { filename, text, role };
}

function titles(roots: readonly ProposedObjective[]): readonly string[] {
  return roots.map((root) => root.title);
}

describe("classifyHskFile", () => {
  it("recognises the grammar appendix by asking its parser", () => {
    // Not by sniffing the text: "is this the grammar table" and "can the grammar parser
    // read this" are the same question, and two answers to it is how a file gets
    // classified as grammar and then fails.
    expect(classifyHskFile(GRAMMAR)).toBe("GRAMMAR_APPENDIX");
  });

  it("recognises the syllabus structure by its skill headings and part bullets", () => {
    expect(classifyHskFile(SYLLABUS)).toBe("SYLLABUS_STRUCTURE");
  });

  it("recognises theme notes by their two counted headings", () => {
    expect(classifyHskFile(THEMES)).toBe("THEME_NOTES");
  });

  it("recognises nothing in an unrelated document", () => {
    expect(classifyHskFile("1. Domain One (40%)\n1.1 Describe a thing\n")).toBe(
      "UNRECOGNIZED",
    );
  });

  it("does not mistake prose that mentions the skills for the structure section", () => {
    // The skill names appear in the invigilation notes too. Both markers are required,
    // and the part bullets are what only the structure section has.
    expect(classifyHskFile("考试分听力、阅读和书写三部分。")).toBe(
      "UNRECOGNIZED",
    );
  });

  it("does not mistake JSON that is not the appendix for grammar", () => {
    expect(classifyHskFile('[{"word":"甲","reading":"jiǎ"}]')).toBe(
      "UNRECOGNIZED",
    );
  });
});

describe("readHskImportFiles", () => {
  describe("what each file is read as", () => {
    it("classifies every file when the owner chooses nothing", () => {
      const reading = readHskImportFiles([
        file("syllabus.txt", SYLLABUS),
        file("grammar.json", GRAMMAR),
        file("notes.md", THEMES),
      ]);

      expect(reading.files.map((one) => [one.role, one.roleWasChosen])).toEqual(
        [
          ["SYLLABUS_STRUCTURE", false],
          ["GRAMMAR_APPENDIX", false],
          ["THEME_NOTES", false],
        ],
      );
      expect(reading.files.every((one) => one.problem === null)).toBe(true);
    });

    it("uses the owner's chosen role instead of the guess", () => {
      // The override exists for the file classification gets wrong. Here it is pointed at
      // a document that would have been recognised as something else, and the result is
      // the owner's choice failing honestly rather than the guess quietly winning.
      const reading = readHskImportFiles([
        file("grammar.json", GRAMMAR, "SYLLABUS_STRUCTURE"),
      ]);

      expect(reading.files[0]?.role).toBe("SYLLABUS_STRUCTURE");
      expect(reading.files[0]?.roleWasChosen).toBe(true);
      expect(reading.files[0]?.problem).not.toBeNull();
    });

    it("leaves out a file the owner set to ignore, without complaining about it", () => {
      const reading = readHskImportFiles([
        file("grammar.json", GRAMMAR),
        file("scratch.txt", SYLLABUS, "IGNORE"),
      ]);

      expect(reading.files[1]?.role).toBe("IGNORE");
      expect(reading.files[1]?.problem).toBeNull();
      expect(titles(reading.roots)).toEqual(["Grammar"]);
    });

    it("says so when a file is not recognised, and imports the rest", () => {
      const reading = readHskImportFiles([
        file("grammar.json", GRAMMAR),
        file("cover-letter.txt", "Dear examinee, welcome to the examination."),
      ]);

      expect(reading.files[1]?.role).toBe("UNRECOGNIZED");
      expect(reading.files[1]?.problem).toMatch(/does not look like/i);
      expect(titles(reading.roots)).toEqual(["Grammar"]);
    });

    it("refuses a second file claiming a role another file already filled", () => {
      // Two syllabus texts in one submission means a mis-set role, and silently keeping
      // the first would import half of what the owner chose.
      const reading = readHskImportFiles([
        file("syllabus.txt", SYLLABUS),
        file("syllabus-copy.txt", SYLLABUS),
      ]);

      expect(reading.files[1]?.problem).toMatch(/already being read as/i);
      expect(titles(reading.roots)).toEqual([
        "Listening",
        "Reading",
        "Writing",
      ]);
    });

    it("reports a file that cannot be parsed as its role, and keeps the others", () => {
      const reading = readHskImportFiles([
        file("grammar.json", GRAMMAR),
        file("broken.json", '[{"类别":"甲类"}]', "GRAMMAR_APPENDIX"),
      ]);

      // The second is refused for the role the first already filled, which is the honest
      // reading: the first grammar file is the one being used.
      expect(reading.files[1]?.problem).not.toBeNull();
      expect(titles(reading.roots)).toEqual(["Grammar"]);
    });

    it("summarises what each file contributed, without quoting it", () => {
      const reading = readHskImportFiles([
        file("grammar.json", GRAMMAR),
        file("notes.md", THEMES),
      ]);

      expect(reading.files[0]?.summary).toMatch(/grammar point/i);
      expect(reading.files[1]?.summary).toMatch(/topic area/i);
      // Counts and roles, never a row's content: the summaries are shown to the owner and
      // the documents are somebody else's.
      expect(reading.files[0]?.summary).not.toContain("第一条");
      expect(reading.files[1]?.summary).not.toContain("Widget Care");
    });
  });

  describe("what any subset produces", () => {
    it("imports all three documents as one tree", () => {
      const reading = readHskImportFiles([
        file("syllabus.txt", SYLLABUS),
        file("grammar.json", GRAMMAR),
        file("notes.md", THEMES),
      ]);

      expect(titles(reading.roots)).toEqual([
        "Listening",
        "Reading",
        "Writing",
        "Grammar",
        "Topics (unofficial)",
        "Language tasks (unofficial)",
      ]);
    });

    it("imports the grammar appendix on its own", () => {
      // The case that motivated the whole strategy: the owner has the grammar JSON for a
      // level and has not extracted its syllabus text yet.
      const reading = readHskImportFiles([file("grammar.json", GRAMMAR)]);

      expect(titles(reading.roots)).toEqual(["Grammar"]);
      expect(reading.nodeCount).toBeGreaterThan(1);
    });

    it("imports the syllabus structure on its own", () => {
      const reading = readHskImportFiles([file("syllabus.txt", SYLLABUS)]);

      expect(titles(reading.roots)).toEqual([
        "Listening",
        "Reading",
        "Writing",
      ]);
    });

    it("imports theme notes on their own", () => {
      const reading = readHskImportFiles([file("notes.md", THEMES)]);

      expect(titles(reading.roots)).toEqual([
        "Topics (unofficial)",
        "Language tasks (unofficial)",
      ]);
    });

    it("proposes nothing at all when no file could be read", () => {
      const reading = readHskImportFiles([
        file("cover.txt", "Nothing structural in here."),
      ]);

      expect(reading.roots).toEqual([]);
      expect(reading.nodeCount).toBe(0);
    });
  });

  describe("the tree it produces", () => {
    it("nests parts under their skill and points under their category", () => {
      const reading = readHskImportFiles([
        file("syllabus.txt", SYLLABUS),
        file("grammar.json", GRAMMAR),
      ]);
      const listening = reading.roots[0];
      const grammar = reading.roots.find((root) => root.title === "Grammar");

      expect(listening?.title).toBe("Listening");
      expect(titles(listening?.children ?? [])).toEqual([
        "Part 1 (20 items)",
        "Part 2 (25 items)",
      ]);
      expect(titles(grammar?.children ?? [])).toEqual(["甲一", "乙一"]);
      expect(grammar?.children[0]?.children).toHaveLength(2);
    });

    it("counts every objective at every level", () => {
      const reading = readHskImportFiles([file("grammar.json", GRAMMAR)]);
      const counted = (nodes: readonly ProposedObjective[]): number =>
        nodes.reduce((total, node) => total + 1 + counted(node.children), 0);

      expect(reading.nodeCount).toBe(counted(reading.roots));
    });

    it("passes the same validation an AI extraction's tree must", () => {
      // The point of converting to `ProposedObjective` rather than inventing a second
      // shape: the confirm page, the run payload, and the apply step are all unchanged.
      const reading = readHskImportFiles([
        file("syllabus.txt", SYLLABUS),
        file("grammar.json", GRAMMAR),
        file("notes.md", THEMES),
      ]);

      expect(
        checkProposedTree(reading.roots, MAX_DETERMINISTIC_IMPORT_NODES),
      ).toEqual([]);
    });

    it("carries no source type, because the owner states one for the whole import", () => {
      const reading = readHskImportFiles([file("grammar.json", GRAMMAR)]);

      expect(reading.roots[0]).not.toHaveProperty("sourceType");
    });

    it("keeps a repeated sibling code on the first only", () => {
      // The plan codes every grammar leaf with its group's name, which the import's own
      // validation refuses among siblings — two objectives claiming the same code would
      // be claiming to be the same section. The parent already carries the heading, so the
      // duplicate is cleared rather than made unique with an invented suffix.
      const reading = readHskImportFiles([file("grammar.json", GRAMMAR)]);
      const group = reading.roots[0]?.children[0];

      expect(group?.children.map((point) => point.code)).toEqual([
        "甲一",
        null,
      ]);
      expect(group?.children.map((point) => point.title)).toEqual([
        "第一条",
        "第二条",
      ]);
    });
  });
});
