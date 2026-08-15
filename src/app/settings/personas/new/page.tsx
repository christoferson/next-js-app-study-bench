import { notFound } from "next/navigation";
import {
  Breadcrumbs,
  SETTINGS_CRUMB,
  TRACKS_CRUMB,
} from "@/shared/ui/breadcrumbs";
import { findPersonaTemplate } from "@/modules/ai-generation/domain/persona-templates";
import { createPersonaAction } from "@/modules/ai-generation/ui/persona-actions";
import { PersonaForm } from "@/modules/ai-generation/ui/persona-form";

interface NewPersonaPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The prefilled form for a new persona.
 *
 * The template arrives in the query string rather than in a form field, so choosing a
 * starting point is ordinary navigation and the prefilled form is a refreshable,
 * bookmarkable URL. A missing or unknown template is a 404: there is no useful blank
 * version of this page, and the picker is one link away.
 */
export default async function NewPersonaPage({
  searchParams,
}: NewPersonaPageProps) {
  const resolved = await searchParams;
  const key = resolved.template;
  const template = typeof key === "string" ? findPersonaTemplate(key) : null;

  if (template === null) {
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
        current="New persona"
      />

      <header className="page-header">
        <p className="eyebrow">New persona</p>
        <h1>{template.draft.label}</h1>
        <p className="lede">{template.summary}</p>
      </header>

      <PersonaForm
        action={createPersonaAction}
        submitLabel="Create persona"
        cancelHref="/settings/personas"
        draft={template.draft}
        archetype={template.archetype}
        templateKey={template.key}
      />
    </main>
  );
}
