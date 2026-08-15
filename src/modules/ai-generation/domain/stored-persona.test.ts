import { describe, expect, it } from "vitest";
import {
  PERSONA_ARCHETYPES,
  PERSONA_KEY_FALLBACK,
  describePersonaArchetype,
  personaKeyFromLabel,
  personaKeyWithSuffix,
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
