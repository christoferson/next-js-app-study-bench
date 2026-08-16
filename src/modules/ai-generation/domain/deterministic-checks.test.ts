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
import { assertValidContent as assertValidCardContent } from "@/modules/flashcards/domain/flashcard-content";
import type { VocabularyContent } from "@/modules/flashcards/domain/flashcard-content";
import type {
  GeneratedFlashcardDraft,
  GeneratedQuestionDraft,
  VocabularyEnrichmentDraft,
  VocabularyEnrichmentTarget,
} from "./generated-draft";
import {
  MIN_ENRICHED_EXAMPLES,
  checkFlashcardDrafts,
  checkQuestionDrafts,
  matchEnrichments,
  mergeEnrichment,
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
    // Empty by default because most of this file is about model-knowledge drafts, which
    // cite nothing. The grounding tests override it.
    supportingChunkIndexes: [],
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

/**
 * Excerpt citations, per grounded mode.
 *
 * The `SPEC.md` section 11.3 rule "source IDs exist when provided", now that there is a
 * mode in which they are provided. The mode difference is the point of these tests: a
 * `SOURCE_GROUNDED` question must name an excerpt and a `HYBRID` one need not, and the
 * label is what the owner would trust.
 */
describe("excerpt citations", () => {
  /** The batch cited nothing because it was shown nothing. */
  const UNGROUNDED: CheckContext = { objectiveIds: [] };
  const GROUNDED: CheckContext = {
    objectiveIds: [],
    grounding: { mode: "SOURCE_GROUNDED", excerptCount: 3 },
  };
  const HYBRID: CheckContext = {
    objectiveIds: [],
    grounding: { mode: "HYBRID", excerptCount: 3 },
  };

  /** The single reason a one-draft batch was refused, under a given grounding. */
  function groundingRefusal(
    draft: GeneratedQuestionDraft,
    context: CheckContext,
  ): string {
    const { accepted, rejected } = checkQuestionDrafts([draft], context);

    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);

    return rejected[0]?.reason ?? "";
  }

  it("refuses a citation from a batch that was shown no excerpts", () => {
    // Absence of grounding is not the same as an empty excerpt list: a model-knowledge
    // batch cannot have a meaningful index, so a claimed one is a fabricated citation.
    expect(
      groundingRefusal(
        questionDraft({ supportingChunkIndexes: [1] }),
        UNGROUNDED,
      ),
    ).toMatch(/cites source excerpts, but this request sent none/i);
  });

  it("accepts an ungrounded draft that cites nothing", () => {
    const result = checkQuestionDrafts([questionDraft()], UNGROUNDED);

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(1);
  });

  it("refuses a grounded question that names no supporting excerpt", () => {
    // The mode's whole promise. A grounded question with no citation was written from
    // model knowledge with a source library in the room.
    expect(
      groundingRefusal(questionDraft({ supportingChunkIndexes: [] }), GROUNDED),
    ).toMatch(/names no supporting excerpt/i);
  });

  it("accepts a hybrid question that names no supporting excerpt", () => {
    // The mode difference, and the reason `mode` is not a boolean: naming no excerpt is
    // the honest answer for a question whose framing is genuinely the model's own.
    const result = checkQuestionDrafts(
      [questionDraft({ supportingChunkIndexes: [] })],
      HYBRID,
    );

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(1);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["past the count sent", 4],
  ])("refuses a %s excerpt index", (_shape, index) => {
    for (const context of [GROUNDED, HYBRID]) {
      expect(
        groundingRefusal(
          questionDraft({ supportingChunkIndexes: [index] }),
          context,
        ),
      ).toMatch(/which was not one of the 3 sent/i);
    }
  });

  it("discards the whole draft rather than dropping the bad index quietly", () => {
    // A question whose stated evidence does not exist is a question whose evidence is
    // unknown. An evidence panel built by narrowing the list would show the owner
    // support the model never claimed.
    const result = checkQuestionDrafts(
      [questionDraft({ supportingChunkIndexes: [1, 99] })],
      GROUNDED,
    );

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toMatch(/excerpt 99/);
  });

  it("accepts an in-range citation in either mode", () => {
    for (const context of [GROUNDED, HYBRID]) {
      const result = checkQuestionDrafts(
        [questionDraft({ supportingChunkIndexes: [1, 3] })],
        context,
      );

      expect(result.rejected).toEqual([]);
      expect(result.accepted).toHaveLength(1);
    }
  });

  it("keeps the grounded drafts when one cites nothing", () => {
    const result = checkQuestionDrafts(
      [
        questionDraft({ supportingChunkIndexes: [1] }),
        questionDraft({ supportingChunkIndexes: [] }),
        questionDraft({ supportingChunkIndexes: [2, 3] }),
      ],
      GROUNDED,
    );

    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toEqual([
      { position: 2, reason: expect.stringMatching(/no supporting excerpt/i) },
    ]);
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

/**
 * Enrichment fixtures.
 *
 * Synthetic words, so what is asserted below is the matching and merging rules and
 * not anyone's syllabus. The terms are single characters that are easy to embed in a
 * sentence, because several rules turn on whether an example contains its word.
 */
function target(
  overrides: Partial<VocabularyContent> = {},
  flashcardId = "card-1",
): VocabularyEnrichmentTarget {
  return {
    flashcardId,
    content: {
      type: "VOCABULARY",
      term: "甲",
      reading: "jiǎ",
      meaning: "the first demo word",
      exampleSentence: null,
      ...overrides,
    },
  };
}

function enrichment(
  overrides: Partial<VocabularyEnrichmentDraft> = {},
): VocabularyEnrichmentDraft {
  return {
    term: "甲",
    meanings: ["first sense", "second sense"],
    synonyms: ["乙"],
    antonyms: [],
    examples: [
      { text: "这是甲。", reading: "zhè shì jiǎ.", translation: "This is A." },
      { text: "甲很好。", reading: "jiǎ hěn hǎo.", translation: "A is good." },
    ],
    usageNotes: "Written register.",
    ...overrides,
  };
}

/** The single reason a one-answer batch was refused. */
function enrichmentRefusal(
  draft: VocabularyEnrichmentDraft,
  card = target(),
): string {
  const result = matchEnrichments([card], [draft]);

  expect(result.matched).toHaveLength(0);
  expect(result.rejected).toHaveLength(1);
  // A refused answer must leave its card reported as untouched, never silently
  // dropped: that count is what the run row shows the owner.
  expect(result.unmatched).toEqual([card]);

  return result.rejected[0]?.reason ?? "";
}

describe("matchEnrichments", () => {
  it("matches an answer to its card by the term it echoed back", () => {
    const cards = [target({}, "card-1"), target({ term: "乙" }, "card-2")];
    const result = matchEnrichments(cards, [
      enrichment({ term: "乙", examples: exampleFor("乙") }),
      enrichment({ term: "甲" }),
    ]);

    expect(result.rejected).toEqual([]);
    expect(result.unmatched).toEqual([]);
    // Order follows the model's answer, not the request, and each answer landed on
    // its own card rather than on the one at the same position.
    expect(result.matched.map((item) => item.target.flashcardId)).toEqual([
      "card-2",
      "card-1",
    ]);
  });

  it("rejects an answer for a word the run never asked about", () => {
    const result = matchEnrichments(
      [target()],
      [enrichment({ term: "丙", examples: exampleFor("丙") })],
    );

    expect(result.matched).toEqual([]);
    expect(result.rejected[0]?.reason).toMatch(/not one of the words/i);
    expect(result.unmatched).toHaveLength(1);
  });

  it("reports the card a drifting answer left behind", () => {
    const cards = [target({}, "card-1"), target({ term: "乙" }, "card-2")];
    const result = matchEnrichments(cards, [
      enrichment({ term: "甲" }),
      enrichment({ term: "丙", examples: exampleFor("丙") }),
    ]);

    expect(result.matched).toHaveLength(1);
    expect(result.unmatched.map((item) => item.flashcardId)).toEqual([
      "card-2",
    ]);
  });

  it("numbers a rejection by its position in the model's answer", () => {
    const result = matchEnrichments(
      [target()],
      [
        enrichment({ term: "丙", examples: exampleFor("丙") }),
        enrichment({ term: "丁", examples: exampleFor("丁") }),
      ],
    );

    expect(result.rejected.map((item) => item.position)).toEqual([1, 2]);
  });

  it("tolerates surrounding whitespace in the echoed term", () => {
    const result = matchEnrichments([target()], [enrichment({ term: " 甲 " })]);

    expect(result.matched).toHaveLength(1);
  });

  it("does not match a different character", () => {
    // Case-insensitive or normalising matching would be wrong for a language where
    // a differing character is a differing word.
    expect(
      matchEnrichments(
        [target({ term: "干" })],
        [enrichment({ term: "千", examples: exampleFor("千") })],
      ).matched,
    ).toEqual([]);
  });

  it("lets one card absorb only one answer", () => {
    const result = matchEnrichments(
      [target()],
      [enrichment(), enrichment({ meanings: ["a later sense"] })],
    );

    expect(result.matched).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.position).toBe(2);
  });

  it("returns every card unmatched when the model answered nothing", () => {
    const cards = [target({}, "card-1"), target({ term: "乙" }, "card-2")];

    expect(matchEnrichments(cards, []).unmatched).toEqual(cards);
  });

  it("refuses an answer with no meanings", () => {
    expect(enrichmentRefusal(enrichment({ meanings: [] }))).toMatch(
      /no meanings/i,
    );
  });

  it("refuses an answer with too few examples", () => {
    expect(
      enrichmentRefusal(enrichment({ examples: exampleFor("甲").slice(0, 1) })),
    ).toMatch(/fewer than 2 example/i);
    expect(MIN_ENRICHED_EXAMPLES).toBe(2);
  });

  it("refuses examples that never use the word", () => {
    const draft = enrichment({
      examples: [
        { text: "这是别的词。", reading: null, translation: null },
        { text: "还有一个句子。", reading: null, translation: null },
      ],
    });

    expect(enrichmentRefusal(draft)).toMatch(/No example sentence uses/i);
  });

  it("refuses an answer the flashcard domain would refuse", () => {
    // Nine meanings is past the domain's own list bound, so the merged card would
    // not be storable. Checked through the domain rather than restated here.
    const draft = enrichment({
      meanings: Array.from({ length: 9 }, (_unused, index) => `sense ${index}`),
    });

    expect(enrichmentRefusal(draft).length).toBeGreaterThan(0);
  });

  it("refuses an answer that claims official status", () => {
    const draft = enrichment({
      usageNotes: "This is an actual exam question about 甲.",
    });

    expect(enrichmentRefusal(draft)).toMatch(/official or real/i);
  });
});

/** Two examples that both contain the given word, so only the rule under test fails. */
function exampleFor(term: string): VocabularyEnrichmentDraft["examples"] {
  return [
    { text: `这是${term}。`, reading: null, translation: null },
    { text: `${term}很好。`, reading: null, translation: null },
  ];
}

describe("mergeEnrichment", () => {
  it("never replaces what the card already said", () => {
    const merged = mergeEnrichment(
      target({ exampleSentence: "甲是原来的句子。" }).content,
      enrichment(),
    );

    expect(merged.term).toBe("甲");
    expect(merged.reading).toBe("jiǎ");
    expect(merged.meaning).toBe("the first demo word");
    expect(merged.exampleSentence).toBe("甲是原来的句子。");
  });

  it("adds the model's senses, synonyms, antonyms, and examples", () => {
    const merged = mergeEnrichment(
      target().content,
      enrichment({ antonyms: ["丙"] }),
    );

    expect(merged.meanings).toEqual(["first sense", "second sense"]);
    expect(merged.synonyms).toEqual(["乙"]);
    expect(merged.antonyms).toEqual(["丙"]);
    expect(merged.examples).toHaveLength(2);
    expect(merged.examples?.[0]).toEqual({
      text: "这是甲。",
      reading: "zhè shì jiǎ.",
      translation: "This is A.",
    });
  });

  it("keeps existing entries first and appends only new ones", () => {
    const merged = mergeEnrichment(
      target({ meanings: ["an owner sense", "first sense"] }).content,
      enrichment(),
    );

    // "first sense" is already there, so it is not repeated.
    expect(merged.meanings).toEqual([
      "an owner sense",
      "first sense",
      "second sense",
    ]);
  });

  it("ignores a repeat that differs only in case or spacing", () => {
    const merged = mergeEnrichment(
      target({ synonyms: ["Study"] }).content,
      enrichment({ synonyms: [" study "] }),
    );

    expect(merged.synonyms).toEqual(["Study"]);
  });

  it("does not store the card's own example sentence twice", () => {
    const merged = mergeEnrichment(
      target({ exampleSentence: "这是甲。" }).content,
      enrichment(),
    );

    expect(merged.exampleSentence).toBe("这是甲。");
    expect(merged.examples?.map((example) => example.text)).toEqual([
      "甲很好。",
    ]);
  });

  it("omits a list the model left empty rather than storing it empty", () => {
    const merged = mergeEnrichment(
      target().content,
      enrichment({ synonyms: [], antonyms: [] }),
    );

    // The domain refuses a present-but-empty list, and an absent field is what an
    // unenriched card looks like for that field.
    expect("synonyms" in merged).toBe(false);
    expect("antonyms" in merged).toBe(false);
  });

  it("drops an example's reading and translation when the model gave none", () => {
    const merged = mergeEnrichment(
      target().content,
      enrichment({ examples: exampleFor("甲") }),
    );

    expect(merged.examples?.[0]).toEqual({ text: "这是甲。" });
  });

  it("prefers the model's usage notes over the card's", () => {
    const merged = mergeEnrichment(
      target({ usageNotes: "an older note" }).content,
      enrichment({ usageNotes: "a newer note" }),
    );

    expect(merged.usageNotes).toBe("a newer note");
  });

  it("keeps the card's usage notes when the model gave none", () => {
    const merged = mergeEnrichment(
      target({ usageNotes: "an older note" }).content,
      enrichment({ usageNotes: null }),
    );

    expect(merged.usageNotes).toBe("an older note");
  });

  it("leaves usage notes absent when neither side has any", () => {
    const merged = mergeEnrichment(
      target().content,
      enrichment({ usageNotes: null }),
    );

    expect("usageNotes" in merged).toBe(false);
  });

  it("produces content the flashcard domain accepts", () => {
    expect(() =>
      assertValidCardContent(mergeEnrichment(target().content, enrichment())),
    ).not.toThrow();
  });
});
