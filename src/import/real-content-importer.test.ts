import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import { createMigratedDatabase } from "@/modules/certifications/infrastructure/test-support";
import { parseExamGuideOutline } from "./exam-guide-parser";
import type { ExamGuideOutline } from "./exam-guide-parser";
import { parseHskVocabularyList } from "./hsk-vocabulary-parser";
import type {
  HskVocabularyEntry,
  HskVocabularyList,
} from "./hsk-vocabulary-parser";
import { createImportFacades } from "./composition";
import {
  CARD_CHUNK_SIZE,
  importExamGuideTrack,
  importHskVocabularyTrack,
  REAL_TRACK_SLUGS,
  toVocabularyCardInput,
} from "./real-content-importer";
import type { ImportProgress } from "./real-content-importer";

/**
 * The importer, against a real migrated in-memory database.
 *
 * Driven through the same facades the script wires, so imported content is held
 * to every domain invariant: a card with no meaning or an objective pointing
 * outside its track would fail here rather than in the owner's bank.
 *
 * What matters about an import is not the first run but the second — the owner
 * will re-run `npm run import:real` after editing their tracks, and it must not
 * add a second copy of anything — so every case checks a re-run too.
 *
 * All fixtures are invented, as in the parser tests: the real documents stay in
 * `external/` and none of their content is in this repository.
 */

const GUIDE_TEXT = [
  "Content outline",
  "This exam guide includes weightings, content domains, and tasks.",
  "•Content Domain 1: Widget Design (60% of scored content)",
  "•Content Domain 2: Widget Operations (40% of scored content)",
  "Content Domain 1: Widget Design",
  "Task 1.1: Choose a widget shape.",
  "•Skill 1.1.1: Comparing round and square widgets.",
  "Task 1.2: Size a widget.",
  "•Skill 1.2.1: Measuring a widget.",
  "Content Domain 2: Widget Operations",
  "Task 2.1: Operate a widget.",
  "•Skill 2.1.1: Turning a widget on.",
  "Technologies and concepts that might appear on the exam",
].join("\n");

const VOCABULARY_TEXT = [
  "#汉字 Pinyin POS English Register",
  "2001阿姨 āyí n. auntNeutral",
  "2002爱护 àihù v. to take good care ofWrittenNew",
  "2003安装 ānzhuāng v. to installNeutral",
  "Page 1 / 40",
].join("\n");

const AWS_SLUG = REAL_TRACK_SLUGS.awsGenerativeAiProfessional;
const HSK_SLUG = REAL_TRACK_SLUGS.hsk5Chinese;

describe("real content import", () => {
  let database: SqliteDatabase;
  let facades: ReturnType<typeof createImportFacades>;
  let outline: ExamGuideOutline;
  let vocabulary: HskVocabularyList;

  beforeEach(() => {
    database = createMigratedDatabase();
    facades = createImportFacades(database);
    outline = parseExamGuideOutline(GUIDE_TEXT);
    vocabulary = parseHskVocabularyList(VOCABULARY_TEXT);
  });

  afterEach(() => {
    database.close();
  });

  const importGuide = async () =>
    importExamGuideTrack(facades, outline, "An invented track description.");

  const importVocabulary = async (onProgress?: (p: ImportProgress) => void) =>
    importHskVocabularyTrack(
      facades,
      vocabulary,
      "An invented track description.",
      onProgress,
    );

  const objectivesOf = async (slug: string) => {
    const detail = await facades.certifications.findDetailBySlug(slug);

    if (detail === null) {
      throw new Error(`No track at ${slug}.`);
    }

    return detail;
  };

  describe("the exam guide track", () => {
    it("creates the track at a slug distinct from the demo track", () => {
      // The demo track occupies the exam-code slug; the real one must not collide
      // with it and silently gain a numeric suffix.
      expect(AWS_SLUG).toBe(
        "aws-certified-generative-ai-developer-professional",
      );
      expect(AWS_SLUG).not.toBe(
        "aws-certified-generative-ai-developer-professional-aip-c01",
      );
    });

    it("records the exam code, provider, and study type", async () => {
      await importGuide();

      const { certification } = await objectivesOf(AWS_SLUG);

      expect(certification).toMatchObject({
        examCode: "AIP-C01",
        provider: "AWS",
        studyType: "TECHNICAL_CERTIFICATION",
      });
    });

    it("creates one root objective per content domain, carrying its weight", async () => {
      await importGuide();

      const { objectiveTree } = await objectivesOf(AWS_SLUG);

      expect(
        objectiveTree.map((node) => [
          node.objective.code,
          node.objective.weight,
        ]),
      ).toEqual([
        ["Domain 1", 60],
        ["Domain 2", 40],
      ]);
    });

    it("creates one child objective per task, under its own domain", async () => {
      await importGuide();

      const { objectiveTree } = await objectivesOf(AWS_SLUG);

      expect(
        objectiveTree[0]?.children.map((node) => node.objective.code),
      ).toEqual(["Task 1.1", "Task 1.2"]);
      expect(
        objectiveTree[1]?.children.map((node) => node.objective.code),
      ).toEqual(["Task 2.1"]);
    });

    it("records the domains and tasks as coming from the official syllabus", async () => {
      await importGuide();

      const { objectiveTree } = await objectivesOf(AWS_SLUG);
      const sources = objectiveTree.flatMap((node) => [
        node.objective.sourceType,
        ...node.children.map((child) => child.objective.sourceType),
      ]);

      expect(new Set(sources)).toEqual(new Set(["OFFICIAL_SYLLABUS"]));
    });

    it("keeps each task's skill statements as its description", async () => {
      await importGuide();

      const { objectiveTree } = await objectivesOf(AWS_SLUG);

      expect(objectiveTree[0]?.children[0]?.objective.description).toBe(
        "Comparing round and square widgets.",
      );
    });

    it("imports no questions: the guide contains none", async () => {
      const result = await importGuide();
      const { certification } = await objectivesOf(AWS_SLUG);
      const bank = await facades.flashcards.countBank(certification.id);

      expect(result.flashcardsCreated).toBe(0);
      expect(bank.total).toBe(0);
    });

    it("reports what it created", async () => {
      const result = await importGuide();

      expect(result).toMatchObject({
        slug: AWS_SLUG,
        alreadyImported: false,
        rootObjectivesCreated: 2,
        childObjectivesCreated: 3,
      });
    });

    it("leaves the track untouched on a re-run", async () => {
      await importGuide();

      const before = await objectivesOf(AWS_SLUG);
      const second = await importGuide();
      const after = await objectivesOf(AWS_SLUG);

      expect(second).toMatchObject({
        alreadyImported: true,
        rootObjectivesCreated: 0,
        childObjectivesCreated: 0,
      });
      expect(after.activeObjectiveCount).toBe(before.activeObjectiveCount);
    });

    it("does not duplicate objectives on a re-run", async () => {
      await importGuide();
      await importGuide();

      const { objectiveTree } = await objectivesOf(AWS_SLUG);

      expect(objectiveTree).toHaveLength(2);
      expect(objectiveTree[0]?.children).toHaveLength(2);
    });
  });

  describe("the vocabulary track", () => {
    it("creates the track at a slug distinct from the demo track", () => {
      expect(HSK_SLUG).toBe("hsk-5-chinese");
      expect(HSK_SLUG).not.toBe("hsk-chinese-demo-track");
    });

    it("records the provider and study type", async () => {
      await importVocabulary();

      const { certification } = await objectivesOf(HSK_SLUG);

      expect(certification).toMatchObject({
        provider: "HSK",
        studyType: "LANGUAGE_PROFICIENCY",
      });
    });

    it("creates one flat vocabulary objective", async () => {
      await importVocabulary();

      const { objectiveTree } = await objectivesOf(HSK_SLUG);

      expect(objectiveTree).toHaveLength(1);
      expect(objectiveTree[0]?.objective.title).toBe("HSK 5 vocabulary");
      expect(objectiveTree[0]?.children).toEqual([]);
    });

    it("records the objective as imported rather than as an official syllabus", async () => {
      // The word list is a third-party compilation, so claiming official
      // provenance would overstate how much the owner should trust it.
      await importVocabulary();

      const { objectiveTree } = await objectivesOf(HSK_SLUG);

      expect(objectiveTree[0]?.objective.sourceType).toBe("IMPORTED");
    });

    it("creates one card per word", async () => {
      const result = await importVocabulary();
      const { certification } = await objectivesOf(HSK_SLUG);
      const bank = await facades.flashcards.countBank(certification.id);

      expect(result.flashcardsCreated).toBe(3);
      expect(bank.total).toBe(3);
    });

    it("activates every card, so the review queue is not empty on the first run", async () => {
      await importVocabulary();

      const { certification } = await objectivesOf(HSK_SLUG);
      const bank = await facades.flashcards.countBank(certification.id);

      expect(bank.active).toBe(3);
    });

    it("maps every card to the vocabulary objective", async () => {
      await importVocabulary();

      const { objectiveTree } = await objectivesOf(HSK_SLUG);
      const objectiveId = objectiveTree[0]?.objective.id ?? "";
      const bank = await facades.flashcards.findBankBySlug(HSK_SLUG, {
        lifecycle: null,
        type: null,
        objective: objectiveId,
        q: null,
        page: 1,
      });

      expect(bank?.totalCount).toBe(3);
    });

    it("stores the word, its reading, and its meaning on the card", async () => {
      await importVocabulary();

      const bank = await facades.flashcards.findBankBySlug(HSK_SLUG, {
        lifecycle: null,
        type: null,
        objective: null,
        q: "阿姨",
        page: 1,
      });

      expect(bank?.items).toHaveLength(1);
      expect(bank?.items[0]?.revision.content).toMatchObject({
        type: "VOCABULARY",
        term: "阿姨",
        reading: "āyí",
        meaning: "(n.) aunt",
      });
    });

    it("reports progress once at the end of a list shorter than a chunk", async () => {
      const reports: ImportProgress[] = [];

      await importVocabulary((progress) => reports.push(progress));

      expect(reports).toEqual([
        { slug: HSK_SLUG, cardsWritten: 3, cardsTotal: 3 },
      ]);
    });

    it("reports progress every chunk and once at the end", async () => {
      // Built from the fixture rather than from the real list: what is under test
      // is the reporting cadence, not the vocabulary.
      const entry = vocabulary.entries[0];

      if (entry === undefined) {
        throw new Error("The fixture parsed no entries.");
      }

      const total = CARD_CHUNK_SIZE + 5;
      const entries: HskVocabularyEntry[] = Array.from(
        { length: total },
        (_unused, index) => ({ ...entry, number: 3000 + index }),
      );
      const reports: ImportProgress[] = [];

      await importHskVocabularyTrack(
        facades,
        { ...vocabulary, entries },
        "An invented track description.",
        (progress) => reports.push(progress),
      );

      expect(reports.map((report) => report.cardsWritten)).toEqual([
        CARD_CHUNK_SIZE,
        total,
      ]);
    });

    it("leaves the bank untouched on a re-run", async () => {
      await importVocabulary();

      const second = await importVocabulary();
      const { certification } = await objectivesOf(HSK_SLUG);
      const bank = await facades.flashcards.countBank(certification.id);

      expect(second).toMatchObject({
        alreadyImported: true,
        flashcardsCreated: 0,
      });
      expect(bank.total).toBe(3);
    });
  });

  describe("both tracks", () => {
    it("imports each track independently, so one already present does not block the other", async () => {
      await importGuide();

      const guideAgain = await importGuide();
      const vocabularyFirst = await importVocabulary();

      expect(guideAgain.alreadyImported).toBe(true);
      expect(vocabularyFirst.alreadyImported).toBe(false);
    });

    it("leaves content the owner already had alone", async () => {
      const existing = await facades.certifications.createCertification({
        name: "A track the owner wrote",
        provider: "Owner",
        examCode: null,
        version: null,
        studyType: "TECHNICAL_CERTIFICATION",
        description: "",
        targetDate: null,
        priority: 3,
        defaultSessionMinutes: 20,
        personaId: null,
      });

      await importGuide();
      await importVocabulary();

      const after = await facades.certifications.findEditFormBySlug(
        existing.slug,
      );

      expect(after).toEqual(existing);
    });
  });
});

describe("toVocabularyCardInput", () => {
  const entry: HskVocabularyEntry = {
    number: 2010,
    term: "熬夜",
    reading: "áoyè",
    partOfSpeech: "v.",
    meaning: "to stay up late",
    register: "Neutral",
    isNewInSyllabus: false,
  };

  it("prefixes the meaning with the part of speech", () => {
    // A Chinese word's part of speech changes what its gloss means, and the answer
    // face renders `meaning` as one line, so a separate field would not be shown.
    expect(toVocabularyCardInput(entry).cardType).toBe("VOCABULARY");
    expect(toVocabularyCardInput(entry)).toMatchObject({
      term: "熬夜",
      reading: "áoyè",
      meaning: "(v.) to stay up late",
    });
  });

  it("leaves the example sentence empty rather than inventing one", () => {
    // The source list has no examples, and fabricated Chinese on a card labelled
    // as the owner's own content would be worse than a blank field.
    expect(toVocabularyCardInput(entry).exampleSentence).toBeNull();
  });

  it("records the register as a tag and in the notes", () => {
    const input = toVocabularyCardInput(entry);

    expect(input.tags).toEqual(["hsk5", "neutral"]);
    expect(input.notes).toContain("Register: Neutral.");
  });

  it("records a word that is new in this syllabus revision", () => {
    const input = toVocabularyCardInput({ ...entry, isNewInSyllabus: true });

    expect(input.tags).toContain("new-in-syllabus");
    expect(input.notes).toContain("New in this HSK syllabus revision.");
  });

  it("records the row number, so a card can be traced back to the list", () => {
    expect(toVocabularyCardInput(entry).notes).toContain("Word 2010");
  });

  it("tags the card's language", () => {
    expect(toVocabularyCardInput(entry).language).toBe("zh");
  });

  it("stores no reading when the row had none", () => {
    expect(toVocabularyCardInput({ ...entry, reading: "" }).reading).toBeNull();
  });
});
