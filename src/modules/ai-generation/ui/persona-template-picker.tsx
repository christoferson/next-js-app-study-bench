import Link from "next/link";
import type { PersonaTemplate } from "@/modules/ai-generation/domain/persona-templates";
import { describePersonaArchetype } from "@/modules/ai-generation/domain/stored-persona";

interface PersonaTemplatePickerProps {
  readonly templates: readonly PersonaTemplate[];
}

/**
 * The starting points a new persona can be copied from.
 *
 * Links rather than a radio group and a "continue" button: choosing a template is
 * choosing which prefilled form to open, so the choice *is* the navigation. That keeps
 * the whole flow server-rendered with no client state, and it makes each prefilled form
 * a bookmarkable, refreshable URL.
 *
 * The summary line is here rather than only on the form, because the templates differ in
 * what they ask the model for — an associate-level and a professional-level AWS persona
 * are not the same persona with a different name — and that difference has to be
 * readable before the choice is made.
 */
export function PersonaTemplatePicker({
  templates,
}: PersonaTemplatePickerProps) {
  return (
    <ul className="card-list">
      {templates.map((template) => (
        <li className="card" key={template.key}>
          <div className="card-heading">
            <h3 className="card-title">
              <Link href={`/settings/personas/new?template=${template.key}`}>
                {template.draft.label}
              </Link>
            </h3>
            <span className="badge">
              {describePersonaArchetype(template.archetype)}
            </span>
          </div>
          <p className="card-text">{template.summary}</p>
        </li>
      ))}
    </ul>
  );
}
