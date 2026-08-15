import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { StoredPersona } from "@/modules/ai-generation/domain/stored-persona";
import type { PersonaRepository } from "@/modules/ai-generation/ports/persona-repository";
import type { PersonaRow } from "./persona-rows";
import { serializeStringList, toStoredPersona } from "./persona-rows";

const PERSONA_COLUMNS = `id, persona_key, archetype, version, label, role,
  guidance, card_guidance, prohibitions, default_question_types,
  default_card_types, language_instruction, content_language, created_at,
  updated_at`;

/**
 * SQLite-backed persona persistence.
 *
 * The four list columns are serialised here rather than in the facade, because JSON in
 * a text column is this adapter's storage decision: the PostgreSQL adapter in D13 may
 * use arrays or `jsonb` instead, and nothing above the port should have to change when
 * it does.
 */
export class SqlitePersonaRepository implements PersonaRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async list(): Promise<StoredPersona[]> {
    const rows = this.database
      .prepare(
        `SELECT ${PERSONA_COLUMNS} FROM personas ORDER BY label ASC, id ASC`,
      )
      .all() as PersonaRow[];

    return rows.map(toStoredPersona);
  }

  async findById(id: string): Promise<StoredPersona | null> {
    const row = this.database
      .prepare(`SELECT ${PERSONA_COLUMNS} FROM personas WHERE id = ?`)
      .get(id) as PersonaRow | undefined;

    return row === undefined ? null : toStoredPersona(row);
  }

  async findByKey(personaKey: string): Promise<StoredPersona | null> {
    const row = this.database
      .prepare(`SELECT ${PERSONA_COLUMNS} FROM personas WHERE persona_key = ?`)
      .get(personaKey) as PersonaRow | undefined;

    return row === undefined ? null : toStoredPersona(row);
  }

  async insert(persona: StoredPersona): Promise<void> {
    this.database
      .prepare(
        `INSERT INTO personas (id, persona_key, archetype, version, label, role,
           guidance, card_guidance, prohibitions, default_question_types,
           default_card_types, language_instruction, content_language,
           created_at, updated_at)
         VALUES (@id, @personaKey, @archetype, @version, @label, @role,
           @guidance, @cardGuidance, @prohibitions, @defaultQuestionTypes,
           @defaultCardTypes, @languageInstruction, @contentLanguage,
           @createdAt, @updatedAt)`,
      )
      .run(toParameters(persona));
  }

  async update(persona: StoredPersona): Promise<boolean> {
    const result = this.database
      .prepare(
        `UPDATE personas
            SET version = @version,
                label = @label,
                role = @role,
                guidance = @guidance,
                card_guidance = @cardGuidance,
                prohibitions = @prohibitions,
                default_question_types = @defaultQuestionTypes,
                default_card_types = @defaultCardTypes,
                language_instruction = @languageInstruction,
                content_language = @contentLanguage,
                updated_at = @updatedAt
          WHERE id = @id`,
      )
      .run({
        id: persona.id,
        version: persona.version,
        label: persona.label,
        role: persona.role,
        guidance: serializeStringList(persona.guidance),
        cardGuidance: serializeStringList(persona.cardGuidance),
        prohibitions: serializeStringList(persona.prohibitions),
        defaultQuestionTypes: serializeStringList(persona.defaultQuestionTypes),
        defaultCardTypes: serializeStringList(persona.defaultCardTypes),
        languageInstruction: persona.languageInstruction,
        contentLanguage: persona.contentLanguage,
        updatedAt: persona.updatedAt,
      });

    return result.changes > 0;
  }

  async delete(id: string): Promise<void> {
    // No row count check: the caller asked for the persona to be gone, and it is.
    this.database.prepare(`DELETE FROM personas WHERE id = ?`).run(id);
  }
}

function toParameters(persona: StoredPersona): Record<string, unknown> {
  return {
    id: persona.id,
    personaKey: persona.personaKey,
    archetype: persona.archetype,
    version: persona.version,
    label: persona.label,
    role: persona.role,
    guidance: serializeStringList(persona.guidance),
    cardGuidance: serializeStringList(persona.cardGuidance),
    prohibitions: serializeStringList(persona.prohibitions),
    defaultQuestionTypes: serializeStringList(persona.defaultQuestionTypes),
    defaultCardTypes: serializeStringList(persona.defaultCardTypes),
    languageInstruction: persona.languageInstruction,
    contentLanguage: persona.contentLanguage,
    createdAt: persona.createdAt,
    updatedAt: persona.updatedAt,
  };
}
