import type { IsoTimestamp } from "@/platform/clock";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import type { ObjectiveId } from "@/modules/certifications/domain/objective";
import type {
  Source,
  SourceChunk,
  SourceId,
  SourceSnapshot,
  SourceSnapshotId,
} from "@/modules/sources/domain/source";
import type { SourceRepository } from "@/modules/sources/ports/source-repository";
import type {
  SourceChunkRow,
  SourceRow,
  SourceSnapshotRow,
} from "./rows";
import { toSource, toSourceChunk, toSourceSnapshot } from "./rows";

const SOURCE_COLUMNS = `id, certification_id, title, source_type, authority,
  original_location, status, created_at, updated_at`;

const SNAPSHOT_COLUMNS = `id, source_id, content_hash, object_key, byte_size,
  char_count, retrieved_at`;

const CHUNK_COLUMNS = `id, snapshot_id, chunk_index, text, char_start, char_end`;

/**
 * SQLite-backed persistence for the source library.
 *
 * Snapshots and chunks are insert-and-read only, mirroring the port: there is no
 * `UPDATE source_snapshots` or `UPDATE source_chunks` statement anywhere in this class,
 * so the append-only rule of `SPEC.md` section 10.2 is enforced by the absence of SQL
 * rather than by a convention.
 */
export class SqliteSourceRepository implements SourceRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async listByCertification(
    certificationId: CertificationId,
  ): Promise<Source[]> {
    const rows = this.database
      .prepare(
        `SELECT ${SOURCE_COLUMNS} FROM sources
         WHERE certification_id = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(certificationId) as SourceRow[];

    return rows.map(toSource);
  }

  async findById(id: SourceId): Promise<Source | null> {
    const row = this.database
      .prepare(`SELECT ${SOURCE_COLUMNS} FROM sources WHERE id = ?`)
      .get(id) as SourceRow | undefined;

    return row === undefined ? null : toSource(row);
  }

  async saveSource(source: Source): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO sources (id, certification_id, title, source_type,
           authority, original_location, status, created_at, updated_at)
         VALUES (@id, @certificationId, @title, @sourceType, @authority,
           @originalLocation, @status, @createdAt, @updatedAt)
         ON CONFLICT (id) DO UPDATE SET
           title = excluded.title,
           source_type = excluded.source_type,
           authority = excluded.authority,
           original_location = excluded.original_location,
           status = excluded.status,
           updated_at = excluded.updated_at`,
      )
      .run({
        id: source.id,
        certificationId: source.certificationId,
        title: source.title,
        sourceType: source.sourceType,
        authority: source.authority,
        originalLocation: source.originalLocation,
        status: source.status,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
      });
  }

  async archive(id: SourceId, occurredAt: IsoTimestamp): Promise<void> {
    this.setStatus(id, "ARCHIVED", occurredAt);
  }

  async restore(id: SourceId, occurredAt: IsoTimestamp): Promise<void> {
    this.setStatus(id, "ACTIVE", occurredAt);
  }

  private setStatus(
    id: SourceId,
    status: "ACTIVE" | "ARCHIVED",
    occurredAt: IsoTimestamp,
  ): void {
    this.database
      .prepare(
        `UPDATE sources SET status = :status, updated_at = :occurredAt
         WHERE id = :id`,
      )
      .run({ id, status, occurredAt });
  }

  async insertSnapshot(snapshot: SourceSnapshot): Promise<void> {
    // A bare insert, so the unique index on (source_id, content_hash) raises rather
    // than being quietly ignored. A caller that reaches here with content it has
    // already stored has a bug in its refresh comparison, and hiding it would produce
    // a "refreshed" source with no new snapshot.
    this.database
      .prepare(
        `INSERT INTO source_snapshots (id, source_id, content_hash, object_key,
           byte_size, char_count, retrieved_at)
         VALUES (@id, @sourceId, @contentHash, @objectKey, @byteSize,
           @charCount, @retrievedAt)`,
      )
      .run({
        id: snapshot.id,
        sourceId: snapshot.sourceId,
        contentHash: snapshot.contentHash,
        objectKey: snapshot.objectKey,
        byteSize: snapshot.byteSize,
        charCount: snapshot.charCount,
        retrievedAt: snapshot.retrievedAt,
      });
  }

  async listSnapshots(sourceId: SourceId): Promise<SourceSnapshot[]> {
    const rows = this.database
      .prepare(
        `SELECT ${SNAPSHOT_COLUMNS} FROM source_snapshots
         WHERE source_id = ?
         ORDER BY retrieved_at DESC, id DESC`,
      )
      .all(sourceId) as SourceSnapshotRow[];

    return rows.map(toSourceSnapshot);
  }

  async findLatestSnapshot(
    sourceId: SourceId,
  ): Promise<SourceSnapshot | null> {
    const row = this.database
      .prepare(
        `SELECT ${SNAPSHOT_COLUMNS} FROM source_snapshots
         WHERE source_id = ?
         ORDER BY retrieved_at DESC, id DESC
         LIMIT 1`,
      )
      .get(sourceId) as SourceSnapshotRow | undefined;

    return row === undefined ? null : toSourceSnapshot(row);
  }

  async findSnapshotById(
    id: SourceSnapshotId,
  ): Promise<SourceSnapshot | null> {
    const row = this.database
      .prepare(`SELECT ${SNAPSHOT_COLUMNS} FROM source_snapshots WHERE id = ?`)
      .get(id) as SourceSnapshotRow | undefined;

    return row === undefined ? null : toSourceSnapshot(row);
  }

  async findSnapshotByHash(
    sourceId: SourceId,
    contentHash: string,
  ): Promise<SourceSnapshot | null> {
    const row = this.database
      .prepare(
        `SELECT ${SNAPSHOT_COLUMNS} FROM source_snapshots
         WHERE source_id = ? AND content_hash = ?`,
      )
      .get(sourceId, contentHash) as SourceSnapshotRow | undefined;

    return row === undefined ? null : toSourceSnapshot(row);
  }

  async insertChunks(chunks: readonly SourceChunk[]): Promise<void> {
    const statement = this.database.prepare(
      `INSERT INTO source_chunks (id, snapshot_id, chunk_index, text,
         char_start, char_end)
       VALUES (@id, @snapshotId, @chunkIndex, @text, @charStart, @charEnd)`,
    );

    for (const chunk of chunks) {
      statement.run({
        id: chunk.id,
        snapshotId: chunk.snapshotId,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
      });
    }
  }

  async listChunks(snapshotId: SourceSnapshotId): Promise<SourceChunk[]> {
    const rows = this.database
      .prepare(
        `SELECT ${CHUNK_COLUMNS} FROM source_chunks
         WHERE snapshot_id = ?
         ORDER BY chunk_index ASC`,
      )
      .all(snapshotId) as SourceChunkRow[];

    return rows.map(toSourceChunk);
  }

  async countChunks(snapshotId: SourceSnapshotId): Promise<number> {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS total FROM source_chunks WHERE snapshot_id = ?`,
      )
      .get(snapshotId) as { readonly total: number };

    return row.total;
  }

  async listObjectiveLinks(sourceId: SourceId): Promise<ObjectiveId[]> {
    const rows = this.database
      .prepare(
        `SELECT objective_id FROM source_objective_links
         WHERE source_id = ?
         ORDER BY created_at ASC, objective_id ASC`,
      )
      .all(sourceId) as { readonly objective_id: string }[];

    return rows.map((row) => row.objective_id);
  }

  async linkObjective(
    sourceId: SourceId,
    objectiveId: ObjectiveId,
    occurredAt: IsoTimestamp,
  ): Promise<void> {
    // The primary key already forbids a duplicate; the facade reports it as a domain
    // error before reaching here, so this insert is bare and a race raises rather than
    // silently succeeding on a second identical link.
    this.database
      .prepare(
        `INSERT INTO source_objective_links (source_id, objective_id, created_at)
         VALUES (?, ?, ?)`,
      )
      .run(sourceId, objectiveId, occurredAt);
  }

  async unlinkObjective(
    sourceId: SourceId,
    objectiveId: ObjectiveId,
  ): Promise<void> {
    this.database
      .prepare(
        `DELETE FROM source_objective_links
         WHERE source_id = ? AND objective_id = ?`,
      )
      .run(sourceId, objectiveId);
  }
}
