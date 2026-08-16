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
import type { TrackProgressView } from "./progress-facade";
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
    options: { readonly durationSeconds?: number | null } = {
      durationSeconds: 12,
    },
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
        // `null` is meaningful here (an attempt the browser did not time), so the
        // default is on the parameter rather than a coalesce that would erase it.
        durationSeconds: options.durationSeconds ?? null,
        attemptedAt: clock.now(),
      }),
    );
  }

  /**
   * One track's detail view, failing the test rather than returning null.
   *
   * Most of these tests are about figures that now live on the per-track page, so a
   * helper keeps each one to the assertion it is making.
   */
  async function trackProgress(
    slug: string = TRACK.slug,
  ): Promise<TrackProgressView> {
    const view = await facade.findTrackProgressBySlug(slug);

    if (view === null) {
      throw new Error(`No progress for ${slug}.`);
    }

    return view;
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
      // No activity either, rather than a zero-length streak dressed up as one.
      expect(view.activity).toMatchObject({
        answeringSeconds: 0,
        activeDays: 0,
        streakDays: 0,
        lastStudiedAt: null,
      });

      const track = await trackProgress();

      expect(track.recentMistakes).toEqual([]);
      expect(track.sessions).toEqual([]);
      expect(track.confidence).toEqual([]);
    });

    it("still lists every active track so the owner can see what is unstudied", async () => {
      await createQuestion("q-1", { objectiveIds: ["objective-1"] });

      const view = await facade.findProgress();

      expect(view.tracks.map((track) => track.track.id)).toEqual([
        TRACK.id,
        SECOND_TRACK.id,
      ]);

      const track = view.tracks[0];

      expect(track?.accuracy.percentage).toBeNull();
      expect(track?.unstudied).toBe(true);
      await expect(
        trackProgress().then((detail) => detail.bank.activeQuestions),
      ).resolves.toBe(1);
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

      const types = (await trackProgress()).questionTypes;

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

      const track = await trackProgress();

      expect(
        track.roots.map((row) => [
          row.objective.id,
          row.attemptCount,
          row.percentage,
          row.attemptedQuestionCount,
          row.questionCount,
        ]),
      ).toEqual([
        ["objective-1", 2, 50, 2, 2],
        // Never attempted, so it reports no percentage rather than a scored zero
        // (`spec/DOMAIN-RULES.md` section 2.5).
        ["objective-2", 0, null, 0, 1],
      ]);
      expect(track.coverage).toEqual({
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
      const track = await trackProgress();

      // One answer counts as evidence about both roots...
      expect(track.roots.map((row) => row.attemptCount)).toEqual([1, 1]);
      // ...but it is still only one answer.
      expect(track.accuracy.attemptCount).toBe(1);
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

      const track = await trackProgress();

      // Coverage the owner cannot act on would only make the figure misleading.
      expect(track.coverage.totalObjectives).toBe(1);
      expect(track.roots.map((row) => row.objective.id)).toEqual([
        "objective-1",
      ]);
    });

    it("nests a child objective under its root rather than listing it beside it", async () => {
      await objectives.save(
        objectiveFixture({
          id: "objective-child",
          parentObjectiveId: "objective-1",
          title: "Child objective",
          displayOrder: 2,
        }),
      );

      const track = await trackProgress();

      // One row per domain, with the tasks inside it behind a disclosure.
      expect(track.roots.map((row) => row.objective.id)).toEqual([
        "objective-1",
      ]);
      expect(
        track.roots[0]?.children.map((row) => [row.objective.id, row.depth]),
      ).toEqual([["objective-child", 1]]);
    });

    it("rolls a child objective's questions up into its root domain", async () => {
      await objectives.save(
        objectiveFixture({
          id: "objective-child",
          parentObjectiveId: "objective-1",
          title: "Child objective",
          displayOrder: 2,
        }),
      );
      await objectives.save(
        objectiveFixture({
          id: "objective-grandchild",
          parentObjectiveId: "objective-child",
          title: "Grandchild objective",
          displayOrder: 3,
        }),
      );
      // Mapped only to the deepest task, and to nothing on the domain itself.
      await createQuestion("q-deep", {
        objectiveIds: ["objective-grandchild"],
      });
      await createQuestion("q-child", { objectiveIds: ["objective-child"] });
      // Mapped to two tasks of the same domain: one question in that domain, not two.
      await createQuestion("q-both", {
        objectiveIds: ["objective-child", "objective-grandchild"],
      });

      await answer("q-deep", true);

      const root = (await trackProgress()).roots[0];

      expect(root?.objective.id).toBe("objective-1");
      expect(root?.questionCount).toBe(3);
      expect(root?.attemptedQuestionCount).toBe(1);
      expect(root?.attemptedPercentage).toBe(33);
      expect(root?.percentage).toBe(100);
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

      const track = await trackProgress();

      // The owner answered a single-choice question; the edit does not rewrite that.
      expect(track.questionTypes.map((row) => row.questionType)).toEqual([
        "SINGLE_CHOICE",
      ]);
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

      const view = await trackProgress();

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

      const view = await trackProgress();

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

      const view = await trackProgress();

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

      const view = await trackProgress();

      expect(view.recentMistakes).toEqual([]);
    });

    it("bounds the list", async () => {
      for (let index = 0; index < 12; index += 1) {
        await createQuestion(`q-${index}`);
        await answer(`q-${index}`, false);
      }

      const view = await trackProgress();

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

      const track = await trackProgress();

      expect(track.bank).toEqual({
        activeQuestions: 1,
        disputedQuestions: 1,
        activeFlashcards: 1,
      });
      expect(track.dueFlashcardCount).toBe(1);
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

      const progress = await trackProgress();

      expect(progress.dueFlashcardCount).toBe(0);
      // The card itself is still part of the bank.
      expect(progress.bank.activeFlashcards).toBe(1);
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

      const view = await trackProgress();

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
      // The history is already scoped to this track, so the rows need no labelling.
      expect(view.sessions[0]?.session.certificationIds).toEqual([TRACK.id]);
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

      const view = await trackProgress();

      expect(view.sessions).toHaveLength(10);
    });
  });

  describe("study activity", () => {
    it("sums recorded answering time and says how much was untimed", async () => {
      await createQuestion("q-1");
      await createQuestion("q-2");

      await answer("q-1", true);
      // The second answer carries no timing, as a page restored from history does.
      await answer("q-2", true, "CONFIDENT", { durationSeconds: null });

      const view = await facade.findProgress();

      // 12 seconds from the timed attempt only: the untimed one contributes nothing
      // rather than an averaged guess, and the count says so.
      expect(view.activity.answeringSeconds).toBe(12);
      expect(view.activity.untimedAttempts).toBe(1);
    });

    it("counts distinct days of activity, not answers", async () => {
      await createQuestion("q-1");
      await createQuestion("q-2");
      await createQuestion("q-3");

      await answer("q-1", true);
      await answer("q-2", false);

      clock.set("2026-03-04T08:00:00.000Z");

      await answer("q-3", true);
      clock.set("2026-03-04T20:00:00.000Z");

      const view = await facade.findProgress();

      expect(view.activity.activeDays).toBe(2);
      expect(view.activity.activeDaysThisMonth).toBe(2);
    });

    it("takes the last studied date from card reviews as well as answers", async () => {
      await flashcards.create(
        flashcardFixture({ lifecycleStatus: "ACTIVE" }),
        cardRevisionFixture({ content: basicContent() }),
      );

      clock.set("2026-03-05T09:00:00.000Z");

      const session = await study.startSession({
        mode: "FLASHCARDS_ONLY",
        certificationIds: [TRACK.id],
        targetMinutes: 10,
      });
      const itemId = (await study.findSession(session.id))?.current?.item.id;

      if (itemId === undefined) {
        throw new Error("Expected a card to review.");
      }

      await study.rateSessionCard({
        sessionId: session.id,
        itemId,
        rating: "GOOD",
      });

      const view = await facade.findProgress();

      // A day spent only on flashcards was still a day studied.
      expect(view.activity.lastStudiedAt).toBe("2026-03-05T09:00:00.000Z");
      expect(view.activity.activeDays).toBe(1);
      expect(view.tracks[0]?.unstudied).toBe(false);
    });

    it("counts a streak of consecutive days up to today", async () => {
      await createQuestion("q-1");
      await createQuestion("q-2");
      await createQuestion("q-3");

      clock.set("2026-03-10T08:00:00.000Z");
      await answer("q-1", true);
      clock.set("2026-03-11T08:00:00.000Z");
      await answer("q-2", true);
      clock.set("2026-03-12T08:00:00.000Z");
      await answer("q-3", true);

      const view = await facade.findProgress();

      expect(view.activity.streakDays).toBe(3);
    });

    it("counts a streak that ended yesterday, so the morning does not reset it", async () => {
      await createQuestion("q-1");
      await createQuestion("q-2");

      clock.set("2026-03-10T08:00:00.000Z");
      await answer("q-1", true);
      clock.set("2026-03-11T08:00:00.000Z");
      await answer("q-2", true);
      clock.set("2026-03-12T06:00:00.000Z");

      const view = await facade.findProgress();

      expect(view.activity.streakDays).toBe(2);
    });

    it("stops the streak at a missed day and ignores what came before it", async () => {
      await createQuestion("q-1");
      await createQuestion("q-2");
      await createQuestion("q-3");

      clock.set("2026-03-01T08:00:00.000Z");
      await answer("q-1", true);
      clock.set("2026-03-02T08:00:00.000Z");
      await answer("q-2", true);
      // A two-day gap, then today.
      clock.set("2026-03-05T08:00:00.000Z");
      await answer("q-3", true);

      const view = await facade.findProgress();

      expect(view.activity.streakDays).toBe(1);
      expect(view.activity.activeDays).toBe(3);
    });

    it("reports no streak when the last day studied is older than yesterday", async () => {
      await createQuestion("q-1");

      await answer("q-1", true);
      clock.set("2026-03-20T08:00:00.000Z");

      const view = await facade.findProgress();

      expect(view.activity.streakDays).toBe(0);
      expect(view.activity.lastStudiedAt).toBe(START);
    });

    it("scopes activity to one track on its own page", async () => {
      await createQuestion("q-1");
      await createQuestion("q-other", { certificationId: SECOND_TRACK.id });

      await answer("q-1", true);
      await answer("q-other", true);

      const view = await trackProgress();

      // One answer belongs to this track, however many the bank holds.
      expect(view.activity.answeringSeconds).toBe(12);
      expect(view.activity.recentItems).toBe(1);
    });
  });

  describe("recent accuracy trend", () => {
    /**
     * Answers `count` questions in order, the ones from `correctFrom` correctly.
     *
     * The clock advances a minute per answer so the "most recent" window is ordered
     * by when the answers were given rather than by identifier, which is what the
     * repository orders on and what the owner means by recent.
     */
    async function answerMany(
      count: number,
      correctFrom: number,
    ): Promise<void> {
      for (let index = 0; index < count; index += 1) {
        clock.set(new Date(Date.parse(START) + index * 60_000).toISOString());
        await createQuestion(`q-trend-${index}`);
        await answer(`q-trend-${index}`, index >= correctFrom);
      }
    }

    it("says there is not enough evidence under the minimum window", async () => {
      await answerMany(5, 0);

      const view = await trackProgress();

      // Five answers can swing thirty points on luck, so no trend is claimed.
      expect(view.trend.trend).toBe("INSUFFICIENT");
      expect(view.trend.windowSize).toBe(5);
      expect(view.trend.deltaPoints).toBeNull();
    });

    it("reports improving when the recent window beats the whole history", async () => {
      // 40 answers: the first 20 wrong, the last 20 right. The trailing 30 are
      // therefore better than the overall 50%.
      await answerMany(40, 20);

      const view = await trackProgress();

      expect(view.accuracy.percentage).toBe(50);
      expect(view.trend.windowSize).toBe(30);
      expect(view.trend.trend).toBe("IMPROVING");
      expect(view.trend.deltaPoints).toBeGreaterThan(0);
    });

    it("reports steady when recent answers match the history", async () => {
      await answerMany(40, 0);

      const view = await trackProgress();

      expect(view.trend.trend).toBe("STEADY");
      expect(view.trend.deltaPoints).toBe(0);
    });
  });

  describe("one track's progress", () => {
    it("agrees with the summary the dashboard card shows for that track", async () => {
      await createQuestion("q-1", { objectiveIds: ["objective-1"] });
      await answer("q-1", true);

      const dashboard = await facade.findProgress();
      const card = dashboard.tracks.find(
        (track) => track.track.id === TRACK.id,
      );
      const detail = await trackProgress();

      // Two views, one set of figures: the card is the detail page's headline row.
      expect(detail.accuracy).toEqual(card?.accuracy);
      expect(detail.coverage).toEqual(card?.coverage);
      expect(detail.activity).toEqual(card?.activity);
      expect(detail.dueFlashcardCount).toBe(card?.dueFlashcardCount);
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
