import Link from "next/link";
import type { SourceListEntry } from "@/modules/sources/application/source-facade";
import { SourceBadges } from "./source-badges";

interface SourceListProps {
  readonly slug: string;
  readonly entries: readonly SourceListEntry[];
}

/**
 * One track's sources.
 *
 * What each row shows is what the owner needs in order to decide whether to open it: what
 * it is, how much weight it carries, how many times it has been read, and when it was last
 * read. The snapshot count is the interesting number for a web source — two snapshots mean
 * the page changed since the import — and it is the boring number 1 for everything else,
 * which is itself informative.
 *
 * Archived sources stay in the list rather than being filtered out. There is no delete in
 * this slice, so hiding them would make them unreachable, and a retired exam guide is
 * still the document some question was written from.
 */
export function SourceList({ slug, entries }: SourceListProps) {
  if (entries.length === 0) {
    return (
      <p className="empty-state">
        No sources yet. A source is a document you trust — an exam guide, a
        documentation page, your own notes. Adding one stores its text so
        questions can later be written from it rather than from a model&apos;s
        memory.
      </p>
    );
  }

  return (
    <ul className="card-list">
      {entries.map((entry) => (
        <li className="card" key={entry.source.id}>
          <div className="card-heading">
            <h3>
              <Link
                href={`/study-tracks/${slug}/sources/${encodeURIComponent(entry.source.id)}`}
              >
                {entry.source.title}
              </Link>
            </h3>
            <SourceBadges
              sourceType={entry.source.sourceType}
              authority={entry.source.authority}
              archived={entry.source.status === "ARCHIVED"}
            />
          </div>
          <p className="card-text">
            {entry.snapshotCount === 0
              ? "No stored text."
              : `${entry.snapshotCount} snapshot${entry.snapshotCount === 1 ? "" : "s"}`}
            {entry.latestSnapshot === null
              ? ""
              : ` · last read ${entry.latestSnapshot.retrievedAt.slice(0, 10)} · ${entry.latestSnapshot.charCount.toLocaleString("en-GB")} characters in ${entry.chunkCount} passage${entry.chunkCount === 1 ? "" : "s"}`}
            {entry.objectiveCount > 0
              ? ` · ${entry.objectiveCount} objective${entry.objectiveCount === 1 ? "" : "s"}`
              : ""}
          </p>
          {entry.source.originalLocation === null ? null : (
            <p className="card-text">{entry.source.originalLocation}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
