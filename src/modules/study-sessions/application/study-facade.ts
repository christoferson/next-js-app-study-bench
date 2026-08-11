import type { Clock } from "@/platform/clock";
import type { IdGenerator } from "@/platform/id-generator";
import type {
  Certification,
  CertificationId,
  CertificationSlug,
} from "@/modules/certifications/domain/certification";
import {
  MAX_SESSION_MINUTES,
  MIN_SESSION_MINUTES,
} from "@/modules/certifications/domain/certification";
import { CertificationNotFoundError } from "@/modules/certifications/domain/errors";
import type { CertificationRepository } from "@/modules/certifications/ports/certification-repository";
import type {
  FlashcardRevision,
  FlashcardWithRevision,
} from "@/modules/flashcards/domain/flashcard";
import { isReviewEligible } from "@/modules/flashcards/domain/flashcard-lifecycle";
import type {
  RecallRating,
  ReviewSchedule,
  ReviewSchedulingStrategy,
} from "@/modules/flashcards/domain/review-scheduling";
import {
  FlashcardNotFoundError,
  FlashcardNotReviewableError,
} from "@/modules/flashcards/domain/errors";
import type { FlashcardRepository } from "@/modules/flashcards/ports/flashcard-repository";
import type {
  Question,
  QuestionId,
  QuestionRevision,
  QuestionRevisionId,
} from "@/modules/question-bank/domain/question";
import { QuestionNotFoundError } from "@/modules/question-bank/domain/errors";
import type { QuestionRepository } from "@/modules/question-bank/ports/question-repository";
import {
  assertAnswerable,
  gradeAnswer,
} from "@/modules/study-sessions/domain/answer-grading";
import {
  DiagnosticNotAvailableError,
  NoStudyContentError,
  SessionItemNotFoundError,
  SessionNotInProgressError,
  StudySessionNotFoundError,
} from "@/modules/study-sessions/domain/errors";
import type {
  QuestionAttempt,
  SubmittedAnswer,
} from "@/modules/study-sessions/domain/question-attempt";
import type {
  ComposedItem,
  SessionCompositionStrategy,
} from "@/modules/study-sessions/domain/session-composer";
import {
  DIAGNOSTIC_MIN_OBJECTIVES,
  DIAGNOSTIC_MIN_QUESTIONS,
  hasStudiableMistake,
  isDiagnosticAvailable,
} from "@/modules/study-sessions/domain/session-composer";
import type {
  SessionMode,
  StudySession,
  StudySessionId,
  StudySessionItem,
  StudySessionItemId,
} from "@/modules/study-sessions/domain/study-session";
import {
  modeAllowsSeveralTracks,
  modeIncludesFlashcards,
  modeIncludesQuestions,
  nextPendingItem,
  settledItemCount,
} from "@/modules/study-sessions/domain/study-session";
import type {
  SessionHistoryEntry,
  StudySessionRepository,
} from "@/modules/study-sessions/ports/study-session-repository";
import type { StudyUnitOfWork } from "@/modules/study-sessions/ports/unit-of-work";
import type {
  RateSessionCardInput,
  StartSessionInput,
  SubmitAnswerInput,
} from "./schemas";

/**
 * Study capability facade.
 *
 * Owns starting a session, resuming the one in progress, answering a question,
 * rating a card inside a session, skipping, finishing, and reading history. Server
 * Actions and pages call this facade; they never reach for SQL, composition policy,
 * grading rules, or the scheduling algorithm themselves
 * (`spec/ARCHITECTURE.md` section 2.3).
 *
 * Nothing here calls a language model. Starting a session is a set of bounded
 * queries plus one pure composition (`spec/ARCHITECTURE.md` section 8), so a session
 * opens at database speed and works with no network at all.
 */

/** How many candidates are read before composing. Bounded, like every read. */
const CANDIDATE_LIMIT = 200;

/** How much answer history the composer is given. */
const HISTORY_LIMIT = 200;

/**
 * The session length the start form offers by default.
 *
 * Ten minutes, matching the promise the primary call to action makes. A track's
 * `defaultSessionMinutes` is the owner's planned study block from D2, which is a
 * different quantity from "how long do I have right now", so it is offered as one of
 * the presets rather than used as the default.
 */
export const DEFAULT_QUICK_MINUTES = 10;

/** Lengths the form offers, before a preselected track's own default is merged. */
const MINUTE_PRESETS: readonly number[] = [5, 10, 20, 30];

/** How many past sessions the history list shows. */
export const SESSION_HISTORY_LIMIT = 20;

/** How many attempts one question's history shows. */
export const ATTEMPT_HISTORY_LIMIT = 20;

/** One mode the start form can offer, with its availability. */
export interface SessionModeOption {
  readonly mode: SessionMode;
  /**
   * Whether starting this mode now would produce a session.
   *
   * The form disables what would fail rather than offering a control that leads to
   * an error page (`spec/UI-GUIDELINES.md` section 1.4).
   */
  readonly available: boolean;
  /** Why the mode is unavailable, or `null` when it is available. */
  readonly unavailableReason: string | null;
}

/** Start-form view: the tracks, the studiable counts, and the workable modes. */
export interface StartSessionView {
  readonly tracks: readonly Certification[];
  /** Preselected track, when the owner arrived from a track page. */
  readonly preselectedId: CertificationId | null;
  readonly defaultMinutes: number;
  readonly minuteOptions: readonly number[];
  readonly modes: readonly SessionModeOption[];
  /** A session already running, so the form can offer to resume it instead. */
  readonly inProgressId: StudySessionId | null;
  readonly dueCardCount: number;
  readonly activeQuestionCount: number;
}

/** One item on the study screen, resolved to the frozen content it names. */
export type StudyItemView =
  | {
      readonly itemType: "QUESTION";
      readonly item: StudySessionItem;
      readonly question: Question;
      readonly revision: QuestionRevision;
    }
  | {
      readonly itemType: "FLASHCARD";
      readonly item: StudySessionItem;
      readonly card: FlashcardWithRevision;
      readonly revision: FlashcardRevision;
    };

/** Study-screen view: the current item and where it sits in the session. */
export interface StudySessionView {
  readonly session: StudySession;
  readonly tracks: readonly Certification[];
  /** `null` once every item is settled: the session is ready to finish. */
  readonly current: StudyItemView | null;
  /** 1-based position of the current item, or the total once nothing is left. */
  readonly position: number;
  readonly itemCount: number;
  readonly settledCount: number;
  readonly attemptCount: number;
  readonly correctCount: number;
}

/** One mistake made during a session, for the follow-up list on the summary. */
export interface SessionMistakeView {
  readonly attempt: QuestionAttempt;
  /** The stem of the revision that was answered, not of the current one. */
  readonly stem: string;
}

/** Completed-session view: what the session actually recorded. */
export interface SessionSummaryView {
  readonly session: StudySession;
  readonly tracks: readonly Certification[];
  readonly itemCount: number;
  readonly settledCount: number;
  readonly attemptCount: number;
  readonly correctCount: number;
  readonly cardsRated: number;
  readonly mistakes: readonly SessionMistakeView[];
}

/** What submitting an answer produced, so the screen can show feedback. */
export interface AnswerOutcome {
  readonly attempt: QuestionAttempt;
  readonly question: Question;
  readonly revision: QuestionRevision;
  /** Whether the session has nothing pending after this item. */
  readonly sessionComplete: boolean;
}

/**
 * The feedback shown after one recorded attempt.
 *
 * Read back from the attempt rather than carried through client state, so the
 * feedback survives a reload and says what was actually recorded. The revision is
 * the frozen one the attempt names, which is what makes the correct answer and the
 * explanation match the wording that was answered.
 */
export interface AnswerFeedbackView {
  readonly attempt: QuestionAttempt;
  readonly question: Question;
  readonly revision: QuestionRevision;
}

/** What rating a card inside a session produced. */
export interface SessionCardOutcome {
  readonly rating: RecallRating;
  readonly schedule: ReviewSchedule;
  readonly sessionComplete: boolean;
}

export interface StudyFacadeDependencies {
  readonly sessions: StudySessionRepository;
  readonly questions: QuestionRepository;
  readonly flashcards: FlashcardRepository;
  readonly certifications: CertificationRepository;
  readonly unitOfWork: StudyUnitOfWork;
  /** The replaceable composition policy (`spec/ARCHITECTURE.md` section 5.3). */
  readonly composer: SessionCompositionStrategy;
  /** The same scheduling algorithm the D4 review screen uses. */
  readonly scheduler: ReviewSchedulingStrategy;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export class StudyFacade {
  constructor(private readonly deps: StudyFacadeDependencies) {}

  /**
   * Everything the start form needs, including which modes would work.
   *
   * Availability is derived from counts rather than by attempting a composition:
   * the form must not create a session to discover whether it could.
   */
  async findStartForm(
    preselectedSlug: CertificationSlug | null,
  ): Promise<StartSessionView> {
    const tracks = await this.deps.certifications.listActive();
    const preselected =
      preselectedSlug === null
        ? null
        : (tracks.find((track) => track.slug === preselectedSlug) ?? null);
    const scope =
      preselected === null ? tracks.map((track) => track.id) : [preselected.id];
    const now = this.deps.clock.now();

    // With no active track there is nothing to scope a candidate query to, and an
    // empty `IN ()` list is not a question worth asking the database.
    const [candidates, dueCards, running, history] = await Promise.all([
      scope.length === 0
        ? Promise.resolve([])
        : this.deps.questions.findStudyCandidates({
            certificationIds: scope,
            limit: CANDIDATE_LIMIT,
          }),
      scope.length === 0
        ? Promise.resolve([])
        : this.deps.flashcards.findDueCandidates({
            certificationIds: scope,
            now,
            limit: CANDIDATE_LIMIT,
          }),
      this.deps.sessions.findInProgress(),
      scope.length === 0
        ? Promise.resolve([])
        : this.deps.sessions.summarizeAttemptsByQuestion({
            certificationIds: scope,
            limit: HISTORY_LIMIT,
          }),
    ]);

    return {
      tracks,
      preselectedId: preselected?.id ?? null,
      defaultMinutes: DEFAULT_QUICK_MINUTES,
      minuteOptions: minuteOptions(preselected),
      modes: modeOptions({
        questionCount: candidates.length,
        dueCardCount: dueCards.length,
        // Counted against the studiable candidates, not against attempt history
        // alone. A mistake on a question since retired or disputed is still
        // history, but composition draws only from eligible questions, so
        // offering the mode on the strength of that attempt would enable a
        // control that fails — the one thing the availability check exists to
        // prevent.
        hasMistakes: hasStudiableMistake(candidates, history),
        diagnosticAvailable: isDiagnosticAvailable(candidates),
      }),
      inProgressId: running?.session.id ?? null,
      dueCardCount: dueCards.length,
      activeQuestionCount: candidates.length,
    };
  }

  /**
   * Composes and saves a new session.
   *
   * The candidate reads, the composition, and the write all happen inside one
   * transaction. The revisions the items freeze must be the ones that were current
   * when the items were written, and reading them outside the transaction would
   * leave a window in which an edit could land between selection and insert.
   *
   * Any session still in progress is abandoned first. Only one session runs at a
   * time, so "resume" has one unambiguous destination; the superseded session keeps
   * every attempt already recorded in it.
   */
  async startSession(input: StartSessionInput): Promise<StudySession> {
    const requested = await this.resolveTracks(input);

    return this.deps.unitOfWork.transaction(
      async ({ sessions, questions, flashcards }) => {
        const now = this.deps.clock.now();
        const running = await sessions.findInProgress();

        if (running !== null) {
          await sessions.closeSession(running.session.id, "ABANDONED", now);
        }

        const certificationIds = requested.map((track) => track.id);
        const [candidates, dueCards, attempts, objectiveAccuracy] =
          await Promise.all([
            modeIncludesQuestions(input.mode)
              ? questions.findStudyCandidates({
                  certificationIds,
                  limit: CANDIDATE_LIMIT,
                })
              : Promise.resolve([]),
            modeIncludesFlashcards(input.mode)
              ? flashcards.findDueCandidates({
                  certificationIds,
                  now,
                  limit: CANDIDATE_LIMIT,
                })
              : Promise.resolve([]),
            sessions.summarizeAttemptsByQuestion({
              certificationIds,
              limit: HISTORY_LIMIT,
            }),
            sessions.summarizeObjectiveAccuracy(certificationIds),
          ]);

        // Checked before composing, so the owner is told a diagnostic is not
        // available yet rather than being handed a two-question "diagnostic".
        if (input.mode === "DIAGNOSTIC" && !isDiagnosticAvailable(candidates)) {
          throw new DiagnosticNotAvailableError(
            DIAGNOSTIC_MIN_OBJECTIVES,
            DIAGNOSTIC_MIN_QUESTIONS,
          );
        }

        const composed = this.deps.composer.compose({
          mode: input.mode,
          targetMinutes: input.targetMinutes,
          questions: candidates,
          flashcards: dueCards.map((due) => ({
            flashcardId: due.flashcard.id,
            flashcardRevisionId: due.revision.id,
            dueAt: due.schedule?.dueAt ?? null,
            createdAt: due.flashcard.createdAt,
          })),
          attempts,
          objectiveAccuracy,
        });

        if (composed.length === 0) {
          throw new NoStudyContentError(emptyReason(input.mode));
        }

        const session: StudySession = {
          id: this.deps.ids.nextId(),
          mode: input.mode,
          status: "IN_PROGRESS",
          certificationIds,
          targetMinutes: input.targetMinutes,
          createdAt: now,
          completedAt: null,
        };

        await sessions.create(session, this.toItems(session.id, composed));

        return session;
      },
    );
  }

  /** The session in progress, or `null` when there is nothing to resume. */
  async findInProgressId(): Promise<StudySessionId | null> {
    const running = await this.deps.sessions.findInProgress();

    return running?.session.id ?? null;
  }

  /**
   * The study screen for one session.
   *
   * The current item is the first one still pending, so reloading the page — or
   * coming back tomorrow — shows exactly where the owner left off. Pausing is
   * therefore just leaving: there is no cursor to save and nothing to lose, because
   * every answer was already committed when it was given.
   */
  async findSession(
    sessionId: StudySessionId,
  ): Promise<StudySessionView | null> {
    const found = await this.deps.sessions.findWithItems(sessionId);

    if (found === null) {
      return null;
    }

    const [tracks, attempts] = await Promise.all([
      this.resolveTrackList(found.session.certificationIds),
      this.deps.sessions.listAttemptsForSession(sessionId),
    ]);
    const pending = nextPendingItem(found.items);

    return {
      session: found.session,
      tracks,
      current: pending === null ? null : await this.resolveItem(pending),
      position: pending?.position ?? found.items.length,
      itemCount: found.items.length,
      settledCount: settledItemCount(found.items),
      attemptCount: attempts.length,
      correctCount: attempts.filter((attempt) => attempt.isCorrect).length,
    };
  }

  /** The summary shown when a session ends. */
  async findSummary(
    sessionId: StudySessionId,
  ): Promise<SessionSummaryView | null> {
    const found = await this.deps.sessions.findWithItems(sessionId);

    if (found === null) {
      return null;
    }

    const [tracks, attempts] = await Promise.all([
      this.resolveTrackList(found.session.certificationIds),
      this.deps.sessions.listAttemptsForSession(sessionId),
    ]);

    const mistakes = await Promise.all(
      [...attempts]
        .reverse()
        .filter((attempt) => !attempt.isCorrect)
        .map(async (attempt) => ({
          attempt,
          stem: await this.stemOf(attempt),
        })),
    );

    return {
      session: found.session,
      tracks,
      itemCount: found.items.length,
      settledCount: settledItemCount(found.items),
      attemptCount: attempts.length,
      correctCount: attempts.filter((attempt) => attempt.isCorrect).length,
      cardsRated: found.items.filter(
        (item) =>
          item.content.itemType === "FLASHCARD" && item.status === "COMPLETED",
      ).length,
      mistakes,
    };
  }

  /**
   * The feedback for one recorded attempt of one session.
   *
   * Addressed by identifier rather than held in client state, so the feedback the
   * owner is reading is the attempt that was actually committed, and reloading the
   * page shows it again instead of skipping to the next item. Returns `null` when the
   * attempt is not part of this session, so a hand-edited URL cannot read another
   * session's answers.
   */
  async findFeedback(
    sessionId: StudySessionId,
    attemptId: string,
  ): Promise<AnswerFeedbackView | null> {
    const attempts = await this.deps.sessions.listAttemptsForSession(sessionId);
    const attempt = attempts.find((candidate) => candidate.id === attemptId);

    if (attempt === undefined) {
      return null;
    }

    const question = await this.deps.questions.findById(attempt.questionId);

    if (question === null) {
      return null;
    }

    return {
      attempt,
      question,
      revision: await findFrozenRevision(
        this.deps.questions,
        question.id,
        attempt.questionRevisionId,
      ),
    };
  }

  /**
   * Grades an answer and records it.
   *
   * The attempt and the item completion commit together
   * (`SPEC.md` section 9.6): an attempt without a completed item would offer the
   * same question again, and a completed item without an attempt would lose the
   * answer. Grading uses the revision the item froze rather than the current one, so
   * editing a question mid-session cannot change the verdict on an answer given to
   * its earlier wording.
   */
  async submitAnswer(input: SubmitAnswerInput): Promise<AnswerOutcome> {
    return this.deps.unitOfWork.transaction(async ({ sessions, questions }) => {
      const { session, item, items } = await requirePendingItem(
        sessions,
        input.sessionId,
        input.itemId,
      );

      if (item.content.itemType !== "QUESTION") {
        throw new SessionItemNotFoundError(item.id);
      }

      const question = await questions.findById(item.content.questionId);

      if (question === null) {
        throw new QuestionNotFoundError(item.content.questionId);
      }

      const revision = await findFrozenRevision(
        questions,
        question.id,
        item.content.questionRevisionId,
      );
      const submitted = toSubmittedAnswer(input);

      assertAnswerable(revision.content, submitted);

      const verdict = gradeAnswer(
        revision.content,
        submitted,
        input.type === "SHORT_ANSWER" ? input.selfAssessment : null,
      );
      const now = this.deps.clock.now();
      const attempt: QuestionAttempt = {
        id: this.deps.ids.nextId(),
        sessionId: session.id,
        questionId: question.id,
        questionRevisionId: revision.id,
        submittedAnswer: submitted,
        isCorrect: verdict.isCorrect,
        confidence: input.confidence,
        durationSeconds: input.durationSeconds,
        attemptedAt: now,
        evaluationMode: verdict.evaluationMode,
        feedbackSnapshot: null,
      };

      await sessions.recordAttempt(attempt);
      await sessions.settleItem(session.id, {
        itemId: item.id,
        status: "COMPLETED",
        occurredAt: now,
      });

      return {
        attempt,
        question,
        revision,
        sessionComplete: isLastPending(items, item.id),
      };
    });
  }

  /**
   * Rates a flashcard that appeared as a session item.
   *
   * One transaction spanning three writes: the review record, the card's new
   * schedule, and the item completion. Committing the schedule without the item
   * would offer the same card again inside the session; committing the item without
   * the schedule would lose the rating. The scheduling algorithm is the one the D4
   * review screen uses, so a card rated inside a session is scheduled identically to
   * one rated on the review page.
   */
  async rateSessionCard(
    input: RateSessionCardInput,
  ): Promise<SessionCardOutcome> {
    return this.deps.unitOfWork.transaction(
      async ({ sessions, flashcards }) => {
        const { session, item, items } = await requirePendingItem(
          sessions,
          input.sessionId,
          input.itemId,
        );

        if (item.content.itemType !== "FLASHCARD") {
          throw new SessionItemNotFoundError(item.id);
        }

        const content = item.content;
        const flashcard = await flashcards.findById(content.flashcardId);

        if (flashcard === null) {
          throw new FlashcardNotFoundError(content.flashcardId);
        }

        // Re-checked inside the transaction: the card may have been retired in
        // another tab after the session was composed, and recording the rating
        // anyway would put a retired card back on a schedule.
        if (!isReviewEligible(flashcard)) {
          throw new FlashcardNotReviewableError(flashcard.lifecycleStatus);
        }

        const current = await flashcards.findSchedule(flashcard.id);
        const schedule = this.deps.scheduler.schedule({
          rating: input.rating,
          current,
        });

        await flashcards.recordReview({
          id: this.deps.ids.nextId(),
          flashcardId: flashcard.id,
          // The revision the session froze, which is the text the owner read.
          flashcardRevisionId: content.flashcardRevisionId,
          rating: input.rating,
          reviewedAt: schedule.lastReviewedAt,
          intervalMinutes: schedule.intervalMinutes,
          dueAt: schedule.dueAt,
          schedulerId: schedule.schedulerId,
        });
        await flashcards.saveSchedule(
          flashcard.id,
          schedule,
          schedule.lastReviewedAt,
        );
        await sessions.settleItem(session.id, {
          itemId: item.id,
          status: "COMPLETED",
          occurredAt: schedule.lastReviewedAt,
        });

        return {
          rating: input.rating,
          schedule,
          sessionComplete: isLastPending(items, item.id),
        };
      },
    );
  }

  /**
   * Marks an item skipped without recording an attempt.
   *
   * No attempt means no score, which is what keeps a skipped diagnostic objective
   * `UNSEEN` rather than scored zero (`spec/DOMAIN-RULES.md` section 2.5).
   */
  async skipItem(
    sessionId: StudySessionId,
    itemId: StudySessionItemId,
  ): Promise<{ readonly sessionComplete: boolean }> {
    return this.deps.unitOfWork.transaction(async ({ sessions }) => {
      const { session, item, items } = await requirePendingItem(
        sessions,
        sessionId,
        itemId,
      );

      await sessions.settleItem(session.id, {
        itemId: item.id,
        status: "SKIPPED",
        occurredAt: this.deps.clock.now(),
      });

      return { sessionComplete: isLastPending(items, item.id) };
    });
  }

  /**
   * Ends a session, whether or not every item was reached.
   *
   * Finishing early is explicitly permitted (`SPEC.md` section 6.6). Items never
   * reached stay `PENDING` rather than being rewritten as skipped: the owner did not
   * see them, and recording that they did would be a false statement about the
   * session.
   */
  async finishSession(sessionId: StudySessionId): Promise<StudySession> {
    return this.deps.unitOfWork.transaction(async ({ sessions }) => {
      const session = await sessions.findById(sessionId);

      if (session === null) {
        throw new StudySessionNotFoundError(sessionId);
      }

      if (session.status !== "IN_PROGRESS") {
        throw new SessionNotInProgressError(session.status);
      }

      const now = this.deps.clock.now();

      await sessions.closeSession(sessionId, "COMPLETED", now);

      return { ...session, status: "COMPLETED" as const, completedAt: now };
    });
  }

  /** Recent sessions, newest first, for the progress dashboard. */
  async listHistory(): Promise<SessionHistoryEntry[]> {
    return this.deps.sessions.listHistory(SESSION_HISTORY_LIMIT);
  }

  /**
   * Attempts against one question, most recent first.
   *
   * Backs the attempt-history section of the question detail page
   * (`SPEC.md` section 6.3, deferred from D3 until attempts existed).
   */
  async listAttemptsForQuestion(
    questionId: QuestionId,
  ): Promise<QuestionAttempt[]> {
    return this.deps.sessions.listAttemptsForQuestion({
      questionId,
      limit: ATTEMPT_HISTORY_LIMIT,
    });
  }

  /** Validates the requested tracks and applies the single-track rule. */
  private async resolveTracks(
    input: StartSessionInput,
  ): Promise<readonly Certification[]> {
    const requested = await Promise.all(
      input.certificationIds.map(async (id) => {
        const track = await this.deps.certifications.findById(id);

        if (track === null) {
          throw new CertificationNotFoundError(id);
        }

        return track;
      }),
    );

    // A single-track session composes from one track even if the form somehow
    // submitted several, rather than quietly widening what the owner chose.
    return modeAllowsSeveralTracks(input.mode)
      ? requested
      : requested.slice(0, 1);
  }

  /**
   * The tracks a recorded session was about.
   *
   * A missing track is dropped rather than failing the read: a session is history,
   * and it must stay readable even if one of its tracks has since been removed.
   */
  private async resolveTrackList(
    ids: readonly CertificationId[],
  ): Promise<Certification[]> {
    const tracks = await Promise.all(
      ids.map(async (id) => this.deps.certifications.findById(id)),
    );

    return tracks.filter((track): track is Certification => track !== null);
  }

  /** Turns composed selections into persistable items, numbered from 1. */
  private toItems(
    sessionId: StudySessionId,
    composed: readonly ComposedItem[],
  ): StudySessionItem[] {
    return composed.map((entry, index) => ({
      id: this.deps.ids.nextId(),
      sessionId,
      position: index + 1,
      content: entry.content,
      status: "PENDING" as const,
      completedAt: null,
    }));
  }

  /**
   * Resolves one item to the frozen content it names.
   *
   * Both branches read the exact revision recorded on the item, never the current
   * one, so an in-progress session shows the wording it was composed with even after
   * the question or card has been edited
   * (`spec/DOMAIN-RULES.md` section 2.3).
   */
  private async resolveItem(item: StudySessionItem): Promise<StudyItemView> {
    const content = item.content;

    switch (content.itemType) {
      case "QUESTION": {
        const question = await this.deps.questions.findById(content.questionId);

        if (question === null) {
          throw new QuestionNotFoundError(content.questionId);
        }

        return {
          itemType: "QUESTION",
          item,
          question,
          revision: await findFrozenRevision(
            this.deps.questions,
            question.id,
            content.questionRevisionId,
          ),
        };
      }
      case "FLASHCARD": {
        const card = await this.deps.flashcards.findWithCurrentRevision(
          content.flashcardId,
        );

        if (card === null) {
          throw new FlashcardNotFoundError(content.flashcardId);
        }

        const revisions = await this.deps.flashcards.listRevisions(
          card.flashcard.id,
        );

        return {
          itemType: "FLASHCARD",
          item,
          card,
          // The frozen revision, falling back to the current one only if it is
          // missing — which the `ON DELETE RESTRICT` foreign key prevents.
          revision:
            revisions.find(
              (candidate) => candidate.id === content.flashcardRevisionId,
            ) ?? card.revision,
        };
      }
    }
  }

  /** The stem of the exact revision an attempt names. */
  private async stemOf(attempt: QuestionAttempt): Promise<string> {
    const revisions = await this.deps.questions.listRevisions(
      attempt.questionId,
    );

    return (
      revisions.find((revision) => revision.id === attempt.questionRevisionId)
        ?.stem ?? "This question is no longer available."
    );
  }
}

/**
 * Loads the session, checks it is running, and finds the named pending item.
 *
 * Shared by every write path, so a stale screen, a double submission, and an item
 * belonging to another session all fail the same way with the same message.
 */
async function requirePendingItem(
  sessions: StudySessionRepository,
  sessionId: StudySessionId,
  itemId: StudySessionItemId,
): Promise<{
  readonly session: StudySession;
  readonly item: StudySessionItem;
  readonly items: readonly StudySessionItem[];
}> {
  const found = await sessions.findWithItems(sessionId);

  if (found === null) {
    throw new StudySessionNotFoundError(sessionId);
  }

  if (found.session.status !== "IN_PROGRESS") {
    throw new SessionNotInProgressError(found.session.status);
  }

  const item = found.items.find(
    (candidate) => candidate.id === itemId && candidate.status === "PENDING",
  );

  if (item === undefined) {
    throw new SessionItemNotFoundError(itemId);
  }

  return { session: found.session, item, items: found.items };
}

/** One exact revision of a question, by identifier. */
async function findFrozenRevision(
  questions: QuestionRepository,
  questionId: QuestionId,
  revisionId: QuestionRevisionId,
): Promise<QuestionRevision> {
  const revisions = await questions.listRevisions(questionId);
  const revision = revisions.find((candidate) => candidate.id === revisionId);

  if (revision === undefined) {
    throw new QuestionNotFoundError(questionId);
  }

  return revision;
}

/** Whether settling this item leaves nothing else pending. */
function isLastPending(
  items: readonly StudySessionItem[],
  itemId: StudySessionItemId,
): boolean {
  return !items.some((item) => item.status === "PENDING" && item.id !== itemId);
}

/**
 * Turns a validated submission into the answer shape the domain grades.
 *
 * Exhaustive over the submission union, so a fourth answered type cannot be added
 * without deciding what is recorded for it.
 */
function toSubmittedAnswer(input: SubmitAnswerInput): SubmittedAnswer {
  switch (input.type) {
    case "SINGLE_CHOICE":
      return { type: "SINGLE_CHOICE", choiceId: input.choiceId };
    case "MULTIPLE_RESPONSE":
      return { type: "MULTIPLE_RESPONSE", choiceIds: input.choiceIds };
    case "SHORT_ANSWER":
      return { type: "SHORT_ANSWER", text: input.text };
  }
}

/** Session lengths the form offers, including a preselected track's default. */
function minuteOptions(preselected: Certification | null): readonly number[] {
  const candidates =
    preselected === null
      ? MINUTE_PRESETS
      : [...MINUTE_PRESETS, preselected.defaultSessionMinutes];

  return [
    ...new Set(
      candidates.filter(
        (minutes) =>
          minutes >= MIN_SESSION_MINUTES && minutes <= MAX_SESSION_MINUTES,
      ),
    ),
  ].sort((left, right) => left - right);
}

/**
 * Why a mode produced nothing, in terms of what the owner can do about it.
 *
 * Exhaustive, so a seventh mode has to say what an empty result means for it.
 */
function emptyReason(mode: SessionMode): string {
  switch (mode) {
    case "SINGLE_TRACK":
    case "MIXED_TRACKS":
      return "There is nothing to study in the tracks you chose yet. Add active questions or flashcards first.";
    case "QUESTIONS_ONLY":
      return "There are no active questions in the tracks you chose. Add or activate some questions first.";
    case "FLASHCARDS_ONLY":
      return "No flashcards are due for review in the tracks you chose.";
    case "MISTAKE_REVIEW":
      return "You have no recorded mistakes in the tracks you chose. Answer some questions first.";
    case "DIAGNOSTIC":
      return "There are not enough active questions to run a diagnostic yet.";
  }
}

/** Availability of each mode, given what the bank currently holds. */
function modeOptions(counts: {
  readonly questionCount: number;
  readonly dueCardCount: number;
  readonly hasMistakes: boolean;
  readonly diagnosticAvailable: boolean;
}): SessionModeOption[] {
  const studiable = counts.questionCount > 0 || counts.dueCardCount > 0;
  const entries: readonly {
    readonly mode: SessionMode;
    readonly available: boolean;
    readonly reason: string;
  }[] = [
    {
      mode: "SINGLE_TRACK",
      available: studiable,
      reason: "Add active questions or flashcards to a track first.",
    },
    {
      mode: "MIXED_TRACKS",
      available: studiable,
      reason: "Add active questions or flashcards to a track first.",
    },
    {
      mode: "QUESTIONS_ONLY",
      available: counts.questionCount > 0,
      reason: "There are no active questions yet.",
    },
    {
      mode: "FLASHCARDS_ONLY",
      available: counts.dueCardCount > 0,
      reason: "No flashcards are due for review.",
    },
    {
      mode: "MISTAKE_REVIEW",
      available: counts.hasMistakes,
      reason: "You have no recorded mistakes to review yet.",
    },
    {
      mode: "DIAGNOSTIC",
      available: counts.diagnosticAvailable,
      reason: `A diagnostic needs at least ${DIAGNOSTIC_MIN_QUESTIONS} active questions across ${DIAGNOSTIC_MIN_OBJECTIVES} objectives.`,
    },
  ];

  return entries.map((entry) => ({
    mode: entry.mode,
    available: entry.available,
    unavailableReason: entry.available ? null : entry.reason,
  }));
}
