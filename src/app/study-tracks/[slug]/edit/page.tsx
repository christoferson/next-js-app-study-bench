import Link from "next/link";
import { notFound } from "next/navigation";
import { getCertificationFacade } from "@/modules/certifications/composition";
import { CertificationForm } from "@/modules/certifications/ui/certification-form";
import { getPersonaFacade } from "@/modules/ai-generation/composition";
import { updateStudyTrackAction } from "../../track-actions";

interface EditStudyTrackPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

/**
 * Edit a study track, including which persona writes its material.
 *
 * The persona list is resolved here and restricted to the archetype this track's study
 * type calls for, so the select offers only assignments that will be accepted. Resolving
 * it at the page rather than in the form is what keeps the certifications module unaware
 * of the ai-generation module (`spec/ARCHITECTURE.md` section 7).
 */
export default async function EditStudyTrackPage({
  params,
}: EditStudyTrackPageProps) {
  const { slug } = await params;
  const certification = await getCertificationFacade().findEditFormBySlug(slug);

  if (certification === null) {
    notFound();
  }

  const personas = await getPersonaFacade().listAssignable(
    certification.studyType,
  );
  const trackPath = `/study-tracks/${certification.slug}`;

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href={trackPath}>Back to {certification.name}</Link>
      </nav>

      <header className="page-header">
        <p className="eyebrow">Edit study track</p>
        <h1>{certification.name}</h1>
        <p className="lede">
          The track address stays <code>{certification.slug}</code> so existing
          links keep working, even if you change the name.
        </p>
      </header>

      <CertificationForm
        action={updateStudyTrackAction}
        submitLabel="Save changes"
        cancelHref={trackPath}
        certification={certification}
        personaChoices={personas.map((persona) => ({
          id: persona.id,
          label: persona.label,
        }))}
      />
    </main>
  );
}
