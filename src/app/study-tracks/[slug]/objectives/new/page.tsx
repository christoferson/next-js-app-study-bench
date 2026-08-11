import Link from "next/link";
import { notFound } from "next/navigation";
import { getCertificationFacade } from "@/modules/certifications/composition";
import { isDomainError } from "@/modules/certifications/domain/errors";
import type { NewObjectiveFormView } from "@/modules/certifications/application/certification-facade";
import { createObjectiveAction } from "@/modules/certifications/ui/actions";
import { ObjectiveForm } from "@/modules/certifications/ui/objective-form";

interface NewObjectivePageProps {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NewObjectivePage({
  params,
  searchParams,
}: NewObjectivePageProps) {
  const { slug } = await params;
  const { parent } = await searchParams;
  const parentObjectiveId = typeof parent === "string" ? parent : null;

  let view: NewObjectiveFormView | null;

  try {
    view = await getCertificationFacade().findNewObjectiveForm(
      slug,
      parentObjectiveId,
    );
  } catch (error) {
    // A `?parent=` value that does not belong to this track is a bad address,
    // not a form error the owner can correct.
    if (isDomainError(error)) {
      notFound();
    }
    throw error;
  }

  if (view === null) {
    notFound();
  }

  const trackPath = `/study-tracks/${view.certification.slug}`;
  const parentTitle = view.parentCandidates.find(
    (candidate) => candidate.id === view.parentObjectiveId,
  )?.title;

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href={trackPath}>Back to {view.certification.name}</Link>
      </nav>

      <header className="page-header">
        <p className="eyebrow">New objective</p>
        <h1>
          {parentTitle === undefined
            ? "Add a root objective"
            : `Add an objective under ${parentTitle}`}
        </h1>
        <p className="lede">
          Objectives form the study map for {view.certification.name}. You can
          nest them and reorder them afterwards.
        </p>
      </header>

      <ObjectiveForm
        action={createObjectiveAction}
        submitLabel="Add objective"
        cancelHref={trackPath}
        slug={view.certification.slug}
        certificationId={view.certification.id}
        parentCandidates={view.parentCandidates}
        parentObjectiveId={view.parentObjectiveId}
      />
    </main>
  );
}
