import type { StoredPersona } from "@/modules/ai-generation/domain/stored-persona";

/**
 * Persistence port for the owner's personas.
 *
 * The methods describe the access patterns the management screen needs; no SQL and no
 * database row crosses this boundary (`spec/ARCHITECTURE.md` section 5.1).
 *
 * `insert` and `update` rather than one `save`, because the two are not
 * interchangeable here: an insert must fail on a taken key so the facade can pick the
 * next one, and an update must never create a row for a persona another tab has
 * deleted.
 */
export interface PersonaRepository {
  /** Every persona, ordered by label, for the settings list. */
  list(): Promise<StoredPersona[]>;
  findById(id: string): Promise<StoredPersona | null>;
  findByKey(personaKey: string): Promise<StoredPersona | null>;
  /**
   * Inserts a new persona.
   *
   * Rejects when `personaKey` is taken. The unique index is what decides that, not a
   * prior read: two tabs saving "AWS associate level" at once must produce two
   * distinguishable keys rather than one silently overwritten persona.
   */
  insert(persona: StoredPersona): Promise<void>;
  /**
   * Overwrites the editable fields, the version, and `updatedAt`.
   *
   * The key, the archetype, and `createdAt` are not updated: the first two are fixed
   * at creation by design, and rewriting the third would erase when the persona
   * appeared. Returns `false` when no row matched, so a stale form reports the
   * deletion instead of appearing to succeed.
   */
  update(persona: StoredPersona): Promise<boolean>;
  /** Removes the row. Succeeds when the identifier matches nothing. */
  delete(id: string): Promise<void>;
}
