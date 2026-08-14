import type { GenerationRun } from "@/modules/ai-generation/domain/generation-run";
import type { FakeGatewayResponse } from "./fake-language-model-gateway";

/**
 * Deterministic fixtures for generation tests.
 *
 * The clock, ID generator, and migrated in-memory database helpers are shared with
 * the certifications module
 * (`@/modules/certifications/infrastructure/test-support`); only the generation
 * shapes and the scripted provider payloads are defined here.
 *
 * The payload builders below produce the *provider's* answer shape — the object a
 * model would put in its tool call — not domain drafts. They are written by hand
 * rather than derived from the domain types on purpose: a fixture built from the
 * types would follow the schema wherever it went, and these tests exist to catch a
 * schema that changed without the prompt changing with it.
 */

export const FIXTURE_TIME = "2026-01-01T00:00:00.000Z";

export function generationRunFixture(
  overrides: Partial<GenerationRun> = {},
): GenerationRun {
  return {
    id: "run-1",
    certificationId: "certification-1",
    itemKind: "QUESTION",
    generationMode: "MODEL_KNOWLEDGE",
    modelProvider: "fake",
    modelId: "fake-deterministic",
    personaId: "technical-certification",
    personaVersion: 1,
    promptTemplateId: "question-model-knowledge",
    promptTemplateVersion: 1,
    inputHash: "a".repeat(64),
    selectedSourceSnapshotIds: [],
    requestedItemCount: 2,
    successfulItemCount: 0,
    failedItemCount: 0,
    usageMetadata: null,
    failureReason: null,
    startedAt: FIXTURE_TIME,
    completedAt: null,
    status: "PENDING",
    ...overrides,
  };
}

/** One well-formed single-choice question, as a provider would answer. */
export function questionPayloadItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    questionType: "SINGLE_CHOICE",
    stem: "A demo workload stores fictional objects. Which demo option fits?",
    instructions: null,
    choices: [
      "Demo option A — the fictional answer",
      "Demo option B — a wrong demo option",
      "Demo option C — another wrong demo option",
    ],
    correctChoiceIndexes: [0],
    expectedConcepts: [],
    explanation: "Demo option A is correct because this demo says so.",
    difficulty: 3,
    tags: ["demo"],
    objectiveIds: [],
    ...overrides,
  };
}

/** One well-formed vocabulary card, as a provider would answer. */
export function flashcardPayloadItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    cardType: "VOCABULARY",
    term: "学习",
    reading: "xuéxí",
    meaning: "to study; to learn",
    exampleSentence: "我每天学习汉语。",
    notes: null,
    tags: ["demo"],
    objectiveIds: [],
    ...overrides,
  };
}

/**
 * One well-formed enrichment entry, as a provider would answer.
 *
 * `term` defaults to the word the flashcard fixtures use, because the term is the
 * join key: an entry whose term matches no card in the run is rejected, so a test
 * that wants a *matching* answer must echo the card's own word back.
 */
export function enrichmentPayloadItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const term = typeof overrides.term === "string" ? overrides.term : "学习";

  return {
    term,
    meanings: ["to study", "to learn as a discipline"],
    synonyms: ["念书"],
    antonyms: [],
    examples: [
      {
        text: `我每天${term}。`,
        reading: "wǒ měi tiān xuéxí.",
        translation: "I study every day.",
      },
      {
        text: `${term}很重要。`,
        reading: "xuéxí hěn zhòngyào.",
        translation: "Studying is important.",
      },
    ],
    usageNotes: "Neutral register; used as both verb and noun.",
    ...overrides,
  };
}

export function enrichmentPayload(
  items: readonly Record<string, unknown>[],
): FakeGatewayResponse {
  return { payload: { words: items } };
}

/** A scripted turn returning `count` well-formed questions. */
export function questionPayload(
  items: readonly Record<string, unknown>[],
): FakeGatewayResponse {
  return { payload: { questions: items } };
}

export function flashcardPayload(
  items: readonly Record<string, unknown>[],
): FakeGatewayResponse {
  return { payload: { flashcards: items } };
}

/**
 * A scripted turn the validator will reject outright.
 *
 * Shape-level nonsense rather than a subtly wrong item: this drives the *repair*
 * path, which is about a response that failed schema validation, not about an item
 * that failed a deterministic check.
 */
export function malformedPayload(): FakeGatewayResponse {
  return { payload: { questions: "not an array" } };
}
