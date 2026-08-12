import type { IsoTimestamp } from "@/platform/clock";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import type { ObjectiveId } from "@/modules/certifications/domain/objective";
import type { QuestionId } from "@/modules/question-bank/domain/question";
import { FlashcardNotFoundError } from "@/modules/flashcards/domain/errors";
import type {
  Flashcard,
  FlashcardId,
  FlashcardLifecycleStatus,
  FlashcardRevision,
  FlashcardWithRevision,
} from "@/modules/flashcards/domain/flashcard";
import { searchableText } from "@/modules/flashcards/domain/flashcard-content";
import type { ReviewSchedule } from "@/modules/flashcards/domain/review-scheduling";
import type {
  DueCardCandidateCriteria,
  DueCardCriteria,
  DueFlashcard,
  FlashcardBankCounts,
  FlashcardRepository,
  FlashcardReviewRecord,
  FlashcardSearchCriteria,
  FlashcardSearchPage,
} from "@/modules/flashcards/ports/flashcard-repository";
import type {
  FlashcardRevisionRow,
  FlashcardReviewRow,
  FlashcardRow,
  ReviewScheduleRow,
} from "./rows";
import {
  serializeContent,
  serializeTags,
  toFlashcard,
  toFlashcardRevision,
  toReviewRecord,
  toReviewSchedule,
} from "./rows";

const CARD_COLUMNS = `id, certification_id, current_revision_id,
  lifecycle_status, source_question_id, generation_mode, generation_run_id,
  created_at, updated_at`;

const REVISION_COLUMNS = `id, flashcard_id, revision_number, card_type,
  content_payload, search_text, notes, tags, language, created_at`;

const SCHEDULE_COLUMNS = `flashcard_id, interval_minutes, due_at, lapse_count,
  review_count, last_reviewed_at, scheduler_id`;

const REVIEW_COLUMNS = `id, flashcard_id, flashcard_revision_id, rating,
  reviewed_at, interval_minutes, due_at, scheduler_id`;

/** Prefixed for the joins that select from several tables at once. */
const JOINED_COLUMNS = [
  ...prefixed(CARD_COLUMNS, "f", "f_"),
  ...prefixed(REVISION_COLUMNS, "r", "r_"),
].join(", ");

const DUE_COLUMNS = [
  ...prefixed(CARD_COLUMNS, "f", "f_"),
  ...prefixed(REVISION_COLUMNS, "r", "r_"),
  ...prefixed(SCHEDULE_COLUMNS, "s", "s_"),
].join(", ");

/** One joined row across the card, revision, and schedule tables. */
type JoinedRow = Record<string, string | number | null>;

/**
 * SQLite-backed flashcard persistence.
 *
 * Revisions are append-only: this class offers `create` and `appendRevision` and
 * no way to rewrite an existing revision row. Reviews are append-only in the same
 * way — `recordReview` inserts, and nothing here updates or deletes a review.
 */
export class SqliteFlashcardRepository implements FlashcardRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async findById(id: FlashcardId): Promise<Flashcard | null> {
    const row = this.database
      .prepare(`SELECT ${CARD_COLUMNS} FROM flashcards WHERE id = ?`)
      .get(id) as FlashcardRow | undefined;

    return row === undefined ? null : toFlashcard(row);
  }

  async findWithCurrentRevision(
    id: FlashcardId,
  ): Promise<FlashcardWithRevision | null> {
    const flashcard = await this.findById(id);

    if (flashcard === null) {
      return null;
    }

    const row = this.database
      .prepare(
        `SELECT ${REVISION_COLUMNS} FROM flashcard_revisions WHERE id = ?`,
      )
      .get(flashcard.currentRevisionId) as FlashcardRevisionRow | undefined;

    if (row === undefined) {
      throw new Error(
        `Flashcard ${id} points at missing revision ${flashcard.currentRevisionId}.`,
      );
    }

    return { flashcard, revision: toFlashcardRevision(row) };
  }

  async listRevisions(id: FlashcardId): Promise<FlashcardRevision[]> {
    const rows = this.database
      .prepare(
        `SELECT ${REVISION_COLUMNS} FROM flashcard_revisions
         WHERE flashcard_id = ?
         ORDER BY revision_number ASC`,
      )
      .all(id) as FlashcardRevisionRow[];

    return rows.map(toFlashcardRevision);
  }

  async findRevision(
    id: FlashcardId,
    revisionNumber: number,
  ): Promise<FlashcardRevision | null> {
    const row = this.database
      .prepare(
        `SELECT ${REVISION_COLUMNS} FROM flashcard_revisions
         WHERE flashcard_id = ? AND revision_number = ?`,
      )
      .get(id, revisionNumber) as FlashcardRevisionRow | undefined;

    return row === undefined ? null : toFlashcardRevision(row);
  }

  /**
   * Bounded bank query.
   *
   * The text filter is a `LIKE` against the current revision's flattened search
   * text, so it matches any field of any card type without the query having to
   * know which fields the type has.
   */
  async search(
    criteria: FlashcardSearchCriteria,
  ): Promise<FlashcardSearchPage> {
    const conditions: string[] = ["f.certification_id = @certificationId"];
    const parameters: Record<string, string | number> = {
      certificationId: criteria.certificationId,
      limit: criteria.limit,
      offset: criteria.offset,
    };

    if (criteria.lifecycleStatus !== undefined) {
      conditions.push("f.lifecycle_status = @lifecycleStatus");
      parameters.lifecycleStatus = criteria.lifecycleStatus;
    }

    if (criteria.cardType !== undefined) {
      conditions.push("r.card_type = @cardType");
      parameters.cardType = criteria.cardType;
    }

    if (criteria.objectiveId !== undefined) {
      conditions.push(
        `EXISTS (SELECT 1 FROM flashcard_objective_links l
                 WHERE l.flashcard_id = f.id AND l.objective_id = @objectiveId)`,
      );
      parameters.objectiveId = criteria.objectiveId;
    }

    if (criteria.textContains !== undefined) {
      // `LIKE` is case-insensitive for ASCII in SQLite; ESCAPE makes a literal
      // `%` or `_` in the owner's search text match itself rather than act as a
      // wildcard.
      conditions.push(`r.search_text LIKE @textPattern ESCAPE '\\'`);
      parameters.textPattern = `%${escapeLike(criteria.textContains)}%`;
    }

    const from = `FROM flashcards f
      JOIN flashcard_revisions r ON r.id = f.current_revision_id
      WHERE ${conditions.join(" AND ")}`;

    const totalRow = this.database
      .prepare(`SELECT COUNT(*) AS total ${from}`)
      .get(parameters) as { readonly total: number } | undefined;

    const rows = this.database
      .prepare(
        `SELECT ${JOINED_COLUMNS} ${from}
         ORDER BY f.updated_at DESC, f.id ASC
         LIMIT @limit OFFSET @offset`,
      )
      .all(parameters) as JoinedRow[];

    return {
      items: rows.map(toFlashcardWithRevision),
      totalCount: totalRow?.total ?? 0,
      limit: criteria.limit,
      offset: criteria.offset,
    };
  }

  async countsByCertification(
    certificationId: CertificationId,
  ): Promise<FlashcardBankCounts> {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN lifecycle_status = 'ACTIVE' THEN 1 ELSE 0 END) AS active
         FROM flashcards WHERE certification_id = ?`,
      )
      .get(certificationId) as
      { readonly total: number; readonly active: number | null } | undefined;

    return { total: row?.total ?? 0, active: row?.active ?? 0 };
  }

  /**
   * Inserts the root, then its first revision, then the current pointer.
   *
   * The pointer is a third statement because the two tables reference each other;
   * the caller's transaction makes the intermediate state unobservable.
   */
  async create(
    flashcard: Flashcard,
    revision: FlashcardRevision,
  ): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO flashcards (id, certification_id, current_revision_id,
           lifecycle_status, source_question_id, generation_mode,
           generation_run_id, created_at, updated_at)
         VALUES (@id, @certificationId, NULL, @lifecycleStatus,
           @sourceQuestionId, @generationMode, @generationRunId, @createdAt,
           @updatedAt)`,
      )
      .run({
        id: flashcard.id,
        certificationId: flashcard.certificationId,
        lifecycleStatus: flashcard.lifecycleStatus,
        sourceQuestionId: flashcard.sourceQuestionId,
        generationMode: flashcard.generationMode,
        generationRunId: flashcard.generationRunId,
        createdAt: flashcard.createdAt,
        updatedAt: flashcard.updatedAt,
      });

    this.insertRevision(revision);
    this.pointAtRevision(flashcard.id, revision.id, flashcard.updatedAt);
  }

  async appendRevision(
    revision: FlashcardRevision,
    occurredAt: IsoTimestamp,
  ): Promise<void> {
    this.insertRevision(revision);
    this.pointAtRevision(revision.flashcardId, revision.id, occurredAt);
  }

  async setLifecycleStatus(
    id: FlashcardId,
    status: FlashcardLifecycleStatus,
    occurredAt: IsoTimestamp,
  ): Promise<void> {
    const result = this.database
      .prepare(
        `UPDATE flashcards SET lifecycle_status = ?, updated_at = ? WHERE id = ?`,
      )
      .run(status, occurredAt, id);

    if (result.changes === 0) {
      throw new FlashcardNotFoundError(id);
    }
  }

  /**
   * Removes a card completely.
   *
   * The current-revision pointer is cleared first: it is `ON DELETE RESTRICT`, so
   * the revision rows cannot go while the root still points at one. The same
   * restriction on `flashcard_reviews.flashcard_revision_id` and on the session
   * item columns is what makes a studied card undeletable — the revision delete
   * raises a constraint failure rather than removing the history that names it.
   */
  async delete(id: FlashcardId): Promise<void> {
    const cleared = this.database
      .prepare(`UPDATE flashcards SET current_revision_id = NULL WHERE id = ?`)
      .run(id);

    if (cleared.changes === 0) {
      throw new FlashcardNotFoundError(id);
    }

    this.database
      .prepare(`DELETE FROM flashcard_objective_links WHERE flashcard_id = ?`)
      .run(id);
    this.database
      .prepare(`DELETE FROM flashcard_revisions WHERE flashcard_id = ?`)
      .run(id);
    this.database.prepare(`DELETE FROM flashcards WHERE id = ?`).run(id);
  }

  async listObjectiveLinks(id: FlashcardId): Promise<ObjectiveId[]> {
    const rows = this.database
      .prepare(
        `SELECT l.objective_id AS objective_id
         FROM flashcard_objective_links l
         JOIN certification_objectives o ON o.id = l.objective_id
         WHERE l.flashcard_id = ?
         ORDER BY o.display_order ASC, o.id ASC`,
      )
      .all(id) as { readonly objective_id: string }[];

    return rows.map((row) => row.objective_id);
  }

  async replaceObjectiveLinks(
    id: FlashcardId,
    objectiveIds: readonly ObjectiveId[],
    occurredAt: IsoTimestamp,
  ): Promise<void> {
    const exists = this.database
      .prepare(`SELECT 1 AS present FROM flashcards WHERE id = ?`)
      .get(id);

    if (exists === undefined) {
      throw new FlashcardNotFoundError(id);
    }

    this.database
      .prepare(`DELETE FROM flashcard_objective_links WHERE flashcard_id = ?`)
      .run(id);

    const insert = this.database.prepare(
      `INSERT INTO flashcard_objective_links (flashcard_id, objective_id, created_at)
       VALUES (?, ?, ?)`,
    );

    for (const objectiveId of new Set(objectiveIds)) {
      insert.run(id, objectiveId, occurredAt);
    }

    this.touch(id, occurredAt);
  }

  /**
   * Active cards due at `criteria.now`, in a deterministic review order.
   *
   * The lifecycle filter is in SQL rather than applied afterwards, so a draft,
   * retired, or archived card is never fetched at all
   * (`SPEC.md` section 22.3).
   *
   * Ordering uses one key for both kinds of card: a reviewed card sorts by its
   * due date, and a card that has never been reviewed sorts by when it was
   * created, so the oldest waiting card comes first in either case. The card
   * identifier breaks ties, which makes the queue stable across reloads —
   * refreshing the review screen offers the same card until it is rated.
   *
   * `due_at <= now` includes a card due at exactly this instant. Comparing the
   * timestamps as text is valid because every stored timestamp is UTC ISO-8601
   * and therefore orders lexicographically.
   */
  async findDueCards(criteria: DueCardCriteria): Promise<DueFlashcard[]> {
    const rows = this.database
      .prepare(
        `SELECT ${DUE_COLUMNS}
         FROM flashcards f
         JOIN flashcard_revisions r ON r.id = f.current_revision_id
         LEFT JOIN review_schedules s ON s.flashcard_id = f.id
         WHERE f.certification_id = @certificationId
           AND f.lifecycle_status = 'ACTIVE'
           AND (s.due_at IS NULL OR s.due_at <= @now)
         ORDER BY COALESCE(s.due_at, f.created_at) ASC, f.id ASC
         LIMIT @limit`,
      )
      .all({
        certificationId: criteria.certificationId,
        now: criteria.now,
        limit: criteria.limit,
      }) as JoinedRow[];

    return rows.map(toDueFlashcard);
  }

  /**
   * The same selection as `findDueCards`, across several tracks.
   *
   * The clauses and the `ORDER BY` are deliberately identical: the only difference
   * is `IN` instead of `=`, so a mixed-track session cannot disagree with the
   * per-track review screen about which card is next.
   */
  async findDueCandidates(
    criteria: DueCardCandidateCriteria,
  ): Promise<DueFlashcard[]> {
    if (criteria.certificationIds.length === 0) {
      return [];
    }

    const placeholders = criteria.certificationIds
      .map((_, index) => `@certification${index}`)
      .join(", ");
    const parameters: Record<string, string | number> = {
      now: criteria.now,
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
        `SELECT ${DUE_COLUMNS}
         FROM flashcards f
         JOIN flashcard_revisions r ON r.id = f.current_revision_id
         LEFT JOIN review_schedules s ON s.flashcard_id = f.id
         WHERE f.certification_id IN (${placeholders})
           AND f.lifecycle_status = 'ACTIVE'
           AND (s.due_at IS NULL OR s.due_at <= @now)
         ORDER BY COALESCE(s.due_at, f.created_at) ASC, f.id ASC
         LIMIT @limit`,
      )
      .all(parameters) as JoinedRow[];

    return rows.map(toDueFlashcard);
  }

  async countDueCards(
    certificationId: CertificationId,
    now: IsoTimestamp,
  ): Promise<number> {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS total
         FROM flashcards f
         LEFT JOIN review_schedules s ON s.flashcard_id = f.id
         WHERE f.certification_id = @certificationId
           AND f.lifecycle_status = 'ACTIVE'
           AND (s.due_at IS NULL OR s.due_at <= @now)`,
      )
      .get({ certificationId, now }) as { readonly total: number } | undefined;

    return row?.total ?? 0;
  }

  async findSchedule(id: FlashcardId): Promise<ReviewSchedule | null> {
    const row = this.database
      .prepare(
        `SELECT ${SCHEDULE_COLUMNS} FROM review_schedules WHERE flashcard_id = ?`,
      )
      .get(id) as ReviewScheduleRow | undefined;

    return row === undefined ? null : toReviewSchedule(row);
  }

  /**
   * Inserts the card's schedule on the first review and replaces it afterwards.
   *
   * `ON CONFLICT` keeps it one statement, so there is no read-then-write window
   * in which two ratings could both insert.
   */
  async saveSchedule(
    id: FlashcardId,
    schedule: ReviewSchedule,
    occurredAt: IsoTimestamp,
  ): Promise<void> {
    const exists = this.database
      .prepare(`SELECT 1 AS present FROM flashcards WHERE id = ?`)
      .get(id);

    if (exists === undefined) {
      throw new FlashcardNotFoundError(id);
    }

    this.database
      .prepare(
        `INSERT INTO review_schedules (flashcard_id, interval_minutes, due_at,
           lapse_count, review_count, last_reviewed_at, scheduler_id, updated_at)
         VALUES (@flashcardId, @intervalMinutes, @dueAt, @lapseCount,
           @reviewCount, @lastReviewedAt, @schedulerId, @updatedAt)
         ON CONFLICT (flashcard_id) DO UPDATE SET
           interval_minutes = excluded.interval_minutes,
           due_at = excluded.due_at,
           lapse_count = excluded.lapse_count,
           review_count = excluded.review_count,
           last_reviewed_at = excluded.last_reviewed_at,
           scheduler_id = excluded.scheduler_id,
           updated_at = excluded.updated_at`,
      )
      .run({
        flashcardId: id,
        intervalMinutes: schedule.intervalMinutes,
        dueAt: schedule.dueAt,
        lapseCount: schedule.lapseCount,
        reviewCount: schedule.reviewCount,
        lastReviewedAt: schedule.lastReviewedAt,
        schedulerId: schedule.schedulerId,
        updatedAt: occurredAt,
      });
  }

  async recordReview(review: FlashcardReviewRecord): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO flashcard_reviews (${REVIEW_COLUMNS})
         VALUES (@id, @flashcardId, @flashcardRevisionId, @rating, @reviewedAt,
           @intervalMinutes, @dueAt, @schedulerId)`,
      )
      .run({
        id: review.id,
        flashcardId: review.flashcardId,
        flashcardRevisionId: review.flashcardRevisionId,
        rating: review.rating,
        reviewedAt: review.reviewedAt,
        intervalMinutes: review.intervalMinutes,
        dueAt: review.dueAt,
        schedulerId: review.schedulerId,
      });
  }

  async listReviews(
    id: FlashcardId,
    limit: number,
  ): Promise<FlashcardReviewRecord[]> {
    const rows = this.database
      .prepare(
        `SELECT ${REVIEW_COLUMNS} FROM flashcard_reviews
         WHERE flashcard_id = @flashcardId
         ORDER BY reviewed_at DESC, id DESC
         LIMIT @limit`,
      )
      .all({ flashcardId: id, limit }) as FlashcardReviewRow[];

    return rows.map(toReviewRecord);
  }

  async listBySourceQuestion(questionId: QuestionId): Promise<Flashcard[]> {
    const rows = this.database
      .prepare(
        `SELECT ${CARD_COLUMNS} FROM flashcards
         WHERE source_question_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(questionId) as FlashcardRow[];

    return rows.map(toFlashcard);
  }

  private insertRevision(revision: FlashcardRevision): void {
    this.database
      .prepare(
        `INSERT INTO flashcard_revisions (${REVISION_COLUMNS})
         VALUES (@id, @flashcardId, @revisionNumber, @cardType, @contentPayload,
           @searchText, @notes, @tags, @language, @createdAt)`,
      )
      .run({
        id: revision.id,
        flashcardId: revision.flashcardId,
        revisionNumber: revision.revisionNumber,
        cardType: revision.cardType,
        contentPayload: serializeContent(revision.content),
        // Derived here rather than stored on the domain revision: it is a search
        // index, not content, and deriving it on write keeps it in step with the
        // payload it came from.
        searchText: searchableText(revision.content),
        notes: revision.notes,
        tags: serializeTags(revision.tags),
        language: revision.language,
        createdAt: revision.createdAt,
      });
  }

  private pointAtRevision(
    flashcardId: FlashcardId,
    revisionId: string,
    occurredAt: IsoTimestamp,
  ): void {
    const result = this.database
      .prepare(
        `UPDATE flashcards SET current_revision_id = ?, updated_at = ? WHERE id = ?`,
      )
      .run(revisionId, occurredAt, flashcardId);

    if (result.changes === 0) {
      throw new FlashcardNotFoundError(flashcardId);
    }
  }

  private touch(id: FlashcardId, occurredAt: IsoTimestamp): void {
    this.database
      .prepare(`UPDATE flashcards SET updated_at = ? WHERE id = ?`)
      .run(occurredAt, id);
  }
}

function toFlashcardWithRevision(row: JoinedRow): FlashcardWithRevision {
  return {
    flashcard: toFlashcard(unprefix(row, "f_") as unknown as FlashcardRow),
    revision: toFlashcardRevision(
      unprefix(row, "r_") as unknown as FlashcardRevisionRow,
    ),
  };
}

function toDueFlashcard(row: JoinedRow): DueFlashcard {
  const scheduleRow = unprefix(row, "s_");

  return {
    ...toFlashcardWithRevision(row),
    // The left join produced null columns for a card that has never been
    // reviewed, which is the new-card case the strategy expects as `null`.
    schedule:
      scheduleRow.flashcard_id === null
        ? null
        : toReviewSchedule(scheduleRow as unknown as ReviewScheduleRow),
  };
}

/** Splits one joined row back into the table shapes the mappers expect. */
function unprefix(row: JoinedRow, prefix: string): JoinedRow {
  const result: JoinedRow = {};

  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith(prefix)) {
      result[key.slice(prefix.length)] = value;
    }
  }

  return result;
}

/** `table.column AS prefixcolumn` for every column in a list. */
function prefixed(columns: string, alias: string, prefix: string): string[] {
  return columns
    .split(",")
    .map((column) => column.trim())
    .map((column) => `${alias}.${column} AS ${prefix}${column}`);
}

/** Escapes the `LIKE` wildcards so a search for "50%" is a literal search. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
