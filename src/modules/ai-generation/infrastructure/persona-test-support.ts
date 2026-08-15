import type { StoredPersona } from "@/modules/ai-generation/domain/stored-persona";

/**
 * Deterministic fixture for persona tests.
 *
 * Every list has more than one entry, so a test that serialises and reads back an array
 * cannot pass by accident on a single-element list.
 */
export function storedPersonaFixture(
  overrides: Partial<StoredPersona> = {},
): StoredPersona {
  return {
    id: "persona-1",
    personaKey: "aws-associate-level",
    archetype: "TECHNICAL",
    version: 1,
    label: "AWS associate level",
    role: "You are an AWS instructor writing associate-level practice questions.",
    guidance: ["Test one service at a time.", "Ask for the best next action."],
    cardGuidance: ["One recall prompt per card.", "The back is the answer."],
    prohibitions: ["Never claim an item is a real exam question."],
    defaultQuestionTypes: ["SINGLE_CHOICE", "MULTIPLE_RESPONSE"],
    defaultCardTypes: ["BASIC", "SCENARIO"],
    languageInstruction: "Write all content in English.",
    contentLanguage: "en",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
