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
  QuestionCandidate,
  QuestionRepository,
  QuestionSearchCriteria,
  QuestionSearchPage,
  StudyCandidateCriteria,
} from "@/modules/question-bank/ports/question-repository";
import type { QuestionRevisionRow, QuestionRow } from "./rows";
import {
  serializeContent,
  serializeTags,
  toQuestion,
  toQuestionRevision,
  toQuestionType,
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

/** One candidate row: the few columns session composition needs. */
interface CandidateRow {
  readonly question_id: string;
  readonly revision_id: string;
  readonly certification_id: string;
  readonly question_type: string;
  readonly difficulty: number | null;
  readonly created_at: string;
}

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
   * Bounded candidate query for session composition.
   *
   * Eligibility is a `WHERE` clause rather than a filter the caller applies, so a
   * draft, retired, archived, or disputed question is never fetched: it mirrors
   * `isStudyEligible` in SQL, and the two are asserted to agree in the repository
   * contract.
   *
   * Objective mappings are fetched in a second statement keyed by the questions
   * just returned, rather than by joining them into the first. A join would
   * multiply each question by its mapping count and break `LIMIT`, which must
   * bound questions rather than rows.
   *
   * Ordering is by creation time then identifier, so the same database state
   * always yields the same candidate list and the composer's own ordering is the
   * only thing that decides session order.
   */
  async findStudyCandidates(
    criteria: StudyCandidateCriteria,
  ): Promise<QuestionCandidate[]> {
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
        `SELECT q.id AS question_id, r.id AS revision_id,
                q.certification_id AS certification_id,
                r.question_type AS question_type, r.difficulty AS difficulty,
                q.created_at AS created_at
         FROM questions q
         JOIN question_revisions r ON r.id = q.current_revision_id
         WHERE q.certification_id IN (${placeholders})
           AND q.lifecycle_status = 'ACTIVE'
           AND q.quality_status <> 'DISPUTED'
         ORDER BY q.created_at ASC, q.id ASC
         LIMIT @limit`,
      )
      .all(parameters) as CandidateRow[];

    const links = this.objectiveLinksFor(rows.map((row) => row.question_id));

    return rows.map((row) => ({
      questionId: row.question_id,
      questionRevisionId: row.revision_id,
      certificationId: row.certification_id,
      objectiveIds: links.get(row.question_id) ?? [],
      questionType: toQuestionType(row.question_type),
      difficulty: row.difficulty,
      createdAt: row.created_at,
    }));
  }

  async countStudyCandidates(
    certificationId: CertificationId,
  ): Promise<number> {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS total FROM questions
         WHERE certification_id = ?
           AND lifecycle_status = 'ACTIVE'
           AND quality_status <> 'DISPUTED'`,
      )
      .get(certificationId) as { readonly total: number } | undefined;

    return row?.total ?? 0;
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

  /**
   * Objective mappings for a known set of questions, as one statement.
   *
   * Bounded by construction: the identifiers come from a page of candidates that
   * was already limited, so there is no unbounded read hiding behind the `IN`.
   */
  private objectiveLinksFor(
    questionIds: readonly QuestionId[],
  ): Map<QuestionId, ObjectiveId[]> {
    const links = new Map<QuestionId, ObjectiveId[]>();

    if (questionIds.length === 0) {
      return links;
    }

    const placeholders = questionIds.map(() => "?").join(", ");
    const rows = this.database
      .prepare(
        `SELECT l.question_id AS question_id, l.objective_id AS objective_id
         FROM question_objective_links l
         JOIN certification_objectives o ON o.id = l.objective_id
         WHERE l.question_id IN (${placeholders})
         ORDER BY o.display_order ASC, o.id ASC`,
      )
      .all(...questionIds) as {
      readonly question_id: string;
      readonly objective_id: string;
    }[];

    for (const row of rows) {
      const existing = links.get(row.question_id);

      if (existing === undefined) {
        links.set(row.question_id, [row.objective_id]);
      } else {
        existing.push(row.objective_id);
      }
    }

    return links;
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
