import { describe, expect, it } from "vitest";
import { createMigratedDatabase } from "@/modules/certifications/infrastructure/test-support";
import { describePersonaRepositoryContract } from "@/modules/ai-generation/ports/persona-repository-contract";
import { SqlitePersonaRepository } from "./sqlite-persona-repository";
import { storedPersonaFixture } from "./persona-test-support";

describePersonaRepositoryContract("SQLite", () => {
  const database = createMigratedDatabase();

  return {
    personas: new SqlitePersonaRepository(database),
    dispose: () => database.close(),
  };
});

describe("SQLite persona schema", () => {
  it("uses a strict table", () => {
    const database = createMigratedDatabase();

    try {
      // A STRICT table refuses a value it cannot store in the declared type; a
      // non-strict table would coerce this version to 0.
      expect(() =>
        database.exec(
          `INSERT INTO personas (id, persona_key, archetype, version, label,
             role, guidance, card_guidance, prohibitions,
             default_question_types, default_card_types, language_instruction,
             created_at, updated_at)
           VALUES ('a', 'k', 'TECHNICAL', 'first', 'L', 'R', '[]', '[]', '[]',
             '[]', '[]', 'English', '2026-01-01T00:00:00.000Z',
             '2026-01-01T00:00:00.000Z')`,
        ),
      ).toThrow(/cannot store TEXT value in INTEGER column/i);
    } finally {
      database.close();
    }
  });

  it("refuses an archetype outside the two codes", () => {
    // The archetype decides which machinery a later slice applies, so it is a
    // property of the schema rather than a convention.
    const database = createMigratedDatabase();

    try {
      expect(() =>
        database.exec(
          `INSERT INTO personas (id, persona_key, archetype, version, label,
             role, guidance, card_guidance, prohibitions,
             default_question_types, default_card_types, language_instruction,
             created_at, updated_at)
           VALUES ('a', 'k', 'MUSICAL', 1, 'L', 'R', '[]', '[]', '[]', '[]',
             '[]', 'English', '2026-01-01T00:00:00.000Z',
             '2026-01-01T00:00:00.000Z')`,
        ),
      ).toThrow(/CHECK constraint failed/i);
    } finally {
      database.close();
    }
  });

  it("starts empty, because no persona is seeded", () => {
    // The two built-in personas stay in code and stay in use. Seeding copies here
    // would create two sources of truth for the persona generation applies.
    const database = createMigratedDatabase();

    try {
      const row = database
        .prepare(`SELECT COUNT(*) AS total FROM personas`)
        .get() as { readonly total: number };

      expect(row.total).toBe(0);
    } finally {
      database.close();
    }
  });

  it("fails loudly on a stored list that is not an array of strings", async () => {
    // The database is an external boundary: a hand-edited row must not become a
    // silently malformed persona (`spec/CODING-STANDARDS.md` section 2).
    const database = createMigratedDatabase();

    try {
      const personas = new SqlitePersonaRepository(database);

      await personas.insert(storedPersonaFixture());
      database.exec(`UPDATE personas SET guidance = '{"not":"a list"}'`);

      await expect(personas.findById("persona-1")).rejects.toThrow(
        /unreadable guidance list/i,
      );
    } finally {
      database.close();
    }
  });

  it("drops a stored content type the domain no longer has", async () => {
    // Filtered rather than fatal, so a persona naming a retired type stays editable.
    const database = createMigratedDatabase();

    try {
      const personas = new SqlitePersonaRepository(database);

      await personas.insert(storedPersonaFixture());
      database.exec(
        `UPDATE personas SET default_card_types = '["BASIC","ORIGAMI"]'`,
      );

      const stored = await personas.findById("persona-1");

      expect(stored?.defaultCardTypes).toEqual(["BASIC"]);
    } finally {
      database.close();
    }
  });
});
