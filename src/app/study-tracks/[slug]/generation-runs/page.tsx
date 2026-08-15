import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, TRACKS_CRUMB, trackCrumb } from "@/shared/ui/breadcrumbs";
import { parseInput } from "@/shared/parse-input";
import { getGenerationFacade } from "@/modules/ai-generation/composition";
import { generationRunFilterSchema } from "@/modules/ai-generation/application/schemas";
import { GenerationRunList } from "@/modules/ai-generation/ui/generation-run-list";

interface GenerationRunsPageProps {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Generation history for one track.
 *
 * Paged, because run history grows without limit and nothing here may read it
 * unbounded (`spec/ARCHITECTURE.md` section 8). There are no filters: the repository
 * offers none, and a control that did nothing would be a dead one.
 */
export default async function GenerationRunsPage({
  params,
  searchParams,
}: GenerationRunsPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const filters = parseInput(generationRunFilterSchema, {
    page: firstValue(query.page),
  });
  const view = await getGenerationFacade().findRuns(slug, filters);

  if (view === null) {
    notFound();
  }

  const trackPath = `/study-tracks/${view.certification.slug}`;
  const runsPath = `${trackPath}/generation-runs`;

  return (
    <main className="page">
      <Breadcrumbs
        trail={[TRACKS_CRUMB, trackCrumb(view.certification)]}
        current="Generation runs"
      />

      <header className="page-header">
        <p className="eyebrow">Generation runs</p>
        <h1>{view.certification.name}</h1>
        <p className="lede">
          {view.totalCount === 0
            ? "Nothing has been generated for this track yet."
            : `${view.totalCount} run${view.totalCount === 1 ? "" : "s"}, newest first. Each records the model, persona, and prompt template that wrote its items.`}
        </p>
        <div className="section-actions">
          <Link className="button" href={`${trackPath}/generate`}>
            Generate with AI
          </Link>
        </div>
      </header>

      <section aria-labelledby="runs-heading" className="section">
        <div className="section-heading">
          <h2 id="runs-heading">Runs</h2>
          {view.totalCount > 0 ? (
            <p className="section-note">
              Showing {view.runs.length} of {view.totalCount}, page {view.page}{" "}
              of {view.pageCount}.
            </p>
          ) : null}
        </div>

        {view.runs.length === 0 ? (
          <p className="empty-state">
            No runs yet. Generating a batch records one here, whether it
            succeeds or fails.
          </p>
        ) : (
          <GenerationRunList runs={view.runs} slug={view.certification.slug} />
        )}

        {view.pageCount > 1 ? (
          <nav aria-label="Pagination" className="pagination">
            {view.page > 1 ? (
              <Link
                className="button-quiet"
                href={`${runsPath}?page=${view.page - 1}`}
              >
                Previous page
              </Link>
            ) : null}
            {view.page < view.pageCount ? (
              <Link
                className="button-quiet"
                href={`${runsPath}?page=${view.page + 1}`}
              >
                Next page
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </main>
  );
}

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}
