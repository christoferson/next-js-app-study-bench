import { notFound } from "next/navigation";
import {
  Breadcrumbs,
  SETTINGS_CRUMB,
  TRACKS_CRUMB,
} from "@/shared/ui/breadcrumbs";
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
      <Breadcrumbs
        trail={[
          TRACKS_CRUMB,
          SETTINGS_CRUMB,
          { label: "Personas", href: "/settings/personas" },
        ]}
        current={persona.label}
      />

      <header className="page-header">
        <p className="eyebrow">Persona</p>
        <h1>{persona.label}</h1>
        <p className="lede">
          Stored as <code>{persona.personaKey}</code>, which stays the same if
          you rename the persona, so a generation run recorded against it can
          always be traced back.
        </p>
        {/*
          A plain anchor, not `next/link`: the target answers with a file attachment
          rather than a page.
        */}
        <p className="field-hint">
          <a href={`/settings/personas/${persona.id}/export`} download>
            Download this persona as JSON
          </a>{" "}
          — a file you can keep, edit by hand, or import into another
          StudyBench. It carries the wording and nothing else: no key, no
          version, no dates, so importing it creates a new persona rather than
          overwriting one.
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
