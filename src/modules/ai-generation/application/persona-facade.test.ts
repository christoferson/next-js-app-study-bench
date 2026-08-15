import { beforeEach, describe, expect, it } from "vitest";
import {
  FixedClock,
  SequentialIdGenerator,
  certificationFixture,
  createMigratedDatabase,
} from "@/modules/certifications/infrastructure/test-support";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import { findPersonaTemplate } from "@/modules/ai-generation/domain/persona-templates";
import { SqlitePersonaRepository } from "@/modules/ai-generation/infrastructure/sqlite-persona-repository";
import { PersonaFacade } from "./persona-facade";
import { parseInput } from "@/shared/parse-input";
import { personaDraftSchema } from "./persona-schemas";

/**
 * Persona management, driven through the real SQLite adapter.
 *
 * A real repository rather than a double, for the reason every facade test in this
 * repository uses one (`spec/TESTING.md`): the JSON list columns and the unique key are
 * where this feature can actually break, and a fake map would assert neither.
 *
 * The validation cases go through the authoritative schema rather than the facade,
 * because that is where they are enforced — the facade takes a parsed draft, and a test
 * that hand-built an invalid one would be testing nothing the application can reach.
 */

describe("PersonaFacade", () => {
  let database: SqliteDatabase;
  let clock: FixedClock;
  let certifications: SqliteCertificationRepository;
  let facade: PersonaFacade;

  beforeEach(() => {
    database = createMigratedDatabase();
    clock = new FixedClock("2026-03-01T00:00:00.000Z");
    certifications = new SqliteCertificationRepository(database);
    facade = new PersonaFacade({
      personas: new SqlitePersonaRepository(database),
      certifications,
      clock,
      ids: new SequentialIdGenerator("persona"),
    });
  });

  describe("findLibrary", () => {
    it("starts with no personas and every template", async () => {
      const view = await facade.findLibrary();

      expect(view.personas).toEqual([]);
      expect(view.templates).toHaveLength(6);
    });
  });

  describe("createFromTemplate", () => {
    it("copies every field from the template as version 1", async () => {
      const template = findPersonaTemplate("jlpt-japanese");
      const created = await facade.createFromTemplate("jlpt-japanese");

      expect(created.version).toBe(1);
      expect(created.archetype).toBe("LANGUAGE");
      expect(created.label).toBe(template?.draft.label);
      expect(created.role).toBe(template?.draft.role);
      expect(created.guidance).toEqual(template?.draft.guidance);
      expect(created.cardGuidance).toEqual(template?.draft.cardGuidance);
      expect(created.prohibitions).toEqual(template?.draft.prohibitions);
      expect(created.defaultQuestionTypes).toEqual(
        template?.draft.defaultQuestionTypes,
      );
      expect(created.defaultCardTypes).toEqual(
        template?.draft.defaultCardTypes,
      );
      expect(created.languageInstruction).toBe(
        template?.draft.languageInstruction,
      );
      expect(created.contentLanguage).toBe(template?.draft.contentLanguage);
      expect(created.createdAt).toBe("2026-03-01T00:00:00.000Z");
      expect(created.updatedAt).toBe("2026-03-01T00:00:00.000Z");
    });

    it("persists what it returns", async () => {
      const created = await facade.createFromTemplate("hsk-chinese");

      await expect(facade.findPersona(created.id)).resolves.toEqual(created);
    });

    it("derives the key from the label", async () => {
      const created = await facade.createFromTemplate("jlpt-japanese");

      expect(created.personaKey).toBe("jlpt-japanese-proficiency");
    });

    it("applies the owner's edits over the template", async () => {
      const created = await facade.createFromTemplate("generic-language", {
        label: "Korean TOPIK",
        guidance: ["Work at the level of a word."],
        contentLanguage: "ko",
      });

      expect(created.label).toBe("Korean TOPIK");
      expect(created.personaKey).toBe("korean-topik");
      expect(created.guidance).toEqual(["Work at the level of a word."]);
      expect(created.contentLanguage).toBe("ko");
      // Untouched fields still come from the template.
      expect(created.prohibitions.length).toBeGreaterThan(0);
    });

    it("keeps the archetype out of the owner's reach", async () => {
      // It decides which machinery a later slice applies, so a form field must not be
      // able to flip it. The type forbids it; this pins the behaviour.
      const created = await facade.createFromTemplate("hsk-chinese", {
        label: "Not technical",
      });

      expect(created.archetype).toBe("LANGUAGE");
    });

    it("suffixes a key that is already taken", async () => {
      const first = await facade.createFromTemplate("generic-technical");
      const second = await facade.createFromTemplate("generic-technical");
      const third = await facade.createFromTemplate("generic-technical");

      expect(first.personaKey).toBe("technical-certification");
      expect(second.personaKey).toBe("technical-certification-2");
      expect(third.personaKey).toBe("technical-certification-3");
    });

    it("refuses a template it does not have", async () => {
      await expect(facade.createFromTemplate("nope")).rejects.toMatchObject({
        code: "PERSONA_TEMPLATE_NOT_FOUND",
      });
      await expect(facade.listPersonas()).resolves.toEqual([]);
    });
  });

  describe("updatePersona", () => {
    it("bumps the version and the update time", async () => {
      const created = await facade.createFromTemplate("aws-associate");

      clock.set("2026-04-01T00:00:00.000Z");

      const updated = await facade.updatePersona(created.id, {
        ...created,
        label: "AWS SAA-C03",
        guidance: ["Test one service.", "Keep the scenario short."],
      });

      expect(updated.version).toBe(2);
      expect(updated.label).toBe("AWS SAA-C03");
      expect(updated.guidance).toEqual([
        "Test one service.",
        "Keep the scenario short.",
      ]);
      expect(updated.updatedAt).toBe("2026-04-01T00:00:00.000Z");
      expect(updated.createdAt).toBe("2026-03-01T00:00:00.000Z");
      await expect(facade.findPersona(created.id)).resolves.toEqual(updated);
    });

    it("bumps the version on every save", async () => {
      const created = await facade.createFromTemplate("aws-associate");
      const second = await facade.updatePersona(created.id, created);
      const third = await facade.updatePersona(created.id, second);

      expect([second.version, third.version]).toEqual([2, 3]);
    });

    it("keeps the key when the label changes", async () => {
      // A run recorded against the old key must stay explicable after a rename.
      const created = await facade.createFromTemplate("hsk-chinese");
      const updated = await facade.updatePersona(created.id, {
        ...created,
        label: "Mandarin",
      });

      expect(updated.personaKey).toBe(created.personaKey);
    });

    it("refuses a persona that no longer exists", async () => {
      const created = await facade.createFromTemplate("hsk-chinese");

      await facade.deletePersona(created.id);

      await expect(
        facade.updatePersona(created.id, created),
      ).rejects.toMatchObject({ code: "PERSONA_NOT_FOUND" });
    });
  });

  describe("deletePersona", () => {
    it("removes the persona", async () => {
      const created = await facade.createFromTemplate("hsk-chinese");

      await facade.deletePersona(created.id);

      await expect(facade.findPersona(created.id)).resolves.toBeNull();
      await expect(facade.listPersonas()).resolves.toEqual([]);
    });

    it("refuses an identifier it does not have", async () => {
      await expect(facade.deletePersona("ghost")).rejects.toMatchObject({
        code: "PERSONA_NOT_FOUND",
      });
    });

    it("refuses a persona a study track is assigned, and names the track", async () => {
      const created = await facade.createFromTemplate("hsk-chinese");

      await certifications.save(
        certificationFixture({
          name: "HSK 5 Chinese",
          studyType: "LANGUAGE_PROFICIENCY",
          personaId: created.id,
        }),
      );

      await expect(facade.deletePersona(created.id)).rejects.toMatchObject({
        code: "PERSONA_IN_USE",
      });
      // The message names the track, because changing the assignment means opening it.
      await expect(facade.deletePersona(created.id)).rejects.toThrow(
        /"HSK 5 Chinese"/,
      );
      await expect(facade.findPersona(created.id)).resolves.not.toBeNull();
    });

    it("allows the deletion once the track is back to automatic", async () => {
      const created = await facade.createFromTemplate("hsk-chinese");
      const track = certificationFixture({
        studyType: "LANGUAGE_PROFICIENCY",
        personaId: created.id,
      });

      await certifications.save(track);
      await certifications.save({ ...track, personaId: null });

      await facade.deletePersona(created.id);

      await expect(facade.findPersona(created.id)).resolves.toBeNull();
    });

    it("does not treat a recorded run as a reason to refuse", async () => {
      // A run stores the persona key and version as text rather than a foreign key, so
      // history stays readable after the persona is gone. Asserted on the schema, which
      // is where the decision was made: the column has no `REFERENCES` clause.
      const columns = database
        .prepare(`SELECT sql FROM sqlite_master WHERE name = 'generation_runs'`)
        .get() as { readonly sql: string };

      expect(columns.sql).toMatch(/persona_id TEXT NOT NULL/);
      expect(columns.sql).not.toMatch(/persona_id[^,]*REFERENCES/);
    });
  });

  describe("listAssignable", () => {
    it("offers only personas whose archetype suits the study type", async () => {
      const hsk = await facade.createFromTemplate("hsk-chinese");
      const aws = await facade.createFromTemplate("aws-associate");

      await expect(
        facade.listAssignable("LANGUAGE_PROFICIENCY"),
      ).resolves.toEqual([hsk]);
      await expect(
        facade.listAssignable("TECHNICAL_CERTIFICATION"),
      ).resolves.toEqual([aws]);
      // A general track studies something that is not a language, so it takes the
      // technical archetype.
      await expect(facade.listAssignable("GENERAL")).resolves.toEqual([aws]);
    });
  });

  describe("resolveAssignment", () => {
    it("treats nothing as automatic", async () => {
      await expect(
        facade.resolveAssignment(null, "TECHNICAL_CERTIFICATION"),
      ).resolves.toBeNull();
      await expect(
        facade.resolveAssignment("", "TECHNICAL_CERTIFICATION"),
      ).resolves.toBeNull();
    });

    it("accepts a persona of the matching archetype", async () => {
      const created = await facade.createFromTemplate("hsk-chinese");

      await expect(
        facade.resolveAssignment(created.id, "LANGUAGE_PROFICIENCY"),
      ).resolves.toBe(created.id);
    });

    it("refuses a persona for a different kind of study", async () => {
      // Restricted rather than warned about: a language persona on a technical track
      // would write Chinese vocabulary drills about IAM.
      const created = await facade.createFromTemplate("hsk-chinese");

      await expect(
        facade.resolveAssignment(created.id, "TECHNICAL_CERTIFICATION"),
      ).rejects.toMatchObject({
        code: "PERSONA_ARCHETYPE_MISMATCH",
      });
    });

    it("reports the mismatch against the persona field", async () => {
      const created = await facade.createFromTemplate("hsk-chinese");

      await expect(
        facade.resolveAssignment(created.id, "TECHNICAL_CERTIFICATION"),
      ).rejects.toMatchObject({
        fieldMessages: expect.any(Function),
      });

      try {
        await facade.resolveAssignment(created.id, "TECHNICAL_CERTIFICATION");
      } catch (error) {
        expect(
          Object.keys(
            (
              error as { fieldMessages(): Record<string, string[]> }
            ).fieldMessages(),
          ),
        ).toEqual(["personaId"]);
      }
    });

    it("refuses an identifier that names nothing", async () => {
      await expect(
        facade.resolveAssignment("ghost", "TECHNICAL_CERTIFICATION"),
      ).rejects.toMatchObject({ code: "PERSONA_NOT_FOUND" });
    });
  });

  describe("requirePersona", () => {
    it("raises a domain error rather than returning null", async () => {
      await expect(facade.requirePersona("ghost")).rejects.toMatchObject({
        code: "PERSONA_NOT_FOUND",
      });
    });
  });
});

describe("personaDraftSchema", () => {
  const valid = {
    label: "AWS associate level",
    role: "You are an AWS instructor.",
    guidance: "Test one service.\nAsk for the best next action.\n",
    cardGuidance: "One prompt per card.",
    prohibitions: "Never claim an item is a real exam question.",
    defaultQuestionTypes: ["SINGLE_CHOICE"],
    defaultCardTypes: ["BASIC"],
    languageInstruction: "Write all content in English.",
    contentLanguage: "en",
  };

  it("parses one entry per line, dropping blanks", () => {
    const parsed = parseInput(personaDraftSchema, valid);

    expect(parsed.guidance).toEqual([
      "Test one service.",
      "Ask for the best next action.",
    ]);
    expect(parsed.contentLanguage).toBe("en");
  });

  it("treats a blank content language as absent", () => {
    expect(
      parseInput(personaDraftSchema, { ...valid, contentLanguage: "  " })
        .contentLanguage,
    ).toBeNull();
  });

  it("refuses an empty label", () => {
    expect(() =>
      parseInput(personaDraftSchema, { ...valid, label: "   " }),
    ).toThrow(/values are not valid/i);
  });

  it("refuses a persona with no guidance", () => {
    // Guidance is the persona. An empty list is an instruction to do whatever the
    // model likes.
    expect(() =>
      parseInput(personaDraftSchema, { ...valid, guidance: "\n\n" }),
    ).toThrow(/values are not valid/i);
  });

  it("refuses a persona with no prohibitions", () => {
    expect(() =>
      parseInput(personaDraftSchema, { ...valid, prohibitions: "" }),
    ).toThrow(/values are not valid/i);
  });

  it("refuses a persona with no default content types", () => {
    expect(() =>
      parseInput(personaDraftSchema, { ...valid, defaultCardTypes: [] }),
    ).toThrow(/values are not valid/i);
    expect(() =>
      parseInput(personaDraftSchema, { ...valid, defaultQuestionTypes: [] }),
    ).toThrow(/values are not valid/i);
  });

  it("drops an unrecognised content type rather than refusing the form", () => {
    // A stale tab, not a mistake worth refusing a save for.
    const parsed = parseInput(personaDraftSchema, {
      ...valid,
      defaultCardTypes: ["BASIC", "ORIGAMI"],
    });

    expect(parsed.defaultCardTypes).toEqual(["BASIC"]);
  });

  it("refuses a guidance line longer than the entry limit", () => {
    expect(() =>
      parseInput(personaDraftSchema, {
        ...valid,
        guidance: "a".repeat(501),
      }),
    ).toThrow(/values are not valid/i);
  });
});
