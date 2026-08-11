import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import {
  FixedClock,
  SequentialIdGenerator,
  certificationFixture,
  createMigratedDatabase,
} from "@/modules/certifications/infrastructure/test-support";
import { DeterministicReviewScheduler } from "@/modules/flashcards/domain/review-scheduling";
import { FlashcardQuestionDependencyChecker } from "@/modules/flashcards/infrastructure/flashcard-question-dependency-checker";
import { SqliteFlashcardRepository } from "@/modules/flashcards/infrastructure/sqlite-flashcard-repository";
import {
  basicContent,
  cardRevisionFixture,
  flashcardFixture,
} from "@/modules/flashcards/infrastructure/test-support";
import { QuestionBankFacade } from "@/modules/question-bank/application/question-bank-facade";
import { QuestionNotDeletableError } from "@/modules/question-bank/domain/errors";
import { SqliteQuestionBankUnitOfWork } from "@/modules/question-bank/infrastructure/sqlite-question-bank-unit-of-work";
import { SqliteQuestionRepository } from "@/modules/question-bank/infrastructure/sqlite-question-repository";
import {
  questionFixture,
  revisionFixture,
} from "@/modules/question-bank/infrastructure/test-support";
import type { QuestionInput } from "@/modules/question-bank/application/schemas";
import { StudyFacade } from "@/modules/study-sessions/application/study-facade";
import { DeterministicSessionComposer } from "@/modules/study-sessions/domain/session-composer";
import {
  AttemptQuestionDependencyChecker,
  CompositeQuestionDependencyChecker,
} from "./attempt-question-dependency-checker";
import { SqliteStudySessionRepository } from "./sqlite-study-session-repository";
import { SqliteStudyUnitOfWork } from "./sqlite-study-unit-of-work";
import {
  sessionFixture,
  questionItemFixture,
  attemptFixture,
} from "./test-support";

/**
 * Study history as a reason a question cannot be hard-deleted
 * (`SPEC.md` section 6.3.2, `spec/DOMAIN-RULES.md` section 1.3).
 *
 * The suite wires the same composite checker the composition root does, and drives
 * the deletion through the question-bank facade, because the requirement is about
 * what the owner is told when they press delete — not just about what a checker
 * returns in isolation.
 */

const TRACK = certificationFixture();
const START = "2026-04-01T08:00:00.000Z";

function singleChoiceInput(): QuestionInput {
  return {
    questionType: "SINGLE_CHOICE",
    stem: "Which service stores objects?",
    instructions: null,
    explanation: null,
    difficulty: null,
    tags: [],
    language: null,
    choiceTexts: ["Amazon S3", "Amazon EBS"],
    correctChoiceIndexes: [0],
  };
}

describe("AttemptQuestionDependencyChecker", () => {
  let database: SqliteDatabase;
  let sessions: SqliteStudySessionRepository;
  let questions: SqliteQuestionRepository;
  let checker: AttemptQuestionDependencyChecker;

  beforeEach(async () => {
    database = createMigratedDatabase();
    sessions = new SqliteStudySessionRepository(database);
    questions = new SqliteQuestionRepository(database);
    checker = new AttemptQuestionDependencyChecker(sessions);

    await new SqliteCertificationRepository(database).save(TRACK);
    await questions.create(
      questionFixture({ lifecycleStatus: "ACTIVE" }),
      revisionFixture(),
    );
  });

  afterEach(() => {
    database.close();
  });

  it("reports a never-studied question as deletable", async () => {
    await expect(
      checker.checkDeletionEligibility("question-1"),
    ).resolves.toEqual({ deletable: true, blockingDependencies: [] });
  });

  it("reports a question a session offered as depended on by that session", async () => {
    await sessions.create(sessionFixture(), [questionItemFixture()]);

    await expect(
      checker.checkDeletionEligibility("question-1"),
    ).resolves.toEqual({
      deletable: false,
      // Offered but not answered: the session is still a record of what was shown.
      blockingDependencies: ["STUDY_SESSIONS"],
    });
  });

  it("reports both kinds once the question has also been answered", async () => {
    await sessions.create(sessionFixture(), [questionItemFixture()]);
    await sessions.recordAttempt(attemptFixture());

    await expect(
      checker.checkDeletionEligibility("question-1"),
    ).resolves.toEqual({
      deletable: false,
      blockingDependencies: ["ATTEMPTS", "STUDY_SESSIONS"],
    });
  });

  it("reports a question that no session names as deletable", async () => {
    await questions.create(
      questionFixture({ id: "question-2", currentRevisionId: "revision-2" }),
      revisionFixture({ id: "revision-2", questionId: "question-2" }),
    );
    await sessions.create(sessionFixture(), [questionItemFixture()]);

    await expect(
      checker.checkDeletionEligibility("question-2"),
    ).resolves.toEqual({ deletable: true, blockingDependencies: [] });
  });
});

describe("CompositeQuestionDependencyChecker", () => {
  let database: SqliteDatabase;
  let clock: FixedClock;
  let questions: SqliteQuestionRepository;
  let flashcards: SqliteFlashcardRepository;
  let sessions: SqliteStudySessionRepository;
  let bank: QuestionBankFacade;
  let study: StudyFacade;

  /** Creates a question through the facade and activates it, as the owner would. */
  async function createActiveQuestion(): Promise<string> {
    const created = await bank.createQuestion(TRACK.id, singleChoiceInput());

    await bank.activateQuestion(created.id);

    return created.id;
  }

  /** Runs a one-question session and answers its only item. */
  async function answerOnce(): Promise<void> {
    const session = await study.startSession({
      mode: "QUESTIONS_ONLY",
      certificationIds: [TRACK.id],
      targetMinutes: 10,
    });
    const view = await study.findSession(session.id);
    const itemId = view?.current?.item.id;

    if (itemId === undefined) {
      throw new Error("Expected a question to answer.");
    }

    await study.submitAnswer({
      type: "SINGLE_CHOICE",
      sessionId: session.id,
      itemId,
      choiceId: "choice-1",
      confidence: "CONFIDENT",
      durationSeconds: 10,
    });
    await study.finishSession(session.id);
  }

  beforeEach(async () => {
    database = createMigratedDatabase();
    clock = new FixedClock(START);
    questions = new SqliteQuestionRepository(database);
    flashcards = new SqliteFlashcardRepository(database);
    sessions = new SqliteStudySessionRepository(database);

    const certifications = new SqliteCertificationRepository(database);

    // Exactly the composition the composition root builds, so this suite tests
    // what production actually consults.
    bank = new QuestionBankFacade({
      questions,
      certifications,
      objectives: new SqliteObjectiveRepository(database),
      unitOfWork: new SqliteQuestionBankUnitOfWork(database),
      dependencies: new CompositeQuestionDependencyChecker(
        new FlashcardQuestionDependencyChecker(flashcards),
        new AttemptQuestionDependencyChecker(sessions),
      ),
      clock,
      ids: new SequentialIdGenerator("bank"),
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
      ids: new SequentialIdGenerator("study"),
    });

    await certifications.save(TRACK);
  });

  afterEach(() => {
    database.close();
  });

  it("refuses to delete a question the owner has answered, and says why", async () => {
    const questionId = await createActiveQuestion();

    await answerOnce();

    const error = await bank
      .deleteQuestion(questionId)
      .catch((thrown) => thrown);

    expect(error).toBeInstanceOf(QuestionNotDeletableError);
    expect((error as QuestionNotDeletableError).dependencies).toEqual([
      "answer attempts",
      "study-session history",
    ]);
    // The refusal names retirement as the alternative, so the message is
    // actionable (`spec/UI-GUIDELINES.md` section 1.4).
    expect(
      (error as QuestionNotDeletableError).fieldMessages()[""]?.[0],
    ).toMatch(/retire it instead/i);
    // Nothing was deleted.
    await expect(questions.findById(questionId)).resolves.not.toBeNull();
  });

  it("reports the answered question as undeletable in the detail view", async () => {
    const questionId = await createActiveQuestion();

    await answerOnce();

    const view = await bank.findDetail(TRACK.slug, questionId);

    // The view is told before the owner presses delete.
    expect(view?.deletable).toBe(false);
    expect(view?.blockingDependencies).toEqual([
      "answer attempts",
      "study-session history",
    ]);
  });

  it("still lets the owner retire an answered question", async () => {
    const questionId = await createActiveQuestion();

    await answerOnce();
    await bank.retireQuestion(questionId);

    await expect(
      questions
        .findById(questionId)
        .then((question) => question?.lifecycleStatus),
    ).resolves.toBe("RETIRED");
    // Retiring is the documented alternative, and the attempt history survives it.
    await expect(
      sessions.listAttemptsForQuestion({ questionId, limit: 10 }),
    ).resolves.toHaveLength(1);
  });

  it("reports flashcard and study dependencies together", async () => {
    const questionId = await createActiveQuestion();

    await answerOnce();
    await flashcards.create(
      flashcardFixture({ sourceQuestionId: questionId }),
      cardRevisionFixture({ content: basicContent() }),
    );

    await expect(bank.checkDeletable(questionId)).resolves.toEqual({
      deletable: false,
      // Every reason at once, rather than one per delete attempt.
      blockingDependencies: [
        "DERIVED_FLASHCARDS",
        "ATTEMPTS",
        "STUDY_SESSIONS",
      ],
    });
  });

  it("still deletes a question nothing depends on", async () => {
    const questionId = await createActiveQuestion();

    await expect(bank.deleteQuestion(questionId)).resolves.toBe(TRACK.id);
    await expect(questions.findById(questionId)).resolves.toBeNull();
  });
});
