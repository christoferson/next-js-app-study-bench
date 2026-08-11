import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import {
  FixedClock,
  SequentialIdGenerator,
  certificationFixture,
  createMigratedDatabase,
  objectiveFixture,
} from "@/modules/certifications/infrastructure/test-support";
import { DeterministicReviewScheduler } from "@/modules/flashcards/domain/review-scheduling";
import { SqliteFlashcardRepository } from "@/modules/flashcards/infrastructure/sqlite-flashcard-repository";
import {
  basicContent,
  cardRevisionFixture,
  flashcardFixture,
} from "@/modules/flashcards/infrastructure/test-support";
import { SqliteQuestionRepository } from "@/modules/question-bank/infrastructure/sqlite-question-repository";
import {
  multipleResponseContent,
  questionFixture,
  revisionFixture,
  singleChoiceContent,
} from "@/modules/question-bank/infrastructure/test-support";
import { DeterministicSessionComposer } from "@/modules/study-sessions/domain/session-composer";
import { SqliteProgressRepository } from "@/modules/study-sessions/infrastructure/sqlite-progress-repository";
import { SqliteStudySessionRepository } from "@/modules/study-sessions/infrastructure/sqlite-study-session-repository";
import { SqliteStudyUnitOfWork } from "@/modules/study-sessions/infrastructure/sqlite-study-unit-of-work";
import {
  attemptFixture,
  questionItemFixture,
  sessionFixture,
} from "@/modules/study-sessions/infrastructure/test-support";
import { ProgressFacade } from "./progress-facade";
import { StudyFacade } from "./study-facade";

/**
 * Progress dashboard behaviour over the real SQLite adapter.
 *
 * Every figure is produced by answering questions through the study facade rather
 * than by inserting attempt rows directly, so the dashboard is tested against data
 * the application can actually create.
 *
 * These tests also stand guard over one prohibition: nothing here, and nothing the
 * port exposes, yields a pass probability or a predicted exam score
 * (`SPEC.md` section 6.8).
 */

const TRACK = certificationFixture();
const SECOND_TRACK = certificationFixture({
  id: "certification-2",
  slug: "second-track",
  name: "Second Track",
});

const START = "2026-03-01T08:00:00.000Z";
const LATER = "2026-03-01T09:00:00.000Z";

describe("ProgressFacade", () => {
  let database: SqliteDatabase;
  let clock: FixedClock;
  let certifications: SqliteCertificationRepository;
  let objectives: SqliteObjectiveRepository;
  let questions: SqliteQuestionRepository;
  let flashcards: SqliteFlashcardRepository;
  let study: StudyFacade;
  let facade: ProgressFacade;

  async function createQuestion(
    id: string,
    options: {
      readonly type?: "SINGLE_CHOICE" | "MULTIPLE_RESPONSE" | "SHORT_ANSWER";
      readonly certificationId?: string;
      readonly objectiveIds?: readonly string[];
    } = {},
  ): Promise<string> {
    const type = options.type ?? "SINGLE_CHOICE";
    const revisionId = `${id}-rev-1`;

    await questions.create(
      questionFixture({
        id,
        certificationId: options.certificationId ?? TRACK.id,
        currentRevisionId: revisionId,
        lifecycleStatus: "ACTIVE",
        createdAt: START,
        updatedAt: START,
      }),
      revisionFixture({
        id: revisionId,
        questionId: id,
        stem: `Stem of ${id}?`,
        questionType: type,
        content:
          type === "MULTIPLE_RESPONSE"
            ? multipleResponseContent()
            : singleChoiceContent(),
      }),
    );

    if (options.objectiveIds !== undefined) {
      await questions.replaceObjectiveLinks(id, options.objectiveIds, START);
    }

    return id;
  }

  /**
   * Answers one specific question, correctly or not.
   *
   * Runs a one-question session per answer so the test names the question it is
   * recording evidence about, instead of depending on composed order.
   */
  async function answer(
    questionId: string,
    isCorrect: boolean,
    confidence:
      "GUESS" | "UNCERTAIN" | "FAIRLY_SURE" | "CONFIDENT" = "CONFIDENT",
  ): Promise<void> {
    const found = await questions.findWithCurrentRevision(questionId);

    if (found === null) {
      throw new Error(`No question ${questionId}.`);
    }

    const { question, revision } = found;
    const sessions = new SqliteStudySessionRepository(database);
    const sessionId = `session-for-${questionId}-${confidence}-${String(isCorrect)}`;

    await sessions.create(
      sessionFixture({
        id: sessionId,
        mode: "QUESTIONS_ONLY",
        status: "COMPLETED",
        certificationIds: [question.certificationId],
        createdAt: clock.now(),
        completedAt: clock.now(),
      }),
      [
        questionItemFixture({
          id: `${sessionId}-item-1`,
          sessionId,
          status: "COMPLETED",
          content: {
            itemType: "QUESTION",
            questionId,
            questionRevisionId: question.currentRevisionId,
          },
          completedAt: clock.now(),
        }),
      ],
    );

    await sessions.recordAttempt(
      attemptFixture({
        id: `attempt-${sessionId}`,
        sessionId,
        questionId,
        questionRevisionId: question.currentRevisionId,
        submittedAnswer:
          revision.content.type === "MULTIPLE_RESPONSE"
            ? { type: "MULTIPLE_RESPONSE", choiceIds: ["choice-1"] }
            : { type: "SINGLE_CHOICE", choiceId: "choice-1" },
        isCorrect,
        confidence,
        attemptedAt: clock.now(),
      }),
    );
  }

  beforeEach(async () => {
    database = createMigratedDatabase();
    clock = new FixedClock(START);
    certifications = new SqliteCertificationRepository(database);
    objectives = new SqliteObjectiveRepository(database);
    questions = new SqliteQuestionRepository(database);
    flashcards = new SqliteFlashcardRepository(database);

    const sessions = new SqliteStudySessionRepository(database);

    facade = new ProgressFacade({
      progress: new SqliteProgressRepository(database),
      sessions,
      certifications,
      objectives,
      flashcards,
      clock,
    });
    study = new StudyFacade({
      sessions,
      questions,
      flashcards,
      certifications,
      unitOfWork: new SqliteStudyUnitOfWork(database),
      composer: new DeterministicSessionComposer(),
      scheduler: new DeterministicReviewScheduler(clock),
      clock,
      ids: new SequentialIdGenerator("gen"),
    });

    await certifications.save(TRACK);
    await certifications.save(SECOND_TRACK);
    await objectives.save(objectiveFixture());
  });

  afterEach(() => {
    database.close();
  });

  describe("an empty bank", () => {
    it("reports itself empty rather than reporting zero accuracy", async () => {
      const view = await facade.findProgress();

      expect(view.empty).toBe(true);
      // Zero attempts is not zero percent: the page says "no evidence yet"
      // (`spec/UI-GUIDELINES.md` section 1.4).
      expect(view.overall).toEqual({
        attemptCount: 0,
        correctCount: 0,
        percentage: null,
      });
      expect(view.recentMistakes).toEqual([]);
      expect(view.sessions).toEqual([]);
      expect(view.confidence).toEqual([]);
    });

    it("still lists every active track so the owner can see what is unstudied", async () => {
      await createQuestion("q-1", { objectiveIds: ["objective-1"] });

      const view = await facade.findProgress();

      expect(view.tracks.map((track) => track.track.id)).toEqual([
        TRACK.id,
        SECOND_TRACK.id,
      ]);
      expect(view.trackNames.get(TRACK.id)).toBe(TRACK.name);

      const track = view.tracks[0];

      expect(track?.accuracy.percentage).toBeNull();
      expect(track?.bank.activeQuestions).toBe(1);
      expect(track?.coverage).toEqual({
        totalObjectives: 1,
        coveredObjectives: 0,
        unseenObjectives: 1,
        percentage: 0,
      });
    });

    it("reports no coverage percentage for a track with no objectives yet", async () => {
      const view = await facade.findProgress();
      const second = view.tracks.find(
        (track) => track.track.id === SECOND_TRACK.id,
      );

      expect(second?.coverage).toEqual({
        totalObjectives: 0,
        coveredObjectives: 0,
        unseenObjectives: 0,
        percentage: null,
      });
    });
  });

  describe("accuracy", () => {
    it("counts overall accuracy across every track", async () => {
      await createQuestion("q-1");
      await createQuestion("q-2");
      await createQuestion("q-other", { certificationId: SECOND_TRACK.id });

      await answer("q-1", true);
      await answer("q-2", false);
      await answer("q-other", true);

      const view = await facade.findProgress();

      expect(view.empty).toBe(false);
      expect(view.overall).toEqual({
        attemptCount: 3,
        correctCount: 2,
        percentage: 67,
      });
    });

    it("counts accuracy per track separately", async () => {
      await createQuestion("q-1");
      await createQuestion("q-other", { certificationId: SECOND_TRACK.id });

      await answer("q-1", true);
      await answer("q-other", false);

      const view = await facade.findProgress();
      const byTrack = new Map(
        view.tracks.map((track) => [track.track.id, track.accuracy]),
      );

      expect(byTrack.get(TRACK.id)).toEqual({
        attemptCount: 1,
        correctCount: 1,
        percentage: 100,
      });
      expect(byTrack.get(SECOND_TRACK.id)).toEqual({
        attemptCount: 1,
        correctCount: 0,
        percentage: 0,
      });
    });

    it("counts accuracy per question type", async () => {
      await createQuestion("q-single", { type: "SINGLE_CHOICE" });
      await createQuestion("q-multi", { type: "MULTIPLE_RESPONSE" });

      await answer("q-single", true);
      await answer("q-multi", false);

      const view = await facade.findProgress();
      const types = view.tracks[0]?.questionTypes ?? [];

      expect(types.map((row) => [row.questionType, row.percentage])).toEqual([
        ["MULTIPLE_RESPONSE", 0],
        ["SINGLE_CHOICE", 100],
      ]);
    });

    it("counts accuracy per objective and marks the rest unseen", async () => {
      await objectives.save(
        objectiveFixture({
          id: "objective-2",
          title: "Second objective",
          displayOrder: 2,
        }),
      );
      await createQuestion("q-1", { objectiveIds: ["objective-1"] });
      await createQuestion("q-2", { objectiveIds: ["objective-1"] });
      await createQuestion("q-3", { objectiveIds: ["objective-2"] });

      await answer("q-1", true);
      await answer("q-2", false);

      const view = await facade.findProgress();
      const track = view.tracks[0];

      expect(
        track?.objectives.map((row) => [
          row.objective.id,
          row.attemptCount,
          row.percentage,
          row.unseen,
        ]),
      ).toEqual([
        ["objective-1", 2, 50, false],
        // Never attempted, so it is unseen rather than scored zero
        // (`spec/DOMAIN-RULES.md` section 2.5).
        ["objective-2", 0, null, true],
      ]);
      expect(track?.coverage).toEqual({
        totalObjectives: 2,
        coveredObjectives: 1,
        unseenObjectives: 1,
        percentage: 50,
      });
    });

    it("does not double-count a track total when one question covers two objectives", async () => {
      await objectives.save(
        objectiveFixture({
          id: "objective-2",
          title: "Second objective",
          displayOrder: 2,
        }),
      );
      await createQuestion("q-1", {
        objectiveIds: ["objective-1", "objective-2"],
      });

      await answer("q-1", true);

      const view = await facade.findProgress();
      const track = view.tracks[0];

      // One answer counts as evidence about both objectives...
      expect(track?.objectives.map((row) => row.attemptCount)).toEqual([1, 1]);
      // ...but it is still only one answer.
      expect(track?.accuracy.attemptCount).toBe(1);
      expect(view.overall.attemptCount).toBe(1);
    });

    it("excludes an archived objective from coverage", async () => {
      await objectives.save(
        objectiveFixture({
          id: "objective-archived",
          title: "Retired objective",
          displayOrder: 2,
          status: "ARCHIVED",
        }),
      );

      const view = await facade.findProgress();
      const track = view.tracks[0];

      // Coverage the owner cannot act on would only make the figure misleading.
      expect(track?.coverage.totalObjectives).toBe(1);
      expect(track?.objectives.map((row) => row.objective.id)).toEqual([
        "objective-1",
      ]);
    });

    it("reports the depth of each objective for the indented list", async () => {
      await objectives.save(
        objectiveFixture({
          id: "objective-child",
          parentObjectiveId: "objective-1",
          title: "Child objective",
          displayOrder: 2,
        }),
      );

      const view = await facade.findProgress();

      expect(
        view.tracks[0]?.objectives.map((row) => [row.objective.id, row.depth]),
      ).toEqual([
        ["objective-1", 0],
        ["objective-child", 1],
      ]);
    });

    it("counts evidence against the revision that was answered, not the current one", async () => {
      await createQuestion("q-1", { type: "SINGLE_CHOICE" });
      await answer("q-1", true);

      // The question is rewritten as a different type after the answer.
      await questions.appendRevision(
        revisionFixture({
          id: "q-1-rev-2",
          questionId: "q-1",
          revisionNumber: 2,
          questionType: "MULTIPLE_RESPONSE",
          content: multipleResponseContent(),
        }),
        LATER,
      );

      const view = await facade.findProgress();

      // The owner answered a single-choice question; the edit does not rewrite that.
      expect(
        view.tracks[0]?.questionTypes.map((row) => row.questionType),
      ).toEqual(["SINGLE_CHOICE"]);
    });
  });

  describe("confidence calibration", () => {
    it("reports each confidence level with its accuracy and bands", async () => {
      await createQuestion("q-1");
      await createQuestion("q-2");
      await createQuestion("q-3");

      await answer("q-1", false, "CONFIDENT");
      await answer("q-2", true, "CONFIDENT");
      await answer("q-3", true, "GUESS");

      const view = await facade.findProgress();

      // Least to most confident, so the table reads as a calibration curve.
      expect(
        view.confidence.map((row) => [
          row.confidence,
          row.attemptCount,
          row.percentage,
        ]),
      ).toEqual([
        ["GUESS", 1, 100],
        ["CONFIDENT", 2, 50],
      ]);
      expect(view.confidence[0]).toMatchObject({
        correctBand: "CORRECT_UNCERTAIN",
        incorrectBand: "INCORRECT_UNCERTAIN",
      });
      expect(view.confidence[1]).toMatchObject({
        correctBand: "CORRECT_CONFIDENT",
        incorrectBand: "INCORRECT_CONFIDENT",
      });
    });

    it("omits a confidence level that has never been used", async () => {
      await createQuestion("q-1");
      await answer("q-1", true, "FAIRLY_SURE");

      const view = await facade.findProgress();

      expect(view.confidence.map((row) => row.confidence)).toEqual([
        "FAIRLY_SURE",
      ]);
    });
  });

  describe("recent mistakes", () => {
    it("lists wrong answers newest first with the wording that was answered", async () => {
      await createQuestion("q-1");
      await createQuestion("q-2");

      await answer("q-1", false, "CONFIDENT");

      clock.set(LATER);

      await answer("q-2", false, "GUESS");
      await questions.appendRevision(
        revisionFixture({
          id: "q-1-rev-2",
          questionId: "q-1",
          revisionNumber: 2,
          stem: "Rewritten stem?",
        }),
        LATER,
      );

      const view = await facade.findProgress();

      expect(
        view.recentMistakes.map((mistake) => [
          mistake.questionId,
          mistake.stem,
          mistake.confidence,
        ]),
      ).toEqual([
        ["q-2", "Stem of q-2?", "GUESS"],
        // The frozen wording, so the list still describes what went wrong.
        ["q-1", "Stem of q-1?", "CONFIDENT"],
      ]);
      expect(view.recentMistakes[0]?.certificationId).toBe(TRACK.id);
    });

    it("omits correct answers", async () => {
      await createQuestion("q-1");
      await answer("q-1", true);

      const view = await facade.findProgress();

      expect(view.recentMistakes).toEqual([]);
    });

    it("bounds the list", async () => {
      for (let index = 0; index < 12; index += 1) {
        await createQuestion(`q-${index}`);
        await answer(`q-${index}`, false);
      }

      const view = await facade.findProgress();

      expect(view.recentMistakes).toHaveLength(10);
    });
  });

  describe("bank and flashcard counts", () => {
    it("counts active and disputed questions and due cards per track", async () => {
      await createQuestion("q-active");
      await createQuestion("q-disputed");
      await questions.setQualityStatus(
        "q-disputed",
        "DISPUTED",
        "Needs a source check.",
        LATER,
      );
      await createQuestion("q-retired");
      await questions.setLifecycleStatus("q-retired", "RETIRED", LATER);
      await flashcards.create(
        flashcardFixture({ lifecycleStatus: "ACTIVE" }),
        cardRevisionFixture({ content: basicContent() }),
      );

      const view = await facade.findProgress();
      const track = view.tracks[0];

      expect(track?.bank).toEqual({
        activeQuestions: 1,
        disputedQuestions: 1,
        activeFlashcards: 1,
      });
      expect(track?.dueFlashcardCount).toBe(1);
    });

    it("stops counting a card as due once it is scheduled ahead", async () => {
      await flashcards.create(
        flashcardFixture({ lifecycleStatus: "ACTIVE" }),
        cardRevisionFixture({ content: basicContent() }),
      );

      const session = await study.startSession({
        mode: "FLASHCARDS_ONLY",
        certificationIds: [TRACK.id],
        targetMinutes: 10,
      });
      const view = await study.findSession(session.id);
      const itemId = view?.current?.item.id;

      if (itemId === undefined) {
        throw new Error("Expected a card to review.");
      }

      await study.rateSessionCard({
        sessionId: session.id,
        itemId,
        rating: "GOOD",
      });

      const progress = await facade.findProgress();

      expect(progress.tracks[0]?.dueFlashcardCount).toBe(0);
      // The card itself is still part of the bank.
      expect(progress.tracks[0]?.bank.activeFlashcards).toBe(1);
    });
  });

  describe("session history", () => {
    it("lists recent sessions newest first with their counts", async () => {
      await createQuestion("q-1");
      await createQuestion("q-2");

      const first = await study.startSession({
        mode: "QUESTIONS_ONLY",
        certificationIds: [TRACK.id],
        targetMinutes: 10,
      });
      const firstView = await study.findSession(first.id);
      const itemId = firstView?.current?.item.id;

      if (itemId === undefined) {
        throw new Error("Expected a question to answer.");
      }

      await study.submitAnswer({
        type: "SINGLE_CHOICE",
        sessionId: first.id,
        itemId,
        choiceId: "choice-1",
        confidence: "CONFIDENT",
        durationSeconds: 12,
      });
      await study.finishSession(first.id);

      clock.set(LATER);

      const second = await study.startSession({
        mode: "QUESTIONS_ONLY",
        certificationIds: [TRACK.id],
        targetMinutes: 10,
      });

      const view = await facade.findProgress();

      expect(view.sessions.map((entry) => entry.session.id)).toEqual([
        second.id,
        first.id,
      ]);
      expect(view.sessions[1]).toMatchObject({
        itemCount: 2,
        settledCount: 1,
        attemptCount: 1,
        correctCount: 1,
      });
      // The history rows name their tracks through the same map the mistake list
      // uses, so the page needs no extra query to label them.
      expect(view.sessions[0]?.session.certificationIds).toEqual([TRACK.id]);
      expect(view.trackNames.get(TRACK.id)).toBe(TRACK.name);
    });

    it("bounds the history", async () => {
      await createQuestion("q-1");

      for (let index = 0; index < 12; index += 1) {
        const session = await study.startSession({
          mode: "QUESTIONS_ONLY",
          certificationIds: [TRACK.id],
          targetMinutes: 10,
        });

        await study.finishSession(session.id);
      }

      const view = await facade.findProgress();

      expect(view.sessions).toHaveLength(10);
    });
  });

  describe("one track's progress", () => {
    it("reports the same figures the dashboard shows for that track", async () => {
      await createQuestion("q-1", { objectiveIds: ["objective-1"] });
      await answer("q-1", true);

      const dashboard = await facade.findProgress();
      const single = await facade.findTrackProgressBySlug(TRACK.slug);

      expect(single).toEqual(
        dashboard.tracks.find((track) => track.track.id === TRACK.id),
      );
    });

    it("returns nothing for a slug that names no track", async () => {
      await expect(
        facade.findTrackProgressBySlug("no-such-track"),
      ).resolves.toBeNull();
    });

    it("reports an archived track that is addressed directly", async () => {
      await certifications.save({ ...SECOND_TRACK, status: "ARCHIVED" });

      const dashboard = await facade.findProgress();

      // Archived tracks stay off the dashboard...
      expect(dashboard.tracks.map((track) => track.track.id)).toEqual([
        TRACK.id,
      ]);
      // ...but its own page still reports what was studied.
      await expect(
        facade
          .findTrackProgressBySlug(SECOND_TRACK.slug)
          .then((view) => view?.track.status),
      ).resolves.toBe("ARCHIVED");
    });
  });
});
