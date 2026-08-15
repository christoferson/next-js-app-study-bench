import { notFound } from "next/navigation";
import { Breadcrumbs, TRACKS_CRUMB, trackCrumb } from "@/shared/ui/breadcrumbs";
import { getGenerationFacade } from "@/modules/ai-generation/composition";
import { GenerationRunReview } from "@/modules/ai-generation/ui/generation-run-review";

interface GenerationRunPageProps {
  readonly params: Promise<{
    readonly slug: string;
    readonly runId: string;
  }>;
}

/**
 * One generation run: review what the model wrote.
 *
 * The facade returns `null` both for an unknown run and for a run belonging to
 * another track, so a guessed address is a 404 rather than a window into a different
 * bank.
 */
export default async function GenerationRunPage({
  params,
}: GenerationRunPageProps) {
  const { slug, runId } = await params;
  const view = await getGenerationFacade().findRunDetail(slug, runId);

  if (view === null) {
    notFound();
  }

  return (
    <main className="page">
      <Breadcrumbs
        trail={[
          TRACKS_CRUMB,
          trackCrumb(view.certification),
          {
            label: "Generation runs",
            href: `/study-tracks/${view.certification.slug}/generation-runs`,
          },
        ]}
        current="Run"
      />

      <GenerationRunReview view={view} />
    </main>
  );
}
