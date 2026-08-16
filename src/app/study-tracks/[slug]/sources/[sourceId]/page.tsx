import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, TRACKS_CRUMB, trackCrumb } from "@/shared/ui/breadcrumbs";
import {
  CollapsibleSection,
  openWhenShort,
} from "@/shared/ui/collapsible-section";
import { getGenerationFacade } from "@/modules/ai-generation/composition";
import { getSourceFacade } from "@/modules/sources/composition";
import { SNAPSHOT_PREVIEW_CHARS } from "@/modules/sources/application/source-facade";
import {
  archiveSourceAction,
  linkSourceObjectiveAction,
  refreshSourceAction,
  restoreSourceAction,
  unlinkSourceObjectiveAction,
} from "@/modules/sources/ui/source-actions";
import { SourceBadges } from "@/modules/sources/ui/source-badges";
import { SnapshotList } from "@/modules/sources/ui/snapshot-list";
import { SourceObjectiveLinkForm } from "@/modules/sources/ui/source-objective-link-form";
import { RefreshSourceForm } from "@/modules/sources/ui/refresh-source-form";

interface SourcePageProps {
  readonly params: Promise<{
    readonly slug: string;
    readonly sourceId: string;
  }>;
  /** `refreshed=0|1` is how a refresh reports its outcome. See `refreshSourceAction`. */
  readonly searchParams: Promise<{ readonly refreshed?: string }>;
}

/**
 * One source: what it is, what it said, and what it is about.
 *
 * The page is arranged as the three questions in that order. Metadata and the snapshot list
 * are the record — a source with two snapshots is a document that changed, and the differing
 * hashes are the evidence. Objective links are the owner's judgement about what the document
 * covers, which is what slice 2 will select grounding by. The preview is last and folded
 * away, because it confirms the import worked and is then rarely read again.
 *
 * Refresh appears on a web source only, and it is absent rather than disabled elsewhere:
 * a pasted document has no address to re-read, so a greyed-out button would be a control
 * that can never work (`spec/UI-GUIDELINES.md` — no dead controls).
 */
export default async function SourcePage({
  params,
  searchParams,
}: SourcePageProps) {
  const { slug, sourceId } = await params;
  const { refreshed } = await searchParams;
  const view = await getSourceFacade().findDetail(slug, sourceId);

  if (view === null) {
    notFound();
  }

  const { certification, source } = view;
  const isArchived = source.status === "ARCHIVED";
  // Asked of the generation module because it owns the evidence links. The page composes the
  // two modules rather than either one importing the other, which is where cross-module
  // reads belong (`spec/ARCHITECTURE.md` section 2).
  const outdatedQuestions =
    await getGenerationFacade().countQuestionsOnSupersededSnapshots(source.id);

  return (
    <main className="page">
      <Breadcrumbs
        trail={[
          TRACKS_CRUMB,
          trackCrumb(certification),
          {
            label: "Sources",
            href: `/study-tracks/${certification.slug}/sources`,
          },
        ]}
        current={source.title}
      />

      <header className="page-header">
        <p className="eyebrow">Source</p>
        <h1>{source.title}</h1>
        <div className="card-heading">
          <SourceBadges
            sourceType={source.sourceType}
            authority={source.authority}
            archived={isArchived}
          />
        </div>
        <p className="card-text">
          Added {source.createdAt.slice(0, 10)} ·{" "}
          {view.snapshots.length === 0
            ? "no stored text"
            : `${view.snapshots.length} snapshot${view.snapshots.length === 1 ? "" : "s"}`}
          {source.originalLocation === null
            ? ""
            : ` · from ${source.originalLocation}`}
        </p>

        <div className="section-actions">
          {view.refreshable ? (
            <RefreshSourceForm
              action={refreshSourceAction}
              slug={certification.slug}
              sourceId={source.id}
            />
          ) : null}
          <form action={isArchived ? restoreSourceAction : archiveSourceAction}>
            <input
              type="hidden"
              name="slug"
              value={certification.slug}
              readOnly
            />
            <input type="hidden" name="sourceId" value={source.id} readOnly />
            <button type="submit" className="button-quiet">
              {isArchived ? "Restore source" : "Archive source"}
            </button>
          </form>
        </div>

        {/* The refresh outcome, carried in the query string so it survives a reload of
            this page. "Unchanged" is a real answer to the question the owner asked and it
            has to be visible — an import that silently does nothing is indistinguishable
            from one that failed. */}
        {refreshed === "0" ? (
          <p className="empty-state" role="status">
            Read again just now, and the page had not changed since{" "}
            {view.snapshots[0]?.retrievedAt.slice(0, 10) ?? "the last reading"}.
            No new snapshot was recorded.
          </p>
        ) : null}
        {refreshed === "1" ? (
          <p className="empty-state" role="status">
            The page had changed. A new snapshot was recorded beside the old
            one, which is kept.
          </p>
        ) : null}

        {/* The consequence of a refresh, stated whenever it holds rather than only after
            the refresh that caused it: the owner may come back days later, and the questions
            are still built on text this document no longer contains.

            Deliberately no bulk action. Whether a question still holds depends on what
            changed, which only reading it can settle, so this points at the questions and
            stops there — nothing is flagged or retired automatically (`SPEC.md` 26.2). */}
        {outdatedQuestions > 0 ? (
          <p className="empty-state" role="status">
            {outdatedQuestions === 1
              ? "1 question was written from"
              : `${outdatedQuestions} questions were written from`}{" "}
            an older snapshot of this source. Their evidence is still readable,
            but this document has changed since. Each of those questions says so
            on its own page, above its evidence, with the button to mark it
            outdated.{" "}
            <Link href={`/study-tracks/${certification.slug}/questions`}>
              Open the question bank
            </Link>{" "}
            to review them. Nothing has been changed for you.
          </p>
        ) : null}

        {isArchived ? (
          <p className="empty-state">
            Archived. It stays here, and questions written from it stay
            verifiable — archiving takes it out of use without destroying the
            text they cite.
          </p>
        ) : null}
      </header>

      <section aria-labelledby="snapshots-heading" className="section">
        <div className="section-heading">
          <h2 id="snapshots-heading">Snapshots</h2>
          <p className="section-note">
            Each reading of this document, newest first. A snapshot is never
            edited: reading the source again appends a new one only when the
            content hash differs, so the history of what it said stays intact.
          </p>
        </div>
        <SnapshotList
          snapshots={view.snapshots}
          chunkCounts={view.chunkCounts}
        />
      </section>

      <section aria-labelledby="objectives-heading" className="section">
        <div className="section-heading">
          <h2 id="objectives-heading">Objectives</h2>
          <p className="section-note">
            What this document covers, in your judgement. Mapping is how study
            material written later finds the right passages of the right source.
          </p>
        </div>

        {view.linkedObjectives.length === 0 ? (
          <p className="empty-state">
            This source is not mapped to any objective yet.
          </p>
        ) : (
          <ul className="card-list">
            {view.linkedObjectives.map((objective) => (
              <li className="card" key={objective.id}>
                <div className="card-heading">
                  {objective.code !== null ? (
                    <span className="badge">{objective.code}</span>
                  ) : null}
                  <p className="card-title">{objective.title}</p>
                </div>
                <form action={unlinkSourceObjectiveAction}>
                  <input
                    type="hidden"
                    name="slug"
                    value={certification.slug}
                    readOnly
                  />
                  <input
                    type="hidden"
                    name="sourceId"
                    value={source.id}
                    readOnly
                  />
                  <input
                    type="hidden"
                    name="objectiveId"
                    value={objective.id}
                    readOnly
                  />
                  <button type="submit" className="button-quiet">
                    Unmap
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {view.linkableObjectives.length > 0 ? (
          <SourceObjectiveLinkForm
            action={linkSourceObjectiveAction}
            slug={certification.slug}
            sourceId={source.id}
            candidates={view.linkableObjectives}
          />
        ) : (
          <p className="field-hint">
            {view.linkedObjectives.length === 0 ? (
              <>
                This track has no active objectives to map yet.{" "}
                <Link href={`/study-tracks/${certification.slug}`}>
                  Add some to the track
                </Link>
                .
              </>
            ) : (
              "Every active objective of this track is already mapped."
            )}
          </p>
        )}
      </section>

      <CollapsibleSection
        id="preview"
        title="Stored text"
        open={openWhenShort(view.snapshots.length)}
        count={
          view.preview === null
            ? "nothing stored"
            : `first ${SNAPSHOT_PREVIEW_CHARS.toLocaleString("en-GB")} characters`
        }
        note="The beginning of the current snapshot, as it was stored — normalised, with the markup and the PDF layout gone. This is the text passages are cut from, so it is what a question written from this source would be grounded in."
      >
        {view.preview === null ? (
          <p className="empty-state">
            The stored text could not be read. The record is here, but the file
            holding its content is missing.
          </p>
        ) : (
          <>
            <pre className="text-preview">{view.preview}</pre>
            {view.previewTruncated ? (
              <p className="field-hint">
                Truncated. The whole document is stored and chunked; only this
                preview is cut.
              </p>
            ) : null}
          </>
        )}
      </CollapsibleSection>
    </main>
  );
}
