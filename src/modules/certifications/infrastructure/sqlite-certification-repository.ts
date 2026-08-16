import type { IsoTimestamp } from "@/platform/clock";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import type {
  Certification,
  CertificationId,
  CertificationSlug,
} from "@/modules/certifications/domain/certification";
import { CertificationNotFoundError } from "@/modules/certifications/domain/errors";
import type { CertificationRepository } from "@/modules/certifications/ports/certification-repository";
import type { CertificationRow } from "./rows";
import { toCertification } from "./rows";

const COLUMNS = `id, slug, name, provider, exam_code, version, study_type,
  description, target_date, priority, default_session_minutes, status, origin,
  persona_id, created_at, updated_at`;

/** SQLite-backed certification persistence. */
export class SqliteCertificationRepository implements CertificationRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async listActive(): Promise<Certification[]> {
    return this.listByStatus("ACTIVE");
  }

  async listArchived(): Promise<Certification[]> {
    return this.listByStatus("ARCHIVED");
  }

  async findById(id: CertificationId): Promise<Certification | null> {
    const row = this.database
      .prepare(`SELECT ${COLUMNS} FROM certifications WHERE id = ?`)
      .get(id) as CertificationRow | undefined;

    return row === undefined ? null : toCertification(row);
  }

  async findBySlug(slug: CertificationSlug): Promise<Certification | null> {
    const row = this.database
      .prepare(`SELECT ${COLUMNS} FROM certifications WHERE slug = ?`)
      .get(slug) as CertificationRow | undefined;

    return row === undefined ? null : toCertification(row);
  }

  async isSlugTaken(slug: CertificationSlug): Promise<boolean> {
    const row = this.database
      .prepare(`SELECT 1 AS present FROM certifications WHERE slug = ?`)
      .get(slug);

    return row !== undefined;
  }

  async listByPersonaId(personaId: string): Promise<Certification[]> {
    const rows = this.database
      .prepare(
        `SELECT ${COLUMNS} FROM certifications
         WHERE persona_id = ?
         ORDER BY name COLLATE NOCASE ASC, id ASC`,
      )
      .all(personaId) as CertificationRow[];

    return rows.map(toCertification);
  }

  async save(certification: Certification): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO certifications (${COLUMNS})
         VALUES (@id, @slug, @name, @provider, @examCode, @version, @studyType,
                 @description, @targetDate, @priority, @defaultSessionMinutes,
                 @status, @origin, @personaId, @createdAt, @updatedAt)
         ON CONFLICT (id) DO UPDATE SET
           slug = excluded.slug,
           name = excluded.name,
           provider = excluded.provider,
           exam_code = excluded.exam_code,
           version = excluded.version,
           study_type = excluded.study_type,
           description = excluded.description,
           target_date = excluded.target_date,
           priority = excluded.priority,
           default_session_minutes = excluded.default_session_minutes,
           status = excluded.status,
           origin = excluded.origin,
           persona_id = excluded.persona_id,
           updated_at = excluded.updated_at`,
      )
      .run({
        id: certification.id,
        slug: certification.slug,
        name: certification.name,
        provider: certification.provider,
        examCode: certification.examCode,
        version: certification.version,
        studyType: certification.studyType,
        description: certification.description,
        targetDate: certification.targetDate,
        priority: certification.priority,
        defaultSessionMinutes: certification.defaultSessionMinutes,
        status: certification.status,
        origin: certification.origin,
        personaId: certification.personaId,
        createdAt: certification.createdAt,
        updatedAt: certification.updatedAt,
      });
  }

  async archive(id: CertificationId, occurredAt: IsoTimestamp): Promise<void> {
    this.setStatus(id, "ARCHIVED", occurredAt);
  }

  async restore(id: CertificationId, occurredAt: IsoTimestamp): Promise<void> {
    this.setStatus(id, "ACTIVE", occurredAt);
  }

  /**
   * Everything the track ever touched, removed in RESTRICT-safe order.
   *
   * Sessions that *included* the track go entirely — a session is one study
   * event, and half a study event referencing deleted revisions would violate
   * historical integrity worse than removing the record outright. That is the
   * owner's explicit instruction: purged "as if they never existed."
   *
   * Order: attempts and session items cannot outlive their session (CASCADE),
   * but sessions must go before questions and cards because items RESTRICT on
   * both. Reviews and schedules RESTRICT on revisions, so they go before cards.
   * Current-revision pointers are cleared before revisions (RESTRICT), mirroring
   * the question repository's delete. Audio assets are keyed by spoken text, not
   * by entity, and are managed on /settings/audio — they are not touched here.
   */
  async purge(id: CertificationId): Promise<void> {
    const run = (sql: string): void => {
      this.database.prepare(sql).run({ id });
    };

    run(
      `DELETE FROM study_sessions WHERE id IN
         (SELECT session_id FROM session_certifications WHERE certification_id = :id)`,
    );
    run(
      `DELETE FROM flashcard_reviews WHERE flashcard_id IN
         (SELECT id FROM flashcards WHERE certification_id = :id)`,
    );
    run(
      `DELETE FROM review_schedules WHERE flashcard_id IN
         (SELECT id FROM flashcards WHERE certification_id = :id)`,
    );
    run(
      `UPDATE flashcards SET current_revision_id = NULL WHERE certification_id = :id`,
    );
    run(
      `DELETE FROM flashcard_revisions WHERE flashcard_id IN
         (SELECT id FROM flashcards WHERE certification_id = :id)`,
    );
    run(`DELETE FROM flashcards WHERE certification_id = :id`);
    run(
      `UPDATE questions SET current_revision_id = NULL WHERE certification_id = :id`,
    );
    run(
      `DELETE FROM question_revisions WHERE question_id IN
         (SELECT id FROM questions WHERE certification_id = :id)`,
    );
    // Source-evidence links before the questions they belong to. They CASCADE from the
    // question, so this is not what makes them go; it is here because they RESTRICT on the
    // chunk side and the purge should say what it removes rather than depending on which
    // side of a link the cascade fires from. The sources themselves cascade from the track.
    run(
      `DELETE FROM question_source_links WHERE question_id IN
         (SELECT id FROM questions WHERE certification_id = :id)`,
    );
    run(`DELETE FROM questions WHERE certification_id = :id`);
    run(`DELETE FROM generation_runs WHERE certification_id = :id`);
    // Children before parents: the self-referencing FK is RESTRICT. Deepest
    // trees first via recursive depth ordering is overkill for SQLite — repeated
    // leaf deletion is simpler and bounded by tree depth.
    let deleted = 1;

    while (deleted > 0) {
      deleted = this.database
        .prepare(
          `DELETE FROM certification_objectives
           WHERE certification_id = :id
             AND id NOT IN (
               SELECT parent_objective_id FROM certification_objectives
               WHERE certification_id = :id AND parent_objective_id IS NOT NULL
             )`,
        )
        .run({ id }).changes;
    }

    const result = this.database
      .prepare(`DELETE FROM certifications WHERE id = ?`)
      .run(id);

    if (result.changes === 0) {
      throw new CertificationNotFoundError(id);
    }
  }

  private listByStatus(status: "ACTIVE" | "ARCHIVED"): Certification[] {
    const rows = this.database
      .prepare(
        `SELECT ${COLUMNS} FROM certifications
         WHERE status = ?
         ORDER BY priority ASC, name COLLATE NOCASE ASC, id ASC`,
      )
      .all(status) as CertificationRow[];

    return rows.map(toCertification);
  }

  private setStatus(
    id: CertificationId,
    status: "ACTIVE" | "ARCHIVED",
    occurredAt: IsoTimestamp,
  ): void {
    const result = this.database
      .prepare(
        `UPDATE certifications SET status = ?, updated_at = ? WHERE id = ?`,
      )
      .run(status, occurredAt, id);

    if (result.changes === 0) {
      throw new CertificationNotFoundError(id);
    }
  }
}
