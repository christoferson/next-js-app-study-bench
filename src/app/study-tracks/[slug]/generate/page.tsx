import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, TRACKS_CRUMB, trackCrumb } from "@/shared/ui/breadcrumbs";
import { getGenerationFacade } from "@/modules/ai-generation/composition";
import {
  describeItemKind,
  describeRunStatus,
} from "@/modules/ai-generation/domain/generation-run";
import { requestGenerationAction } from "@/modules/ai-generation/ui/actions";
import { FakeProviderNotice } from "@/modules/ai-generation/ui/fake-provider-notice";
import { GenerationForm } from "@/modules/ai-generation/ui/generation-form";

interface GeneratePageProps {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Ask a model for a small batch of study material.
 *
 * `?duplicateOf=` is how the duplicate-batch guard reaches this page: the action
 * redirects here with the earlier run's id when an equivalent request has already
 * been made (`SPEC.md` section 11.6). The notice links to that run and the form then
 * offers an explicit confirmation, so generating the same batch twice is a decision
 * the owner makes rather than one the application makes for them — or blocks.
 *
 * An unknown or foreign run id in the query string is treated as no notice at all
 * rather than an error: a stale bookmark should show the form.
 */
export default async function GeneratePage({
  params,
  searchParams,
}: GeneratePageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const facade = getGenerationFacade();
  const view = await facade.findGenerationForm(slug);

  if (view === null) {
    notFound();
  }

  const duplicateOfId = firstValue(query.duplicateOf);
  const duplicate =
    duplicateOfId.length === 0
      ? null
      : await facade.findRunDetail(slug, duplicateOfId);
  const trackPath = `/study-tracks/${view.certification.slug}`;

  return (
    <main className="page">
      <Breadcrumbs
        trail={[TRACKS_CRUMB, trackCrumb(view.certification)]}
        current="Generate with AI"
      />

      <header className="page-header">
        <p className="eyebrow">Generate with AI</p>
        <h1>{view.certification.name}</h1>
        <p className="lede">
          A model writes a small batch from its own knowledge. Everything it
          writes is saved as a draft for you to read, edit, and activate — or
          reject. Nothing generated here is official exam material, and no
          source is consulted.
        </p>
        {/* Above the form rather than beside the model name in it: whether the
            output will be real is the first thing to know about this page, and the
            provenance line at the bottom is read after a decision, not before. */}
        <FakeProviderNotice provider={view.modelProvider} subject="upcoming" />
        <div className="section-actions">
          <Link className="button-quiet" href={`${trackPath}/generation-runs`}>
            Past runs
          </Link>
        </div>
      </header>

      {duplicate === null ? null : (
        <section aria-labelledby="duplicate-heading" className="section">
          <div className="section-heading">
            <h2 id="duplicate-heading">You have asked for this already</h2>
          </div>
          <p className="empty-state" role="status">
            An equivalent request has already been made:{" "}
            <Link href={`${trackPath}/generation-runs/${duplicate.run.id}`}>
              {describeItemKind(duplicate.run.itemKind)},{" "}
              {describeRunStatus(duplicate.run.status).toLowerCase()},{" "}
              {duplicate.counts.total} kept, started{" "}
              {duplicate.run.startedAt.slice(0, 10)}
            </Link>
            . Open it to review what you already have, or tick the confirmation
            below to generate another batch anyway.
          </p>
        </section>
      )}

      <section aria-labelledby="request-heading" className="section">
        <div className="section-heading">
          <h2 id="request-heading">What should it write?</h2>
        </div>
        <GenerationForm
          action={requestGenerationAction}
          generateAnyway={duplicate !== null}
          maxItemCount={view.maxItemCount}
          modelId={view.modelId}
          modelProvider={view.modelProvider}
          objectives={view.objectives}
          persona={view.persona}
          personaChoices={view.personaChoices}
          assignedPersonaId={view.assignedPersonaId}
          slug={view.certification.slug}
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
