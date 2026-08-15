import Link from "next/link";
import { notFound } from "next/navigation";
import { getPersonaFacade } from "@/modules/ai-generation/composition";
import { updatePersonaAction } from "@/modules/ai-generation/ui/persona-actions";
import { PersonaForm } from "@/modules/ai-generation/ui/persona-form";

interface EditPersonaPageProps {
  readonly params: Promise<{ readonly personaId: string }>;
}

/**
 * Edit one persona.
 *
 * The same form the create page renders, prefilled from the stored persona instead of
 * from a template. Saving appends a version rather than overwriting silently, so a run
 * recorded against version 2 stays explicable after version 3 exists.
 */
export default async function EditPersonaPage({
  params,
}: EditPersonaPageProps) {
  const { personaId } = await params;
  const persona = await getPersonaFacade().findPersona(personaId);

  if (persona === null) {
    notFound();
  }

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href="/settings/personas">Back to personas</Link>
      </nav>

      <header className="page-header">
        <p className="eyebrow">Persona</p>
        <h1>{persona.label}</h1>
        <p className="lede">
          Stored as <code>{persona.personaKey}</code>, which stays the same if
          you rename the persona, so a generation run recorded against it can
          always be traced back.
        </p>
      </header>

      <PersonaForm
        action={updatePersonaAction}
        submitLabel="Save new version"
        cancelHref="/settings/personas"
        draft={persona}
        archetype={persona.archetype}
        personaId={persona.id}
        version={persona.version}
      />
    </main>
  );
}
