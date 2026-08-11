import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CertificationRepository } from "@/modules/certifications/ports/certification-repository";
import type { ObjectiveRepository } from "@/modules/certifications/ports/objective-repository";
import {
  certificationFixture,
  objectiveFixture,
} from "@/modules/certifications/infrastructure/test-support";
import type { QuestionRepository } from "@/modules/question-bank/ports/question-repository";
import {
  questionFixture,
  revisionFixture,
} from "@/modules/question-bank/infrastructure/test-support";
import type { FlashcardRepository } from "@/modules/flashcards/ports/flashcard-repository";
import {
  cardRevisionFixture,
  flashcardFixture,
} from "@/modules/flashcards/infrastructure/test-support";
import {
  SessionItemNotFoundError,
  StudySessionNotFoundError,
} from "@/modules/study-sessions/domain/errors";
import {
  attemptFixture,
  cardItemFixture,
  questionItemFixture,
  sessionFixture,
} from "@/modules/study-sessions/infrastructure/test-support";
import type { StudySessionRepository } from "./study-session-repository";

/**
 * Shared study-session-repository contract.
 *
 * Defines the domain-observable behaviour every study-session persistence adapter
 * must provide, so the PostgreSQL adapter in D13 runs these same assertions rather
 * than a parallel set (`spec/ARCHITECTURE.md` section 7.4).
 */

export interface StudySessionContractSubject {
  readonly sessions: StudySessionRepository;
  readonly certifications: CertificationRepository;
  readonly objectives: ObjectiveRepository;
  readonly questions: QuestionRepository;
  readonly flashcards: FlashcardRepository;
  /** Called after each test so state never leaks between cases. */
  dispose(): void;
}

const NOW = "2026-06-01T12:00:00.000Z";
const LATER = "2026-06-01T13:00:00.000Z";
const LATEST = "2026-06-01T14:00:00.000Z";
const UNBOUNDED = 50;

export function describeStudySessionRepositoryContract(
  adapterName: string,
  createSubject: () => StudySessionContractSubject,
): void {
  describe(`${adapterName} study-session repository contract`, () => {
    let subject: StudySessionContractSubject;

    /** One question with one revision, which items and attempts can reference. */
    async function saveQuestion(
      id = "question-1",
      overrides: Parameters<typeof questionFixture>[0] = {},
    ): Promise<{ readonly questionId: string; readonly revisionId: string }> {
      const revisionId = `${id}-revision-1`;

      await subject.questions.create(
        questionFixture({
          id,
          currentRevisionId: revisionId,
          lifecycleStatus: "ACTIVE",
          ...overrides,
        }),
        revisionFixture({ id: revisionId, questionId: id }),
      );

      return { questionId: id, revisionId };
    }

    async function saveCard(
      id = "flashcard-1",
    ): Promise<{ readonly flashcardId: string; readonly revisionId: string }> {
      const revisionId = `${id}-revision-1`;

      await subject.flashcards.create(
        flashcardFixture({
          id,
          currentRevisionId: revisionId,
          lifecycleStatus: "ACTIVE",
        }),
        cardRevisionFixture({ id: revisionId, flashcardId: id }),
      );

      return { flashcardId: id, revisionId };
    }

    beforeEach(async () => {
      subject = createSubject();
      // Sessions reference a certification, so every case starts from one saved
      // track plus one objective questions can be mapped to.
      await subject.certifications.save(certificationFixture());
      await subject.objectives.save(objectiveFixture());
    });

    afterEach(() => {
      subject.dispose();
    });

    describe("session round trip", () => {
      it("round-trips a session with its ordered items", async () => {
        const question = await saveQuestion();
        const card = await saveCard();
        const session = sessionFixture({ createdAt: NOW });
        const items = [
          cardItemFixture({
            id: "item-1",
            position: 1,
            content: {
              itemType: "FLASHCARD",
              flashcardId: card.flashcardId,
              flashcardRevisionId: card.revisionId,
            },
          }),
          questionItemFixture({
            id: "item-2",
            position: 2,
            content: {
              itemType: "QUESTION",
              questionId: question.questionId,
              questionRevisionId: question.revisionId,
            },
          }),
        ];

        await subject.sessions.create(session, items);

        await expect(subject.sessions.findById(session.id)).resolves.toEqual(
          session,
        );
        await expect(
          subject.sessions.findWithItems(session.id),
        ).resolves.toEqual({ session, items });
      });

      it("returns items in position order regardless of insert order", async () => {
        const question = await saveQuestion();
        const session = sessionFixture();

        await subject.sessions.create(session, [
          questionItemFixture({
            id: "item-3",
            position: 3,
            content: {
              itemType: "QUESTION",
              questionId: question.questionId,
              questionRevisionId: question.revisionId,
            },
          }),
          questionItemFixture({
            id: "item-1",
            position: 1,
            content: {
              itemType: "QUESTION",
              questionId: question.questionId,
              questionRevisionId: question.revisionId,
            },
          }),
        ]);

        const found = await subject.sessions.findWithItems(session.id);

        expect(found?.items.map((item) => item.id)).toEqual([
          "item-1",
          "item-3",
        ]);
      });

      it("keeps several tracks on a mixed-track session", async () => {
        await subject.certifications.save(
          certificationFixture({
            id: "certification-2",
            slug: "another-track",
            name: "Another Track",
          }),
        );

        const session = sessionFixture({
          mode: "MIXED_TRACKS",
          certificationIds: ["certification-1", "certification-2"],
        });
        const question = await saveQuestion();

        await subject.sessions.create(session, [
          questionItemFixture({
            content: {
              itemType: "QUESTION",
              questionId: question.questionId,
              questionRevisionId: question.revisionId,
            },
          }),
        ]);

        const found = await subject.sessions.findById(session.id);

        expect(found?.certificationIds).toHaveLength(2);
        expect([...(found?.certificationIds ?? [])].sort()).toEqual([
          "certification-1",
          "certification-2",
        ]);
      });

      it("returns null for an unknown session", async () => {
        await expect(
          subject.sessions.findById("session-missing"),
        ).resolves.toBeNull();
        await expect(
          subject.sessions.findWithItems("session-missing"),
        ).resolves.toBeNull();
      });
    });

    describe("incremental completion", () => {
      /** A three-item session, so completion can be observed item by item. */
      async function threeItemSession(): Promise<void> {
        const question = await saveQuestion();

        await subject.sessions.create(
          sessionFixture(),
          [1, 2, 3].map((position) =>
            questionItemFixture({
              id: `item-${position}`,
              position,
              content: {
                itemType: "QUESTION",
                questionId: question.questionId,
                questionRevisionId: question.revisionId,
              },
            }),
          ),
        );
      }

      it("settles one item at a time, leaving the rest pending", async () => {
        await threeItemSession();

        await subject.sessions.settleItem("session-1", {
          itemId: "item-1",
          status: "COMPLETED",
          occurredAt: LATER,
        });

        const found = await subject.sessions.findWithItems("session-1");

        expect(
          found?.items.map((item) => [item.id, item.status, item.completedAt]),
        ).toEqual([
          ["item-1", "COMPLETED", LATER],
          ["item-2", "PENDING", null],
          ["item-3", "PENDING", null],
        ]);
      });

      it("records a skip without a completion of its own kind", async () => {
        await threeItemSession();

        await subject.sessions.settleItem("session-1", {
          itemId: "item-2",
          status: "SKIPPED",
          occurredAt: LATER,
        });

        const found = await subject.sessions.findWithItems("session-1");

        expect(found?.items.find((item) => item.id === "item-2")?.status).toBe(
          "SKIPPED",
        );
      });

      it("refuses to settle the same item twice", async () => {
        await threeItemSession();

        await subject.sessions.settleItem("session-1", {
          itemId: "item-1",
          status: "COMPLETED",
          occurredAt: LATER,
        });

        // A double-tapped submit button must not record a second answer.
        await expect(
          subject.sessions.settleItem("session-1", {
            itemId: "item-1",
            status: "COMPLETED",
            occurredAt: LATEST,
          }),
        ).rejects.toThrow(SessionItemNotFoundError);
      });

      it("refuses to settle an item of another session", async () => {
        await threeItemSession();

        await expect(
          subject.sessions.settleItem("session-other", {
            itemId: "item-1",
            status: "COMPLETED",
            occurredAt: LATER,
          }),
        ).rejects.toThrow(SessionItemNotFoundError);
      });

      it("closes a session and leaves unreached items pending", async () => {
        await threeItemSession();

        await subject.sessions.settleItem("session-1", {
          itemId: "item-1",
          status: "COMPLETED",
          occurredAt: LATER,
        });
        await subject.sessions.closeSession("session-1", "COMPLETED", LATEST);

        const found = await subject.sessions.findWithItems("session-1");

        expect(found?.session.status).toBe("COMPLETED");
        expect(found?.session.completedAt).toBe(LATEST);
        // Finishing early does not claim the owner saw items 2 and 3.
        expect(
          found?.items.filter((item) => item.status === "PENDING"),
        ).toHaveLength(2);
      });

      it("refuses to close a session twice", async () => {
        await threeItemSession();
        await subject.sessions.closeSession("session-1", "COMPLETED", LATER);

        await expect(
          subject.sessions.closeSession("session-1", "ABANDONED", LATEST),
        ).rejects.toThrow(StudySessionNotFoundError);
      });

      it("refuses to close an unknown session", async () => {
        await expect(
          subject.sessions.closeSession("session-missing", "COMPLETED", LATER),
        ).rejects.toThrow(StudySessionNotFoundError);
      });
    });

    describe("in-progress lookup", () => {
      it("finds the running session with its items", async () => {
        const question = await saveQuestion();
        const session = sessionFixture();

        await subject.sessions.create(session, [
          questionItemFixture({
            content: {
              itemType: "QUESTION",
              questionId: question.questionId,
              questionRevisionId: question.revisionId,
            },
          }),
        ]);

        const found = await subject.sessions.findInProgress();

        expect(found?.session.id).toBe(session.id);
        expect(found?.items).toHaveLength(1);
      });

      it("finds nothing once the session has ended", async () => {
        const question = await saveQuestion();

        await subject.sessions.create(sessionFixture(), [
          questionItemFixture({
            content: {
              itemType: "QUESTION",
              questionId: question.questionId,
              questionRevisionId: question.revisionId,
            },
          }),
        ]);
        await subject.sessions.closeSession("session-1", "COMPLETED", LATER);

        await expect(subject.sessions.findInProgress()).resolves.toBeNull();
      });

      it("finds nothing when no session has ever been recorded", async () => {
        await expect(subject.sessions.findInProgress()).resolves.toBeNull();
      });

      it("resolves to the most recent when two are somehow running", async () => {
        const question = await saveQuestion();
        const item = questionItemFixture({
          content: {
            itemType: "QUESTION",
            questionId: question.questionId,
            questionRevisionId: question.revisionId,
          },
        });

        await subject.sessions.create(sessionFixture({ createdAt: NOW }), [
          item,
        ]);
        await subject.sessions.create(
          sessionFixture({ id: "session-2", createdAt: LATER }),
          [{ ...item, id: "item-2", sessionId: "session-2" }],
        );

        const found = await subject.sessions.findInProgress();

        expect(found?.session.id).toBe("session-2");
      });
    });

    describe("attempts", () => {
      it("appends an attempt and reads it back by question", async () => {
        const question = await saveQuestion();

        await subject.sessions.create(sessionFixture(), [
          questionItemFixture({
            content: {
              itemType: "QUESTION",
              questionId: question.questionId,
              questionRevisionId: question.revisionId,
            },
          }),
        ]);

        const attempt = attemptFixture({
          questionId: question.questionId,
          questionRevisionId: question.revisionId,
          attemptedAt: LATER,
        });

        await subject.sessions.recordAttempt(attempt);

        await expect(
          subject.sessions.listAttemptsForQuestion({
            questionId: question.questionId,
            limit: UNBOUNDED,
          }),
        ).resolves.toEqual([attempt]);
      });

      it("keeps every submitted-answer shape intact", async () => {
        const single = await saveQuestion("question-single", {
          currentRevisionId: "question-single-revision-1",
        });
        const multiple = await saveQuestion("question-multiple", {
          currentRevisionId: "question-multiple-revision-1",
        });
        const short = await saveQuestion("question-short", {
          currentRevisionId: "question-short-revision-1",
        });

        await subject.sessions.create(sessionFixture(), [
          questionItemFixture({
            content: {
              itemType: "QUESTION",
              questionId: single.questionId,
              questionRevisionId: single.revisionId,
            },
          }),
        ]);

        const attempts = [
          attemptFixture({
            id: "attempt-single",
            questionId: single.questionId,
            questionRevisionId: single.revisionId,
            submittedAnswer: { type: "SINGLE_CHOICE", choiceId: "choice-2" },
          }),
          attemptFixture({
            id: "attempt-multiple",
            questionId: multiple.questionId,
            questionRevisionId: multiple.revisionId,
            submittedAnswer: {
              type: "MULTIPLE_RESPONSE",
              // Order and multiplicity both have to survive the round trip: a
              // stored answer is the evidence a later review reads.
              choiceIds: ["choice-2", "choice-1"],
            },
            isCorrect: false,
          }),
          attemptFixture({
            id: "attempt-short",
            questionId: short.questionId,
            questionRevisionId: short.revisionId,
            submittedAnswer: {
              type: "SHORT_ANSWER",
              text: "Objects, with eleven nines of durability.",
            },
            evaluationMode: "SELF_ASSESSED",
            confidence: "GUESS",
            durationSeconds: null,
          }),
        ];

        for (const attempt of attempts) {
          await subject.sessions.recordAttempt(attempt);
        }

        for (const attempt of attempts) {
          await expect(
            subject.sessions.listAttemptsForQuestion({
              questionId: attempt.questionId,
              limit: UNBOUNDED,
            }),
          ).resolves.toEqual([attempt]);
        }
      });

      it("lists a question's attempts newest first", async () => {
        const question = await saveQuestion();

        await subject.sessions.create(sessionFixture(), [
          questionItemFixture({
            content: {
              itemType: "QUESTION",
              questionId: question.questionId,
              questionRevisionId: question.revisionId,
            },
          }),
        ]);

        for (const [index, attemptedAt] of [NOW, LATEST, LATER].entries()) {
          await subject.sessions.recordAttempt(
            attemptFixture({
              id: `attempt-${index}`,
              questionId: question.questionId,
              questionRevisionId: question.revisionId,
              attemptedAt,
            }),
          );
        }

        const attempts = await subject.sessions.listAttemptsForQuestion({
          questionId: question.questionId,
          limit: UNBOUNDED,
        });

        expect(attempts.map((attempt) => attempt.attemptedAt)).toEqual([
          LATEST,
          LATER,
          NOW,
        ]);
      });

      it("bounds the attempt history by the requested limit", async () => {
        const question = await saveQuestion();

        await subject.sessions.create(sessionFixture(), [
          questionItemFixture({
            content: {
              itemType: "QUESTION",
              questionId: question.questionId,
              questionRevisionId: question.revisionId,
            },
          }),
        ]);

        for (let index = 0; index < 5; index += 1) {
          await subject.sessions.recordAttempt(
            attemptFixture({
              id: `attempt-${index}`,
              questionId: question.questionId,
              questionRevisionId: question.revisionId,
            }),
          );
        }

        await expect(
          subject.sessions.listAttemptsForQuestion({
            questionId: question.questionId,
            limit: 2,
          }),
        ).resolves.toHaveLength(2);
      });

      it("lists a session's attempts oldest first", async () => {
        const question = await saveQuestion();

        await subject.sessions.create(sessionFixture(), [
          questionItemFixture({
            content: {
              itemType: "QUESTION",
              questionId: question.questionId,
              questionRevisionId: question.revisionId,
            },
          }),
        ]);

        for (const [index, attemptedAt] of [LATEST, NOW, LATER].entries()) {
          await subject.sessions.recordAttempt(
            attemptFixture({
              id: `attempt-${index}`,
              questionId: question.questionId,
              questionRevisionId: question.revisionId,
              attemptedAt,
            }),
          );
        }

        const attempts =
          await subject.sessions.listAttemptsForSession("session-1");

        expect(attempts.map((attempt) => attempt.attemptedAt)).toEqual([
          NOW,
          LATER,
          LATEST,
        ]);
      });

      it("finds no attempts for a question that has never been answered", async () => {
        const question = await saveQuestion();

        await expect(
          subject.sessions.listAttemptsForQuestion({
            questionId: question.questionId,
            limit: UNBOUNDED,
          }),
        ).resolves.toEqual([]);
      });
    });

    describe("candidate and history queries for the composer", () => {
      /** A session plus two answered questions in one track. */
      async function answeredHistory(): Promise<void> {
        const first = await saveQuestion("question-1");
        const second = await saveQuestion("question-2");

        await subject.questions.replaceObjectiveLinks(
          first.questionId,
          ["objective-1"],
          NOW,
        );
        await subject.questions.replaceObjectiveLinks(
          second.questionId,
          ["objective-1"],
          NOW,
        );
        await subject.sessions.create(sessionFixture(), [
          questionItemFixture({
            content: {
              itemType: "QUESTION",
              questionId: first.questionId,
              questionRevisionId: first.revisionId,
            },
          }),
        ]);

        await subject.sessions.recordAttempt(
          attemptFixture({
            id: "attempt-1",
            questionId: first.questionId,
            questionRevisionId: first.revisionId,
            isCorrect: false,
            confidence: "CONFIDENT",
            attemptedAt: NOW,
          }),
        );
        await subject.sessions.recordAttempt(
          attemptFixture({
            id: "attempt-2",
            questionId: first.questionId,
            questionRevisionId: first.revisionId,
            isCorrect: true,
            confidence: "FAIRLY_SURE",
            attemptedAt: LATER,
          }),
        );
        await subject.sessions.recordAttempt(
          attemptFixture({
            id: "attempt-3",
            questionId: second.questionId,
            questionRevisionId: second.revisionId,
            isCorrect: false,
            confidence: "GUESS",
            attemptedAt: LATEST,
          }),
        );
      }

      it("summarizes the latest verdict per attempted question", async () => {
        await answeredHistory();

        const summaries = await subject.sessions.summarizeAttemptsByQuestion({
          certificationIds: ["certification-1"],
          limit: UNBOUNDED,
        });

        expect(summaries).toEqual([
          {
            questionId: "question-2",
            attemptCount: 1,
            lastAttemptedAt: LATEST,
            lastIsCorrect: false,
            lastConfidence: "GUESS",
          },
          {
            // Two attempts, and the later correct one is the current standing.
            questionId: "question-1",
            attemptCount: 2,
            lastAttemptedAt: LATER,
            lastIsCorrect: true,
            lastConfidence: "FAIRLY_SURE",
          },
        ]);
      });

      it("summarizes nothing for an empty track list", async () => {
        await answeredHistory();

        await expect(
          subject.sessions.summarizeAttemptsByQuestion({
            certificationIds: [],
            limit: UNBOUNDED,
          }),
        ).resolves.toEqual([]);
        await expect(
          subject.sessions.summarizeObjectiveAccuracy([]),
        ).resolves.toEqual([]);
      });

      it("excludes questions of other tracks from the summary", async () => {
        await answeredHistory();

        await expect(
          subject.sessions.summarizeAttemptsByQuestion({
            certificationIds: ["certification-other"],
            limit: UNBOUNDED,
          }),
        ).resolves.toEqual([]);
      });

      it("bounds the answer-history summary by the requested limit", async () => {
        await answeredHistory();

        await expect(
          subject.sessions.summarizeAttemptsByQuestion({
            certificationIds: ["certification-1"],
            limit: 1,
          }),
        ).resolves.toHaveLength(1);
      });

      it("groups accuracy by objective, counting every attempt", async () => {
        await answeredHistory();

        await expect(
          subject.sessions.summarizeObjectiveAccuracy(["certification-1"]),
        ).resolves.toEqual([
          { objectiveId: "objective-1", attemptCount: 3, correctCount: 1 },
        ]);
      });

      it("returns no row for an objective with no attempts", async () => {
        await subject.objectives.save(
          objectiveFixture({
            id: "objective-untouched",
            title: "Never studied",
          }),
        );
        await answeredHistory();

        const rows = await subject.sessions.summarizeObjectiveAccuracy([
          "certification-1",
        ]);

        // Absence is what lets the caller read UNSEEN rather than "scored zero"
        // (`spec/DOMAIN-RULES.md` section 2.5).
        expect(
          rows.some((row) => row.objectiveId === "objective-untouched"),
        ).toBe(false);
      });
    });

    describe("session history", () => {
      it("lists sessions newest first with their counts", async () => {
        const question = await saveQuestion();
        const item = questionItemFixture({
          content: {
            itemType: "QUESTION",
            questionId: question.questionId,
            questionRevisionId: question.revisionId,
          },
        });

        await subject.sessions.create(sessionFixture({ createdAt: NOW }), [
          item,
          { ...item, id: "item-2", position: 2 },
        ]);
        await subject.sessions.settleItem("session-1", {
          itemId: "item-1",
          status: "COMPLETED",
          occurredAt: LATER,
        });
        await subject.sessions.recordAttempt(
          attemptFixture({
            questionId: question.questionId,
            questionRevisionId: question.revisionId,
            isCorrect: true,
          }),
        );
        await subject.sessions.closeSession("session-1", "COMPLETED", LATER);

        await subject.sessions.create(
          sessionFixture({ id: "session-2", createdAt: LATEST }),
          [{ ...item, id: "item-3", sessionId: "session-2" }],
        );

        const history = await subject.sessions.listHistory(UNBOUNDED);

        expect(history).toEqual([
          {
            session: expect.objectContaining({ id: "session-2" }),
            itemCount: 1,
            settledCount: 0,
            attemptCount: 0,
            correctCount: 0,
          },
          {
            session: expect.objectContaining({
              id: "session-1",
              status: "COMPLETED",
            }),
            itemCount: 2,
            settledCount: 1,
            attemptCount: 1,
            correctCount: 1,
          },
        ]);
      });

      it("does not multiply item and attempt counts together", async () => {
        const question = await saveQuestion();
        const item = questionItemFixture({
          content: {
            itemType: "QUESTION",
            questionId: question.questionId,
            questionRevisionId: question.revisionId,
          },
        });

        await subject.sessions.create(sessionFixture(), [
          item,
          { ...item, id: "item-2", position: 2 },
          { ...item, id: "item-3", position: 3 },
        ]);

        for (const index of [1, 2]) {
          await subject.sessions.recordAttempt(
            attemptFixture({
              id: `attempt-${index}`,
              questionId: question.questionId,
              questionRevisionId: question.revisionId,
              isCorrect: index === 1,
            }),
          );
        }

        const [entry] = await subject.sessions.listHistory(UNBOUNDED);

        expect(entry).toMatchObject({
          itemCount: 3,
          attemptCount: 2,
          correctCount: 1,
        });
      });

      it("bounds the history by the requested limit", async () => {
        const question = await saveQuestion();
        const item = questionItemFixture({
          content: {
            itemType: "QUESTION",
            questionId: question.questionId,
            questionRevisionId: question.revisionId,
          },
        });

        for (const index of [1, 2, 3]) {
          await subject.sessions.create(
            sessionFixture({
              id: `session-${index}`,
              createdAt: `2026-06-0${index}T12:00:00.000Z`,
            }),
            [{ ...item, id: `item-${index}`, sessionId: `session-${index}` }],
          );
          await subject.sessions.closeSession(
            `session-${index}`,
            "COMPLETED",
            LATER,
          );
        }

        await expect(subject.sessions.listHistory(2)).resolves.toHaveLength(2);
      });

      it("lists nothing before any session exists", async () => {
        await expect(subject.sessions.listHistory(UNBOUNDED)).resolves.toEqual(
          [],
        );
      });
    });

    describe("question references (SPEC.md section 6.3.2)", () => {
      it("counts nothing for a question never studied", async () => {
        const question = await saveQuestion();

        await expect(
          subject.sessions.countQuestionReferences(question.questionId),
        ).resolves.toEqual({ attempts: 0, sessionItems: 0 });
      });

      it("counts a session item that offered the question", async () => {
        const question = await saveQuestion();

        await subject.sessions.create(sessionFixture(), [
          questionItemFixture({
            content: {
              itemType: "QUESTION",
              questionId: question.questionId,
              questionRevisionId: question.revisionId,
            },
          }),
        ]);

        await expect(
          subject.sessions.countQuestionReferences(question.questionId),
        ).resolves.toEqual({ attempts: 0, sessionItems: 1 });
      });

      it("counts every attempt against the question", async () => {
        const question = await saveQuestion();

        await subject.sessions.create(sessionFixture(), [
          questionItemFixture({
            content: {
              itemType: "QUESTION",
              questionId: question.questionId,
              questionRevisionId: question.revisionId,
            },
          }),
        ]);

        for (const index of [1, 2]) {
          await subject.sessions.recordAttempt(
            attemptFixture({
              id: `attempt-${index}`,
              questionId: question.questionId,
              questionRevisionId: question.revisionId,
            }),
          );
        }

        await expect(
          subject.sessions.countQuestionReferences(question.questionId),
        ).resolves.toEqual({ attempts: 2, sessionItems: 1 });
      });

      it("counts nothing for an unknown question", async () => {
        await expect(
          subject.sessions.countQuestionReferences("question-missing"),
        ).resolves.toEqual({ attempts: 0, sessionItems: 0 });
      });
    });
  });
}
