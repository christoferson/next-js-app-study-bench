import Link from "next/link";
import { notFound } from "next/navigation";
import { getCertificationFacade } from "@/modules/certifications/composition";
import { updateCertificationAction } from "@/modules/certifications/ui/actions";
import { CertificationForm } from "@/modules/certifications/ui/certification-form";

interface EditStudyTrackPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

export default async function EditStudyTrackPage({
  params,
}: EditStudyTrackPageProps) {
  const { slug } = await params;
  const certification = await getCertificationFacade().findEditFormBySlug(slug);

  if (certification === null) {
    notFound();
  }

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
        action={updateCertificationAction}
        submitLabel="Save changes"
        cancelHref={trackPath}
        certification={certification}
      />
    </main>
  );
}
