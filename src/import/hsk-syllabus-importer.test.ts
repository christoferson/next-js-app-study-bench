import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import { createMigratedDatabase } from "@/modules/certifications/infrastructure/test-support";
import type { ObjectiveTreeNode } from "@/modules/certifications/domain/objective";
import { createImportFacades } from "./composition";
import { parseHskExamStructure } from "./hsk-exam-structure-parser";
import { parseHskGrammarOutline } from "./hsk-grammar-parser";
import { parseHskThemeOutline } from "./hsk-theme-parser";
import { parseHskVocabularyList } from "./hsk-vocabulary-parser";
import {
  importHskVocabularyTrack,
  REAL_TRACK_SLUGS,
} from "./real-content-importer";
import {
  HskSyllabusImportError,
  importHskSyllabusObjectives,
  planHskSyllabusObjectives,
} from "./hsk-syllabus-importer";

/**
 * The syllabus importer, against a real migrated in-memory database.
 *
 * Driven through the same facades the script wires, so the imported hierarchy is
 * held to every domain rule: an objective pointing outside its track or under a
 * parent from another track would fail here.
 *
 * What matters about this import is the second run. The owner will re-run it after
 * editing their track, and it must not add a second copy of anything — and above
 * all it must not touch the vocabulary root or the cards mapped to it, which is
 * what the first run of `import:real` created.
 *
 * All fixtures are invented, as in the parser tests.
 */

const SYLLABUS_TEXT = [
  "1． 听力",
  "◎ 第一部分，共20题。考生做这一部分的题。",
  "◎ 第二部分，共25题。考生做这一部分的题。",
  "2． 阅读",
  "◎ 第一部分，共15题。考生做这一部分的题。",
  "◎ 第二部分，共10题。考生做这一部分的题。",
  "◎ 第三部分，共20题。考生做这一部分的题。",
  "3． 书写",
  "◎ 第一部分，共8题。考生做这一部分的题。",
  "◎ 第二部分，共2题。考生做这一部分的题。",
].join("\n");

const GRAMMAR_JSON = JSON.stringify([
  { 类别: "甲类", 类别名称: "甲一", 细目: "细目甲", 语法内容: "第一条" },
  { 类别: "甲类", 类别名称: "甲一", 细目: "", 语法内容: "第二条" },
  { 类别: "乙类", 类别名称: "", 细目: "", 语法内容: "第三条" },
]);

const THEMES_TEXT = [
  "## The 2 Core Topic Areas",
  "   1. Widget Care (甲甲甲): Cleaning widgets and storing them.",
  "   2. Widget Trade (乙乙乙): Buying widgets and selling widgets.",
  "## The 1 Core Language Tasks (Communication Objectives)",
  "   1. 丙丙丙 (Ordering Widgets): Asking for a widget by size.",
].join("\n");

const VOCABULARY_TEXT = [
  "#汉字 Pinyin POS English Register",
  "2001阿姨 āyí n. auntNeutral",
  "2002爱护 àihù v. to take good care ofWrittenNew",
].join("\n");

const HSK_SLUG = REAL_TRACK_SLUGS.hsk5Chinese;

/** The plan the fixtures produce: three skills, grammar, and two theme roots. */
function fixturePlan() {
  return planHskSyllabusObjectives({
    structure: parseHskExamStructure(SYLLABUS_TEXT),
    grammar: parseHskGrammarOutline(GRAMMAR_JSON),
    themes: parseHskThemeOutline(THEMES_TEXT),
  });
}

describe("planHskSyllabusObjectives", () => {
  it("plans six roots: three skills, grammar, topics, and tasks", () => {
    expect(fixturePlan().map((root) => root.title)).toEqual([
      "Listening",
      "Reading",
      "Writing",
      "Grammar",
      "Topics (unofficial)",
      "Language tasks (unofficial)",
    ]);
  });

  it("codes each skill root with the syllabus's own name for it", () => {
    expect(
      fixturePlan()
        .slice(0, 3)
        .map((root) => root.code),
    ).toEqual(["听力", "阅读", "书写"]);
  });

  it("weights each skill by its item count, which sums to the paper", () => {
    // Legitimate as a percentage only because the examination has exactly 100
    // items, which the structure assertion checks before this is reached.
    const weights = fixturePlan()
      .slice(0, 3)
      .map((root) => root.weight ?? 0);

    expect(weights).toEqual([45, 45, 10]);
    expect(weights.reduce((total, weight) => total + weight, 0)).toBe(100);
  });

  it("plans one child per part, titled with its item count", () => {
    expect(fixturePlan()[0]?.children.map((part) => part.title)).toEqual([
      "Part 1 (20 items)",
      "Part 2 (25 items)",
    ]);
  });

  it("keeps the syllabus's own format description on each part", () => {
    expect(fixturePlan()[0]?.children[0]?.description).toBe(
      "第一部分，共20题。考生做这一部分的题。",
    );
  });

  it("plans the grammar appendix three levels deep, a leaf per point", () => {
    const grammar = fixturePlan()[3];

    expect(grammar?.children.map((group) => group.title)).toEqual([
      "甲一",
      "乙类",
    ]);
    expect(grammar?.children[0]?.children.map((point) => point.title)).toEqual([
      "第一条",
      "第二条",
    ]);
  });

  it("titles a grammar leaf with the point and codes it with its group", () => {
    // A picker row then reads "甲一 — 第一条", which is what a drill request needs.
    expect(fixturePlan()[3]?.children[0]?.children[0]).toMatchObject({
      code: "甲一",
      title: "第一条",
      description: "细目甲",
    });
  });

  it("leaves a grammar leaf with no finer label undescribed", () => {
    expect(fixturePlan()[3]?.children[0]?.children[1]?.description).toBeNull();
  });

  it("titles a theme with both its Chinese name and its English gloss", () => {
    expect(fixturePlan()[4]?.children.map((theme) => theme.title)).toEqual([
      "甲甲甲 — Widget Care",
      "乙乙乙 — Widget Trade",
    ]);
    expect(fixturePlan()[5]?.children[0]?.title).toBe(
      "丙丙丙 — Ordering Widgets",
    );
  });

  it("keeps each theme's one-line description", () => {
    expect(fixturePlan()[4]?.children[0]?.description).toBe(
      "Cleaning widgets and storing them.",
    );
  });

  it("records the syllabus roots as coming from the official syllabus", () => {
    const sources = fixturePlan()
      .slice(0, 4)
      .flatMap((root) => [
        root.sourceType,
        ...root.children.flatMap((child) => [
          child.sourceType,
          ...child.children.map((leaf) => leaf.sourceType),
        ]),
      ]);

    expect(new Set(sources)).toEqual(new Set(["OFFICIAL_SYLLABUS"]));
  });

  it("records the themes as AI-proposed, never as official", () => {
    // The notes are a chatbot answer citing third-party sites, so labelling them
    // official would overstate their provenance.
    const sources = fixturePlan()
      .slice(4)
      .flatMap((root) => [
        root.sourceType,
        ...root.children.map((child) => child.sourceType),
      ]);

    expect(new Set(sources)).toEqual(new Set(["AI_PROPOSED"]));
  });

  it("says in the title that the theme roots are unofficial", () => {
    expect(fixturePlan()[4]?.title).toContain("unofficial");
    expect(fixturePlan()[5]?.title).toContain("unofficial");
  });
});

describe("importHskSyllabusObjectives", () => {
  let database: SqliteDatabase;
  let facades: ReturnType<typeof createImportFacades>;

  beforeEach(async () => {
    database = createMigratedDatabase();
    facades = createImportFacades(database);

    // The syllabus import extends the track the vocabulary import created, so
    // that import is the precondition for every case here.
    await importHskVocabularyTrack(
      facades,
      parseHskVocabularyList(VOCABULARY_TEXT),
      "An invented track description.",
    );
  });

  afterEach(() => {
    database.close();
  });

  const runImport = async (
    onRoot?: Parameters<typeof importHskSyllabusObjectives>[2],
  ) => importHskSyllabusObjectives(facades, fixturePlan(), onRoot);

  const treeOf = async (): Promise<readonly ObjectiveTreeNode[]> => {
    const detail = await facades.certifications.findDetailBySlug(HSK_SLUG);

    if (detail === null) {
      throw new Error(`No track at ${HSK_SLUG}.`);
    }

    return detail.objectiveTree;
  };

  it("adds the six roots beside the vocabulary root the earlier import created", async () => {
    await runImport();

    expect((await treeOf()).map((node) => node.objective.title)).toEqual([
      "HSK 5 vocabulary",
      "Listening",
      "Reading",
      "Writing",
      "Grammar",
      "Topics (unofficial)",
      "Language tasks (unofficial)",
    ]);
  });

  it("writes the whole hierarchy, counting the roots it created", async () => {
    const result = await runImport();

    // 3 skills + 7 parts, 1 grammar root + 2 groups + 3 points, 2 theme roots + 3
    // themes.
    expect(result.objectivesCreated).toBe(21);
    expect(result.roots).toHaveLength(6);
  });

  it("nests the parts under their skill", async () => {
    await runImport();

    const listening = (await treeOf()).find(
      (node) => node.objective.title === "Listening",
    );

    expect(listening?.children.map((node) => node.objective.title)).toEqual([
      "Part 1 (20 items)",
      "Part 2 (25 items)",
    ]);
  });

  it("nests the grammar points under their category group", async () => {
    await runImport();

    const grammar = (await treeOf()).find(
      (node) => node.objective.title === "Grammar",
    );

    expect(
      grammar?.children[0]?.children.map((node) => node.objective.title),
    ).toEqual(["第一条", "第二条"]);
  });

  it("leaves the vocabulary root and its cards untouched", async () => {
    const before = await facades.flashcards.findBankBySlug(HSK_SLUG, {
      lifecycle: null,
      type: null,
      objective: null,
      q: null,
      page: 1,
    });

    await runImport();

    const vocabulary = (await treeOf())[0];
    const after = await facades.flashcards.findBankBySlug(HSK_SLUG, {
      lifecycle: null,
      type: null,
      objective: vocabulary?.objective.id ?? "",
      q: null,
      page: 1,
    });

    expect(vocabulary?.objective.title).toBe("HSK 5 vocabulary");
    expect(vocabulary?.children).toEqual([]);
    expect(after?.totalCount).toBe(before?.totalCount);
    expect(after?.totalCount).toBe(2);
  });

  it("adds nothing on a re-run", async () => {
    await runImport();

    const second = await runImport();

    expect(second.objectivesCreated).toBe(0);
    expect(second.roots.every((root) => root.alreadyPresent)).toBe(true);
  });

  it("does not duplicate the hierarchy on a re-run", async () => {
    await runImport();
    await runImport();

    const tree = await treeOf();
    const grammar = tree.find((node) => node.objective.title === "Grammar");

    expect(tree).toHaveLength(7);
    expect(grammar?.children).toHaveLength(2);
  });

  it("recognises a root the owner has renamed, by its code", async () => {
    await runImport();

    const listening = (await treeOf()).find(
      (node) => node.objective.title === "Listening",
    );

    if (listening === undefined) {
      throw new Error("The listening root was not created.");
    }

    await facades.certifications.updateObjective(listening.objective.id, {
      parentObjectiveId: null,
      code: listening.objective.code,
      title: "Listening practice",
      description: listening.objective.description,
      weight: listening.objective.weight,
      sourceType: listening.objective.sourceType,
    });

    const second = await runImport();
    const listeningRoots = (await treeOf()).filter(
      (node) => node.objective.code === "听力",
    );

    expect(second.roots[0]?.alreadyPresent).toBe(true);
    expect(listeningRoots).toHaveLength(1);
  });

  it("recognises a root whose code the owner has cleared, by its title", async () => {
    await runImport();

    const reading = (await treeOf()).find(
      (node) => node.objective.title === "Reading",
    );

    if (reading === undefined) {
      throw new Error("The reading root was not created.");
    }

    await facades.certifications.updateObjective(reading.objective.id, {
      parentObjectiveId: null,
      code: null,
      title: "Reading",
      description: reading.objective.description,
      weight: reading.objective.weight,
      sourceType: reading.objective.sourceType,
    });

    const second = await runImport();

    expect(second.roots[1]?.alreadyPresent).toBe(true);
    expect(await treeOf()).toHaveLength(7);
  });

  it("treats an archived root as present, so archiving is not undone", async () => {
    await runImport();

    const writing = (await treeOf()).find(
      (node) => node.objective.title === "Writing",
    );

    if (writing === undefined) {
      throw new Error("The writing root was not created.");
    }

    await facades.certifications.archiveObjective(writing.objective.id);

    const second = await runImport();

    expect(second.roots[2]?.alreadyPresent).toBe(true);
  });

  it("adds the roots that are missing and skips the ones present", async () => {
    // An interrupted run is resumed by re-running: the roots already written are
    // reported as present, and the rest are created.
    const plan = fixturePlan();

    await importHskSyllabusObjectives(facades, plan.slice(0, 2));

    const second = await importHskSyllabusObjectives(facades, plan);

    expect(second.roots.map((root) => root.alreadyPresent)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(await treeOf()).toHaveLength(7);
  });

  it("reports each root as it is written", async () => {
    const reported: string[] = [];

    await runImport((root) => reported.push(root.title));

    expect(reported).toEqual([
      "Listening",
      "Reading",
      "Writing",
      "Grammar",
      "Topics (unofficial)",
      "Language tasks (unofficial)",
    ]);
  });

  it("refuses to run when the HSK track does not exist", async () => {
    const empty = createMigratedDatabase();

    try {
      await expect(
        importHskSyllabusObjectives(createImportFacades(empty), fixturePlan()),
      ).rejects.toThrow(HskSyllabusImportError);
    } finally {
      empty.close();
    }
  });

  it("leaves another track's objectives alone", async () => {
    const other = await facades.certifications.createCertification({
      name: "A track the owner wrote",
      provider: "Owner",
      examCode: null,
      version: null,
      studyType: "LANGUAGE_PROFICIENCY",
      description: "",
      targetDate: null,
      priority: 3,
      defaultSessionMinutes: 20,
    });

    await runImport();

    const detail = await facades.certifications.findDetailBySlug(other.slug);

    expect(detail?.objectiveTree).toEqual([]);
  });
});
