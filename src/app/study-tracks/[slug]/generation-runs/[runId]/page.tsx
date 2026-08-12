import Link from "next/link";
import { notFound } from "next/navigation";
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
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href={`/study-tracks/${view.certification.slug}/generation-runs`}>
          Back to the generation runs
        </Link>
      </nav>

      <GenerationRunReview view={view} />
    </main>
  );
}
