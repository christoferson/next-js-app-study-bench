import { describe, expect, it } from "vitest";
import { readPragma } from "@/platform/database/sqlite";
import { describeCertificationRepositoryContract } from "@/modules/certifications/ports/repository-contract";
import { SqliteCertificationRepository } from "./sqlite-certification-repository";
import { SqliteObjectiveRepository } from "./sqlite-objective-repository";
import { SqliteUnitOfWork } from "./sqlite-unit-of-work";
import { certificationFixture, createMigratedDatabase } from "./test-support";

describeCertificationRepositoryContract("SQLite", () => {
  const database = createMigratedDatabase();

  return {
    certifications: new SqliteCertificationRepository(database),
    objectives: new SqliteObjectiveRepository(database),
    unitOfWork: new SqliteUnitOfWork(database),
    dispose: () => database.close(),
  };
});

/**
 * Persona assignment, which the shared contract cannot state.
 *
 * `certifications.persona_id` is a real foreign key to `personas` (migration 0010), so a
 * test that asserts on it needs a persona row — and this module must not import the
 * persona repository to write one (`spec/ARCHITECTURE.md` section 7, pinned by the
 * boundary test in ai-generation). The row goes in with SQL, which is also what makes the
 * `ON DELETE RESTRICT` case assertable here rather than only through the facade.
 */
describe("SQLite persona assignment", () => {
  function seedPersona(
    database: ReturnType<typeof createMigratedDatabase>,
    id: string,
  ): void {
    database.exec(
      `INSERT INTO personas (id, persona_key, archetype, version, label, role,
         guidance, card_guidance, prohibitions, default_question_types,
         default_card_types, language_instruction, content_language,
         created_at, updated_at)
       VALUES ('${id}', '${id}-key', 'TECHNICAL', 1, 'A persona', 'You are.',
         '["a"]', '["a"]', '["a"]', '["SINGLE_CHOICE"]', '["BASIC"]',
         'In English.', 'en',
         '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    );
  }

  it("round-trips an assigned persona identifier", async () => {
    const database = createMigratedDatabase();

    try {
      seedPersona(database, "persona-1");

      const certifications = new SqliteCertificationRepository(database);
      const certification = certificationFixture({ personaId: "persona-1" });

      await certifications.save(certification);

      await expect(certifications.findById(certification.id)).resolves.toEqual(
        certification,
      );
    } finally {
      database.close();
    }
  });

  it("lists the tracks assigned one persona, archived ones included", async () => {
    // Archived tracks count. A persona an archived track still names must not be
    // deletable, because restoring the track would leave it pointing at nothing.
    const database = createMigratedDatabase();

    try {
      seedPersona(database, "persona-1");
      seedPersona(database, "persona-2");

      const certifications = new SqliteCertificationRepository(database);

      await certifications.save(
        certificationFixture({ personaId: "persona-1" }),
      );
      await certifications.save(
        certificationFixture({
          id: "certification-2",
          slug: "archived-track",
          name: "Archived track",
          personaId: "persona-1",
          status: "ARCHIVED",
        }),
      );
      await certifications.save(
        certificationFixture({
          id: "certification-3",
          slug: "other-track",
          name: "Other track",
          personaId: "persona-2",
        }),
      );
      await certifications.save(
        certificationFixture({
          id: "certification-4",
          slug: "automatic-track",
          name: "Automatic track",
        }),
      );

      const assigned = await certifications.listByPersonaId("persona-1");

      expect(assigned.map((track) => track.name)).toEqual([
        "Archived track",
        "Demo Cloud Practitioner",
      ]);
      await expect(
        certifications.listByPersonaId("persona-unknown"),
      ).resolves.toEqual([]);
    } finally {
      database.close();
    }
  });

  it("clears an assignment back to automatic", async () => {
    const database = createMigratedDatabase();

    try {
      seedPersona(database, "persona-1");

      const certifications = new SqliteCertificationRepository(database);
      const certification = certificationFixture({ personaId: "persona-1" });

      await certifications.save(certification);
      await certifications.save({ ...certification, personaId: null });

      await expect(
        certifications.listByPersonaId("persona-1"),
      ).resolves.toEqual([]);
      await expect(
        certifications.findById(certification.id),
      ).resolves.toMatchObject({ personaId: null });
    } finally {
      database.close();
    }
  });

  it("refuses to delete a persona a track still names", async () => {
    // The floor under the facade's check: even a direct DELETE is refused, so no code
    // path can leave a track naming a persona that is gone.
    const database = createMigratedDatabase();

    try {
      seedPersona(database, "persona-1");

      await new SqliteCertificationRepository(database).save(
        certificationFixture({ personaId: "persona-1" }),
      );

      expect(() =>
        database.exec(`DELETE FROM personas WHERE id = 'persona-1'`),
      ).toThrow(/FOREIGN KEY constraint failed/i);
    } finally {
      database.close();
    }
  });

  it("refuses an assignment to a persona that does not exist", async () => {
    const database = createMigratedDatabase();

    try {
      await expect(
        new SqliteCertificationRepository(database).save(
          certificationFixture({ personaId: "ghost" }),
        ),
      ).rejects.toThrow(/FOREIGN KEY constraint failed/i);
    } finally {
      database.close();
    }
  });
});

describe("SQLite connection configuration", () => {
  it("enables foreign keys and a busy timeout on every connection", () => {
    const database = createMigratedDatabase();

    try {
      expect(readPragma(database, "foreign_keys")).toBe(1);
      expect(readPragma(database, "busy_timeout")).toBe(5000);
    } finally {
      database.close();
    }
  });

  it("uses strict tables for the certification schema", () => {
    const database = createMigratedDatabase();

    try {
      // A STRICT table rejects a value that cannot be stored in its column's
      // declared type. Here a non-numeric priority is refused rather than
      // silently coerced, which a non-strict table would allow.
      expect(() =>
        database.exec(
          `INSERT INTO certifications (id, slug, name, provider, study_type,
             description, priority, default_session_minutes, status, origin,
             created_at, updated_at)
           VALUES ('x', 'x', 'x', 'x', 'GENERAL', 'x', 'high', 20, 'ACTIVE',
             'OWNER', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        ),
      ).toThrow(/cannot store TEXT/i);
    } finally {
      database.close();
    }
  });
});
