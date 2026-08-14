import Link from "next/link";
import { notFound } from "next/navigation";
import { getObjectiveImportFacade } from "@/modules/ai-generation/composition";
import {
  describeFailureCategory,
  describeRunStatus,
} from "@/modules/ai-generation/domain/generation-run";
import { applyObjectiveImportAction } from "@/modules/ai-generation/ui/objective-import-actions";
import { FakeProviderNotice } from "@/modules/ai-generation/ui/fake-provider-notice";
import { ObjectiveImportConfirm } from "@/modules/ai-generation/ui/objective-import-confirm";

interface ConfirmImportPageProps {
  readonly params: Promise<{
    readonly slug: string;
    readonly runId: string;
  }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The confirm step: what the model proposed, and whether to keep it.
 *
 * A page with its own URL rather than a second panel on the upload form, and that is a
 * deliberate cost. It means the proposal has to be stored somewhere between the two
 * requests — which is why the run row carries `proposed_payload` — but it buys three
 * things a component-level preview cannot: the page survives a refresh, it can be
 * opened on the phone after extracting on a laptop, and re-reading it costs nothing
 * because the model is not called again.
 *
 * Four states are rendered here, and each says something different:
 *
 * - A proposal to confirm — the ordinary case.
 * - Already applied — the objectives are on the track, so there is no Apply button at
 *   all rather than one that would be refused.
 * - A failed extraction — the model call happened and did not work.
 * - A completed run that proposed nothing — the document had no outline in it.
 */
export default async function ConfirmImportPage({
  params,
  searchParams,
}: ConfirmImportPageProps) {
  const { slug, runId } = await params;
  const query = await searchParams;
  const view = await getObjectiveImportFacade().findConfirmation(slug, runId);

  if (view === null) {
    notFound();
  }

  const trackPath = `/study-tracks/${view.certification.slug}`;
  const importPath = `${trackPath}/objectives/import`;
  const truncated = firstValue(query.truncated).length > 0;
  const proposal = view.tree;

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href={importPath}>Import another document</Link>
      </nav>

      <header className="page-header">
        <p className="eyebrow">Proposed outline</p>
        <h1>{view.certification.name}</h1>
        <p className="lede">
          {view.applied
            ? "This outline has already been added to the track."
            : proposal === null || view.nodeCount === 0
              ? "This extraction produced no outline to add."
              : `A model read your document and proposes ${view.nodeCount} ${
                  view.nodeCount === 1 ? "objective" : "objectives"
                }. Nothing has been added to the track yet — read the tree, then choose.`}
        </p>
        <FakeProviderNotice provider={view.modelProvider} subject="past" />
        <div className="section-actions">
          <Link className="button-quiet" href={trackPath}>
            Track
          </Link>
          <Link
            className="button-quiet"
            href={`${trackPath}/generation-runs/${view.run.id}`}
          >
            Run details
          </Link>
        </div>
      </header>

      {truncated ? (
        <p className="empty-state" role="status">
          The document was longer than one request can carry, so only the
          beginning of it was read. A syllabus usually states its outline near
          the front, but check the tree below for a missing final section — and
          if one is missing, paste that part on its own.
        </p>
      ) : null}

      {view.run.status === "FAILED" ? (
        <section aria-labelledby="failed-heading" className="section">
          <div className="section-heading">
            <h2 id="failed-heading">The extraction did not work</h2>
          </div>
          <p className="empty-state" role="status">
            {view.run.failureReason === null
              ? "The model call did not produce a usable outline."
              : describeFailureCategory(view.run.failureReason)}{" "}
            Nothing was added to your track.{" "}
            <Link href={importPath}>Try again</Link> — pasting the outline as
            text is the most reliable option when a PDF has failed twice.
          </p>
        </section>
      ) : null}

      {view.applied ? (
        <section aria-labelledby="applied-heading" className="section">
          <div className="section-heading">
            <h2 id="applied-heading">Already added</h2>
            <p className="section-note">
              Applied {view.run.appliedAt?.slice(0, 10)}. Applying again would
              duplicate every objective, so this outline cannot be added a
              second time.
            </p>
          </div>
          <p className="empty-state" role="status">
            <Link href={trackPath}>
              Open {view.certification.name} to see the outline
            </Link>
            . To change an objective, edit it there; to import a different
            document, <Link href={importPath}>start a new import</Link>.
          </p>
        </section>
      ) : proposal === null || view.nodeCount === 0 ? (
        view.run.status === "FAILED" ? null : (
          <section aria-labelledby="empty-heading" className="section">
            <div className="section-heading">
              <h2 id="empty-heading">Nothing to add</h2>
            </div>
            <p className="empty-state" role="status">
              The run finished (
              {describeRunStatus(view.run.status).toLowerCase()}) without
              finding an outline in that document. That usually means the file
              is a scan with no text layer, or the outline is in a table the
              extractor could not read.{" "}
              <Link href={importPath}>Paste the outline as text instead</Link>.
            </p>
          </section>
        )
      ) : (
        <section aria-labelledby="proposal-heading" className="section">
          <div className="section-heading">
            <h2 id="proposal-heading">Check the outline</h2>
            <p className="section-note">
              {view.nodeCount}{" "}
              {view.nodeCount === 1 ? "objective" : "objectives"} proposed,
              codes and weights copied from the document. Anything you apply is
              added after your existing objectives; nothing you already have is
              changed.
            </p>
          </div>
          <ObjectiveImportConfirm
            action={applyObjectiveImportAction}
            nodeCount={view.nodeCount}
            roots={proposal.roots}
            runId={view.run.id}
            slug={view.certification.slug}
          />
        </section>
      )}
    </main>
  );
}

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}
