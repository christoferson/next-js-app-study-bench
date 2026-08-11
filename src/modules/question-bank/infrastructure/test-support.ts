import type {
  Question,
  QuestionContent,
  QuestionRevision,
} from "../domain/question";

/**
 * Deterministic question fixtures.
 *
 * The clock, ID generator, and migrated in-memory database helpers are shared
 * with the certifications module
 * (`@/modules/certifications/infrastructure/test-support`); only the aggregate
 * shapes are defined here.
 */

export const FIXTURE_TIME = "2026-01-01T00:00:00.000Z";

export function singleChoiceContent(): QuestionContent {
  return {
    type: "SINGLE_CHOICE",
    choices: [
      { id: "choice-1", text: "Amazon S3" },
      { id: "choice-2", text: "Amazon EBS" },
    ],
    correctChoiceId: "choice-1",
  };
}

export function multipleResponseContent(): QuestionContent {
  return {
    type: "MULTIPLE_RESPONSE",
    choices: [
      { id: "choice-1", text: "Durability" },
      { id: "choice-2", text: "Availability" },
      { id: "choice-3", text: "Colour" },
    ],
    correctChoiceIds: ["choice-1", "choice-2"],
  };
}

export function shortAnswerContent(): QuestionContent {
  return {
    type: "SHORT_ANSWER",
    expectedConcepts: ["object storage", "eleven nines"],
  };
}

export function questionFixture(overrides: Partial<Question> = {}): Question {
  return {
    id: "question-1",
    certificationId: "certification-1",
    currentRevisionId: "revision-1",
    lifecycleStatus: "DRAFT",
    qualityStatus: "UNREVIEWED",
    generationMode: "MANUAL",
    disputeReason: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    ...overrides,
  };
}

export function revisionFixture(
  overrides: Partial<QuestionRevision> = {},
): QuestionRevision {
  return {
    id: "revision-1",
    questionId: "question-1",
    revisionNumber: 1,
    stem: "Which service stores objects?",
    instructions: null,
    questionType: "SINGLE_CHOICE",
    content: singleChoiceContent(),
    explanation: null,
    difficulty: null,
    tags: [],
    language: null,
    createdAt: FIXTURE_TIME,
    ...overrides,
  };
}
