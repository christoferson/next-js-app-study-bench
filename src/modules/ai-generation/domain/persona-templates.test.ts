import { describe, expect, it } from "vitest";
import { QUESTION_TYPES } from "@/modules/question-bank/domain/question";
import { CARD_TYPES } from "@/modules/flashcards/domain/flashcard";
import {
  PERSONA_TEMPLATES,
  PERSONA_TEMPLATE_KEYS,
  findPersonaTemplate,
  genericTemplateForArchetype,
} from "./persona-templates";
import { PERSONA_ARCHETYPES } from "./stored-persona";

/**
 * The curated templates.
 *
 * A template's prose is a judgement call and not something a test should pin, so what
 * is asserted here is the two things that would silently break the feature: a template
 * that is incomplete — one empty field is a persona that instructs the model to do
 * whatever it likes — and a template that is another template with the nouns swapped,
 * which is the failure mode of writing six of them in one sitting.
 */

describe("persona templates", () => {
  it("offers six starting points", () => {
    expect(PERSONA_TEMPLATES).toHaveLength(6);
  });

  it("uses a unique key for each", () => {
    expect(new Set(PERSONA_TEMPLATE_KEYS).size).toBe(PERSONA_TEMPLATES.length);
  });

  it("covers both archetypes", () => {
    const archetypes = new Set(
      PERSONA_TEMPLATES.map((template) => template.archetype),
    );

    expect([...archetypes].sort()).toEqual([...PERSONA_ARCHETYPES].sort());
  });

  it.each(
    PERSONA_TEMPLATES.map((template) => [template.key, template] as const),
  )("%s is complete", (_key, template) => {
    expect(template.summary.length).toBeGreaterThan(0);
    expect(template.draft.label.length).toBeGreaterThan(0);
    expect(template.draft.role.length).toBeGreaterThan(0);
    expect(template.draft.languageInstruction.length).toBeGreaterThan(0);
    // Five guidelines is the floor a usable persona needs; three is enough for the
    // shorter lists.
    expect(template.draft.guidance.length).toBeGreaterThanOrEqual(5);
    expect(template.draft.cardGuidance.length).toBeGreaterThanOrEqual(3);
    expect(template.draft.prohibitions.length).toBeGreaterThanOrEqual(3);
    expect(template.draft.defaultQuestionTypes.length).toBeGreaterThan(0);
    expect(template.draft.defaultCardTypes.length).toBeGreaterThan(0);

    for (const line of [
      ...template.draft.guidance,
      ...template.draft.cardGuidance,
      ...template.draft.prohibitions,
    ]) {
      expect(line.trim()).toBe(line);
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it.each(
    PERSONA_TEMPLATES.map((template) => [template.key, template] as const),
  )("%s names only content types the domain has", (_key, template) => {
    for (const type of template.draft.defaultQuestionTypes) {
      expect(QUESTION_TYPES).toContain(type);
    }
    for (const type of template.draft.defaultCardTypes) {
      expect(CARD_TYPES).toContain(type);
    }
  });

  it("keeps every prohibition list free of an empty entry", () => {
    // A blank prohibition would reach the prompt as a stray blank line.
    for (const template of PERSONA_TEMPLATES) {
      expect(template.draft.prohibitions.every((line) => line.length > 3)).toBe(
        true,
      );
    }
  });

  it("distinguishes the associate and professional AWS templates", () => {
    // The reason there are two: they must differ in what they ask the model for, not
    // in their names.
    const associate = findPersonaTemplate("aws-associate");
    const professional = findPersonaTemplate("aws-professional");

    expect(associate).not.toBeNull();
    expect(professional).not.toBeNull();
    expect(associate?.draft.guidance).not.toEqual(professional?.draft.guidance);
    expect(associate?.draft.role).not.toEqual(professional?.draft.role);
    // The professional one is about choosing between workable options.
    expect(professional?.draft.guidance.join(" ")).toMatch(/tradeoff/i);
    // The associate one deliberately stays away from that.
    expect(associate?.draft.guidance.join(" ")).not.toMatch(/tradeoff/i);
  });

  it("writes the JLPT template in Japanese terms, with no Chinese vocabulary", () => {
    // The failure this guards against is a search-and-replace of the HSK template:
    // pinyin, hanzi, and HSK levels have no place in Japanese material, and a
    // persona that mentioned them would teach the model to invent them.
    const jlpt = findPersonaTemplate("jlpt-japanese");
    const text = [
      jlpt?.draft.role ?? "",
      ...(jlpt?.draft.guidance ?? []),
      ...(jlpt?.draft.cardGuidance ?? []),
      ...(jlpt?.draft.prohibitions ?? []),
      jlpt?.draft.languageInstruction ?? "",
    ].join(" ");

    expect(jlpt?.archetype).toBe("LANGUAGE");
    expect(jlpt?.draft.contentLanguage).toBe("ja");
    // "no pinyin" is stated once, as a prohibition; nothing else may name it.
    expect(jlpt?.draft.guidance.join(" ")).not.toMatch(/pinyin/i);
    expect(jlpt?.draft.guidance.join(" ")).not.toMatch(/hanzi|mandarin|hsk/i);
    expect(text).toMatch(/kanji/i);
    expect(text).toMatch(/hiragana/i);
    expect(text).toMatch(/N5/);
  });

  it("keeps the HSK template Chinese", () => {
    const hsk = findPersonaTemplate("hsk-chinese");

    expect(hsk?.draft.contentLanguage).toBe("zh");
    expect(hsk?.draft.guidance.join(" ")).toMatch(/pinyin/i);
    expect(hsk?.draft.guidance.join(" ")).not.toMatch(/kanji|hiragana/i);
  });

  it("leaves the generic language template's language unnamed", () => {
    // Its whole purpose: the owner names the language once, rather than deleting
    // another language's specifics.
    const generic = findPersonaTemplate("generic-language");
    const text = [
      generic?.draft.role ?? "",
      ...(generic?.draft.guidance ?? []),
    ].join(" ");

    expect(generic?.draft.contentLanguage).toBeNull();
    expect(text).not.toMatch(/chinese|japanese|pinyin|kanji|hsk|jlpt/i);
    expect(text).toMatch(/target language/i);
  });

  it("gives the import flow the generic template for each archetype", () => {
    // An imported persona is created from the generic starting point with every editable
    // field overridden, so what the template supplies is only the archetype. Anything
    // subject-specific would leave AWS prose behind a JLPT persona.
    expect(genericTemplateForArchetype("TECHNICAL").key).toBe(
      "generic-technical",
    );
    expect(genericTemplateForArchetype("LANGUAGE").key).toBe(
      "generic-language",
    );
    expect(genericTemplateForArchetype("TECHNICAL").archetype).toBe(
      "TECHNICAL",
    );
    expect(genericTemplateForArchetype("LANGUAGE").archetype).toBe("LANGUAGE");
  });

  it("finds a template by key and reports nothing for an unknown one", () => {
    expect(findPersonaTemplate("hsk-chinese")?.key).toBe("hsk-chinese");
    expect(findPersonaTemplate("nope")).toBeNull();
  });
});
