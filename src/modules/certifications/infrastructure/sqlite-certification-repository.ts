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
  created_at, updated_at`;

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

  async save(certification: Certification): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO certifications (${COLUMNS})
         VALUES (@id, @slug, @name, @provider, @examCode, @version, @studyType,
                 @description, @targetDate, @priority, @defaultSessionMinutes,
                 @status, @origin, @createdAt, @updatedAt)
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
