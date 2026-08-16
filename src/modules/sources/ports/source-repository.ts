import type { IsoTimestamp } from "@/platform/clock";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import type { ObjectiveId } from "@/modules/certifications/domain/objective";
import type {
  Source,
  SourceChunk,
  SourceId,
  SourceSnapshot,
  SourceSnapshotId,
} from "@/modules/sources/domain/source";

/**
 * Persistence port for the source library.
 *
 * **There is no snapshot or chunk update method, and that absence is the mechanism.**
 * `SPEC.md` section 10.2 requires that a refresh create a new snapshot rather than
 * replace the old content, and the cheapest way to guarantee that is to make replacing
 * impossible to express: `insertSnapshot` and `insertChunks` are the only writes those
 * two records have. A future contributor who wants to "just update the hash" has to add
 * a method and delete this paragraph, which is a visible decision rather than a one-line
 * mistake.
 *
 * `saveSource` does exist, because a source's title, authority, and status are the
 * owner's own metadata and editing them is not rewriting history.
 */
export interface SourceRepository {
  /** One track's sources, newest first, both statuses. */
  listByCertification(certificationId: CertificationId): Promise<Source[]>;
  findById(id: SourceId): Promise<Source | null>;
  /** Inserts or replaces the source record only. Never touches snapshots. */
  saveSource(source: Source): Promise<void>;
  archive(id: SourceId, occurredAt: IsoTimestamp): Promise<void>;
  restore(id: SourceId, occurredAt: IsoTimestamp): Promise<void>;

  /**
   * Appends one snapshot.
   *
   * Fails when the source already has a snapshot with the same content hash: identical
   * content is not a new snapshot, and the unique index rather than a prior read is what
   * decides that. Callers that mean "refresh" check `findSnapshotByHash` first so they
   * can report "unchanged" instead of an error.
   */
  insertSnapshot(snapshot: SourceSnapshot): Promise<void>;
  listSnapshots(sourceId: SourceId): Promise<SourceSnapshot[]>;
  /** The newest snapshot, or `null` for a source whose import failed midway. */
  findLatestSnapshot(sourceId: SourceId): Promise<SourceSnapshot | null>;
  findSnapshotById(id: SourceSnapshotId): Promise<SourceSnapshot | null>;
  findSnapshotByHash(
    sourceId: SourceId,
    contentHash: string,
  ): Promise<SourceSnapshot | null>;

  /** Appends the chunks of one snapshot, in index order. */
  insertChunks(chunks: readonly SourceChunk[]): Promise<void>;
  listChunks(snapshotId: SourceSnapshotId): Promise<SourceChunk[]>;
  countChunks(snapshotId: SourceSnapshotId): Promise<number>;

  listObjectiveLinks(sourceId: SourceId): Promise<ObjectiveId[]>;
  linkObjective(
    sourceId: SourceId,
    objectiveId: ObjectiveId,
    occurredAt: IsoTimestamp,
  ): Promise<void>;
  unlinkObjective(sourceId: SourceId, objectiveId: ObjectiveId): Promise<void>;
}
