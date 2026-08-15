import type { Clock } from "@/platform/clock";
import type { IdGenerator } from "@/platform/id-generator";
import type { StudyType } from "@/modules/certifications/domain/certification";
import { describeStudyType } from "@/modules/certifications/domain/certification";
import type { CertificationRepository } from "@/modules/certifications/ports/certification-repository";
import {
  PersonaArchetypeMismatchError,
  PersonaInUseError,
  PersonaNotFoundError,
  PersonaTemplateNotFoundError,
} from "@/modules/ai-generation/domain/errors";
import type { PersonaTemplate } from "@/modules/ai-generation/domain/persona-templates";
import {
  PERSONA_TEMPLATES,
  findPersonaTemplate,
} from "@/modules/ai-generation/domain/persona-templates";
import type {
  PersonaDraft,
  StoredPersona,
} from "@/modules/ai-generation/domain/stored-persona";
import {
  describePersonaArchetype,
  personaArchetypeForStudyType,
  personaKeyFromLabel,
  personaKeyWithSuffix,
  personaSuitsStudyType,
} from "@/modules/ai-generation/domain/stored-persona";
import type { PersonaRepository } from "@/modules/ai-generation/ports/persona-repository";

/**
 * Persona-management capability facade.
 *
 * Everything the settings screen can do to a persona goes through here: the actions
 * read a form, this decides what a persona *is*. Three decisions live here rather than
 * in a component or an action, so they hold for every caller.
 *
 * **Creation copies a template.** A new persona is the template's fields as the owner
 * submitted them, at version 1, with a key derived from the label. No link back to the
 * template is stored, so improving a template later cannot change what an existing
 * persona generates.
 *
 * **Editing bumps the version.** A run records the persona and version that produced
 * it, so changed wording must be a new version rather than an edit in place — the same
 * rule `personas.ts` states for the built-in personas, applied to data instead of code.
 *
 * **Deletion is refused while a track uses it.** A track that names a deleted persona
 * would have no persona at all, so `deletePersona` asks the certification repository
 * first and names the tracks in the refusal. Recorded *runs* are deliberately not a
 * reason to refuse: a run stores the persona key and version as text rather than a
 * foreign key, so history stays readable after the persona is gone.
 *
 * **Assignment is validated here.** `resolveAssignment` is the edge the certifications
 * module cannot have: it turns a submitted identifier into one the track may store,
 * refusing an identifier that names nothing or a persona for a different kind of study.
 * Certifications must not import this module (`spec/ARCHITECTURE.md` section 7), so the
 * column there is opaque text and this is what gives it meaning.
 */

/** The settings list, plus what a new persona can be started from. */
export interface PersonaLibraryView {
  readonly personas: readonly StoredPersona[];
  readonly templates: readonly PersonaTemplate[];
}

export interface PersonaFacadeDependencies {
  readonly personas: PersonaRepository;
  /**
   * Read-only here, and only to answer "is this persona in use?".
   *
   * The dependency runs this way round — generation knows about certifications, never
   * the reverse — which is exactly why the deletion guard lives in this module.
   */
  readonly certifications: CertificationRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * How many suffixed keys are tried before giving up.
 *
 * A bound rather than a loop, for the reason slug allocation has one: a repository that
 * reported every key as taken would otherwise spin forever.
 */
const MAX_KEY_ATTEMPTS = 50;

export class PersonaFacade {
  constructor(private readonly deps: PersonaFacadeDependencies) {}

  async listPersonas(): Promise<readonly StoredPersona[]> {
    return this.deps.personas.list();
  }

  /** The settings page's whole read: the owner's personas and the starting points. */
  async findLibrary(): Promise<PersonaLibraryView> {
    return {
      personas: await this.deps.personas.list(),
      templates: PERSONA_TEMPLATES,
    };
  }

  async findPersona(id: string): Promise<StoredPersona | null> {
    return this.deps.personas.findById(id);
  }

  /** The persona, or a domain error the form can render. */
  async requirePersona(id: string): Promise<StoredPersona> {
    const persona = await this.deps.personas.findById(id);

    if (persona === null) {
      throw new PersonaNotFoundError(id);
    }

    return persona;
  }

  /**
   * Creates a persona from a template.
   *
   * `overrides` is what the owner typed into the prefilled form; anything absent falls
   * back to the template. The archetype comes from the template only — it is not an
   * override, because it decides which machinery a later slice applies and so is not
   * the kind of thing a form field should be able to flip.
   */
  async createFromTemplate(
    templateKey: string,
    overrides: Partial<PersonaDraft> = {},
  ): Promise<StoredPersona> {
    const template = findPersonaTemplate(templateKey);

    if (template === null) {
      throw new PersonaTemplateNotFoundError(templateKey);
    }

    const draft: PersonaDraft = { ...template.draft, ...overrides };
    const now = this.deps.clock.now();
    const persona: StoredPersona = {
      ...draft,
      id: this.deps.ids.nextId(),
      personaKey: await this.allocateKey(draft.label),
      archetype: template.archetype,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    await this.deps.personas.insert(persona);

    return persona;
  }

  /**
   * Replaces the editable fields and bumps the version.
   *
   * The key does not move with the label, deliberately: a run recorded against
   * `hsk-chinese` must stay explicable after the owner renames the persona to
   * "Mandarin", which is exactly the case a key derived fresh on every save would
   * break.
   */
  async updatePersona(id: string, draft: PersonaDraft): Promise<StoredPersona> {
    const existing = await this.requirePersona(id);
    const updated: StoredPersona = {
      ...existing,
      ...draft,
      version: existing.version + 1,
      updatedAt: this.deps.clock.now(),
    };

    if (!(await this.deps.personas.update(updated))) {
      // Deleted between the read and the write, in another tab.
      throw new PersonaNotFoundError(id);
    }

    return updated;
  }

  /**
   * Removes a persona.
   *
   * Refuses an identifier that matches nothing, so a stale list says so rather than
   * reporting a deletion that never happened, and refuses one a study track is assigned
   * — naming the tracks, because the owner has to open each track's edit form to change
   * it. The database enforces the same rule as a foreign key (migration 0010); this
   * check is what turns it into a sentence.
   */
  async deletePersona(id: string): Promise<void> {
    await this.requirePersona(id);

    const assigned = await this.deps.certifications.listByPersonaId(id);

    if (assigned.length > 0) {
      throw new PersonaInUseError(
        id,
        assigned.map((certification) => certification.name),
      );
    }

    await this.deps.personas.delete(id);
  }

  /**
   * Personas a track of this study type may be assigned, plus the automatic default.
   *
   * Restricted to the matching archetype rather than listing everything and warning
   * afterwards: the form then offers only choices that will be accepted.
   */
  async listAssignable(
    studyType: StudyType,
  ): Promise<readonly StoredPersona[]> {
    const personas = await this.deps.personas.list();

    return personas.filter((persona) =>
      personaSuitsStudyType(persona, studyType),
    );
  }

  /**
   * Validates a persona assignment for a track of `studyType`.
   *
   * Returns the identifier the track should store: `null` for "decide by study type",
   * or the persona's own id. Raises rather than falling back, because this runs on a
   * submitted form where a silent substitution would tell the owner they had assigned
   * something they had not.
   */
  async resolveAssignment(
    personaId: string | null,
    studyType: StudyType,
  ): Promise<string | null> {
    if (personaId === null || personaId.length === 0) {
      return null;
    }

    const persona = await this.requirePersona(personaId);

    if (!personaSuitsStudyType(persona, studyType)) {
      throw new PersonaArchetypeMismatchError(
        personaId,
        `"${persona.label}" is a ${describePersonaArchetype(persona.archetype).toLowerCase()} persona, and a ${describeStudyType(studyType).toLowerCase()} track needs a ${describePersonaArchetype(personaArchetypeForStudyType(studyType)).toLowerCase()} one. Choose another persona, or leave it automatic.`,
      );
    }

    return persona.id;
  }

  /**
   * The first free key for a label.
   *
   * `aws-associate-level`, then `-2`, `-3`, ... The read-then-insert race is closed by
   * the unique index rather than by this loop: `insert` rejects a taken key, so the
   * worst case of two simultaneous saves is a failed submission the owner retries, not
   * two personas sharing provenance.
   */
  private async allocateKey(label: string): Promise<string> {
    const stem = personaKeyFromLabel(label);

    for (let attempt = 1; attempt <= MAX_KEY_ATTEMPTS; attempt += 1) {
      const candidate = personaKeyWithSuffix(stem, attempt);

      if ((await this.deps.personas.findByKey(candidate)) === null) {
        return candidate;
      }
    }

    // Fifty personas whose labels reduce to one key. Falling back to the identifier
    // keeps the key unique and the save working; it is ugly and unreachable.
    return `${stem}-${this.deps.ids.nextId()}`;
  }
}
