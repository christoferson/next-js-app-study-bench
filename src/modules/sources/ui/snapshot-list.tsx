import {
  shortHash,
  type SourceSnapshot,
} from "@/modules/sources/domain/source";

interface SnapshotListProps {
  readonly snapshots: readonly SourceSnapshot[];
  /** Chunk counts by snapshot id, so this list runs no query of its own. */
  readonly chunkCounts: Readonly<Record<string, number>>;
}

/**
 * Every reading of one source, newest first.
 *
 * The hash prefix is the point of this list. A source with two snapshots is a document that
 * changed, and the two differing hashes are the evidence — a date alone would not
 * distinguish "read again and it had changed" from "read again and nothing had". Twelve
 * characters is what a reader can compare between two rows at a glance.
 *
 * The newest row is marked as current rather than being separated out into its own panel,
 * because "which text is in use" and "what came before" are the same question read from
 * different ends, and splitting them would show the same row twice.
 */
export function SnapshotList({ snapshots, chunkCounts }: SnapshotListProps) {
  if (snapshots.length === 0) {
    return (
      <p className="empty-state">
        No stored text. The import did not complete, so there is nothing to
        ground a question in yet.
      </p>
    );
  }

  return (
    <ul className="card-list">
      {snapshots.map((snapshot, index) => (
        <li className="card" key={snapshot.id}>
          <div className="card-heading">
            <p className="card-title">
              <code>{shortHash(snapshot.contentHash)}</code>
            </p>
            {index === 0 ? <span className="badge">Current</span> : null}
          </div>
          <p className="card-text">
            Read {snapshot.retrievedAt.slice(0, 10)} ·{" "}
            {snapshot.charCount.toLocaleString("en-GB")} characters ·{" "}
            {formatBytes(snapshot.byteSize)} ·{" "}
            {(chunkCounts[snapshot.id] ?? 0).toLocaleString("en-GB")} passage
            {(chunkCounts[snapshot.id] ?? 0) === 1 ? "" : "s"}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * A byte count a person can read.
 *
 * Kilobytes as 1024 bytes, which is what a file manager shows, and one decimal place only
 * past a kilobyte — the exact size of a stored document is never the interesting part, only
 * its order of magnitude.
 */
export function formatBytes(byteSize: number): string {
  if (byteSize < 1024) {
    return `${byteSize} bytes`;
  }

  if (byteSize < 1024 * 1024) {
    return `${(byteSize / 1024).toFixed(1)} kB`;
  }

  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}
