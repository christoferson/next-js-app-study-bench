import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import { seedDemoContent } from "@/modules/certifications/infrastructure/demo-seed";
import { DEMO_TRACK_SLUGS } from "@/modules/certifications/infrastructure/demo-seed";
import { SqliteUnitOfWork } from "@/modules/certifications/infrastructure/sqlite-unit-of-work";
import {
  FixedClock,
  SequentialIdGenerator,
  createMigratedDatabase,
} from "@/modules/certifications/infrastructure/test-support";
import { createSeedFacades } from "./composition";
import { DEMO_BANKS } from "./demo-bank-content";
import { seedDemoBanks } from "./demo-bank-seeder";
import type { DemoBankSeedResult } from "./demo-bank-seeder";

/**
 * The demo bank seeder, against a real migrated in-memory database.
 *
 * What matters about a seed is not that it inserts rows once, but what happens on
 * the second run: the owner will run `npm run seed` again after adding their own
 * content, and it must not duplicate demo items or touch anything they wrote.
 * Everything here therefore checks a re-run as well as a first run.
 *
 * The suite drives the same facades the script wires, so demo content is held to
 * every domain invariant — a card with no answer or a question with no marked
 * correct choice would fail here rather than in the owner's bank.
 */

const TECHNICAL = DEMO_TRACK_SLUGS.technicalCertification;
const LANGUAGE = DEMO_TRACK_SLUGS.languageProficiency;

describe("seedDemoBanks", () => {
  let database: SqliteDatabase;
  let facades: ReturnType<typeof createSeedFacades>;

  const seedTracks = async (): Promise<void> => {
    await seedDemoContent({
      unitOfWork: new SqliteUnitOfWork(database),
      clock: new FixedClock(),
      ids: new SequentialIdGenerator(),
    });
  };

  const seedBanks = async () => seedDemoBanks(facades);

  const resultFor = (
    outcome: Awaited<ReturnType<typeof seedBanks>>,
    slug: string,
  ): DemoBankSeedResult => {
    const found = outcome.tracks.find((track) => track.slug === slug);

    if (found === undefined) {
      throw new Error(`No seed result for ${slug}.`);
    }

    return found;
  };

  const countsFor = async (slug: string) => {
    const certification = await facades.certifications.findBySlug(slug);

    if (certification === null) {
      throw new Error(`No track ${slug}.`);
    }

    const [questions, flashcards] = await Promise.all([
      facades.questionBank.countBank(certification.id),
      facades.flashcards.countBank(certification.id),
    ]);

    return { certification, questions, flashcards };
  };

  beforeEach(() => {
    database = createMigratedDatabase();
    facades = createSeedFacades(database);
  });

  afterEach(() => {
    database.close();
  });

  describe("on a freshly seeded database", () => {
    it("fills both banks on both tracks", async () => {
      // The owner's complaint that started this: a seeded track with two empty
      // banks has nothing to study.
      await seedTracks();

      const outcome = await seedBanks();

      for (const bank of DEMO_BANKS) {
        const result = resultFor(outcome, bank.slug);

        expect(result.trackFound).toBe(true);
        expect(result.questionsInserted).toBe(bank.questions.length);
        expect(result.flashcardsInserted).toBe(bank.flashcards.length);
      }
    });

    it("writes between four and six questions on the technical track", async () => {
      await seedTracks();
      await seedBanks();

      const { questions } = await countsFor(TECHNICAL);

      expect(questions.total).toBeGreaterThanOrEqual(4);
      expect(questions.total).toBeLessThanOrEqual(6);
    });

    it("writes between four and six cards on the language track", async () => {
      await seedTracks();
      await seedBanks();

      const { flashcards } = await countsFor(LANGUAGE);

      expect(flashcards.total).toBeGreaterThanOrEqual(4);
      expect(flashcards.total).toBeLessThanOrEqual(6);
    });

    it("gives each track some of the other bank too", async () => {
      // Both banks on both tracks, so a mixed session and every bank view has
      // content to render on either track.
      await seedTracks();
      await seedBanks();

      const technical = await countsFor(TECHNICAL);
      const language = await countsFor(LANGUAGE);

      expect(technical.flashcards.total).toBeGreaterThan(0);
      expect(language.questions.total).toBeGreaterThan(0);
    });

    it("activates everything, so a session can offer it immediately", async () => {
      await seedTracks();
      await seedBanks();

      for (const slug of [TECHNICAL, LANGUAGE]) {
        const { questions, flashcards } = await countsFor(slug);

        expect(questions.active).toBe(questions.total);
        expect(flashcards.active).toBe(flashcards.total);
      }
    });

    it("maps every seeded item to an objective of its own track", async () => {
      await seedTracks();
      await seedBanks();

      const { certification } = await countsFor(TECHNICAL);
      const bank = await facades.questionBank.findBankBySlug(TECHNICAL, {
        lifecycle: null,
        quality: null,
        type: null,
        objective: null,
        q: null,
        page: 1,
      });

      expect(bank).not.toBeNull();

      for (const item of bank?.items ?? []) {
        const detail = await facades.questionBank.findDetail(
          TECHNICAL,
          item.question.id,
        );

        expect(detail?.linkedObjectives.length).toBeGreaterThan(0);
        expect(
          detail?.linkedObjectives.every(
            (objective) => objective.certificationId === certification.id,
          ),
        ).toBe(true);
      }
    });

    it("records demo content as the owner's own manual authoring, unreviewed", async () => {
      // Nothing in the seed was written by a model, so labelling it as generated
      // would be a false provenance claim (`spec/AI-GUIDELINES.md` section 1.9).
      await seedTracks();
      await seedBanks();

      const bank = await facades.questionBank.findBankBySlug(TECHNICAL, {
        lifecycle: null,
        quality: null,
        type: null,
        objective: null,
        q: null,
        page: 1,
      });

      for (const item of bank?.items ?? []) {
        expect(item.question.generationMode).toBe("MANUAL");
        expect(item.question.generationRunId).toBeNull();
        expect(item.question.qualityStatus).toBe("UNREVIEWED");
      }
    });

    it("covers more than one question type and more than one card type", async () => {
      await seedTracks();
      await seedBanks();

      const questions = await facades.questionBank.findBankBySlug(TECHNICAL, {
        lifecycle: null,
        quality: null,
        type: null,
        objective: null,
        q: null,
        page: 1,
      });
      const cards = await facades.flashcards.findBankBySlug(LANGUAGE, {
        lifecycle: null,
        type: null,
        objective: null,
        q: null,
        page: 1,
      });
      const questionTypes = new Set(
        (questions?.items ?? []).map((item) => item.revision.questionType),
      );
      const cardTypes = new Set(
        (cards?.items ?? []).map((item) => item.revision.cardType),
      );

      expect(questionTypes.size).toBeGreaterThanOrEqual(3);
      expect(cardTypes.size).toBeGreaterThanOrEqual(3);
    });

    it("seeds the vocabulary card the specification illustrates", async () => {
      // `SPEC.md` section 6.4 uses 学习 as its example; having it present means the
      // documented card type is studiable on the first run.
      await seedTracks();
      await seedBanks();

      const cards = await facades.flashcards.findBankBySlug(LANGUAGE, {
        lifecycle: null,
        type: null,
        objective: null,
        q: "学习",
        page: 1,
      });

      expect(cards?.items.length).toBeGreaterThan(0);
    });

    it("never claims any demo item is official or real exam material", async () => {
      await seedTracks();
      await seedBanks();

      const text = JSON.stringify(DEMO_BANKS);

      expect(text).not.toMatch(/official/i);
      expect(text).not.toMatch(/real exam/i);
      expect(text).not.toMatch(/actual exam/i);
    });
  });

  describe("on a second run", () => {
    it("inserts nothing and reports both banks as already present", async () => {
      await seedTracks();
      await seedBanks();

      const second = await seedBanks();

      for (const bank of DEMO_BANKS) {
        const result = resultFor(second, bank.slug);

        expect(result.questionsInserted).toBe(0);
        expect(result.flashcardsInserted).toBe(0);
        expect(result.questionsSkipped).toBe(true);
        expect(result.flashcardsSkipped).toBe(true);
      }
    });

    it("leaves the item counts exactly as they were", async () => {
      await seedTracks();
      await seedBanks();
      const before = await countsFor(TECHNICAL);

      await seedBanks();
      await seedBanks();

      const after = await countsFor(TECHNICAL);

      expect(after.questions.total).toBe(before.questions.total);
      expect(after.flashcards.total).toBe(before.flashcards.total);
    });

    it("does not revise or overwrite an item the owner has edited", async () => {
      await seedTracks();
      await seedBanks();

      const bank = await facades.questionBank.findBankBySlug(TECHNICAL, {
        lifecycle: null,
        quality: null,
        type: null,
        objective: null,
        q: null,
        page: 1,
      });
      const first = bank?.items[0];

      expect(first).toBeDefined();

      if (first !== undefined) {
        await facades.questionBank.reviseQuestion(first.question.id, {
          questionType: "SHORT_ANSWER",
          stem: "My own rewritten question.",
          instructions: null,
          explanation: null,
          difficulty: null,
          tags: [],
          language: null,
          expectedConcepts: ["my own concept"],
        });

        await seedBanks();

        const detail = await facades.questionBank.findDetail(
          TECHNICAL,
          first.question.id,
        );

        expect(detail?.currentRevision.stem).toBe("My own rewritten question.");
        expect(detail?.revisions).toHaveLength(2);
      }
    });

    it("fills only the bank that is still empty", async () => {
      // Per-bank rather than per-track: deleting every card but keeping the
      // questions must not stop the cards coming back, and must not duplicate the
      // questions.
      await seedTracks();
      const partial = await seedDemoBanks(facades, [
        { slug: TECHNICAL, questions: [], flashcards: [] },
        DEMO_BANKS[1] ?? { slug: LANGUAGE, questions: [], flashcards: [] },
      ]);

      expect(resultFor(partial, LANGUAGE).flashcardsInserted).toBeGreaterThan(
        0,
      );

      const second = await seedBanks();

      // The technical bank was left empty by the partial run, so it is filled now.
      expect(resultFor(second, TECHNICAL).questionsInserted).toBeGreaterThan(0);
      // The language banks already hold the demo cards, so they are untouched.
      expect(resultFor(second, LANGUAGE).flashcardsSkipped).toBe(true);
      expect(resultFor(second, LANGUAGE).flashcardsInserted).toBe(0);
    });
  });

  describe("when the demo tracks are not there", () => {
    it("reports the missing track instead of creating one", async () => {
      // Seeding content is not a second, hidden track seeder: if the owner
      // renamed or removed the demo track, the script says so.
      const outcome = await seedBanks();

      for (const bank of DEMO_BANKS) {
        const result = resultFor(outcome, bank.slug);

        expect(result.trackFound).toBe(false);
        expect(result.questionsInserted).toBe(0);
        expect(result.flashcardsInserted).toBe(0);
      }
    });
  });

  describe("when the demo content and the demo objectives disagree", () => {
    it("fails loudly rather than seeding an unmapped item", async () => {
      await seedTracks();

      const broken = [
        {
          slug: TECHNICAL,
          questions: [
            {
              objectiveCode: "Demo domain 99",
              input: {
                questionType: "SINGLE_CHOICE" as const,
                stem: "Demo question with a missing objective.",
                instructions: null,
                explanation: null,
                difficulty: null,
                tags: [],
                language: null,
                choiceTexts: ["One", "Two"],
                correctChoiceIndexes: [0],
              },
            },
          ],
          flashcards: [],
        },
      ];

      await expect(seedDemoBanks(facades, broken)).rejects.toThrow(
        /Demo domain 99/,
      );
    });
  });
});
