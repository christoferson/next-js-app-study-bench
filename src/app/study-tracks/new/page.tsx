import Link from "next/link";
import { createCertificationAction } from "@/modules/certifications/ui/actions";
import { CertificationForm } from "@/modules/certifications/ui/certification-form";

export default function NewStudyTrackPage() {
  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href="/">Back to study tracks</Link>
      </nav>

      <header className="page-header">
        <p className="eyebrow">New study track</p>
        <h1>Create a study track</h1>
        <p className="lede">
          A study track represents a certification, examination, language level,
          or any subject you want to build a question bank for.
        </p>
      </header>

      <CertificationForm
        action={createCertificationAction}
        submitLabel="Create study track"
        cancelHref="/"
      />
    </main>
  );
}
