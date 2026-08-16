import type {
  Source,
  SourceAuthority,
  SourceChunk,
  SourceSnapshot,
  SourceStatus,
  SourceType,
} from "@/modules/sources/domain/source";
import {
  SOURCE_AUTHORITIES,
  SOURCE_TYPES,
} from "@/modules/sources/domain/source";

/**
 * Row mapping for the source-library tables.
 *
 * The database is an external boundary, so the three closed unions are matched against
 * their lists on the way out rather than cast (`spec/CODING-STANDARDS.md` section 2). A
 * hand-edited local database then fails loudly here instead of putting an unknown
 * authority word in front of the owner, or — worse in slice 2 — into a prompt that asks
 * a model how much to trust it.
 */

export interface SourceRow {
  readonly id: string;
  readonly certification_id: string;
  readonly title: string;
  readonly source_type: string;
  readonly authority: string;
  readonly original_location: string | null;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface SourceSnapshotRow {
  readonly id: string;
  readonly source_id: string;
  readonly content_hash: string;
  readonly object_key: string;
  readonly byte_size: number;
  readonly char_count: number;
  readonly retrieved_at: string;
}

export interface SourceChunkRow {
  readonly id: string;
  readonly snapshot_id: string;
  readonly chunk_index: number;
  readonly text: string;
  readonly char_start: number;
  readonly char_end: number;
}

export function toSource(row: SourceRow): Source {
  return {
    id: row.id,
    certificationId: row.certification_id,
    title: row.title,
    sourceType: toSourceType(row.id, row.source_type),
    authority: toAuthority(row.id, row.authority),
    originalLocation: row.original_location,
    status: toStatus(row.id, row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toSourceSnapshot(row: SourceSnapshotRow): SourceSnapshot {
  return {
    id: row.id,
    sourceId: row.source_id,
    contentHash: row.content_hash,
    objectKey: row.object_key,
    byteSize: row.byte_size,
    charCount: row.char_count,
    retrievedAt: row.retrieved_at,
  };
}

export function toSourceChunk(row: SourceChunkRow): SourceChunk {
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    chunkIndex: row.chunk_index,
    text: row.text,
    charStart: row.char_start,
    charEnd: row.char_end,
  };
}

function toSourceType(sourceId: string, value: string): SourceType {
  const found = SOURCE_TYPES.find((candidate) => candidate === value);

  if (found === undefined) {
    throw new Error(`Stored source ${sourceId} has an unknown type: ${value}`);
  }

  return found;
}

function toAuthority(sourceId: string, value: string): SourceAuthority {
  const found = SOURCE_AUTHORITIES.find((candidate) => candidate === value);

  if (found === undefined) {
    throw new Error(
      `Stored source ${sourceId} has an unknown authority: ${value}`,
    );
  }

  return found;
}

function toStatus(sourceId: string, value: string): SourceStatus {
  if (value !== "ACTIVE" && value !== "ARCHIVED") {
    throw new Error(`Stored source ${sourceId} has an unknown status: ${value}`);
  }

  return value;
}
