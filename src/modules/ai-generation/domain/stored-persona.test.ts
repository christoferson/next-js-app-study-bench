import { describe, expect, it } from "vitest";
import { STUDY_TYPES } from "@/modules/certifications/domain/certification";
import { storedPersonaFixture } from "@/modules/ai-generation/infrastructure/persona-test-support";
import { personaIdForStudyType } from "./personas";
import {
  PERSONA_ARCHETYPES,
  PERSONA_KEY_FALLBACK,
  describePersonaArchetype,
  personaArchetypeForStudyType,
  personaKeyFromLabel,
  personaKeyWithSuffix,
  personaSuitsStudyType,
  storedPersonaToPersona,
} from "./stored-persona";

describe("personaKeyFromLabel", () => {
  it("produces a hyphenated key from a label", () => {
    expect(personaKeyFromLabel("AWS Professional Level")).toBe(
      "aws-professional-level",
    );
  });

  it("collapses punctuation and trims separators", () => {
    expect(personaKeyFromLabel("  ...HSK Chinese — (v2)!  ")).toBe(
      "hsk-chinese-v2",
    );
  });

  it("falls back when no key characters survive", () => {
    // A label written entirely in non-Latin script is a perfectly good persona name.
    expect(personaKeyFromLabel("汉语水平考试")).toBe(PERSONA_KEY_FALLBACK);
    expect(personaKeyFromLabel("!!!")).toBe(PERSONA_KEY_FALLBACK);
  });

  it("bounds the length without leaving a trailing hyphen", () => {
    const key = personaKeyFromLabel(`${"a".repeat(60)} ${"b".repeat(60)}`);

    expect(key.length).toBeLessThanOrEqual(80);
    expect(key.endsWith("-")).toBe(false);
  });

  it("is deterministic", () => {
    expect(personaKeyFromLabel("Repeatable")).toBe(
      personaKeyFromLabel("Repeatable"),
    );
  });
});

describe("personaKeyWithSuffix", () => {
  it("leaves the first attempt unsuffixed", () => {
    expect(personaKeyWithSuffix("hsk-chinese", 1)).toBe("hsk-chinese");
  });

  it("numbers later attempts", () => {
    expect(personaKeyWithSuffix("hsk-chinese", 3)).toBe("hsk-chinese-3");
  });
});

describe("describePersonaArchetype", () => {
  it("names every archetype", () => {
    for (const archetype of PERSONA_ARCHETYPES) {
      expect(describePersonaArchetype(archetype).length).toBeGreaterThan(0);
    }
  });
});

describe("personaArchetypeForStudyType", () => {
  it("decides an archetype for every study type", () => {
    for (const studyType of STUDY_TYPES) {
      expect(PERSONA_ARCHETYPES).toContain(
        personaArchetypeForStudyType(studyType),
      );
    }
  });

  it("agrees with the built-in registry about which kind of study each type is", () => {
    // The two mappings must not drift: `personaIdForStudyType` decides the automatic
    // persona and this decides which stored ones may be assigned, so a study type whose
    // built-in persona is the HSK one must accept language personas and no others.
    for (const studyType of STUDY_TYPES) {
      const builtInIsLanguage = personaIdForStudyType(studyType) === "hsk";

      expect(personaArchetypeForStudyType(studyType)).toBe(
        builtInIsLanguage ? "LANGUAGE" : "TECHNICAL",
      );
    }
  });
});

describe("personaSuitsStudyType", () => {
  it("accepts a matching archetype and refuses the other", () => {
    const technical = storedPersonaFixture({ archetype: "TECHNICAL" });
    const language = storedPersonaFixture({ archetype: "LANGUAGE" });

    expect(personaSuitsStudyType(technical, "TECHNICAL_CERTIFICATION")).toBe(
      true,
    );
    expect(personaSuitsStudyType(technical, "GENERAL")).toBe(true);
    expect(personaSuitsStudyType(technical, "LANGUAGE_PROFICIENCY")).toBe(
      false,
    );
    expect(personaSuitsStudyType(language, "LANGUAGE_PROFICIENCY")).toBe(true);
    expect(personaSuitsStudyType(language, "TECHNICAL_CERTIFICATION")).toBe(
      false,
    );
  });
});

describe("storedPersonaToPersona", () => {
  it("uses the stable key as the identifier, never the row id", () => {
    // What the adapter exists for: the identifier written onto every run must be the key,
    // because a uuid explains nothing and a label moves.
    const persona = storedPersonaFixture({
      id: "01J0000000000000000000",
      personaKey: "aws-associate-level",
      version: 4,
    });

    const effective = storedPersonaToPersona(persona);

    expect(effective.id).toBe("aws-associate-level");
    expect(effective.version).toBe(4);
  });

  it("carries every field the prompt reads across unchanged", () => {
    // Nothing added and nothing reworded, which is what keeps a stored persona's prompt
    // structurally identical to a built-in one's — and why no template version was bumped
    // for this change.
    const persona = storedPersonaFixture();
    const effective = storedPersonaToPersona(persona);

    expect(effective).toEqual({
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
    });
  });
});
