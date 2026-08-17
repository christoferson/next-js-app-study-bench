import type { IsoTimestamp } from "@/platform/clock";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import { ObjectiveNotFoundError } from "@/modules/certifications/domain/errors";
import type {
  Objective,
  ObjectiveId,
} from "@/modules/certifications/domain/objective";
import type {
  ObjectivePosition,
  ObjectiveRepository,
} from "@/modules/certifications/ports/objective-repository";
import type { ObjectiveRow } from "./rows";
import { toObjective } from "./rows";

const COLUMNS = `id, certification_id, parent_objective_id, code, title,
  description, weight, source_type, display_order, status, created_at,
  updated_at`;

/** SQLite-backed objective persistence. */
export class SqliteObjectiveRepository implements ObjectiveRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async listByCertification(
    certificationId: CertificationId,
  ): Promise<Objective[]> {
    const rows = this.database
      .prepare(
        `SELECT ${COLUMNS} FROM certification_objectives
         WHERE certification_id = ?
         ORDER BY display_order ASC, id ASC`,
      )
      .all(certificationId) as ObjectiveRow[];

    return rows.map(toObjective);
  }

  async findById(id: ObjectiveId): Promise<Objective | null> {
    const row = this.database
      .prepare(`SELECT ${COLUMNS} FROM certification_objectives WHERE id = ?`)
      .get(id) as ObjectiveRow | undefined;

    return row === undefined ? null : toObjective(row);
  }

  async save(objective: Objective): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO certification_objectives (${COLUMNS})
         VALUES (@id, @certificationId, @parentObjectiveId, @code, @title,
                 @description, @weight, @sourceType, @displayOrder, @status,
                 @createdAt, @updatedAt)
         ON CONFLICT (id) DO UPDATE SET
           parent_objective_id = excluded.parent_objective_id,
           code = excluded.code,
           title = excluded.title,
           description = excluded.description,
           weight = excluded.weight,
           source_type = excluded.source_type,
           display_order = excluded.display_order,
           status = excluded.status,
           updated_at = excluded.updated_at`,
      )
      .run({
        id: objective.id,
        certificationId: objective.certificationId,
        parentObjectiveId: objective.parentObjectiveId,
        code: objective.code,
        title: objective.title,
        description: objective.description,
        weight: objective.weight,
        sourceType: objective.sourceType,
        displayOrder: objective.displayOrder,
        status: objective.status,
        createdAt: objective.createdAt,
        updatedAt: objective.updatedAt,
      });
  }

  async applyPositions(
    positions: readonly ObjectivePosition[],
    occurredAt: IsoTimestamp,
  ): Promise<void> {
    const statement = this.database.prepare(
      `UPDATE certification_objectives
       SET display_order = ?, updated_at = ?
       WHERE id = ?`,
    );

    for (const position of positions) {
      const result = statement.run(
        position.displayOrder,
        occurredAt,
        position.id,
      );

      if (result.changes === 0) {
        throw new ObjectiveNotFoundError(position.id);
      }
    }
  }

  async archive(id: ObjectiveId, occurredAt: IsoTimestamp): Promise<void> {
    this.setStatus(id, "ARCHIVED", occurredAt);
  }

  async restore(id: ObjectiveId, occurredAt: IsoTimestamp): Promise<void> {
    this.setStatus(id, "ACTIVE", occurredAt);
  }

  async archiveAllByCertification(
    certificationId: CertificationId,
    occurredAt: IsoTimestamp,
  ): Promise<number> {
    return this.setStatusOfAll(
      certificationId,
      "ARCHIVED",
      "ACTIVE",
      occurredAt,
    );
  }

  async restoreAllByCertification(
    certificationId: CertificationId,
    occurredAt: IsoTimestamp,
  ): Promise<number> {
    return this.setStatusOfAll(
      certificationId,
      "ACTIVE",
      "ARCHIVED",
      occurredAt,
    );
  }

  /**
   * Every objective of one track, gone, with its mappings.
   *
   * The three link tables first. They CASCADE from the objective, so this is not
   * what makes them go; it is here for the same reason the certification purge
   * spells out `question_source_links` — the removal should say what it takes,
   * rather than reading correctly only if you know which side of each link the
   * cascade fires from. Deleting a link row never touches the question,
   * flashcard, or source on the other side.
   *
   * Then the objectives themselves, children before parents, because
   * `parent_objective_id` is RESTRICT. Repeated leaf deletion rather than a
   * recursive depth ordering, matching `SqliteCertificationRepository.purge`:
   * the loop is bounded by tree depth and needs no CTE.
   */
  async purgeAllByCertification(
    certificationId: CertificationId,
  ): Promise<number> {
    const objectiveIds = `SELECT id FROM certification_objectives WHERE certification_id = :id`;

    for (const table of [
      "question_objective_links",
      "flashcard_objective_links",
      "source_objective_links",
    ]) {
      this.database
        .prepare(`DELETE FROM ${table} WHERE objective_id IN (${objectiveIds})`)
        .run({ id: certificationId });
    }

    const leaves = this.database.prepare(
      `DELETE FROM certification_objectives
       WHERE certification_id = :id
         AND id NOT IN (
           SELECT parent_objective_id FROM certification_objectives
           WHERE certification_id = :id AND parent_objective_id IS NOT NULL
         )`,
    );
    let purged = 0;
    let deleted = 1;

    while (deleted > 0) {
      deleted = leaves.run({ id: certificationId }).changes;
      purged += deleted;
    }

    return purged;
  }

  /**
   * Moves every objective of one track from `from` to `to`.
   *
   * Filtered on the current status so an already-archived objective keeps its
   * original `updated_at`: the timestamp records when the objective changed, and
   * a bulk action that touched nothing should not restamp it.
   */
  private setStatusOfAll(
    certificationId: CertificationId,
    to: "ACTIVE" | "ARCHIVED",
    from: "ACTIVE" | "ARCHIVED",
    occurredAt: IsoTimestamp,
  ): number {
    return this.database
      .prepare(
        `UPDATE certification_objectives
         SET status = ?, updated_at = ?
         WHERE certification_id = ? AND status = ?`,
      )
      .run(to, occurredAt, certificationId, from).changes;
  }

  private setStatus(
    id: ObjectiveId,
    status: "ACTIVE" | "ARCHIVED",
    occurredAt: IsoTimestamp,
  ): void {
    const result = this.database
      .prepare(
        `UPDATE certification_objectives
         SET status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(status, occurredAt, id);

    if (result.changes === 0) {
      throw new ObjectiveNotFoundError(id);
    }
  }
}
