import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import { CertificationNotFoundError } from "@/modules/certifications/domain/errors";
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
import { DETERMINISTIC_SCHEDULER_ID } from "@/modules/flashcards/domain/review-scheduling";
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
  shortAnswerContent,
  singleChoiceContent,
} from "@/modules/question-bank/infrastructure/test-support";
import {
  DiagnosticNotAvailableError,
  NoStudyContentError,
  SessionItemNotFoundError,
  SessionNotInProgressError,
  StudySessionNotFoundError,
} from "@/modules/study-sessions/domain/errors";
import { DeterministicSessionComposer } from "@/modules/study-sessions/domain/session-composer";
import { SqliteStudySessionRepository } from "@/modules/study-sessions/infrastructure/sqlite-study-session-repository";
import { SqliteStudyUnitOfWork } from "@/modules/study-sessions/infrastructure/sqlite-study-unit-of-work";
import type { StudySessionId } from "@/modules/study-sessions/domain/study-session";
import { StudyFacade } from "./study-facade";
import { DEFAULT_QUICK_MINUTES } from "./study-facade";
import type { StartSessionInput } from "./schemas";

/**
 * Facade behaviour over the real SQLite adapter, with an injected clock, ID
 * generator, composition policy, and scheduler, so composed order, due dates, and
 * identifiers are deterministic.
 *
 * No test here reaches the network or a language model: starting a session is a set
 * of bounded queries plus one pure composition, and these tests are the evidence
 * (`spec/TESTING.md` section 5).
 */

const TRACK = certificationFixture();
const SECOND_TRACK = certificationFixture({
  id: "certification-2",
  slug: "second-track",
  name: "Second Track",
  defaultSessionMinutes: 45,
});

const START = "2026-03-01T08:00:00.000Z";
const LATER = "2026-03-01T08:05:00.000Z";

function startInput(
  overrides: Partial<StartSessionInput> = {},
): StartSessionInput {
  return {
    mode: "SINGLE_TRACK",
    certificationIds: [TRACK.id],
    targetMinutes: DEFAULT_QUICK_MINUTES,
    ...overrides,
  };
}

describe("StudyFacade", () => {
  let database: SqliteDatabase;
  let clock: FixedClock;
  let questions: SqliteQuestionRepository;
  let flashcards: SqliteFlashcardRepository;
  let sessions: SqliteStudySessionRepository;
  let facade: StudyFacade;

  /** One active question of the given type, mapped to one objective. */
  async function createQuestion(
    id: string,
    options: {
      readonly type?: "SINGLE_CHOICE" | "MULTIPLE_RESPONSE" | "SHORT_ANSWER";
      readonly certificationId?: string;
      readonly objectiveIds?: readonly string[];
      readonly createdAt?: string;
    } = {},
  ): Promise<{ readonly questionId: string; readonly revisionId: string }> {
    const type = options.type ?? "SINGLE_CHOICE";
    const revisionId = `${id}-rev-1`;

    await questions.create(
      questionFixture({
        id,
        certificationId: options.certificationId ?? TRACK.id,
        currentRevisionId: revisionId,
        lifecycleStatus: "ACTIVE",
        createdAt: options.createdAt ?? START,
        updatedAt: options.createdAt ?? START,
      }),
      revisionFixture({
        id: revisionId,
        questionId: id,
        stem: `Stem of ${id}?`,
        questionType: type,
        content:
          type === "MULTIPLE_RESPONSE"
            ? multipleResponseContent()
            : type === "SHORT_ANSWER"
              ? shortAnswerContent()
              : singleChoiceContent(),
      }),
    );

    if (options.objectiveIds !== undefined) {
      await questions.replaceObjectiveLinks(id, options.objectiveIds, START);
    }

    return { questionId: id, revisionId };
  }

  async function createCard(
    id: string,
    options: {
      readonly certificationId?: string;
      readonly createdAt?: string;
    } = {},
  ): Promise<string> {
    const revisionId = `${id}-rev-1`;

    await flashcards.create(
      flashcardFixture({
        id,
        certificationId: options.certificationId ?? TRACK.id,
        currentRevisionId: revisionId,
        lifecycleStatus: "ACTIVE",
        createdAt: options.createdAt ?? START,
        updatedAt: options.createdAt ?? START,
      }),
      cardRevisionFixture({
        id: revisionId,
        flashcardId: id,
        content: basicContent(),
      }),
    );

    return id;
  }

  /** The identifier of the first pending item of a session. */
  async function currentItemId(sessionId: StudySessionId): Promise<string> {
    const view = await facade.findSession(sessionId);
    const itemId = view?.current?.item.id;

    if (itemId === undefined) {
      throw new Error("Expected a pending item on the study screen.");
    }

    return itemId;
  }

  /** Answers the current question item with the given choice. */
  async function answerCurrent(
    sessionId: StudySessionId,
    choiceId: string,
    confidence:
      "GUESS" | "UNCERTAIN" | "FAIRLY_SURE" | "CONFIDENT" = "CONFIDENT",
  ): Promise<Awaited<ReturnType<StudyFacade["submitAnswer"]>>> {
    return facade.submitAnswer({
      type: "SINGLE_CHOICE",
      sessionId,
      itemId: await currentItemId(sessionId),
      choiceId,
      confidence,
      durationSeconds: 15,
    });
  }

  beforeEach(async () => {
    database = createMigratedDatabase();
    clock = new FixedClock(START);
    questions = new SqliteQuestionRepository(database);
    flashcards = new SqliteFlashcardRepository(database);
    sessions = new SqliteStudySessionRepository(database);
    facade = new StudyFacade({
      sessions,
      questions,
      flashcards,
      certifications: new SqliteCertificationRepository(database),
      unitOfWork: new SqliteStudyUnitOfWork(database),
      // The production policies, sharing the test clock: composed order and due
      // dates are asserted against the specified algorithms, not against stubs.
      composer: new DeterministicSessionComposer(),
      scheduler: new DeterministicReviewScheduler(clock),
      clock,
      ids: new SequentialIdGenerator("gen"),
    });

    const certifications = new SqliteCertificationRepository(database);
    const objectives = new SqliteObjectiveRepository(database);

    await certifications.save(TRACK);
    await certifications.save(SECOND_TRACK);
    await objectives.save(objectiveFixture());
  });

  afterEach(() => {
    database.close();
  });

  describe("the start form", () => {
    it("offers the tracks, the ten-minute default, and the studiable counts", async () => {
      await createQuestion("q-1");
      await createCard("c-1");

      const view = await facade.findStartForm(null);

      expect(view.tracks.map((track) => track.id)).toEqual([
        TRACK.id,
        SECOND_TRACK.id,
      ]);
      expect(view.defaultMinutes).toBe(DEFAULT_QUICK_MINUTES);
      expect(view.minuteOptions).toEqual([5, 10, 20, 30]);
      expect(view.activeQuestionCount).toBe(1);
      expect(view.dueCardCount).toBe(1);
      expect(view.preselectedId).toBeNull();
      expect(view.inProgressId).toBeNull();
    });

    it("preselects a track and merges its own planned length", async () => {
      await createQuestion("q-other", { certificationId: SECOND_TRACK.id });

      const view = await facade.findStartForm(SECOND_TRACK.slug);

      expect(view.preselectedId).toBe(SECOND_TRACK.id);
      // The track's planned study block is offered as a preset; the quick default
      // stays ten minutes, because "how long do I have now" is a different
      // question from "how long do I plan to study".
      expect(view.minuteOptions).toEqual([5, 10, 20, 30, 45]);
      expect(view.defaultMinutes).toBe(DEFAULT_QUICK_MINUTES);
      expect(view.activeQuestionCount).toBe(1);
    });

    it("counts only the preselected track's content", async () => {
      await createQuestion("q-1");
      await createQuestion("q-other", { certificationId: SECOND_TRACK.id });

      const view = await facade.findStartForm(TRACK.slug);

      expect(view.activeQuestionCount).toBe(1);
    });

    it("ignores a slug that names no track", async () => {
      await createQuestion("q-1");

      const view = await facade.findStartForm("no-such-track");

      expect(view.preselectedId).toBeNull();
      expect(view.activeQuestionCount).toBe(1);
    });

    it("disables every mode when nothing is studiable", async () => {
      const view = await facade.findStartForm(null);

      expect(view.modes.every((mode) => !mode.available)).toBe(true);
      // A disabled control has to say why (`spec/UI-GUIDELINES.md` section 1.4).
      expect(view.modes.every((mode) => mode.unavailableReason !== null)).toBe(
        true,
      );
    });

    it("disables flashcards-only until a card is due", async () => {
      await createQuestion("q-1");

      const view = await facade.findStartForm(null);
      const byMode = new Map(view.modes.map((mode) => [mode.mode, mode]));

      expect(byMode.get("QUESTIONS_ONLY")?.available).toBe(true);
      expect(byMode.get("SINGLE_TRACK")?.available).toBe(true);
      expect(byMode.get("FLASHCARDS_ONLY")?.available).toBe(false);
    });

    it("disables questions-only until a question is active", async () => {
      await createCard("c-1");

      const view = await facade.findStartForm(null);
      const byMode = new Map(view.modes.map((mode) => [mode.mode, mode]));

      expect(byMode.get("FLASHCARDS_ONLY")?.available).toBe(true);
      expect(byMode.get("QUESTIONS_ONLY")?.available).toBe(false);
    });

    it("offers mistake review only once something has been answered wrongly", async () => {
      await createQuestion("q-1");

      const before = await facade.findStartForm(null);

      expect(
        before.modes.find((mode) => mode.mode === "MISTAKE_REVIEW")?.available,
      ).toBe(false);

      const session = await facade.startSession(startInput());

      await answerCurrent(session.id, "choice-2");
      await facade.finishSession(session.id);

      const after = await facade.findStartForm(null);

      expect(
        after.modes.find((mode) => mode.mode === "MISTAKE_REVIEW")?.available,
      ).toBe(true);
    });

    it("stops offering mistake review once the mistaken question cannot be studied", async () => {
      await createQuestion("q-1");

      const session = await facade.startSession(startInput());

      await answerCurrent(session.id, "choice-2");
      await facade.finishSession(session.id);

      await questions.setLifecycleStatus("q-1", "RETIRED", clock.now());

      const after = await facade.findStartForm(null);

      // The attempt is still history the progress page reports, but composition
      // draws only from studiable questions, so offering the mode here would put a
      // control in front of the owner that then refuses to start.
      expect(
        after.modes.find((mode) => mode.mode === "MISTAKE_REVIEW")?.available,
      ).toBe(false);
      await expect(
        facade.startSession(startInput({ mode: "MISTAKE_REVIEW" })),
      ).rejects.toThrow(NoStudyContentError);
    });

    it("offers a diagnostic only at the documented threshold", async () => {
      const objectives = new SqliteObjectiveRepository(database);

      for (const index of [2, 3]) {
        await objectives.save(
          objectiveFixture({
            id: `objective-${index}`,
            title: `Objective ${index}`,
            displayOrder: index,
          }),
        );
      }

      // Five questions across three objectives: enough objectives, one question
      // short of the six a diagnostic needs.
      for (const index of [1, 2, 3, 4, 5]) {
        await createQuestion(`q-${index}`, {
          objectiveIds: [`objective-${((index - 1) % 3) + 1}`],
        });
      }

      const before = await facade.findStartForm(null);

      expect(
        before.modes.find((mode) => mode.mode === "DIAGNOSTIC")?.available,
      ).toBe(false);

      await createQuestion("q-6", { objectiveIds: ["objective-3"] });

      const after = await facade.findStartForm(null);

      expect(
        after.modes.find((mode) => mode.mode === "DIAGNOSTIC")?.available,
      ).toBe(true);
    });

    it("reports a session already in progress, so the form can offer to resume", async () => {
      await createQuestion("q-1");

      const session = await facade.startSession(startInput());
      const view = await facade.findStartForm(null);

      expect(view.inProgressId).toBe(session.id);
      await expect(facade.findInProgressId()).resolves.toBe(session.id);
    });
  });

  describe("starting a session", () => {
    it("composes a session without any AI call, from the bank alone", async () => {
      for (const index of [1, 2, 3]) {
        await createQuestion(`q-${index}`);
      }
      await createCard("c-1");

      const session = await facade.startSession(startInput());

      expect(session.status).toBe("IN_PROGRESS");
      expect(session.mode).toBe("SINGLE_TRACK");
      expect(session.targetMinutes).toBe(DEFAULT_QUICK_MINUTES);
      expect(session.certificationIds).toEqual([TRACK.id]);
      expect(session.createdAt).toBe(START);
      expect(session.completedAt).toBeNull();

      const view = await facade.findSession(session.id);

      // The overdue card comes first, then the questions
      // (`spec/DOMAIN-RULES.md` section 2.2).
      expect(view?.itemCount).toBe(4);
      expect(view?.current?.itemType).toBe("FLASHCARD");
      expect(view?.position).toBe(1);
      expect(view?.settledCount).toBe(0);
    });

    it("freezes the revision that was current when the session was composed", async () => {
      const created = await createQuestion("q-1");
      const session = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );

      const view = await facade.findSession(session.id);

      expect(view?.current?.item.content).toEqual({
        itemType: "QUESTION",
        questionId: "q-1",
        questionRevisionId: created.revisionId,
      });
    });

    it("sizes the session from the requested minutes", async () => {
      for (let index = 0; index < 20; index += 1) {
        await createQuestion(`q-${index}`);
      }

      const ten = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY", targetMinutes: 10 }),
      );

      // One minute per question, so ten minutes is ten questions.
      await expect(
        facade.findSession(ten.id).then((view) => view?.itemCount),
      ).resolves.toBe(10);

      const five = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY", targetMinutes: 5 }),
      );

      await expect(
        facade.findSession(five.id).then((view) => view?.itemCount),
      ).resolves.toBe(5);
    });

    it("keeps questions out of a flashcards-only session and cards out of a questions-only one", async () => {
      await createQuestion("q-1");
      await createCard("c-1");

      const cardsOnly = await facade.startSession(
        startInput({ mode: "FLASHCARDS_ONLY" }),
      );
      const cardsView = await facade.findSession(cardsOnly.id);

      expect(cardsView?.itemCount).toBe(1);
      expect(cardsView?.current?.itemType).toBe("FLASHCARD");

      const questionsOnly = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );
      const questionsView = await facade.findSession(questionsOnly.id);

      expect(questionsView?.itemCount).toBe(1);
      expect(questionsView?.current?.itemType).toBe("QUESTION");
    });

    it("composes a mixed-track session from every chosen track", async () => {
      await createQuestion("q-1");
      await createQuestion("q-other", { certificationId: SECOND_TRACK.id });

      const session = await facade.startSession(
        startInput({
          mode: "MIXED_TRACKS",
          certificationIds: [TRACK.id, SECOND_TRACK.id],
        }),
      );

      expect(session.certificationIds).toEqual([TRACK.id, SECOND_TRACK.id]);

      const view = await facade.findSession(session.id);

      expect(view?.itemCount).toBe(2);
      // Named tracks, in track-name order, so the study screen can say which
      // certification the current item belongs to.
      expect(view?.tracks.map((track) => track.id)).toEqual([
        TRACK.id,
        SECOND_TRACK.id,
      ]);
    });

    it("narrows a single-track request that somehow named several tracks", async () => {
      await createQuestion("q-1");
      await createQuestion("q-other", { certificationId: SECOND_TRACK.id });

      const session = await facade.startSession(
        startInput({ certificationIds: [TRACK.id, SECOND_TRACK.id] }),
      );

      // The owner asked for one track, so the session is about one track rather
      // than being quietly widened.
      expect(session.certificationIds).toEqual([TRACK.id]);
      await expect(
        facade.findSession(session.id).then((view) => view?.itemCount),
      ).resolves.toBe(1);
    });

    it("composes a mistake review from recorded wrong answers only", async () => {
      // Two questions created at the same instant, so the composed order is the
      // documented id tie-break: q-1 first, then q-2.
      await createQuestion("q-1");
      await createQuestion("q-2");

      const first = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );

      // q-1 is answered incorrectly, q-2 correctly.
      await answerCurrent(first.id, "choice-2");
      await answerCurrent(first.id, "choice-1");
      await facade.finishSession(first.id);

      const review = await facade.startSession(
        startInput({ mode: "MISTAKE_REVIEW" }),
      );
      const view = await facade.findSession(review.id);

      expect(view?.itemCount).toBe(1);
      expect(view?.current?.item.content).toMatchObject({
        questionId: "q-1",
      });
    });

    it("refuses a mode with nothing to offer, naming what to do about it", async () => {
      await createQuestion("q-1");

      await expect(
        facade.startSession(startInput({ mode: "FLASHCARDS_ONLY" })),
      ).rejects.toBeInstanceOf(NoStudyContentError);
      await expect(
        facade.startSession(startInput({ mode: "MISTAKE_REVIEW" })),
      ).rejects.toThrow(/no recorded mistakes/i);
    });

    it("refuses a diagnostic below the threshold rather than composing a small one", async () => {
      await createQuestion("q-1", { objectiveIds: ["objective-1"] });

      await expect(
        facade.startSession(startInput({ mode: "DIAGNOSTIC" })),
      ).rejects.toBeInstanceOf(DiagnosticNotAvailableError);
    });

    it("refuses a track that does not exist", async () => {
      await createQuestion("q-1");

      await expect(
        facade.startSession(startInput({ certificationIds: ["missing"] })),
      ).rejects.toBeInstanceOf(CertificationNotFoundError);
    });

    it("never composes a draft, retired, archived, or disputed question", async () => {
      await createQuestion("q-active");
      await questions.create(
        questionFixture({ id: "q-draft", currentRevisionId: "draft-rev" }),
        revisionFixture({ id: "draft-rev", questionId: "q-draft" }),
      );
      await createQuestion("q-retired");
      await questions.setLifecycleStatus("q-retired", "RETIRED", LATER);
      await createQuestion("q-disputed");
      await questions.setQualityStatus(
        "q-disputed",
        "DISPUTED",
        "Needs a source check.",
        LATER,
      );

      const session = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );
      const view = await facade.findSession(session.id);

      expect(view?.itemCount).toBe(1);
      expect(view?.current?.item.content).toMatchObject({
        questionId: "q-active",
      });
    });

    it("abandons the session in progress and keeps its recorded answers", async () => {
      await createQuestion("q-1");
      await createQuestion("q-2");

      const first = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );

      await answerCurrent(first.id, "choice-1");

      clock.set(LATER);

      const second = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );

      // Only one session runs at a time, so "resume" has one destination.
      await expect(facade.findInProgressId()).resolves.toBe(second.id);

      const superseded = await facade.findSummary(first.id);

      expect(superseded?.session.status).toBe("ABANDONED");
      expect(superseded?.session.completedAt).toBe(LATER);
      // The answer given in the abandoned session is still history.
      expect(superseded?.attemptCount).toBe(1);
      expect(superseded?.correctCount).toBe(1);
    });

    it("is deterministic: the same bank composes the same session", async () => {
      for (const index of [1, 2, 3]) {
        await createQuestion(`q-${index}`);
      }

      const first = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );
      const firstItems = await sessions.findWithItems(first.id);
      const second = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );
      const secondItems = await sessions.findWithItems(second.id);

      expect(secondItems?.items.map((item) => item.content)).toEqual(
        firstItems?.items.map((item) => item.content),
      );
    });
  });

  describe("submitting an answer", () => {
    it("records the attempt and completes the item together", async () => {
      await createQuestion("q-1");
      await createQuestion("q-2");

      const session = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );
      const itemId = await currentItemId(session.id);
      const outcome = await facade.submitAnswer({
        type: "SINGLE_CHOICE",
        sessionId: session.id,
        itemId,
        choiceId: "choice-1",
        confidence: "FAIRLY_SURE",
        durationSeconds: 22,
      });

      expect(outcome.attempt.isCorrect).toBe(true);
      expect(outcome.attempt.evaluationMode).toBe("DETERMINISTIC");
      expect(outcome.attempt.confidence).toBe("FAIRLY_SURE");
      expect(outcome.attempt.durationSeconds).toBe(22);
      expect(outcome.attempt.attemptedAt).toBe(START);
      expect(outcome.attempt.feedbackSnapshot).toBeNull();
      expect(outcome.sessionComplete).toBe(false);

      // Both writes landed: the attempt is queryable and the item has moved on.
      const view = await facade.findSession(session.id);

      expect(view?.attemptCount).toBe(1);
      expect(view?.correctCount).toBe(1);
      expect(view?.settledCount).toBe(1);
      expect(view?.current?.item.id).not.toBe(itemId);
      await expect(facade.listAttemptsForQuestion("q-1")).resolves.toHaveLength(
        1,
      );
    });

    it("records neither the attempt nor the completion when grading refuses", async () => {
      await createQuestion("q-1");

      const session = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );
      const itemId = await currentItemId(session.id);

      await expect(
        facade.submitAnswer({
          type: "SINGLE_CHOICE",
          sessionId: session.id,
          itemId,
          choiceId: "choice-99",
          confidence: "GUESS",
          durationSeconds: null,
        }),
      ).rejects.toThrow();

      // The transaction rolled back, so the item is still answerable.
      const view = await facade.findSession(session.id);

      expect(view?.attemptCount).toBe(0);
      expect(view?.settledCount).toBe(0);
      expect(view?.current?.item.id).toBe(itemId);
    });

    it("grades a multiple response on exact set equality", async () => {
      await createQuestion("q-1", { type: "MULTIPLE_RESPONSE" });

      const session = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );
      const partial = await facade.submitAnswer({
        type: "MULTIPLE_RESPONSE",
        sessionId: session.id,
        itemId: await currentItemId(session.id),
        choiceIds: ["choice-1"],
        confidence: "UNCERTAIN",
        durationSeconds: null,
      });

      // No partial credit (`SPEC.md` section 6.7).
      expect(partial.attempt.isCorrect).toBe(false);
    });

    it("records a short answer as self-assessed", async () => {
      await createQuestion("q-1", { type: "SHORT_ANSWER" });

      const session = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );
      const outcome = await facade.submitAnswer({
        type: "SHORT_ANSWER",
        sessionId: session.id,
        itemId: await currentItemId(session.id),
        text: "It stores objects durably.",
        selfAssessment: true,
        confidence: "FAIRLY_SURE",
        durationSeconds: null,
      });

      expect(outcome.attempt.isCorrect).toBe(true);
      expect(outcome.attempt.evaluationMode).toBe("SELF_ASSESSED");
      expect(outcome.attempt.submittedAnswer).toEqual({
        type: "SHORT_ANSWER",
        text: "It stores objects durably.",
      });
    });

    it("reports the session complete on the last pending item", async () => {
      await createQuestion("q-1");

      const session = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );
      const outcome = await answerCurrent(session.id, "choice-1");

      expect(outcome.sessionComplete).toBe(true);

      const view = await facade.findSession(session.id);

      // Nothing pending, so the screen offers to finish rather than an item.
      expect(view?.current).toBeNull();
      expect(view?.position).toBe(1);
    });

    it("refuses a second answer to the same item", async () => {
      await createQuestion("q-1");
      await createQuestion("q-2");

      const session = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );
      const itemId = await currentItemId(session.id);

      await facade.submitAnswer({
        type: "SINGLE_CHOICE",
        sessionId: session.id,
        itemId,
        choiceId: "choice-1",
        confidence: "CONFIDENT",
        durationSeconds: null,
      });

      // A double-tapped submit button, or a back-button resubmission.
      await expect(
        facade.submitAnswer({
          type: "SINGLE_CHOICE",
          sessionId: session.id,
          itemId,
          choiceId: "choice-2",
          confidence: "CONFIDENT",
          durationSeconds: null,
        }),
      ).rejects.toBeInstanceOf(SessionItemNotFoundError);
      await expect(facade.listAttemptsForQuestion("q-1")).resolves.toHaveLength(
        1,
      );
    });

    it("refuses an answer to a session that has already ended", async () => {
      await createQuestion("q-1");
      await createQuestion("q-2");

      const session = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );
      const itemId = await currentItemId(session.id);

      await facade.finishSession(session.id);

      await expect(
        facade.submitAnswer({
          type: "SINGLE_CHOICE",
          sessionId: session.id,
          itemId,
          choiceId: "choice-1",
          confidence: "CONFIDENT",
          durationSeconds: null,
        }),
      ).rejects.toBeInstanceOf(SessionNotInProgressError);
    });

    it("refuses an answer submitted for a flashcard item", async () => {
      await createCard("c-1");

      const session = await facade.startSession(
        startInput({ mode: "FLASHCARDS_ONLY" }),
      );

      await expect(
        facade.submitAnswer({
          type: "SINGLE_CHOICE",
          sessionId: session.id,
          itemId: await currentItemId(session.id),
          choiceId: "choice-1",
          confidence: "CONFIDENT",
          durationSeconds: null,
        }),
      ).rejects.toBeInstanceOf(SessionItemNotFoundError);
    });
  });

  describe("editing a question during a session", () => {
    it("keeps the frozen wording and records the attempt against the old revision", async () => {
      const created = await createQuestion("q-1");
      const session = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );

      // The question is edited after the session was composed: a new revision, a
      // different correct choice, and a different stem.
      await questions.appendRevision(
        revisionFixture({
          id: "q-1-rev-2",
          questionId: "q-1",
          revisionNumber: 2,
          stem: "Rewritten stem?",
          content: {
            type: "SINGLE_CHOICE",
            choices: [
              { id: "choice-1", text: "Amazon S3" },
              { id: "choice-2", text: "Amazon EBS" },
            ],
            correctChoiceId: "choice-2",
          },
        }),
        LATER,
      );

      // Resuming shows what was composed, not what the bank now holds
      // (`spec/DOMAIN-RULES.md` section 2.3).
      const resumed = await facade.findSession(session.id);

      expect(resumed?.current?.item.content).toMatchObject({
        questionRevisionId: created.revisionId,
      });
      expect(
        resumed?.current?.itemType === "QUESTION"
          ? resumed.current.revision.stem
          : null,
      ).toBe("Stem of q-1?");

      const outcome = await answerCurrent(session.id, "choice-1");

      // Graded against the frozen revision, so the answer is correct even though
      // the current revision says otherwise.
      expect(outcome.attempt.questionRevisionId).toBe(created.revisionId);
      expect(outcome.attempt.isCorrect).toBe(true);

      const [attempt] = await facade.listAttemptsForQuestion("q-1");

      expect(attempt?.questionRevisionId).toBe(created.revisionId);
      // And the current revision is still the new one: the session did not undo
      // the edit.
      await expect(
        questions
          .findById("q-1")
          .then((question) => question?.currentRevisionId),
      ).resolves.toBe("q-1-rev-2");
    });

    it("shows the frozen wording in the summary's mistake list", async () => {
      await createQuestion("q-1");

      const session = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );

      await answerCurrent(session.id, "choice-2");
      await questions.appendRevision(
        revisionFixture({
          id: "q-1-rev-2",
          questionId: "q-1",
          revisionNumber: 2,
          stem: "Rewritten stem?",
        }),
        LATER,
      );

      const summary = await facade.findSummary(session.id);

      expect(summary?.mistakes.map((mistake) => mistake.stem)).toEqual([
        "Stem of q-1?",
      ]);
    });
  });

  describe("rating a flashcard inside a session", () => {
    it("writes the review, the schedule, and the item completion together", async () => {
      await createCard("c-1");

      const session = await facade.startSession(
        startInput({ mode: "FLASHCARDS_ONLY" }),
      );
      const itemId = await currentItemId(session.id);
      const outcome = await facade.rateSessionCard({
        sessionId: session.id,
        itemId,
        rating: "GOOD",
      });

      expect(outcome.rating).toBe("GOOD");
      expect(outcome.schedule.schedulerId).toBe(DETERMINISTIC_SCHEDULER_ID);
      expect(outcome.sessionComplete).toBe(true);

      // All three writes landed.
      await expect(flashcards.findSchedule("c-1")).resolves.toEqual(
        outcome.schedule,
      );
      await expect(flashcards.listReviews("c-1", 10)).resolves.toMatchObject([
        {
          flashcardId: "c-1",
          flashcardRevisionId: "c-1-rev-1",
          rating: "GOOD",
          dueAt: outcome.schedule.dueAt,
        },
      ]);

      const view = await facade.findSession(session.id);

      expect(view?.settledCount).toBe(1);
      expect(view?.current).toBeNull();
      // A rating is not an answer: the session records no attempt for it.
      expect(view?.attemptCount).toBe(0);
    });

    it("schedules exactly as the review screen would", async () => {
      await createCard("c-1");
      await createCard("c-2");

      const session = await facade.startSession(
        startInput({ mode: "FLASHCARDS_ONLY" }),
      );
      const inSession = await facade.rateSessionCard({
        sessionId: session.id,
        itemId: await currentItemId(session.id),
        rating: "GOOD",
      });
      const directly = new DeterministicReviewScheduler(clock).schedule({
        rating: "GOOD",
        current: null,
      });

      // The same strategy the D4 review screen uses, so a card rated inside a
      // session is scheduled identically to one rated on the review page.
      expect(inSession.schedule).toEqual(directly);
    });

    it("takes the card out of the next session's due queue", async () => {
      await createCard("c-1");

      const session = await facade.startSession(
        startInput({ mode: "FLASHCARDS_ONLY" }),
      );

      await facade.rateSessionCard({
        sessionId: session.id,
        itemId: await currentItemId(session.id),
        rating: "GOOD",
      });
      await facade.finishSession(session.id);

      await expect(
        facade.startSession(startInput({ mode: "FLASHCARDS_ONLY" })),
      ).rejects.toBeInstanceOf(NoStudyContentError);
    });

    it("refuses a rating submitted for a question item", async () => {
      await createQuestion("q-1");

      const session = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );

      await expect(
        facade.rateSessionCard({
          sessionId: session.id,
          itemId: await currentItemId(session.id),
          rating: "GOOD",
        }),
      ).rejects.toBeInstanceOf(SessionItemNotFoundError);
    });

    it("refuses a rating for a card retired since the session was composed", async () => {
      await createCard("c-1");

      const session = await facade.startSession(
        startInput({ mode: "FLASHCARDS_ONLY" }),
      );
      const itemId = await currentItemId(session.id);

      await flashcards.setLifecycleStatus("c-1", "RETIRED", LATER);

      await expect(
        facade.rateSessionCard({
          sessionId: session.id,
          itemId,
          rating: "GOOD",
        }),
      ).rejects.toThrow(/retired/i);
      // Nothing was written, so the card is not back on a schedule.
      await expect(flashcards.findSchedule("c-1")).resolves.toBeNull();
      await expect(flashcards.listReviews("c-1", 10)).resolves.toEqual([]);
    });
  });

  describe("skipping, pausing, and finishing", () => {
    it("records a skip without recording an attempt", async () => {
      await createQuestion("q-1");
      await createQuestion("q-2");

      const session = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );
      const itemId = await currentItemId(session.id);
      const outcome = await facade.skipItem(session.id, itemId);

      expect(outcome.sessionComplete).toBe(false);

      const view = await facade.findSession(session.id);

      // No attempt means no score, which is what keeps a skipped objective
      // unseen rather than scored zero (`spec/DOMAIN-RULES.md` section 2.5).
      expect(view?.attemptCount).toBe(0);
      expect(view?.settledCount).toBe(1);
      expect(view?.current?.item.id).not.toBe(itemId);
      await expect(facade.listAttemptsForQuestion("q-1")).resolves.toEqual([]);
    });

    it("resumes at the same item after leaving the screen", async () => {
      for (const index of [1, 2, 3]) {
        await createQuestion(`q-${index}`);
      }

      const session = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );

      await answerCurrent(session.id, "choice-1");

      const paused = await facade.findSession(session.id);

      // Pausing is just leaving: every answer was committed when it was given, so
      // there is no cursor to save and nothing to lose.
      await expect(facade.findInProgressId()).resolves.toBe(session.id);

      const resumed = await facade.findSession(session.id);

      expect(resumed?.current?.item.id).toBe(paused?.current?.item.id);
      expect(resumed?.position).toBe(2);
      expect(resumed?.settledCount).toBe(1);
    });

    it("finishes early and leaves unreached items pending", async () => {
      for (const index of [1, 2, 3]) {
        await createQuestion(`q-${index}`);
      }

      const session = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );

      await answerCurrent(session.id, "choice-1");

      clock.set(LATER);

      const finished = await facade.finishSession(session.id);

      expect(finished.status).toBe("COMPLETED");
      expect(finished.completedAt).toBe(LATER);
      await expect(facade.findInProgressId()).resolves.toBeNull();

      const summary = await facade.findSummary(session.id);

      // Items never reached stay pending: recording them as skipped would claim
      // the owner saw them.
      expect(summary?.itemCount).toBe(3);
      expect(summary?.settledCount).toBe(1);
      expect(summary?.attemptCount).toBe(1);
      expect(summary?.correctCount).toBe(1);
    });

    it("refuses to finish a session twice", async () => {
      await createQuestion("q-1");

      const session = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );

      await facade.finishSession(session.id);

      await expect(facade.finishSession(session.id)).rejects.toBeInstanceOf(
        SessionNotInProgressError,
      );
    });

    it("refuses to finish a session that does not exist", async () => {
      await expect(
        facade.finishSession("session-missing"),
      ).rejects.toBeInstanceOf(StudySessionNotFoundError);
    });
  });

  describe("summary and history", () => {
    it("summarizes what the session actually recorded", async () => {
      await createQuestion("q-1");
      await createQuestion("q-2");
      await createCard("c-1");

      const session = await facade.startSession(startInput());

      await facade.rateSessionCard({
        sessionId: session.id,
        itemId: await currentItemId(session.id),
        rating: "HARD",
      });
      await answerCurrent(session.id, "choice-1");
      await answerCurrent(session.id, "choice-2", "CONFIDENT");
      await facade.finishSession(session.id);

      const summary = await facade.findSummary(session.id);

      expect(summary?.itemCount).toBe(3);
      expect(summary?.settledCount).toBe(3);
      expect(summary?.cardsRated).toBe(1);
      expect(summary?.attemptCount).toBe(2);
      expect(summary?.correctCount).toBe(1);
      expect(summary?.mistakes).toHaveLength(1);
      expect(summary?.mistakes[0]?.stem).toBe("Stem of q-2?");
      expect(summary?.tracks.map((track) => track.id)).toEqual([TRACK.id]);
    });

    it("returns nothing for a session that does not exist", async () => {
      await expect(facade.findSession("missing")).resolves.toBeNull();
      await expect(facade.findSummary("missing")).resolves.toBeNull();
    });

    it("lists sessions newest first with their counts", async () => {
      await createQuestion("q-1");
      await createQuestion("q-2");

      const first = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );

      await answerCurrent(first.id, "choice-1");
      await facade.finishSession(first.id);

      clock.set(LATER);

      const second = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );
      const history = await facade.listHistory();

      expect(history.map((entry) => entry.session.id)).toEqual([
        second.id,
        first.id,
      ]);
      expect(history[1]).toMatchObject({
        itemCount: 2,
        settledCount: 1,
        attemptCount: 1,
        correctCount: 1,
      });
    });

    it("lists no history before any session has been started", async () => {
      await expect(facade.listHistory()).resolves.toEqual([]);
    });
  });

  describe("feedback for a recorded attempt", () => {
    it("reads back the attempt with the revision it was graded against", async () => {
      const created = await createQuestion("q-1");

      const session = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );
      const outcome = await answerCurrent(session.id, "choice-2");
      const feedback = await facade.findFeedback(
        session.id,
        outcome.attempt.id,
      );

      expect(feedback?.attempt).toEqual(outcome.attempt);
      expect(feedback?.question.id).toBe("q-1");
      expect(feedback?.revision.id).toBe(created.revisionId);
    });

    it("refuses to read another session's attempt", async () => {
      await createQuestion("q-1");
      await createQuestion("q-2");

      const first = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );
      const outcome = await answerCurrent(first.id, "choice-1");

      await facade.finishSession(first.id);

      const second = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );

      // A hand-edited URL must not read an answer from another session.
      await expect(
        facade.findFeedback(second.id, outcome.attempt.id),
      ).resolves.toBeNull();
    });

    it("returns nothing for an attempt that does not exist", async () => {
      await createQuestion("q-1");

      const session = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );

      await expect(
        facade.findFeedback(session.id, "attempt-missing"),
      ).resolves.toBeNull();
    });
  });

  describe("attempt history for one question", () => {
    it("lists a question's attempts most recent first", async () => {
      await createQuestion("q-1");

      const first = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );

      await answerCurrent(first.id, "choice-2");
      await facade.finishSession(first.id);

      clock.set(LATER);

      const second = await facade.startSession(
        startInput({ mode: "QUESTIONS_ONLY" }),
      );

      await answerCurrent(second.id, "choice-1");

      const attempts = await facade.listAttemptsForQuestion("q-1");

      expect(
        attempts.map((attempt) => [attempt.attemptedAt, attempt.isCorrect]),
      ).toEqual([
        [LATER, true],
        [START, false],
      ]);
    });

    it("lists nothing for a question that has never been answered", async () => {
      await createQuestion("q-1");

      await expect(facade.listAttemptsForQuestion("q-1")).resolves.toEqual([]);
    });
  });
});
