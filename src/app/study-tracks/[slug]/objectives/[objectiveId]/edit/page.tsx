import Link from "next/link";
import { notFound } from "next/navigation";
import { getCertificationFacade } from "@/modules/certifications/composition";
import { updateObjectiveAction } from "@/modules/certifications/ui/actions";
import { ObjectiveForm } from "@/modules/certifications/ui/objective-form";

interface EditObjectivePageProps {
  readonly params: Promise<{
    readonly slug: string;
    readonly objectiveId: string;
  }>;
}

export default async function EditObjectivePage({
  params,
}: EditObjectivePageProps) {
  const { slug, objectiveId } = await params;
  const view = await getCertificationFacade().findObjectiveForm(
    slug,
    objectiveId,
  );

  if (view === null) {
    notFound();
  }

  const trackPath = `/study-tracks/${view.certification.slug}`;

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href={trackPath}>Back to {view.certification.name}</Link>
      </nav>

      <header className="page-header">
        <p className="eyebrow">Edit objective</p>
        <h1>{view.objective.title}</h1>
        <p className="lede">
          Changing the parent moves this objective and everything nested under
          it. Only valid parents are offered.
        </p>
      </header>

      <ObjectiveForm
        action={updateObjectiveAction}
        submitLabel="Save objective"
        cancelHref={trackPath}
        slug={view.certification.slug}
        certificationId={view.certification.id}
        parentCandidates={view.parentCandidates}
        parentObjectiveId={view.objective.parentObjectiveId}
        objective={view.objective}
      />
    </main>
  );
}
