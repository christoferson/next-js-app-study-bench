import type { StudyType } from "@/modules/certifications/domain/certification";
import type { QuestionType } from "@/modules/question-bank/domain/question";
import type { CardType } from "@/modules/flashcards/domain/flashcard";
import type { EffectivePersona } from "./personas";

/**
 * The owner's own personas (`SPEC.md` section 10, `spec/AI-GUIDELINES.md` section 2).
 *
 * `personas.ts` holds the two built-in personas: code, selected by study type, not
 * editable. They stay, and they are still what generation applies. This file adds the
 * second kind — a persona the owner created, edited, and owns — because one shared
 * "technical certification" text cannot serve an associate-level track and a
 * professional-level one at once: the whole difference between them *is* the guidance.
 *
 * A stored persona is deliberately not a `Persona`. It carries a uuid rather than a
 * `PersonaId`, and it carries an archetype, a key, and timestamps that a code persona
 * has no use for. `storedPersonaToPersona` below is the one place the two meet: it
 * reduces a stored persona to the `EffectivePersona` the prompt builder takes, so a
 * track can be assigned either kind without a second prompt path.
 */

/**
 * What kind of study a persona is for.
 *
 * A closed code rather than free text, and fixed at creation, because it is what a
 * later slice wires machinery to: vocabulary enrichment is meaningful for a language
 * persona and meaningless for a technical one. That decision must be readable from a
 * field, never inferred by searching a label for "HSK" or "Chinese"
 * (`spec/CODING-STANDARDS.md` section 1).
 *
 * It is not editable after creation for the same reason: changing it would change
 * which machinery applies, which is a different persona rather than an edited one.
 */
export type PersonaArchetype = "TECHNICAL" | "LANGUAGE";

export const PERSONA_ARCHETYPES: readonly PersonaArchetype[] = [
  "TECHNICAL",
  "LANGUAGE",
];

export function describePersonaArchetype(archetype: PersonaArchetype): string {
  switch (archetype) {
    case "TECHNICAL":
      return "Technical";
    case "LANGUAGE":
      return "Language";
  }
}

/**
 * The fields the owner writes and may change.
 *
 * Separate from the record so that "create" and "edit" take the same value: what
 * differs between them is the key, the version, and the timestamps, and none of those
 * is the owner's to type.
 */
export interface PersonaDraft {
  readonly label: string;
  readonly role: string;
  readonly guidance: readonly string[];
  readonly cardGuidance: readonly string[];
  readonly prohibitions: readonly string[];
  readonly defaultQuestionTypes: readonly QuestionType[];
  readonly defaultCardTypes: readonly CardType[];
  readonly languageInstruction: string;
  readonly contentLanguage: string | null;
}

export interface StoredPersona extends PersonaDraft {
  readonly id: string;
  /**
   * Stable identifier, derived from the label once and then never changed.
   *
   * A run records which persona produced it, and a renamed persona must not make that
   * record unreadable — the same reason a study track's slug survives a rename.
   */
  readonly personaKey: string;
  readonly archetype: PersonaArchetype;
  /** Bumped by every edit, so a recorded run names the text that produced it. */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Used when a label reduces to nothing a key can be built from. */
export const PERSONA_KEY_FALLBACK = "persona";

/**
 * Derives a persona key from a label.
 *
 * Deliberately the same shape as a track slug — lowercase, hyphenated, ASCII — so the
 * two identifiers read alike in a recorded run. A label written entirely in
 * non-Latin characters reduces to nothing, which is why there is a fallback rather
 * than a refusal: "汉语水平考试" is a perfectly good persona name.
 */
export function personaKeyFromLabel(label: string): string {
  const key = label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");

  return key.length > 0 ? key : PERSONA_KEY_FALLBACK;
}

/** `stem`, `stem-2`, `stem-3`, ... — how a key collision is resolved. */
export function personaKeyWithSuffix(stem: string, attempt: number): string {
  return attempt <= 1 ? stem : `${stem}-${attempt}`;
}

/**
 * Which archetype a study type may be assigned a persona of.
 *
 * The same mapping `personaIdForStudyType` makes for the built-in personas, expressed
 * over archetypes: a language track studies words, a technical or general track studies
 * applied judgement. Exhaustive over `StudyType`, so a new study type must decide here
 * rather than accepting every persona by default.
 *
 * A track may only be assigned a persona of its own archetype. The restriction is
 * deliberate rather than an advisory warning: an archetype decides which machinery
 * applies — vocabulary enrichment is meaningful for a language persona and meaningless
 * for a technical one — so a mismatched assignment would produce a track whose
 * generation and whose enrichment disagree about what it is studying.
 */
export function personaArchetypeForStudyType(
  studyType: StudyType,
): PersonaArchetype {
  switch (studyType) {
    case "LANGUAGE_PROFICIENCY":
      return "LANGUAGE";
    case "TECHNICAL_CERTIFICATION":
      return "TECHNICAL";
    case "GENERAL":
      return "TECHNICAL";
  }
}

export function personaSuitsStudyType(
  persona: StoredPersona,
  studyType: StudyType,
): boolean {
  return persona.archetype === personaArchetypeForStudyType(studyType);
}

/**
 * A stored persona as generation applies it.
 *
 * The adapter that lets one prompt builder serve both kinds of persona. Every field is
 * carried across unchanged except the identity: the persona *key* becomes the
 * identifier, not the uuid, because that identifier is written onto every run it
 * produces and a key is the stable, readable thing — `personaKey` survives a rename,
 * and "hsk-5-intensive v3" explains a run in a way a uuid cannot.
 *
 * Nothing is added and nothing is reworded, which is what keeps the rendered prompt
 * structurally identical to a built-in persona's: `prompt-templates.ts` reads exactly
 * these fields, so no template version bump is involved in this change.
 */
export function storedPersonaToPersona(
  persona: StoredPersona,
): EffectivePersona {
  return {
    id: persona.personaKey,
    version: persona.version,
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
