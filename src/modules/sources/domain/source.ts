import type { IsoTimestamp } from "@/platform/clock";
import type { CertificationId } from "@/modules/certifications/domain/certification";

/**
 * What the owner decided to trust, and what it said when it was read.
 *
 * Three records rather than one, and the split is the point (`SPEC.md` sections 6.14
 * and 10.2):
 *
 * - A `Source` is a decision — this document, from here, this authoritative. It holds
 *   no text, so nothing about it changes when the page behind it is edited.
 * - A `SourceSnapshot` is content at one moment, identified by the hash of that
 *   content. It is immutable: there is no operation anywhere in this module that
 *   updates one, and a refresh appends.
 * - A `SourceChunk` is one passage of one snapshot, with the offsets that locate it in
 *   the document.
 *
 * The snapshot's *text* is not on the snapshot. It is in object storage under
 * `objectKey`, because a source is a whole document and `SPEC.md` section 12.1 keeps
 * large content out of relational columns. What is on the snapshot is everything a
 * list, a comparison, or a staleness check needs — hash, size, character count, time —
 * so the source library renders without reading a single file.
 */

export type SourceId = string;
export type SourceSnapshotId = string;
export type SourceChunkId = string;

/**
 * How the text arrived.
 *
 * Four kinds, and only one of them can be re-read later. `MARKDOWN` and `PASTED_TEXT`
 * are both plain text to everything downstream — they are distinguished because the
 * owner can see at a glance which of their sources were files, and because markdown
 * structure is a hint a later chunker or prompt may legitimately use.
 */
export const SOURCE_TYPES = [
  "PASTED_TEXT",
  "MARKDOWN",
  "TEXT_PDF",
  "WEB_URL",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * How much weight this text carries, as judged by the owner.
 *
 * Owner-chosen rather than inferred, because nothing about a file or a URL reveals it:
 * the same PDF shape covers an official exam guide and a stranger's revision notes.
 * It is recorded so that grounded generation and, later, a conflict between two
 * sources can be resolved by something better than upload order.
 */
export const SOURCE_AUTHORITIES = [
  "OFFICIAL",
  "TRUSTED_THIRD_PARTY",
  "USER_AUTHORED",
  "GENERAL_WEB",
  "UNKNOWN",
] as const;

export type SourceAuthority = (typeof SOURCE_AUTHORITIES)[number];

export type SourceStatus = "ACTIVE" | "ARCHIVED";

export interface Source {
  readonly id: SourceId;
  readonly certificationId: CertificationId;
  readonly title: string;
  readonly sourceType: SourceType;
  readonly authority: SourceAuthority;
  /** The URL, the uploaded filename, or `null` for a paste, which has no origin. */
  readonly originalLocation: string | null;
  readonly status: SourceStatus;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

export interface SourceSnapshot {
  readonly id: SourceSnapshotId;
  readonly sourceId: SourceId;
  /** sha256 hex of the normalized text. Identity, not integrity. */
  readonly contentHash: string;
  /** Where the extracted text is, relative to the storage root. */
  readonly objectKey: string;
  readonly byteSize: number;
  readonly charCount: number;
  readonly retrievedAt: IsoTimestamp;
}

export interface SourceChunk {
  readonly id: SourceChunkId;
  readonly snapshotId: SourceSnapshotId;
  readonly chunkIndex: number;
  readonly text: string;
  /** Half-open offsets into the snapshot text: `[charStart, charEnd)`. */
  readonly charStart: number;
  readonly charEnd: number;
}

/**
 * Whether this source remembers somewhere it could be read again.
 *
 * The one rule behind the absence of a Refresh button on most source pages. A pasted
 * document has no origin: re-reading it would mean asking the owner to paste again,
 * which is importing a new source, not refreshing this one. An uploaded file has a
 * filename, which is a label rather than an address — the bytes were never kept
 * (see `SourceFacade`), and even if they had been, re-reading them would produce the
 * identical snapshot.
 */
export function isRefreshable(source: Source): boolean {
  return source.sourceType === "WEB_URL" && source.originalLocation !== null;
}

/**
 * The short form of a content hash, for a snapshot list.
 *
 * Twelve characters, which is what a reader can compare between two rows at a glance
 * and still not confuse. The full hash is never the interesting part; whether two
 * snapshots differ is.
 */
export function shortHash(contentHash: string): string {
  return contentHash.slice(0, 12);
}

/**
 * Where one snapshot's text is stored.
 *
 * Sharded on the first two characters of the hash for the reason the audio module
 * shards: one flat directory with thousands of files is slow to list and unpleasant to
 * inspect, and a hash's leading bytes are uniformly distributed by construction. The
 * key is derived entirely from the hash, so it is stable, contains nothing the browser
 * sent, and satisfies `assertValidObjectKey` without needing to be sanitised.
 *
 * Two sources holding identical text therefore share one object. That is safe because
 * the object is content-addressed and never mutated, and it is why deleting a source's
 * objects is not part of this slice: the row is what makes content reachable.
 */
export function objectKeyForContentHash(contentHash: string): string {
  if (!/^[0-9a-f]{64}$/.test(contentHash)) {
    throw new Error("A source object key needs a sha256 hex content hash.");
  }

  return `sources/${contentHash.slice(0, 2)}/${contentHash.slice(2)}.txt`;
}
