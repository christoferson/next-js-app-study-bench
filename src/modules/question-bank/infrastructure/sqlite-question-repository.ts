import type { IsoTimestamp } from "@/platform/clock";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import type { ObjectiveId } from "@/modules/certifications/domain/objective";
import { QuestionNotFoundError } from "@/modules/question-bank/domain/errors";
import type {
  Question,
  QuestionId,
  QuestionLifecycleStatus,
  QuestionQualityStatus,
  QuestionRevision,
  QuestionWithRevision,
} from "@/modules/question-bank/domain/question";
import type {
  QuestionBankCounts,
  QuestionRepository,
  QuestionSearchCriteria,
  QuestionSearchPage,
} from "@/modules/question-bank/ports/question-repository";
import type { QuestionRevisionRow, QuestionRow } from "./rows";
import {
  serializeContent,
  serializeTags,
  toQuestion,
  toQuestionRevision,
} from "./rows";

const QUESTION_COLUMNS = `id, certification_id, current_revision_id,
  lifecycle_status, quality_status, generation_mode, dispute_reason, created_at,
  updated_at`;

const REVISION_COLUMNS = `id, question_id, revision_number, stem, instructions,
  question_type, content_payload, explanation, difficulty, tags, language,
  created_at`;

/** Prefixed for the search join, which selects from both tables at once. */
const JOINED_COLUMNS = [
  ...QUESTION_COLUMNS.split(",").map(
    (column) => `q.${column.trim()} AS q_${column.trim()}`,
  ),
  ...REVISION_COLUMNS.split(",").map(
    (column) => `r.${column.trim()} AS r_${column.trim()}`,
  ),
].join(", ");

/** One search row: a question root joined to its current revision. */
type JoinedRow = Record<string, string | number | null>;

/**
 * SQLite-backed question-bank persistence.
 *
 * Revisions are append-only: this class offers `create` and `appendRevision` and
 * no way to rewrite an existing revision row.
 */
export class SqliteQuestionRepository implements QuestionRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async findById(id: QuestionId): Promise<Question | null> {
    const row = this.database
      .prepare(`SELECT ${QUESTION_COLUMNS} FROM questions WHERE id = ?`)
      .get(id) as QuestionRow | undefined;

    return row === undefined ? null : toQuestion(row);
  }

  async findWithCurrentRevision(
    id: QuestionId,
  ): Promise<QuestionWithRevision | null> {
    const question = await this.findById(id);

    if (question === null) {
      return null;
    }

    const row = this.database
      .prepare(
        `SELECT ${REVISION_COLUMNS} FROM question_revisions WHERE id = ?`,
      )
      .get(question.currentRevisionId) as QuestionRevisionRow | undefined;

    if (row === undefined) {
      throw new Error(
        `Question ${id} points at missing revision ${question.currentRevisionId}.`,
      );
    }

    return { question, revision: toQuestionRevision(row) };
  }

  async listRevisions(id: QuestionId): Promise<QuestionRevision[]> {
    const rows = this.database
      .prepare(
        `SELECT ${REVISION_COLUMNS} FROM question_revisions
         WHERE question_id = ?
         ORDER BY revision_number ASC`,
      )
      .all(id) as QuestionRevisionRow[];

    return rows.map(toQuestionRevision);
  }

  async findRevision(
    id: QuestionId,
    revisionNumber: number,
  ): Promise<QuestionRevision | null> {
    const row = this.database
      .prepare(
        `SELECT ${REVISION_COLUMNS} FROM question_revisions
         WHERE question_id = ? AND revision_number = ?`,
      )
      .get(id, revisionNumber) as QuestionRevisionRow | undefined;

    return row === undefined ? null : toQuestionRevision(row);
  }

  /**
   * Bounded bank query.
   *
   * The stem filter is a `LIKE` against the current revision only, so editing a
   * question changes what it matches. No full-text index is introduced: the
   * personal bank is small, and FTS5 would be an unused dependency on the
   * table's write path.
   */
  async search(criteria: QuestionSearchCriteria): Promise<QuestionSearchPage> {
    const conditions: string[] = ["q.certification_id = @certificationId"];
    const parameters: Record<string, string | number> = {
      certificationId: criteria.certificationId,
      limit: criteria.limit,
      offset: criteria.offset,
    };

    if (criteria.lifecycleStatus !== undefined) {
      conditions.push("q.lifecycle_status = @lifecycleStatus");
      parameters.lifecycleStatus = criteria.lifecycleStatus;
    }

    if (criteria.qualityStatus !== undefined) {
      conditions.push("q.quality_status = @qualityStatus");
      parameters.qualityStatus = criteria.qualityStatus;
    }

    if (criteria.questionType !== undefined) {
      conditions.push("r.question_type = @questionType");
      parameters.questionType = criteria.questionType;
    }

    if (criteria.objectiveId !== undefined) {
      conditions.push(
        `EXISTS (SELECT 1 FROM question_objective_links l
                 WHERE l.question_id = q.id AND l.objective_id = @objectiveId)`,
      );
      parameters.objectiveId = criteria.objectiveId;
    }

    if (criteria.stemContains !== undefined) {
      // `LIKE` is case-insensitive for ASCII in SQLite; ESCAPE makes a literal
      // `%` or `_` in the owner's search text match itself rather than act as a
      // wildcard.
      conditions.push(`r.stem LIKE @stemPattern ESCAPE '\\'`);
      parameters.stemPattern = `%${escapeLike(criteria.stemContains)}%`;
    }

    const where = conditions.join(" AND ");
    const from = `FROM questions q
      JOIN question_revisions r ON r.id = q.current_revision_id
      WHERE ${where}`;

    const totalRow = this.database
      .prepare(`SELECT COUNT(*) AS total ${from}`)
      .get(parameters) as { readonly total: number } | undefined;

    const rows = this.database
      .prepare(
        `SELECT ${JOINED_COLUMNS} ${from}
         ORDER BY q.updated_at DESC, q.id ASC
         LIMIT @limit OFFSET @offset`,
      )
      .all(parameters) as JoinedRow[];

    return {
      items: rows.map(toQuestionWithRevision),
      totalCount: totalRow?.total ?? 0,
      limit: criteria.limit,
      offset: criteria.offset,
    };
  }

  async countsByCertification(
    certificationId: CertificationId,
  ): Promise<QuestionBankCounts> {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN lifecycle_status = 'ACTIVE' THEN 1 ELSE 0 END) AS active
         FROM questions WHERE certification_id = ?`,
      )
      .get(certificationId) as
      { readonly total: number; readonly active: number | null } | undefined;

    return { total: row?.total ?? 0, active: row?.active ?? 0 };
  }

  /**
   * Inserts the root, then its first revision, then the current pointer.
   *
   * The pointer is a third statement because the two tables reference each
   * other; the caller's transaction makes the intermediate state unobservable.
   */
  async create(question: Question, revision: QuestionRevision): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO questions (id, certification_id, current_revision_id,
           lifecycle_status, quality_status, generation_mode, dispute_reason,
           created_at, updated_at)
         VALUES (@id, @certificationId, NULL, @lifecycleStatus, @qualityStatus,
           @generationMode, @disputeReason, @createdAt, @updatedAt)`,
      )
      .run({
        id: question.id,
        certificationId: question.certificationId,
        lifecycleStatus: question.lifecycleStatus,
        qualityStatus: question.qualityStatus,
        generationMode: question.generationMode,
        disputeReason: question.disputeReason,
        createdAt: question.createdAt,
        updatedAt: question.updatedAt,
      });

    this.insertRevision(revision);
    this.pointAtRevision(question.id, revision.id, question.updatedAt);
  }

  async appendRevision(
    revision: QuestionRevision,
    occurredAt: IsoTimestamp,
  ): Promise<void> {
    this.insertRevision(revision);
    this.pointAtRevision(revision.questionId, revision.id, occurredAt);
  }

  async setLifecycleStatus(
    id: QuestionId,
    status: QuestionLifecycleStatus,
    occurredAt: IsoTimestamp,
  ): Promise<void> {
    const result = this.database
      .prepare(
        `UPDATE questions SET lifecycle_status = ?, updated_at = ? WHERE id = ?`,
      )
      .run(status, occurredAt, id);

    if (result.changes === 0) {
      throw new QuestionNotFoundError(id);
    }
  }

  async setQualityStatus(
    id: QuestionId,
    status: QuestionQualityStatus,
    disputeReason: string | null,
    occurredAt: IsoTimestamp,
  ): Promise<void> {
    const result = this.database
      .prepare(
        `UPDATE questions
         SET quality_status = ?, dispute_reason = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(status, disputeReason, occurredAt, id);

    if (result.changes === 0) {
      throw new QuestionNotFoundError(id);
    }
  }

  /**
   * Removes a question completely.
   *
   * The current-revision pointer is cleared first: it is `ON DELETE RESTRICT`,
   * so the revision rows cannot go while the root still points at one. Revisions
   * and links then cascade from the root, and the explicit deletes keep the
   * intent readable rather than relying on cascade order.
   */
  async delete(id: QuestionId): Promise<void> {
    const cleared = this.database
      .prepare(`UPDATE questions SET current_revision_id = NULL WHERE id = ?`)
      .run(id);

    if (cleared.changes === 0) {
      throw new QuestionNotFoundError(id);
    }

    this.database
      .prepare(`DELETE FROM question_objective_links WHERE question_id = ?`)
      .run(id);
    this.database
      .prepare(`DELETE FROM question_revisions WHERE question_id = ?`)
      .run(id);
    this.database.prepare(`DELETE FROM questions WHERE id = ?`).run(id);
  }

  async listObjectiveLinks(id: QuestionId): Promise<ObjectiveId[]> {
    const rows = this.database
      .prepare(
        `SELECT l.objective_id AS objective_id
         FROM question_objective_links l
         JOIN certification_objectives o ON o.id = l.objective_id
         WHERE l.question_id = ?
         ORDER BY o.display_order ASC, o.id ASC`,
      )
      .all(id) as { readonly objective_id: string }[];

    return rows.map((row) => row.objective_id);
  }

  async replaceObjectiveLinks(
    id: QuestionId,
    objectiveIds: readonly ObjectiveId[],
    occurredAt: IsoTimestamp,
  ): Promise<void> {
    const exists = this.database
      .prepare(`SELECT 1 AS present FROM questions WHERE id = ?`)
      .get(id);

    if (exists === undefined) {
      throw new QuestionNotFoundError(id);
    }

    this.database
      .prepare(`DELETE FROM question_objective_links WHERE question_id = ?`)
      .run(id);

    const insert = this.database.prepare(
      `INSERT INTO question_objective_links (question_id, objective_id, created_at)
       VALUES (?, ?, ?)`,
    );

    for (const objectiveId of new Set(objectiveIds)) {
      insert.run(id, objectiveId, occurredAt);
    }

    this.touch(id, occurredAt);
  }

  private insertRevision(revision: QuestionRevision): void {
    this.database
      .prepare(
        `INSERT INTO question_revisions (${REVISION_COLUMNS})
         VALUES (@id, @questionId, @revisionNumber, @stem, @instructions,
           @questionType, @contentPayload, @explanation, @difficulty, @tags,
           @language, @createdAt)`,
      )
      .run({
        id: revision.id,
        questionId: revision.questionId,
        revisionNumber: revision.revisionNumber,
        stem: revision.stem,
        instructions: revision.instructions,
        questionType: revision.questionType,
        contentPayload: serializeContent(revision.content),
        explanation: revision.explanation,
        difficulty: revision.difficulty,
        tags: serializeTags(revision.tags),
        language: revision.language,
        createdAt: revision.createdAt,
      });
  }

  private pointAtRevision(
    questionId: QuestionId,
    revisionId: string,
    occurredAt: IsoTimestamp,
  ): void {
    const result = this.database
      .prepare(
        `UPDATE questions SET current_revision_id = ?, updated_at = ? WHERE id = ?`,
      )
      .run(revisionId, occurredAt, questionId);

    if (result.changes === 0) {
      throw new QuestionNotFoundError(questionId);
    }
  }

  private touch(id: QuestionId, occurredAt: IsoTimestamp): void {
    this.database
      .prepare(`UPDATE questions SET updated_at = ? WHERE id = ?`)
      .run(occurredAt, id);
  }
}

function toQuestionWithRevision(row: JoinedRow): QuestionWithRevision {
  return {
    question: toQuestion(unprefix(row, "q_") as unknown as QuestionRow),
    revision: toQuestionRevision(
      unprefix(row, "r_") as unknown as QuestionRevisionRow,
    ),
  };
}

/** Splits one joined row back into the two table shapes the mappers expect. */
function unprefix(row: JoinedRow, prefix: string): JoinedRow {
  const result: JoinedRow = {};

  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith(prefix)) {
      result[key.slice(prefix.length)] = value;
    }
  }

  return result;
}

/** Escapes the `LIKE` wildcards so a search for "50%" is a literal search. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
