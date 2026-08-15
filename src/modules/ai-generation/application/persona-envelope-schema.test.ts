import { describe, expect, it } from "vitest";
import { ValidationError, isDomainError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import {
  MAX_PERSONA_FILE_BYTES,
  PERSONA_ENVELOPE_KEY,
  PERSONA_ENVELOPE_VERSION,
  personaExportFilename,
  toPersonaEnvelope,
} from "@/modules/ai-generation/domain/persona-export";
import { storedPersonaFixture } from "@/modules/ai-generation/infrastructure/persona-test-support";
import {
  personaEnvelopeSchema,
  toImportedPersona,
} from "./persona-envelope-schema";

/**
 * The persona file format, in both directions.
 *
 * The round-trip case is the one that matters most: export then import must yield the
 * draft that was exported, or the format quietly loses somebody's guidance. The rest are
 * the ways a file can be wrong — a version this build cannot read, a content type it does
 * not know, a field past its bound — each asserted to name the field that failed, because
 * a file is often hand-edited and "invalid" alone is not actionable.
 */

/** A valid envelope, as the export route writes one. */
function envelope(overrides: Record<string, unknown> = {}): unknown {
  return {
    ...toPersonaEnvelope(storedPersonaFixture()),
    ...overrides,
  };
}

function fieldMessages(
  value: unknown,
): Readonly<Record<string, readonly string[]>> {
  try {
    parseInput(personaEnvelopeSchema, value);
  } catch (error) {
    if (isDomainError(error)) {
      return error.fieldMessages();
    }
    throw error;
  }

  throw new Error("The envelope was accepted, but a rejection was expected.");
}

describe("toPersonaEnvelope", () => {
  it("carries the wording and the archetype", () => {
    const persona = storedPersonaFixture();

    expect(toPersonaEnvelope(persona)).toEqual({
      [PERSONA_ENVELOPE_KEY]: PERSONA_ENVELOPE_VERSION,
      archetype: "TECHNICAL",
      label: persona.label,
      role: persona.role,
      guidance: persona.guidance,
      cardGuidance: persona.cardGuidance,
      prohibitions: persona.prohibitions,
      defaultQuestionTypes: persona.defaultQuestionTypes,
      defaultCardTypes: persona.defaultCardTypes,
      languageInstruction: persona.languageInstruction,
      contentLanguage: persona.contentLanguage,
    });
  });

  it.each(["id", "personaKey", "version", "createdAt", "updatedAt"])(
    "leaves %s out, so an import mints its own identity",
    (field) => {
      // The design of the format: a file is a draft, not a persona. Carrying the key
      // across would give two personas the same provenance.
      expect(toPersonaEnvelope(storedPersonaFixture())).not.toHaveProperty(
        field,
      );
    },
  );
});

describe("personaExportFilename", () => {
  it("names the file after the persona key", () => {
    expect(personaExportFilename("aws-associate-level")).toBe(
      "aws-associate-level.persona.json",
    );
  });

  it.each([
    ['bad"; filename="evil', "bad-filename-evil.persona.json"],
    ["with\r\nnewline", "with-newline.persona.json"],
    ["../../etc/passwd", "etc-passwd.persona.json"],
    ["", "persona.persona.json"],
    ["漢字", "persona.persona.json"],
  ])("filters %j out of a header value, giving %j", (personaKey, expected) => {
    // The value lands in `Content-Disposition`; a quote or a newline there would be a
    // header-injection primitive rather than an odd filename.
    const filename = personaExportFilename(personaKey);

    expect(filename).toBe(expected);
    expect(filename).toMatch(/^[a-z0-9.-]+$/);
  });
});

describe("personaEnvelopeSchema", () => {
  it("accepts an exported persona", () => {
    const parsed = parseInput(personaEnvelopeSchema, envelope());

    expect(parsed.label).toBe("AWS associate level");
    expect(parsed.archetype).toBe("TECHNICAL");
  });

  it("guarantees a round trip: export then import is the same draft", () => {
    // The property the format exists for. A file that lost a guidance line, reordered a
    // type list, or dropped the content language would still import "successfully".
    const persona = storedPersonaFixture({
      archetype: "LANGUAGE",
      guidance: ["One.", "Two.", "Three."],
      defaultQuestionTypes: ["SINGLE_CHOICE", "SHORT_ANSWER"],
      defaultCardTypes: ["VOCABULARY", "CLOZE"],
      contentLanguage: "ja",
    });
    const serialized = JSON.stringify(toPersonaEnvelope(persona), null, 2);
    const imported = toImportedPersona(
      parseInput(personaEnvelopeSchema, JSON.parse(serialized)),
    );

    expect(imported.archetype).toBe(persona.archetype);
    expect(imported.draft).toEqual({
      label: persona.label,
      role: persona.role,
      guidance: persona.guidance,
      cardGuidance: persona.cardGuidance,
      prohibitions: persona.prohibitions,
      defaultQuestionTypes: persona.defaultQuestionTypes,
      defaultCardTypes: persona.defaultCardTypes,
      languageInstruction: persona.languageInstruction,
      contentLanguage: persona.contentLanguage,
    });
  });

  it("produces exactly the shape the create form prefills from", () => {
    // Not a separate write path: the imported draft is what a template's draft is, so it
    // reaches `PersonaForm` and `createFromTemplate` unchanged.
    const template = toImportedPersona(
      parseInput(personaEnvelopeSchema, envelope()),
    );

    expect(Object.keys(template.draft).sort()).toEqual(
      [
        "cardGuidance",
        "contentLanguage",
        "defaultCardTypes",
        "defaultQuestionTypes",
        "guidance",
        "label",
        "languageInstruction",
        "prohibitions",
        "role",
      ].sort(),
    );
  });

  describe("the version marker", () => {
    it("refuses a file with no marker at all", () => {
      const withoutMarker: Record<string, unknown> = {
        ...(envelope() as Record<string, unknown>),
      };

      delete withoutMarker[PERSONA_ENVELOPE_KEY];

      expect(fieldMessages(withoutMarker)[PERSONA_ENVELOPE_KEY]?.[0]).toContain(
        "not a StudyBench persona",
      );
    });

    it("refuses a newer format rather than reading half of it", () => {
      // The whole reason the marker is there. A silent partial read is the failure a
      // format version prevents.
      const messages = fieldMessages(
        envelope({ [PERSONA_ENVELOPE_KEY]: PERSONA_ENVELOPE_VERSION + 1 }),
      );

      expect(messages[PERSONA_ENVELOPE_KEY]?.[0]).toContain("cannot read");
    });

    it.each([0, "1", null, true])("refuses the marker %j", (version) => {
      expect(
        fieldMessages(envelope({ [PERSONA_ENVELOPE_KEY]: version })),
      ).toHaveProperty(PERSONA_ENVELOPE_KEY);
    });
  });

  describe("the enum fields", () => {
    it("refuses an unknown question type, naming it", () => {
      // Strict rather than filtering, unlike the form's checkbox group: an unknown value
      // in a *file* means the file is for another version, and dropping it would import a
      // persona that generates the wrong content types.
      const messages = fieldMessages(
        envelope({ defaultQuestionTypes: ["SINGLE_CHOICE", "ESSAY"] }),
      );

      expect(messages["defaultQuestionTypes"]?.[0]).toContain("ESSAY");
    });

    it("refuses an unknown card type", () => {
      expect(
        fieldMessages(envelope({ defaultCardTypes: ["FLIPBOOK"] })),
      ).toHaveProperty("defaultCardTypes");
    });

    it("refuses an empty type list", () => {
      expect(
        fieldMessages(envelope({ defaultQuestionTypes: [] })),
      ).toHaveProperty("defaultQuestionTypes");
    });

    it("refuses an unknown archetype", () => {
      expect(fieldMessages(envelope({ archetype: "MUSICAL" }))).toHaveProperty(
        "archetype",
      );
    });

    it("drops a duplicated type rather than storing it twice", () => {
      const parsed = parseInput(
        personaEnvelopeSchema,
        envelope({ defaultCardTypes: ["BASIC", "BASIC", "SCENARIO"] }),
      );

      expect(parsed.defaultCardTypes).toEqual(["BASIC", "SCENARIO"]);
    });
  });

  describe("the bounds", () => {
    it("refuses an oversized role, on the role field", () => {
      const messages = fieldMessages(envelope({ role: "x".repeat(2001) }));

      expect(messages["role"]?.[0]).toContain("2000 characters or fewer");
    });

    it("refuses an oversized label", () => {
      expect(
        fieldMessages(envelope({ label: "x".repeat(121) })),
      ).toHaveProperty("label");
    });

    it("refuses a guidance entry past the per-entry limit", () => {
      expect(
        fieldMessages(envelope({ guidance: ["fine", "y".repeat(501)] })),
      ).toHaveProperty("guidance");
    });

    it("refuses more guidance entries than the cap", () => {
      const messages = fieldMessages(
        envelope({
          guidance: Array.from({ length: 26 }, (_, index) => `line ${index}`),
        }),
      );

      expect(messages["guidance"]?.[0]).toContain("25 entries or fewer");
    });

    it("refuses an empty guidance list", () => {
      // A persona with no guidance is an instruction to the model to do what it likes.
      expect(fieldMessages(envelope({ guidance: [] }))).toHaveProperty(
        "guidance",
      );
    });

    it("refuses an oversized content language", () => {
      expect(
        fieldMessages(envelope({ contentLanguage: "x".repeat(21) })),
      ).toHaveProperty("contentLanguage");
    });

    it("bounds the whole file well above every field at its limit", () => {
      // The file bound is a memory guard, not a content rule: it must not be reachable by
      // a persona the form would accept.
      const largest = JSON.stringify(
        envelope({
          role: "x".repeat(2000),
          guidance: Array.from({ length: 25 }, () => "y".repeat(500)),
          cardGuidance: Array.from({ length: 25 }, () => "y".repeat(500)),
          prohibitions: Array.from({ length: 25 }, () => "y".repeat(500)),
        }),
      );

      expect(largest.length).toBeLessThan(MAX_PERSONA_FILE_BYTES);
    });
  });

  describe("tolerance where it costs nothing", () => {
    it("trims text and drops blank list entries", () => {
      const parsed = parseInput(
        personaEnvelopeSchema,
        envelope({ label: "  Spaced  ", guidance: ["  kept  ", "", "   "] }),
      );

      expect(parsed.label).toBe("Spaced");
      expect(parsed.guidance).toEqual(["kept"]);
    });

    it("treats a missing or null content language as none", () => {
      const withoutLanguage: Record<string, unknown> = {
        ...(envelope() as Record<string, unknown>),
      };

      delete withoutLanguage.contentLanguage;

      expect(
        parseInput(personaEnvelopeSchema, withoutLanguage).contentLanguage,
      ).toBeNull();
      expect(
        parseInput(personaEnvelopeSchema, envelope({ contentLanguage: null }))
          .contentLanguage,
      ).toBeNull();
    });

    it("ignores an unknown key, so a newer field does not break a readable file", () => {
      expect(() =>
        parseInput(
          personaEnvelopeSchema,
          envelope({ favouriteColour: "blue" }),
        ),
      ).not.toThrow();
    });

    it("refuses a file that is not an object at all", () => {
      for (const value of [null, 42, "text", []]) {
        expect(() => parseInput(personaEnvelopeSchema, value)).toThrow(
          ValidationError,
        );
      }
    });
  });
});
