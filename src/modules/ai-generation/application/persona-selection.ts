import type { Certification } from "@/modules/certifications/domain/certification";
import type { EffectivePersona } from "@/modules/ai-generation/domain/personas";
import { personaForStudyType } from "@/modules/ai-generation/domain/personas";
import type { StoredPersona } from "@/modules/ai-generation/domain/stored-persona";
import {
  personaSuitsStudyType,
  storedPersonaToPersona,
} from "@/modules/ai-generation/domain/stored-persona";
import type { PersonaRepository } from "@/modules/ai-generation/ports/persona-repository";

/**
 * Which persona a request actually generates with.
 *
 * One resolution order, shared by the generate flow and the objective import so the two
 * cannot drift into offering different personas for the same track:
 *
 * 1. The persona chosen on the form, when one was chosen. A per-request override, not a
 *    change to the track: asking for one batch in a different voice must not silently
 *    re-assign the track.
 * 2. The track's assigned persona, when it has one.
 * 3. The built-in persona for the study type — the behaviour every track had before
 *    assignment existed, and still the default.
 *
 * Two cases fall through to the built-in rather than failing. An identifier that matches
 * nothing, because a persona deleted in another tab must not turn a generate request
 * into an error page; and a persona whose archetype no longer suits the track, because a
 * track's study type can be changed after a persona was assigned to it and the
 * assignment is then stale data rather than a request the owner just made. Generating
 * with the wrong archetype would be worse than generating with the study type's own
 * persona.
 *
 * Assignment itself is strict about both — `PersonaFacade.resolveAssignment` refuses an
 * unknown or mismatched persona — so this leniency applies only to data that was valid
 * when it was written.
 */
export async function resolveEffectivePersona(
  personas: PersonaRepository,
  certification: Certification,
  requestedPersonaId: string | null,
): Promise<EffectivePersona> {
  const chosen =
    (await findUsable(personas, requestedPersonaId, certification)) ??
    (await findUsable(personas, certification.personaId, certification));

  return chosen === null
    ? personaForStudyType(certification.studyType)
    : storedPersonaToPersona(chosen);
}

/**
 * The personas a track may be assigned or generate with.
 *
 * Restricted to the archetype the study type calls for, which is what makes the select
 * on the form a list of valid choices rather than a list with traps in it.
 */
export function assignablePersonas(
  personas: readonly StoredPersona[],
  certification: Certification,
): readonly StoredPersona[] {
  return personas.filter((persona) =>
    personaSuitsStudyType(persona, certification.studyType),
  );
}

async function findUsable(
  personas: PersonaRepository,
  personaId: string | null,
  certification: Certification,
): Promise<StoredPersona | null> {
  if (personaId === null || personaId.length === 0) {
    return null;
  }

  const persona = await personas.findById(personaId);

  if (persona === null) {
    return null;
  }

  return personaSuitsStudyType(persona, certification.studyType)
    ? persona
    : null;
}
