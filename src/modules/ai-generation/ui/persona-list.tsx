import Link from "next/link";
import type { StoredPersona } from "@/modules/ai-generation/domain/stored-persona";
import { describePersonaArchetype } from "@/modules/ai-generation/domain/stored-persona";
import { DeletePersonaForm } from "./delete-persona-form";

interface PersonaListProps {
  readonly personas: readonly StoredPersona[];
}

/**
 * The owner's personas.
 *
 * Empty on a fresh installation, and correctly so: the two built-in personas stay in
 * code and stay in use, so nothing was copied in here to make the list look populated.
 * The empty state says that, because a list that is empty for a good reason must
 * explain the reason — otherwise it reads as a feature that lost its data.
 */
export function PersonaList({ personas }: PersonaListProps) {
  if (personas.length === 0) {
    return (
      <p className="empty-state">
        No personas yet. Generation currently uses the built-in personas — one
        for technical certifications, one for HSK Chinese. Create a persona from
        a starting point below to write your own.
      </p>
    );
  }

  return (
    <ul className="card-list">
      {personas.map((persona) => (
        <li className="card" key={persona.id}>
          <div className="card-heading">
            <h3 className="card-title">
              <Link href={`/settings/personas/${persona.id}`}>
                {persona.label}
              </Link>
            </h3>
            <span className="badge">
              {describePersonaArchetype(persona.archetype)}
            </span>
          </div>

          <dl className="meta">
            <div className="meta-item">
              <dt>Version</dt>
              <dd>{persona.version}</dd>
            </div>
            <div className="meta-item">
              <dt>Updated</dt>
              <dd>{persona.updatedAt.slice(0, 10)}</dd>
            </div>
            <div className="meta-item">
              <dt>Key</dt>
              <dd>
                <code>{persona.personaKey}</code>
              </dd>
            </div>
          </dl>

          <div className="section-actions">
            <Link
              className="button-quiet"
              href={`/settings/personas/${persona.id}`}
            >
              Edit
            </Link>
            <DeletePersonaForm personaId={persona.id} label={persona.label} />
          </div>
        </li>
      ))}
    </ul>
  );
}
