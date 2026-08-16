import type { IsoTimestamp } from "@/platform/clock";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import type { ObjectiveId } from "@/modules/certifications/domain/objective";
import type { GroundingCandidate } from "@/modules/ai-generation/domain/source-grounding";
import type {
  GroundingSourceSummary,
  QuestionEvidence,
  SourceGroundingRepository,
} from "@/modules/ai-generation/ports/source-grounding-repository";

/**
 * SQLite persistence for question evidence, and the query that finds grounding candidates.
 *
 * Three properties worth stating, because each is load-bearing:
 *
 * - **The newest snapshot per source is chosen in SQL, not in the caller.** A correlated
 *   `MAX(retrieved_at)` subquery, so the ranking never sees a chunk of superseded text and
 *   the "grounded on current content" rule is not something a caller can forget. Ties on
 *   `retrieved_at` are broken by id so the choice is deterministic — two snapshots written
 *   in the same millisecond is possible on a fast machine, and a query that picked either
 *   would make a selection irreproducible.
 * - **"Superseded" is computed, never stored.** Both staleness queries ask the same
 *   question — does this chunk's source have a snapshot newer than the chunk's own? — and
 *   there is no column anywhere holding the answer. Migration 0015 says why.
 * - **Identifiers are bound, never interpolated.** The source-id list is variable-length,
 *   so the placeholders are generated and the values bound; the only text this class
 *   interpolates into SQL is `?`.
 */
export class SqliteSourceGroundingRepository implements SourceGroundingRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async listGroundingCandidates(input: {
    readonly certificationId: CertificationId;
    readonly sourceIds: readonly string[];
    readonly objectiveIds: readonly ObjectiveId[];
  }): Promise<readonly GroundingCandidate[]> {
    if (input.sourceIds.length === 0) {
      return [];
    }

    const sourcePlaceholders = input.sourceIds.map(() => "?").join(", ");
    // An empty objective list must match nothing rather than everything, and
    // `objective_id IN ()` is a syntax error in SQLite. `NULL` is never equal to anything,
    // so a single NULL placeholder is the empty set expressed in valid SQL.
    const objectivePlaceholders =
      input.objectiveIds.length === 0
        ? "NULL"
        : input.objectiveIds.map(() => "?").join(", ");
    const rows = this.database
      .prepare(
        `SELECT c.id AS chunk_id,
                c.snapshot_id AS snapshot_id,
                c.chunk_index AS chunk_index,
                c.text AS text,
                s.id AS source_id,
                s.title AS source_title,
                EXISTS (
                  SELECT 1 FROM source_objective_links l
                    WHERE l.source_id = s.id
                      AND l.objective_id IN (${objectivePlaceholders})
                ) AS objective_linked
           FROM source_chunks c
           JOIN source_snapshots snap ON snap.id = c.snapshot_id
           JOIN sources s ON s.id = snap.source_id
          WHERE s.certification_id = ?
            AND s.status = 'ACTIVE'
            AND s.id IN (${sourcePlaceholders})
            AND snap.id = (
              SELECT inner_snap.id FROM source_snapshots inner_snap
                WHERE inner_snap.source_id = s.id
                ORDER BY inner_snap.retrieved_at DESC, inner_snap.id DESC
                LIMIT 1
            )
          ORDER BY s.created_at ASC, s.id ASC, c.chunk_index ASC`,
      )
      .all(
        ...input.objectiveIds,
        input.certificationId,
        ...input.sourceIds,
      ) as readonly CandidateRow[];

    return rows.map((row) => ({
      chunkId: row.chunk_id,
      snapshotId: row.snapshot_id,
      sourceId: row.source_id,
      sourceTitle: row.source_title,
      chunkIndex: row.chunk_index,
      text: row.text,
      // SQLite has no boolean type: EXISTS returns 0 or 1.
      objectiveLinked: row.objective_linked === 1,
    }));
  }

  async listCheckableSourceIds(
    certificationId: CertificationId,
  ): Promise<readonly string[]> {
    const rows = this.database
      .prepare(
        `SELECT id FROM sources
          WHERE certification_id = ?
            AND status = 'ACTIVE'
          ORDER BY created_at ASC, id ASC`,
      )
      .all(certificationId) as readonly { readonly id: string }[];

    return rows.map((row) => row.id);
  }

  async listGroundableSources(
    certificationId: CertificationId,
  ): Promise<readonly GroundingSourceSummary[]> {
    const rows = this.database
      .prepare(
        `SELECT id, title, source_type FROM sources
          WHERE certification_id = ?
            AND status = 'ACTIVE'
          ORDER BY title COLLATE NOCASE ASC, id ASC`,
      )
      .all(certificationId) as readonly {
      readonly id: string;
      readonly title: string;
      readonly source_type: string;
    }[];

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      sourceType: row.source_type,
    }));
  }

  async createLinks(input: {
    readonly questionId: string;
    readonly chunkIds: readonly string[];
    readonly occurredAt: IsoTimestamp;
  }): Promise<void> {
    // OR IGNORE on the primary key: a model that names the same excerpt twice supports the
    // question once, and the caller has already deduplicated, so this is belt and braces
    // rather than the mechanism.
    const statement = this.database.prepare(
      `INSERT OR IGNORE INTO question_source_links
         (question_id, source_chunk_id, created_at)
       VALUES (?, ?, ?)`,
    );

    for (const chunkId of input.chunkIds) {
      statement.run(input.questionId, chunkId, input.occurredAt);
    }
  }

  async listEvidence(questionId: string): Promise<readonly QuestionEvidence[]> {
    const rows = this.database
      .prepare(
        `SELECT c.id AS chunk_id,
                c.chunk_index AS chunk_index,
                c.text AS text,
                snap.id AS snapshot_id,
                snap.retrieved_at AS retrieved_at,
                s.id AS source_id,
                s.title AS source_title,
                EXISTS (
                  SELECT 1 FROM source_snapshots newer
                    WHERE newer.source_id = s.id
                      AND newer.retrieved_at > snap.retrieved_at
                ) AS superseded
           FROM question_source_links link
           JOIN source_chunks c ON c.id = link.source_chunk_id
           JOIN source_snapshots snap ON snap.id = c.snapshot_id
           JOIN sources s ON s.id = snap.source_id
          WHERE link.question_id = ?
          ORDER BY s.title COLLATE NOCASE ASC, s.id ASC, c.chunk_index ASC`,
      )
      .all(questionId) as readonly EvidenceRow[];

    return rows.map((row) => ({
      chunkId: row.chunk_id,
      sourceId: row.source_id,
      sourceTitle: row.source_title,
      snapshotId: row.snapshot_id,
      retrievedAt: row.retrieved_at,
      chunkIndex: row.chunk_index,
      text: row.text,
      supersededByNewerSnapshot: row.superseded === 1,
    }));
  }

  async deleteLinksForQuestion(questionId: string): Promise<void> {
    this.database
      .prepare(`DELETE FROM question_source_links WHERE question_id = ?`)
      .run(questionId);
  }

  async countQuestionsOnSupersededSnapshots(sourceId: string): Promise<number> {
    const row = this.database
      .prepare(
        `SELECT COUNT(DISTINCT link.question_id) AS total
           FROM question_source_links link
           JOIN source_chunks c ON c.id = link.source_chunk_id
           JOIN source_snapshots snap ON snap.id = c.snapshot_id
          WHERE snap.source_id = ?
            AND EXISTS (
              SELECT 1 FROM source_snapshots newer
                WHERE newer.source_id = snap.source_id
                  AND newer.retrieved_at > snap.retrieved_at
            )`,
      )
      .get(sourceId) as { readonly total: number };

    return row.total;
  }
}

interface CandidateRow {
  readonly chunk_id: string;
  readonly snapshot_id: string;
  readonly chunk_index: number;
  readonly text: string;
  readonly source_id: string;
  readonly source_title: string;
  readonly objective_linked: number;
}

interface EvidenceRow {
  readonly chunk_id: string;
  readonly chunk_index: number;
  readonly text: string;
  readonly snapshot_id: string;
  readonly retrieved_at: IsoTimestamp;
  readonly source_id: string;
  readonly source_title: string;
  readonly superseded: number;
}
