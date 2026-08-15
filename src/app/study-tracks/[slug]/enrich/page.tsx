import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, TRACKS_CRUMB, trackCrumb } from "@/shared/ui/breadcrumbs";
import { getGenerationFacade } from "@/modules/ai-generation/composition";
import { describeRunStatus } from "@/modules/ai-generation/domain/generation-run";
import { requestEnrichmentAction } from "@/modules/ai-generation/ui/actions";
import { EnrichmentForm } from "@/modules/ai-generation/ui/enrichment-form";
import { FakeProviderNotice } from "@/modules/ai-generation/ui/fake-provider-notice";

interface EnrichPageProps {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Fill in dictionary detail for vocabulary cards that only have a gloss.
 *
 * A separate page from Generate rather than a third option on it, because it is a
 * different request: nothing is created, the cards are chosen by the bank rather than
 * by the owner, and there is no draft to accept afterwards. Sharing the generate form
 * would have meant hiding most of its controls.
 *
 * Two query flags reach this page from the action. `?duplicateOf=` is the
 * duplicate-run guard, exactly as on the generate page. `?nothingToEnrich=1` is the
 * happy ending: every card already has its detail, so there was nothing to spend a
 * model call on.
 */
export default async function EnrichPage({
  params,
  searchParams,
}: EnrichPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const facade = getGenerationFacade();
  const view = await facade.findEnrichmentForm(slug);

  if (view === null) {
    notFound();
  }

  const duplicateOfId = firstValue(query.duplicateOf);
  const duplicate =
    duplicateOfId.length === 0
      ? null
      : await facade.findRunDetail(slug, duplicateOfId);
  const finishedJustNow = firstValue(query.nothingToEnrich).length > 0;
  const trackPath = `/study-tracks/${view.certification.slug}`;

  return (
    <main className="page">
      <Breadcrumbs
        trail={[TRACKS_CRUMB, trackCrumb(view.certification)]}
        current="Enrich with AI"
      />

      <header className="page-header">
        <p className="eyebrow">Enrich with AI</p>
        <h1>{view.certification.name}</h1>
        <p className="lede">
          A model adds the detail a one-line gloss leaves out: further senses,
          synonyms and antonyms, example sentences with readings and
          translations, and a note on register. Each card keeps everything it
          already says — the extra detail arrives as a new revision, so nothing
          you wrote is replaced.
        </p>
        <FakeProviderNotice provider={view.modelProvider} subject="upcoming" />
        <div className="section-actions">
          <Link className="button-quiet" href={`${trackPath}/flashcards`}>
            Card bank
          </Link>
          <Link className="button-quiet" href={`${trackPath}/generation-runs`}>
            Past runs
          </Link>
        </div>
      </header>

      {finishedJustNow ? (
        <p className="empty-state" role="status">
          Every active vocabulary card on this track already has its extra
          detail, so there was nothing to enrich and no model call was made.
        </p>
      ) : null}

      {duplicate === null ? null : (
        <section aria-labelledby="duplicate-heading" className="section">
          <div className="section-heading">
            <h2 id="duplicate-heading">You have asked for this already</h2>
          </div>
          <p className="empty-state" role="status">
            These same cards were enriched by an earlier run:{" "}
            <Link href={`${trackPath}/generation-runs/${duplicate.run.id}`}>
              {describeRunStatus(duplicate.run.status).toLowerCase()},{" "}
              {duplicate.run.successfulItemCount} enriched, started{" "}
              {duplicate.run.startedAt.slice(0, 10)}
            </Link>
            . Open it to read what you already have, or tick the confirmation
            below to enrich them again anyway.
          </p>
        </section>
      )}

      <section aria-labelledby="request-heading" className="section">
        <div className="section-heading">
          <h2 id="request-heading">How much should it do?</h2>
          <p className="section-note">
            {view.unenrichedCount === 0
              ? "Every active vocabulary card on this track already has its extra detail."
              : `${view.unenrichedCount} active vocabulary ${
                  view.unenrichedCount === 1 ? "card" : "cards"
                } still have only a gloss.`}
          </p>
        </div>
        <EnrichmentForm
          action={requestEnrichmentAction}
          generateAnyway={duplicate !== null}
          maxItemCount={view.maxItemCount}
          modelId={view.modelId}
          modelProvider={view.modelProvider}
          persona={view.persona}
          slug={view.certification.slug}
          unenrichedCount={view.unenrichedCount}
        />
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
