import type { IsoTimestamp } from "@/platform/clock";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import type { QuestionId } from "@/modules/question-bank/domain/question";
import type { QuestionAttempt } from "@/modules/study-sessions/domain/question-attempt";
import type {
  ObjectiveAccuracy,
  QuestionAttemptSummary,
} from "@/modules/study-sessions/domain/session-composer";
import type {
  SessionItemStatus,
  SessionStatus,
  StudySession,
  StudySessionId,
  StudySessionItem,
  StudySessionItemId,
  StudySessionWithItems,
} from "@/modules/study-sessions/domain/study-session";

/**
 * Persistence port for study sessions, their items, and the attempts recorded
 * against them.
 *
 * The methods describe the access patterns the application needs. No SQL, query
 * builder, or database row crosses this boundary
 * (`spec/ARCHITECTURE.md` section 5.1).
 *
 * There is deliberately no method that updates or deletes an attempt. An attempt
 * is a historical fact (`spec/DOMAIN-RULES.md` section 1.3): the only write is an
 * append, so no caller can revise the record of an answer even by mistake. There
 * is likewise no method that rewrites an item's frozen content — the revision an
 * item points at is fixed when the session is composed
 * (`spec/DOMAIN-RULES.md` section 2.3).
 */

/** A session item together with the status it settled into. */
export interface SessionItemOutcome {
  readonly itemId: StudySessionItemId;
  /**
   * `PENDING` is absent on purpose: an item can be settled but never un-settled,
   * so there is no way to reopen an answered item.
   */
  readonly status: Extract<SessionItemStatus, "COMPLETED" | "SKIPPED">;
  readonly occurredAt: IsoTimestamp;
}

/** How a session may end. In progress is not an ending. */
export type SessionEndStatus = Extract<
  SessionStatus,
  "COMPLETED" | "ABANDONED"
>;

/**
 * One row of the session-history list.
 *
 * The counts are computed in SQL rather than by loading every item and attempt,
 * so listing history stays one bounded query
 * (`spec/ARCHITECTURE.md` section 8).
 */
export interface SessionHistoryEntry {
  readonly session: StudySession;
  readonly itemCount: number;
  readonly settledCount: number;
  readonly attemptCount: number;
  readonly correctCount: number;
}

/** Attempt-history query for one question. Bounded, like every other read. */
export interface AttemptHistoryCriteria {
  readonly questionId: QuestionId;
  readonly limit: number;
}

/** Answer-history query for the composer, scoped to the chosen tracks. */
export interface StudyHistoryCriteria {
  readonly certificationIds: readonly CertificationId[];
  readonly limit: number;
}

export interface StudySessionRepository {
  findById(id: StudySessionId): Promise<StudySession | null>;
  /** The session with its ordered items, as the study screen needs it. */
  findWithItems(id: StudySessionId): Promise<StudySessionWithItems | null>;
  /**
   * The one session still in progress, or `null`.
   *
   * Singular because only one session is in progress at a time: starting a new
   * one supersedes the old (see the `ABANDONED` note on `SessionStatus`). That
   * makes "resume" a single unambiguous destination instead of a list the owner
   * has to choose from.
   */
  findInProgress(): Promise<StudySessionWithItems | null>;
  /**
   * Sessions most recent first, bounded by `limit`.
   *
   * `certificationId` narrows to sessions that included that track, which is what a
   * single track's progress page shows. Filtering here rather than in the caller keeps
   * the bound meaningful: reading ten sessions and then discarding the ones belonging
   * to other tracks would show fewer than ten, and sometimes none.
   */
  listHistory(
    limit: number,
    certificationId?: CertificationId,
  ): Promise<SessionHistoryEntry[]>;

  /**
   * Inserts a session, its track associations, and its composed items.
   *
   * One call because a session with no items is not a valid aggregate — the
   * composer refuses to create one — and callers run it inside a unit of work.
   */
  create(
    session: StudySession,
    items: readonly StudySessionItem[],
  ): Promise<void>;

  /**
   * Marks one item settled.
   *
   * Fails when the item is not currently pending in that session, which is what
   * makes a double submission from a stale screen an error rather than a second
   * recorded answer.
   */
  settleItem(
    sessionId: StudySessionId,
    outcome: SessionItemOutcome,
  ): Promise<void>;

  /**
   * Ends a session.
   *
   * Items still `PENDING` stay pending: finishing early means the owner never
   * reached them, and rewriting them as skipped would claim they were seen (see
   * the note on `SessionItemStatus`).
   */
  closeSession(
    id: StudySessionId,
    status: SessionEndStatus,
    occurredAt: IsoTimestamp,
  ): Promise<void>;

  /** Appends an attempt. Callers pair it with `settleItem` in one transaction. */
  recordAttempt(attempt: QuestionAttempt): Promise<void>;
  /** Attempts against one question, most recent first, bounded. */
  listAttemptsForQuestion(
    criteria: AttemptHistoryCriteria,
  ): Promise<QuestionAttempt[]>;
  /** Attempts recorded in one session, oldest first. */
  listAttemptsForSession(id: StudySessionId): Promise<QuestionAttempt[]>;

  /**
   * Per-question answer history, in the shape the composer's priority bands need.
   *
   * One row per question that has ever been attempted within the given tracks,
   * carrying the latest attempt's verdict and confidence. Bounded: the composer
   * only needs recent history to prioritise, and reading every attempt ever
   * recorded would be an unbounded read (`spec/ARCHITECTURE.md` section 8).
   */
  summarizeAttemptsByQuestion(
    criteria: StudyHistoryCriteria,
  ): Promise<QuestionAttemptSummary[]>;

  /**
   * Per-objective accuracy, in the shape the composer's weak- and
   * unseen-objective bands need.
   *
   * An objective with no attempts is absent rather than present with zeroes,
   * which is what lets "no row" mean `UNSEEN`
   * (`spec/DOMAIN-RULES.md` section 2.5) instead of "scored zero".
   */
  summarizeObjectiveAccuracy(
    certificationIds: readonly CertificationId[],
  ): Promise<ObjectiveAccuracy[]>;

  /**
   * Whether any attempt or session item references this question.
   *
   * Backs the deletion check: a question the owner has answered, or that a
   * recorded session offered, carries history that a hard delete would erase
   * (`SPEC.md` section 6.3.2).
   */
  countQuestionReferences(id: QuestionId): Promise<{
    readonly attempts: number;
    readonly sessionItems: number;
  }>;
}
