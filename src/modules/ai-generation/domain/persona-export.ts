import type {
  PersonaArchetype,
  PersonaDraft,
  StoredPersona,
} from "./stored-persona";

/**
 * The file format a persona travels in (`SPEC.md` section 10).
 *
 * A persona is the one part of StudyBench worth handing to somebody else: it is prose,
 * it took work to write, and it is useful without any of this application's data. So it
 * gets a file format rather than a copy-paste of the edit form — one JSON object that
 * exports from here and imports back, and doubles as a shareable template.
 *
 * **What the envelope leaves out is the design.** No `id`, no `personaKey`, no
 * `version`, no timestamps. Those are identity and history, and an import mints its own:
 * a downloaded file is a *draft* of exactly the shape a template carries, so importing
 * one lands in the same prefilled form choosing a template does, and the facade allocates
 * a fresh key the same way. Carrying the key across would be the tempting mistake —
 * two personas claiming the same provenance, or an import that silently overwrites a
 * persona a run was recorded against.
 *
 * **The version marker is first and mandatory.** A file the owner may have kept for a
 * year is untrusted input twice over (`spec/CODING-STANDARDS.md` section 2), and a
 * format change must be able to say "this file is newer than this application" instead
 * of quietly reading half of it.
 */

/** The marker key, and the only version this release reads or writes. */
export const PERSONA_ENVELOPE_KEY = "studybench_persona";
export const PERSONA_ENVELOPE_VERSION = 1;

/**
 * The largest persona file that will be read.
 *
 * Generous for the format — every bounded field at its limit is a few tens of kilobytes —
 * and checked from the declared size before any bytes are read, so a large upload is
 * refused rather than buffered. The bound exists because the alternative is reading
 * whatever the file claims to be into memory to find out it is not a persona.
 */
export const MAX_PERSONA_FILE_BYTES = 256 * 1024;

/**
 * A persona as a file.
 *
 * The field names are the domain's own, so the file reads like the form the owner filled
 * in rather than like a database row.
 */
export interface PersonaEnvelope extends PersonaDraft {
  readonly [PERSONA_ENVELOPE_KEY]: number;
  readonly archetype: PersonaArchetype;
}

/**
 * What an import produced: the archetype, and the draft the form prefills from.
 *
 * The archetype is separate from the draft for the same reason it is separate on a
 * template — it is fixed at creation and decides which machinery the persona reaches,
 * so it is not one of the fields the owner edits.
 */
export interface ImportedPersona {
  readonly archetype: PersonaArchetype;
  readonly draft: PersonaDraft;
}

/** One persona as the export route serves it. */
export function toPersonaEnvelope(persona: StoredPersona): PersonaEnvelope {
  return {
    [PERSONA_ENVELOPE_KEY]: PERSONA_ENVELOPE_VERSION,
    archetype: persona.archetype,
    label: persona.label,
    role: persona.role,
    guidance: persona.guidance,
    cardGuidance: persona.cardGuidance,
    prohibitions: persona.prohibitions,
    defaultQuestionTypes: persona.defaultQuestionTypes,
    defaultCardTypes: persona.defaultCardTypes,
    languageInstruction: persona.languageInstruction,
    contentLanguage: persona.contentLanguage,
  };
}

/**
 * The filename a download offers.
 *
 * Built from the persona key, which is already lowercase ASCII with hyphens — and
 * filtered again anyway, because this value ends up in a `Content-Disposition` header
 * where a quote or a newline would be a header-injection primitive rather than an odd
 * filename (`spec/SECURITY.md`). A key that filtered away to nothing still yields a
 * usable name.
 */
export function personaExportFilename(personaKey: string): string {
  const safe = personaKey.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const trimmed = safe.replace(/^-+|-+$/g, "").slice(0, 80);

  return `${trimmed.length > 0 ? trimmed : "persona"}.persona.json`;
}
