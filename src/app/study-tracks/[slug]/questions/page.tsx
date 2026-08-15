import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, TRACKS_CRUMB, trackCrumb } from "@/shared/ui/breadcrumbs";
import { CollapsibleSection } from "@/shared/ui/collapsible-section";
import { parseInput } from "@/shared/parse-input";
import { getQuestionBankFacade } from "@/modules/question-bank/composition";
import { questionFilterSchema } from "@/modules/question-bank/application/schemas";
import { QuestionBankList } from "@/modules/question-bank/ui/question-bank-list";
import { QuestionFilterForm } from "@/modules/question-bank/ui/question-filter-form";

interface QuestionBankPageProps {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The question bank for one study track.
 *
 * Filters arrive in the query string and are parsed permissively: an
 * unrecognised value shows the unfiltered bank rather than an error, so a stale
 * bookmark still works. Results are paginated, so the bank is never read
 * unbounded (`spec/ARCHITECTURE.md` section 8).
 */
export default async function QuestionBankPage({
  params,
  searchParams,
}: QuestionBankPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const filters = parseInput(questionFilterSchema, {
    lifecycle: firstValue(query.lifecycle),
    quality: firstValue(query.quality),
    type: firstValue(query.type),
    objective: firstValue(query.objective),
    q: firstValue(query.q),
    page: firstValue(query.page),
  });
  const view = await getQuestionBankFacade().findBankBySlug(slug, filters);

  if (view === null) {
    notFound();
  }

  const bankPath = `/study-tracks/${view.certification.slug}/questions`;
  const isFiltered = view.totalCount !== view.unfilteredCount;

  return (
    <main className="page">
      <Breadcrumbs
        trail={[TRACKS_CRUMB, trackCrumb(view.certification)]}
        current="Question bank"
      />

      <header className="page-header">
        <p className="eyebrow">Question bank</p>
        <h1>{view.certification.name}</h1>
        <p className="lede">
          {view.unfilteredCount === 0
            ? "No questions yet."
            : `${view.unfilteredCount} question${view.unfilteredCount === 1 ? "" : "s"} in this bank.`}
          {isFiltered ? ` ${view.totalCount} match the current filters.` : ""}
        </p>
        <div className="section-actions">
          <Link className="button" href={`${bankPath}/new`}>
            Write a question
          </Link>
        </div>
      </header>

      {/* Open by default, unlike the histories: filters are a control the owner came here to
          use, and one hidden behind a press is one they will not find. Collapsing is for
          getting the form out of the way of the results on a phone. */}
      <CollapsibleSection id="filters" title="Filters" open>
        <QuestionFilterForm
          action={bankPath}
          filters={filters}
          objectives={view.objectives}
        />
      </CollapsibleSection>

      <section aria-labelledby="questions-heading" className="section">
        <div className="section-heading">
          <h2 id="questions-heading">Questions</h2>
          {view.totalCount > 0 ? (
            <p className="section-note">
              Showing {view.items.length} of {view.totalCount}, page {view.page}{" "}
              of {view.pageCount}.
            </p>
          ) : null}
        </div>

        {view.items.length === 0 ? (
          <p className="empty-state">
            {view.unfilteredCount === 0
              ? "This bank is empty. Write your first question to start building it."
              : "No questions match these filters. Clear them to see the whole bank."}
          </p>
        ) : (
          <QuestionBankList slug={view.certification.slug} items={view.items} />
        )}

        {view.pageCount > 1 ? (
          <nav aria-label="Pagination" className="pagination">
            {view.page > 1 ? (
              <Link
                className="button-quiet"
                href={pageHref(bankPath, query, view.page - 1)}
              >
                Previous page
              </Link>
            ) : null}
            {view.page < view.pageCount ? (
              <Link
                className="button-quiet"
                href={pageHref(bankPath, query, view.page + 1)}
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

/** Keeps the active filters while changing the page. */
function pageHref(
  bankPath: string,
  query: Record<string, string | string[] | undefined>,
  page: number,
): string {
  const search = new URLSearchParams();

  for (const key of ["lifecycle", "quality", "type", "objective", "q"]) {
    const value = firstValue(query[key]);

    if (value.length > 0) {
      search.set(key, value);
    }
  }

  search.set("page", String(page));

  return `${bankPath}?${search.toString()}`;
}
