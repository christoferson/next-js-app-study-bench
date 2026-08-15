import Link from "next/link";
import { getPersonaFacade } from "@/modules/ai-generation/composition";
import { CertificationForm } from "@/modules/certifications/ui/certification-form";
import { createStudyTrackAction } from "../track-actions";

/**
 * Create a study track.
 *
 * The persona choices are resolved here rather than in the form, because the form lives
 * in the certifications module and that module must not know that personas exist. A new
 * track has no study type yet, so every persona the owner has is offered and the
 * archetype check happens on save, where the submitted study type is known.
 */
export default async function NewStudyTrackPage() {
  const personas = await getPersonaFacade().listPersonas();

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
        action={createStudyTrackAction}
        submitLabel="Create study track"
        cancelHref="/"
        personaChoices={personas.map((persona) => ({
          id: persona.id,
          label: persona.label,
        }))}
      />
    </main>
  );
}
