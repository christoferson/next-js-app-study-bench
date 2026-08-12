import { describe, expect, it } from "vitest";
import {
  multipleResponseContent,
  shortAnswerContent,
  singleChoiceContent,
} from "@/modules/question-bank/infrastructure/test-support";
import {
  basicContent,
  clozeContent,
  vocabularyContent,
} from "@/modules/flashcards/infrastructure/test-support";
import type {
  GeneratedFlashcardDraft,
  GeneratedQuestionDraft,
} from "./generated-draft";
import {
  checkFlashcardDrafts,
  checkQuestionDrafts,
} from "./deterministic-checks";
import type { CheckContext } from "./deterministic-checks";

/**
 * Every rule in `SPEC.md` section 11.3, one test each.
 *
 * These are the checks that stand between a model's answer and the owner's bank, so
 * each is pinned by a draft that fails only that rule: a test that trips several
 * rules at once would keep passing after one of them was deleted.
 */

const CONTEXT: CheckContext = { objectiveIds: ["objective-1", "objective-2"] };

function questionDraft(
  overrides: Partial<GeneratedQuestionDraft> = {},
): GeneratedQuestionDraft {
  return {
    stem: "Which demo service stores fictional objects for this demo track?",
    instructions: null,
    questionType: "SINGLE_CHOICE",
    content: singleChoiceContent(),
    explanation: "Because this demo says so.",
    difficulty: 3,
    tags: ["demo"],
    language: null,
    objectiveIds: [],
    ...overrides,
  };
}

function flashcardDraft(
  overrides: Partial<GeneratedFlashcardDraft> = {},
): GeneratedFlashcardDraft {
  return {
    cardType: "VOCABULARY",
    content: vocabularyContent(),
    notes: null,
    tags: ["demo"],
    language: "zh",
    objectiveIds: [],
    ...overrides,
  };
}

/** The single reason a one-draft batch was refused. */
function refusal(draft: GeneratedQuestionDraft): string {
  const { accepted, rejected } = checkQuestionDrafts([draft], CONTEXT);

  expect(accepted).toHaveLength(0);
  expect(rejected).toHaveLength(1);

  return rejected[0]?.reason ?? "";
}

function cardRefusal(draft: GeneratedFlashcardDraft): string {
  const { accepted, rejected } = checkFlashcardDrafts([draft], CONTEXT);

  expect(accepted).toHaveLength(0);
  expect(rejected).toHaveLength(1);

  return rejected[0]?.reason ?? "";
}

describe("checkQuestionDrafts", () => {
  it("accepts a well-formed draft of each question type", () => {
    const drafts = [
      questionDraft(),
      questionDraft({
        questionType: "MULTIPLE_RESPONSE",
        content: multipleResponseContent(),
      }),
      questionDraft({
        questionType: "SHORT_ANSWER",
        content: shortAnswerContent(),
      }),
    ];

    const result = checkQuestionDrafts(drafts, CONTEXT);

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(3);
  });

  it("keeps the good drafts when one is unusable", () => {
    const result = checkQuestionDrafts(
      [questionDraft(), questionDraft({ stem: "   " }), questionDraft()],
      CONTEXT,
    );

    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);
  });

  it("numbers a rejection by its position in the model's answer", () => {
    const result = checkQuestionDrafts(
      [questionDraft(), questionDraft({ stem: "too short" })],
      CONTEXT,
    );

    expect(result.rejected[0]?.position).toBe(2);
  });

  it("refuses a draft with no question text", () => {
    expect(refusal(questionDraft({ stem: "  \n " }))).toMatch(/no text/i);
  });

  it("refuses a question too short to be answerable", () => {
    expect(refusal(questionDraft({ stem: "Why?" }))).toMatch(/too short/i);
  });

  it("refuses an unrecognised question type", () => {
    const draft = questionDraft({
      questionType: "DRAG_AND_DROP" as GeneratedQuestionDraft["questionType"],
    });

    expect(refusal(draft)).toMatch(/unrecognised question type/i);
  });

  it("refuses content that disagrees with the declared type", () => {
    const draft = questionDraft({
      questionType: "MULTIPLE_RESPONSE",
      content: singleChoiceContent(),
    });

    expect(refusal(draft)).toMatch(/says it is MULTIPLE_RESPONSE/);
  });

  it("refuses a choice question with too few choices", () => {
    const draft = questionDraft({
      content: {
        type: "SINGLE_CHOICE",
        choices: [{ id: "choice-1", text: "The only demo option" }],
        correctChoiceId: "choice-1",
      },
    });

    expect(refusal(draft)).toMatch(/at least 2 choices/i);
  });

  it("refuses a choice question with too many choices", () => {
    const choices = Array.from({ length: 9 }, (_unused, index) => ({
      id: `choice-${index + 1}`,
      text: `Demo option ${index + 1}`,
    }));
    const draft = questionDraft({
      content: { type: "SINGLE_CHOICE", choices, correctChoiceId: "choice-1" },
    });

    expect(refusal(draft)).toMatch(/at most/i);
  });

  it("refuses two choices sharing an identifier", () => {
    const draft = questionDraft({
      content: {
        type: "SINGLE_CHOICE",
        choices: [
          { id: "choice-1", text: "Demo option A" },
          { id: "choice-1", text: "Demo option B" },
        ],
        correctChoiceId: "choice-1",
      },
    });

    expect(refusal(draft)).toMatch(/same identifier/i);
  });

  it("refuses two choices with the same text, ignoring case and spacing", () => {
    const draft = questionDraft({
      content: {
        type: "SINGLE_CHOICE",
        choices: [
          { id: "choice-1", text: "Demo  option A" },
          { id: "choice-2", text: "demo option a" },
        ],
        correctChoiceId: "choice-1",
      },
    });

    expect(refusal(draft)).toMatch(/same text/i);
  });

  it("refuses an answer that names a choice which does not exist", () => {
    const draft = questionDraft({
      content: {
        type: "SINGLE_CHOICE",
        choices: [
          { id: "choice-1", text: "Demo option A" },
          { id: "choice-2", text: "Demo option B" },
        ],
        correctChoiceId: "choice-9",
      },
    });

    expect(refusal(draft)).toMatch(/choice/i);
  });

  it("refuses a multiple-response question with a single answer", () => {
    const draft = questionDraft({
      questionType: "MULTIPLE_RESPONSE",
      content: {
        type: "MULTIPLE_RESPONSE",
        choices: [
          { id: "choice-1", text: "Demo option A" },
          { id: "choice-2", text: "Demo option B" },
          { id: "choice-3", text: "Demo option C" },
        ],
        correctChoiceIds: ["choice-1"],
      },
    });

    expect(refusal(draft)).toMatch(/at least two correct answers/i);
  });

  it("refuses a multiple-response question where every choice is correct", () => {
    const draft = questionDraft({
      questionType: "MULTIPLE_RESPONSE",
      content: {
        type: "MULTIPLE_RESPONSE",
        choices: [
          { id: "choice-1", text: "Demo option A" },
          { id: "choice-2", text: "Demo option B" },
        ],
        correctChoiceIds: ["choice-1", "choice-2"],
      },
    });

    expect(refusal(draft)).toMatch(/tests nothing/i);
  });

  it("refuses a difficulty outside the scale", () => {
    expect(refusal(questionDraft({ difficulty: 9 }))).toMatch(/difficulty/i);
    expect(refusal(questionDraft({ difficulty: 0 }))).toMatch(/difficulty/i);
    expect(refusal(questionDraft({ difficulty: 2.5 }))).toMatch(/difficulty/i);
  });

  it("accepts a draft with no difficulty", () => {
    const result = checkQuestionDrafts(
      [questionDraft({ difficulty: null })],
      CONTEXT,
    );

    expect(result.rejected).toEqual([]);
  });

  it("refuses an objective that does not exist in the track", () => {
    const draft = questionDraft({ objectiveIds: ["objective-9"] });

    expect(refusal(draft)).toMatch(/do not exist in this track/i);
  });

  it("refuses the same objective claimed twice", () => {
    const draft = questionDraft({
      objectiveIds: ["objective-1", "objective-1"],
    });

    expect(refusal(draft)).toMatch(/same objective twice/i);
  });

  it("accepts objectives that exist", () => {
    const result = checkQuestionDrafts(
      [questionDraft({ objectiveIds: ["objective-1", "objective-2"] })],
      CONTEXT,
    );

    expect(result.rejected).toEqual([]);
  });

  it.each([
    ["stem", { stem: "This is an actual exam question about demo storage." }],
    ["instructions", { instructions: "Verbatim from the exam." }],
    ["explanation", { explanation: "Taken from the real exam." }],
    [
      "a choice",
      {
        content: {
          type: "SINGLE_CHOICE" as const,
          choices: [
            { id: "choice-1", text: "An official AWS question says so" },
            { id: "choice-2", text: "Demo option B" },
          ],
          correctChoiceId: "choice-1",
        },
      },
    ],
  ])("refuses an official claim in the %s", (_field, overrides) => {
    expect(refusal(questionDraft(overrides))).toMatch(/official or real/i);
  });

  it.each([
    "https://docs.example.com/demo",
    "source: the demo handbook",
    "doi:10.1000/demo",
  ])("refuses the citation-shaped tag %s", (tag) => {
    expect(refusal(questionDraft({ tags: ["demo", tag] }))).toMatch(
      /cites a source/i,
    );
  });

  it("accepts ordinary tags", () => {
    const result = checkQuestionDrafts(
      [questionDraft({ tags: ["demo", "storage", "s3"] })],
      CONTEXT,
    );

    expect(result.rejected).toEqual([]);
  });
});

describe("checkFlashcardDrafts", () => {
  it("accepts a well-formed card", () => {
    const result = checkFlashcardDrafts([flashcardDraft()], CONTEXT);

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(1);
  });

  it("refuses an unrecognised card type", () => {
    const draft = flashcardDraft({
      cardType: "AUDIO" as GeneratedFlashcardDraft["cardType"],
    });

    expect(cardRefusal(draft)).toMatch(/unrecognised card type/i);
  });

  it("refuses content that disagrees with the declared type", () => {
    const draft = flashcardDraft({
      cardType: "BASIC",
      content: clozeContent(),
    });

    expect(cardRefusal(draft)).toMatch(/says it is BASIC/);
  });

  it("refuses content the flashcard domain itself rejects", () => {
    const draft = flashcardDraft({
      cardType: "CLOZE",
      content: { type: "CLOZE", text: "This sentence has no blank at all." },
    });

    expect(cardRefusal(draft).length).toBeGreaterThan(0);
  });

  it("refuses an objective that does not exist in the track", () => {
    const draft = flashcardDraft({ objectiveIds: ["objective-9"] });

    expect(cardRefusal(draft)).toMatch(/do not exist in this track/i);
  });

  it("refuses an official claim in a card's own text", () => {
    const draft = flashcardDraft({
      cardType: "BASIC",
      content: {
        type: "BASIC",
        front: "What is this?",
        back: "A real exam question, apparently.",
      },
    });

    expect(cardRefusal(draft)).toMatch(/official or real/i);
  });

  it("refuses an official claim in a card's notes", () => {
    const draft = flashcardDraft({
      cardType: "BASIC",
      content: basicContent(),
      notes: "Copied verbatim from the exam.",
    });

    expect(cardRefusal(draft)).toMatch(/official or real/i);
  });

  it("refuses a citation-shaped tag", () => {
    const draft = flashcardDraft({ tags: ["https://example.com/hsk"] });

    expect(cardRefusal(draft)).toMatch(/cites a source/i);
  });

  it("keeps the good cards when one is unusable", () => {
    const result = checkFlashcardDrafts(
      [
        flashcardDraft(),
        flashcardDraft({ objectiveIds: ["objective-9"] }),
        flashcardDraft(),
      ],
      CONTEXT,
    );

    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toEqual([
      { position: 2, reason: expect.stringMatching(/do not exist/i) },
    ]);
  });
});
