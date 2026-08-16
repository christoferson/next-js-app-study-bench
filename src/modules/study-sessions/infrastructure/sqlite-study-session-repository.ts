import type { IsoTimestamp } from "@/platform/clock";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import type { QuestionId } from "@/modules/question-bank/domain/question";
import type { QuestionAttempt } from "@/modules/study-sessions/domain/question-attempt";
import type {
  ObjectiveAccuracy,
  QuestionAttemptSummary,
} from "@/modules/study-sessions/domain/session-composer";
import {
  SessionItemNotFoundError,
  StudySessionNotFoundError,
} from "@/modules/study-sessions/domain/errors";
import type {
  StudySession,
  StudySessionId,
  StudySessionItem,
  StudySessionWithItems,
} from "@/modules/study-sessions/domain/study-session";
import type {
  AttemptHistoryCriteria,
  SessionEndStatus,
  SessionHistoryEntry,
  SessionItemOutcome,
  StudyHistoryCriteria,
  StudySessionRepository,
} from "@/modules/study-sessions/ports/study-session-repository";
import type {
  QuestionAttemptRow,
  StudySessionItemRow,
  StudySessionRow,
} from "./rows";
import {
  serializeSubmittedAnswer,
  toConfidence,
  toQuestionAttempt,
  toStudySession,
  toStudySessionItem,
} from "./rows";

const SESSION_COLUMNS = `id, mode, status, target_minutes, created_at,
  completed_at`;

const ITEM_COLUMNS = `id, session_id, position, item_type, question_id,
  question_revision_id, flashcard_id, flashcard_revision_id, status,
  completed_at`;

const ATTEMPT_COLUMNS = `id, session_id, question_id, question_revision_id,
  submitted_answer, is_correct, confidence, duration_seconds, attempted_at,
  evaluation_mode, feedback_snapshot`;

/**
 * SQLite-backed study-session persistence.
 *
 * Attempts are append-only: this class offers `recordAttempt` and no way to update
 * or delete one. Item content is write-once in the same way — `settleItem` moves an
 * item's status and nothing here can repoint it at a different revision, which is
 * what keeps a composed session frozen against later edits
 * (`spec/DOMAIN-RULES.md` section 2.3).
 */
export class SqliteStudySessionRepository implements StudySessionRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async findById(id: StudySessionId): Promise<StudySession | null> {
    const row = this.database
      .prepare(`SELECT ${SESSION_COLUMNS} FROM study_sessions WHERE id = ?`)
      .get(id) as StudySessionRow | undefined;

    return row === undefined
      ? null
      : toStudySession(row, this.trackIdsFor(row.id));
  }

  async findWithItems(
    id: StudySessionId,
  ): Promise<StudySessionWithItems | null> {
    const session = await this.findById(id);

    return session === null
      ? null
      : { session, items: this.itemsFor(session.id) };
  }

  /**
   * The single session still in progress.
   *
   * Ordered newest first and limited to one so that a database which somehow held
   * two in-progress rows resolves to the most recent rather than an arbitrary one.
   * The application prevents that state by abandoning the old session when a new
   * one starts, but a read should not depend on a write path having been correct.
   */
  async findInProgress(): Promise<StudySessionWithItems | null> {
    const row = this.database
      .prepare(
        `SELECT ${SESSION_COLUMNS} FROM study_sessions
         WHERE status = 'IN_PROGRESS'
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
      )
      .get() as StudySessionRow | undefined;

    if (row === undefined) {
      return null;
    }

    const session = toStudySession(row, this.trackIdsFor(row.id));

    return { session, items: this.itemsFor(session.id) };
  }

  /**
   * Session history with its counts computed in SQL.
   *
   * Correlated subqueries rather than joins: joining items and attempts to the
   * same session row would multiply them together and inflate both counts.
   */
  async listHistory(
    limit: number,
    certificationId?: CertificationId,
  ): Promise<SessionHistoryEntry[]> {
    const rows = this.database
      .prepare(
        `SELECT ${SESSION_COLUMNS.split(",")
          .map((column) => `s.${column.trim()}`)
          .join(", ")},
                (SELECT COUNT(*) FROM study_session_items i
                  WHERE i.session_id = s.id) AS item_count,
                (SELECT COUNT(*) FROM study_session_items i
                  WHERE i.session_id = s.id AND i.status <> 'PENDING')
                  AS settled_count,
                (SELECT COUNT(*) FROM question_attempts a
                  WHERE a.session_id = s.id) AS attempt_count,
                (SELECT COUNT(*) FROM question_attempts a
                  WHERE a.session_id = s.id AND a.is_correct = 1)
                  AS correct_count
         FROM study_sessions s
         WHERE (@certificationId IS NULL OR EXISTS (
                  SELECT 1 FROM session_certifications c
                  WHERE c.session_id = s.id
                    AND c.certification_id = @certificationId))
         ORDER BY s.created_at DESC, s.id DESC
         LIMIT @limit`,
      )
      .all({
        limit,
        certificationId: certificationId ?? null,
      }) as (StudySessionRow & {
      readonly item_count: number;
      readonly settled_count: number;
      readonly attempt_count: number;
      readonly correct_count: number;
    })[];

    return rows.map((row) => ({
      session: toStudySession(row, this.trackIdsFor(row.id)),
      itemCount: row.item_count,
      settledCount: row.settled_count,
      attemptCount: row.attempt_count,
      correctCount: row.correct_count,
    }));
  }

  async create(
    session: StudySession,
    items: readonly StudySessionItem[],
  ): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO study_sessions (${SESSION_COLUMNS})
         VALUES (@id, @mode, @status, @targetMinutes, @createdAt, @completedAt)`,
      )
      .run({
        id: session.id,
        mode: session.mode,
        status: session.status,
        targetMinutes: session.targetMinutes,
        createdAt: session.createdAt,
        completedAt: session.completedAt,
      });

    const insertTrack = this.database.prepare(
      `INSERT INTO session_certifications (session_id, certification_id)
       VALUES (?, ?)`,
    );

    for (const certificationId of new Set(session.certificationIds)) {
      insertTrack.run(session.id, certificationId);
    }

    const insertItem = this.database.prepare(
      `INSERT INTO study_session_items (${ITEM_COLUMNS})
       VALUES (@id, @sessionId, @position, @itemType, @questionId,
         @questionRevisionId, @flashcardId, @flashcardRevisionId, @status,
         @completedAt)`,
    );

    for (const item of items) {
      insertItem.run({
        id: item.id,
        sessionId: item.sessionId,
        position: item.position,
        itemType: item.content.itemType,
        questionId:
          item.content.itemType === "QUESTION" ? item.content.questionId : null,
        questionRevisionId:
          item.content.itemType === "QUESTION"
            ? item.content.questionRevisionId
            : null,
        flashcardId:
          item.content.itemType === "FLASHCARD"
            ? item.content.flashcardId
            : null,
        flashcardRevisionId:
          item.content.itemType === "FLASHCARD"
            ? item.content.flashcardRevisionId
            : null,
        status: item.status,
        completedAt: item.completedAt,
      });
    }
  }

  /**
   * Settles one pending item.
   *
   * The `status = 'PENDING'` predicate is part of the update, not a prior read, so
   * two submissions racing on the same item cannot both succeed: the second
   * changes no rows and raises. That is what makes "save after every answer" safe
   * from a double-tapped submit button.
   */
  async settleItem(
    sessionId: StudySessionId,
    outcome: SessionItemOutcome,
  ): Promise<void> {
    const result = this.database
      .prepare(
        `UPDATE study_session_items
         SET status = @status, completed_at = @occurredAt
         WHERE id = @itemId AND session_id = @sessionId AND status = 'PENDING'`,
      )
      .run({
        itemId: outcome.itemId,
        sessionId,
        status: outcome.status,
        occurredAt: outcome.occurredAt,
      });

    if (result.changes === 0) {
      throw new SessionItemNotFoundError(outcome.itemId);
    }
  }

  /**
   * Ends a session that is still in progress.
   *
   * Guarded on the current status for the same reason as `settleItem`: finishing a
   * session twice must not rewrite the first completion time.
   */
  async closeSession(
    id: StudySessionId,
    status: SessionEndStatus,
    occurredAt: IsoTimestamp,
  ): Promise<void> {
    const result = this.database
      .prepare(
        `UPDATE study_sessions
         SET status = @status, completed_at = @occurredAt
         WHERE id = @id AND status = 'IN_PROGRESS'`,
      )
      .run({ id, status, occurredAt });

    if (result.changes === 0) {
      throw new StudySessionNotFoundError(id);
    }
  }

  async recordAttempt(attempt: QuestionAttempt): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO question_attempts (${ATTEMPT_COLUMNS})
         VALUES (@id, @sessionId, @questionId, @questionRevisionId,
           @submittedAnswer, @isCorrect, @confidence, @durationSeconds,
           @attemptedAt, @evaluationMode, @feedbackSnapshot)`,
      )
      .run({
        id: attempt.id,
        sessionId: attempt.sessionId,
        questionId: attempt.questionId,
        questionRevisionId: attempt.questionRevisionId,
        submittedAnswer: serializeSubmittedAnswer(attempt.submittedAnswer),
        isCorrect: attempt.isCorrect ? 1 : 0,
        confidence: attempt.confidence,
        durationSeconds: attempt.durationSeconds,
        attemptedAt: attempt.attemptedAt,
        evaluationMode: attempt.evaluationMode,
        feedbackSnapshot: attempt.feedbackSnapshot,
      });
  }

  async listAttemptsForQuestion(
    criteria: AttemptHistoryCriteria,
  ): Promise<QuestionAttempt[]> {
    const rows = this.database
      .prepare(
        `SELECT ${ATTEMPT_COLUMNS} FROM question_attempts
         WHERE question_id = @questionId
         ORDER BY attempted_at DESC, id DESC
         LIMIT @limit`,
      )
      .all({
        questionId: criteria.questionId,
        limit: criteria.limit,
      }) as QuestionAttemptRow[];

    return rows.map(toQuestionAttempt);
  }

  async listAttemptsForSession(id: StudySessionId): Promise<QuestionAttempt[]> {
    const rows = this.database
      .prepare(
        `SELECT ${ATTEMPT_COLUMNS} FROM question_attempts
         WHERE session_id = ?
         ORDER BY attempted_at ASC, id ASC`,
      )
      .all(id) as QuestionAttemptRow[];

    return rows.map(toQuestionAttempt);
  }

  /**
   * Latest verdict per attempted question, within the selected tracks.
   *
   * The window function picks one row per question — the most recent attempt — so
   * the composer sees the owner's current standing on each question rather than
   * every answer they have ever given. `attempted_at DESC, id DESC` makes that
   * choice deterministic when two attempts share a timestamp.
   */
  async summarizeAttemptsByQuestion(
    criteria: StudyHistoryCriteria,
  ): Promise<QuestionAttemptSummary[]> {
    if (criteria.certificationIds.length === 0) {
      return [];
    }

    const placeholders = criteria.certificationIds
      .map((_, index) => `@certification${index}`)
      .join(", ");
    const parameters: Record<string, string | number> = {
      limit: criteria.limit,
    };

    for (const [
      index,
      certificationId,
    ] of criteria.certificationIds.entries()) {
      parameters[`certification${index}`] = certificationId;
    }

    const rows = this.database
      .prepare(
        `SELECT question_id, attempt_count, last_attempted_at, last_is_correct,
                last_confidence
         FROM (
           SELECT a.question_id AS question_id,
                  COUNT(*) OVER (PARTITION BY a.question_id) AS attempt_count,
                  a.attempted_at AS last_attempted_at,
                  a.is_correct AS last_is_correct,
                  a.confidence AS last_confidence,
                  ROW_NUMBER() OVER (
                    PARTITION BY a.question_id
                    ORDER BY a.attempted_at DESC, a.id DESC
                  ) AS recency
           FROM question_attempts a
           JOIN questions q ON q.id = a.question_id
           WHERE q.certification_id IN (${placeholders})
         )
         WHERE recency = 1
         ORDER BY last_attempted_at DESC, question_id ASC
         LIMIT @limit`,
      )
      .all(parameters) as {
      readonly question_id: string;
      readonly attempt_count: number;
      readonly last_attempted_at: string;
      readonly last_is_correct: number;
      readonly last_confidence: string;
    }[];

    return rows.map((row) => ({
      questionId: row.question_id,
      attemptCount: row.attempt_count,
      lastAttemptedAt: row.last_attempted_at,
      lastIsCorrect: row.last_is_correct === 1,
      lastConfidence: toConfidence(row.last_confidence),
    }));
  }

  /**
   * Attempts grouped by objective, within the selected tracks.
   *
   * An attempt counts towards every objective its question is mapped to, so the
   * totals here can exceed the attempt count — that is correct: one answer is
   * evidence about each objective it covers. Objectives with no attempts produce
   * no row at all, which is what lets the caller read absence as `UNSEEN`.
   */
  async summarizeObjectiveAccuracy(
    certificationIds: readonly CertificationId[],
  ): Promise<ObjectiveAccuracy[]> {
    if (certificationIds.length === 0) {
      return [];
    }

    const placeholders = certificationIds
      .map((_, index) => `@certification${index}`)
      .join(", ");
    const parameters: Record<string, string> = {};

    for (const [index, certificationId] of certificationIds.entries()) {
      parameters[`certification${index}`] = certificationId;
    }

    const rows = this.database
      .prepare(
        `SELECT l.objective_id AS objective_id,
                COUNT(*) AS attempt_count,
                SUM(a.is_correct) AS correct_count
         FROM question_attempts a
         JOIN questions q ON q.id = a.question_id
         JOIN question_objective_links l ON l.question_id = a.question_id
         WHERE q.certification_id IN (${placeholders})
         GROUP BY l.objective_id
         ORDER BY l.objective_id ASC`,
      )
      .all(parameters) as {
      readonly objective_id: string;
      readonly attempt_count: number;
      readonly correct_count: number | null;
    }[];

    return rows.map((row) => ({
      objectiveId: row.objective_id,
      attemptCount: row.attempt_count,
      correctCount: row.correct_count ?? 0,
    }));
  }

  async countQuestionReferences(id: QuestionId): Promise<{
    readonly attempts: number;
    readonly sessionItems: number;
  }> {
    const row = this.database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM question_attempts WHERE question_id = @id)
             AS attempts,
           (SELECT COUNT(*) FROM study_session_items WHERE question_id = @id)
             AS session_items`,
      )
      .get({ id }) as
      { readonly attempts: number; readonly session_items: number } | undefined;

    return {
      attempts: row?.attempts ?? 0,
      sessionItems: row?.session_items ?? 0,
    };
  }

  private trackIdsFor(sessionId: StudySessionId): CertificationId[] {
    const rows = this.database
      .prepare(
        `SELECT sc.certification_id AS certification_id
         FROM session_certifications sc
         JOIN certifications c ON c.id = sc.certification_id
         WHERE sc.session_id = ?
         ORDER BY c.name ASC, c.id ASC`,
      )
      .all(sessionId) as { readonly certification_id: string }[];

    return rows.map((row) => row.certification_id);
  }

  private itemsFor(sessionId: StudySessionId): StudySessionItem[] {
    const rows = this.database
      .prepare(
        `SELECT ${ITEM_COLUMNS} FROM study_session_items
         WHERE session_id = ?
         ORDER BY position ASC`,
      )
      .all(sessionId) as StudySessionItemRow[];

    return rows.map(toStudySessionItem);
  }
}
