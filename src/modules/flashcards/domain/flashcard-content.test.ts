import { describe, expect, it } from "vitest";
import { InvalidFlashcardContentError } from "./errors";
import type { CardType, FlashcardContent } from "./flashcard";
import { CARD_TYPES } from "./flashcard";
import {
  CLOZE_BLANK,
  MAX_CLOZE_DELETIONS,
  MAX_CLOZE_HINT_LENGTH,
  MAX_VOCABULARY_EXAMPLES,
  MAX_VOCABULARY_SYNONYMS,
  assertValidContent,
  cardFaces,
  cardSummary,
  clozeAnswerText,
  clozeBlanks,
  clozeDeletions,
  clozePrompt,
  isClozeType,
  parseCloze,
  searchableText,
  vocabularyExamples,
  vocabularySenses,
} from "./flashcard-content";

/**
 * One valid card of each type, for the checks that must cover all five.
 *
 * Each entry keeps its own variant type rather than widening to the whole union,
 * so a test can spread one and override a single field — `{ ...BASIC, front: " " }`
 * — and still be checked against the variant it belongs to.
 */
type ContentOf<K extends CardType> = Extract<FlashcardContent, { type: K }>;

const VALID_CONTENT: { readonly [K in CardType]: ContentOf<K> } = {
  BASIC: {
    type: "BASIC",
    front: "What does S3 stand for?",
    back: "Simple Storage Service",
  },
  REVERSED: {
    type: "REVERSED",
    front: "ephemeral",
    back: "lasting for a very short time",
  },
  CLOZE: {
    type: "CLOZE",
    text: "An S3 bucket name must be {{globally unique}}.",
  },
  VOCABULARY: {
    // The demo card from `SPEC.md` section 6.4.
    type: "VOCABULARY",
    term: "学习",
    reading: "xuéxí",
    meaning: "to study; to learn",
    exampleSentence: "我每天学习汉语。",
  },
  SCENARIO: {
    type: "SCENARIO",
    scenario: "A workload writes 20 GB of logs a day and reads them rarely.",
    question: "Which storage class fits?",
    answer: "S3 Standard-IA, or Glacier Instant Retrieval if reads are rarer.",
  },
};

/**
 * The same card once every optional field has been filled in.
 *
 * Kept beside the plain fixture rather than replacing it, because the pair is the
 * point: both must be valid, both must render, and the plain one is what the
 * owner's 1,600 imported cards look like.
 */
const ENRICHED_VOCABULARY: ContentOf<"VOCABULARY"> = {
  type: "VOCABULARY",
  term: "学习",
  reading: "xuéxí",
  meaning: "to study; to learn",
  exampleSentence: "我每天学习汉语。",
  meanings: ["to imitate a good example"],
  synonyms: ["念书", "读书"],
  antonyms: ["玩儿"],
  examples: [
    {
      text: "他在学习开车。",
      reading: "tā zài xuéxí kāichē.",
      translation: "He is learning to drive.",
    },
    { text: "值得学习。" },
  ],
  usageNotes:
    "Neutral register; also used of learning from a person's example.",
};

function expectInvalidField(
  content: FlashcardContent,
  field: string,
): InvalidFlashcardContentError {
  try {
    assertValidContent(content);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidFlashcardContentError);
    const invalid = error as InvalidFlashcardContentError;
    expect(invalid.field).toBe(field);

    return invalid;
  }

  throw new Error(`Expected ${content.type} content to be rejected.`);
}

describe("assertValidContent", () => {
  it("accepts a valid card of every type", () => {
    for (const cardType of CARD_TYPES) {
      expect(() => assertValidContent(VALID_CONTENT[cardType])).not.toThrow();
    }
  });

  it("covers every card type in the fixture table", () => {
    expect(Object.keys(VALID_CONTENT).sort()).toEqual([...CARD_TYPES].sort());
  });

  it("rejects a basic card with a blank front or back", () => {
    expectInvalidField({ ...VALID_CONTENT.BASIC, front: "   " }, "front");
    expectInvalidField({ ...VALID_CONTENT.BASIC, back: "" }, "back");
  });

  it("rejects a reversed card with a blank side, because either side prompts", () => {
    expectInvalidField({ ...VALID_CONTENT.REVERSED, back: "  " }, "back");
    expectInvalidField({ ...VALID_CONTENT.REVERSED, front: "" }, "front");
  });

  it("rejects a cloze card with no deletion", () => {
    const error = expectInvalidField(
      { type: "CLOZE", text: "An S3 bucket name must be globally unique." },
      "text",
    );

    expect(error.message).toContain("{{");
  });

  it("rejects a cloze card with an empty deletion", () => {
    expectInvalidField({ type: "CLOZE", text: "A bucket is {{  }}." }, "text");
  });

  it("rejects a cloze card with an unclosed marker", () => {
    expectInvalidField(
      { type: "CLOZE", text: "A {{bucket}} lives in a {{region." },
      "text",
    );
  });

  it("rejects a cloze card with a stray closing marker", () => {
    expectInvalidField(
      { type: "CLOZE", text: "A {{bucket}} lives in a region}}." },
      "text",
    );
  });

  it("rejects a cloze card with more deletions than one card should carry", () => {
    const tooMany = Array.from(
      { length: MAX_CLOZE_DELETIONS + 1 },
      (_unused, index) => `{{word ${index}}}`,
    ).join(" ");

    const error = expectInvalidField({ type: "CLOZE", text: tooMany }, "text");

    expect(error.message).toContain(String(MAX_CLOZE_DELETIONS));
  });

  it("accepts a cloze card at the deletion limit", () => {
    const atLimit = Array.from(
      { length: MAX_CLOZE_DELETIONS },
      (_unused, index) => `{{word ${index}}}`,
    ).join(" ");

    expect(() =>
      assertValidContent({ type: "CLOZE", text: atLimit }),
    ).not.toThrow();
  });

  it("requires a term and a meaning on a vocabulary card", () => {
    expectInvalidField({ ...VALID_CONTENT.VOCABULARY, term: " " }, "term");
    expectInvalidField({ ...VALID_CONTENT.VOCABULARY, meaning: "" }, "meaning");
  });

  it("accepts a vocabulary card without a reading or an example", () => {
    expect(() =>
      assertValidContent({
        type: "VOCABULARY",
        term: "AZ",
        reading: null,
        meaning: "Availability Zone",
        exampleSentence: null,
      }),
    ).not.toThrow();
  });

  it("rejects a whitespace-only reading or example rather than storing it", () => {
    expectInvalidField(
      { ...VALID_CONTENT.VOCABULARY, reading: "   " },
      "reading",
    );
    expectInvalidField(
      { ...VALID_CONTENT.VOCABULARY, exampleSentence: "\t" },
      "exampleSentence",
    );
  });

  it("accepts a vocabulary card with every optional field filled in", () => {
    expect(() => assertValidContent(ENRICHED_VOCABULARY)).not.toThrow();
  });

  it("rejects an empty list rather than storing a field that says nothing", () => {
    expectInvalidField(
      { ...VALID_CONTENT.VOCABULARY, synonyms: [] },
      "synonyms",
    );
    expectInvalidField(
      { ...VALID_CONTENT.VOCABULARY, examples: [] },
      "examples",
    );
  });

  it("rejects a blank entry in a list", () => {
    expectInvalidField(
      { ...VALID_CONTENT.VOCABULARY, antonyms: ["玩儿", "  "] },
      "antonyms",
    );
  });

  it("rejects the same entry listed twice, which a model does and a person does not", () => {
    expectInvalidField(
      { ...VALID_CONTENT.VOCABULARY, synonyms: ["念书", "念书"] },
      "synonyms",
    );
  });

  it("caps each list so one card cannot become a thesaurus page", () => {
    const tooMany = Array.from(
      { length: MAX_VOCABULARY_SYNONYMS + 1 },
      (_unused, index) => `synonym ${index}`,
    );

    const error = expectInvalidField(
      { ...VALID_CONTENT.VOCABULARY, synonyms: tooMany },
      "synonyms",
    );

    expect(error.message).toContain(String(MAX_VOCABULARY_SYNONYMS));
  });

  it("caps the examples too", () => {
    expectInvalidField(
      {
        ...VALID_CONTENT.VOCABULARY,
        examples: Array.from(
          { length: MAX_VOCABULARY_EXAMPLES + 1 },
          (_unused, index) => ({ text: `例句 ${index}` }),
        ),
      },
      "examples",
    );
  });

  it("requires an example to have its own sentence", () => {
    expectInvalidField(
      {
        ...VALID_CONTENT.VOCABULARY,
        examples: [{ text: " ", reading: "yī jù" }],
      },
      "examples",
    );
  });

  it("rejects a blank reading or translation on an example", () => {
    expectInvalidField(
      {
        ...VALID_CONTENT.VOCABULARY,
        examples: [{ text: "例句。", reading: "" }],
      },
      "examples",
    );
    expectInvalidField(
      {
        ...VALID_CONTENT.VOCABULARY,
        examples: [{ text: "例句。", translation: "\t" }],
      },
      "examples",
    );
  });

  it("rejects whitespace-only usage notes", () => {
    expectInvalidField(
      { ...VALID_CONTENT.VOCABULARY, usageNotes: "  " },
      "usageNotes",
    );
  });

  it("requires all three parts of a scenario card", () => {
    expectInvalidField({ ...VALID_CONTENT.SCENARIO, scenario: "" }, "scenario");
    expectInvalidField(
      { ...VALID_CONTENT.SCENARIO, question: " " },
      "question",
    );
    expectInvalidField({ ...VALID_CONTENT.SCENARIO, answer: "" }, "answer");
  });
});

describe("cloze parsing", () => {
  it("splits text and deletions in order", () => {
    expect(parseCloze("A {{bucket}} is in a {{region}}.")).toEqual([
      { kind: "TEXT", text: "A " },
      // A deletion with no `|` has no hint, which is every card written before
      // hints existed.
      { kind: "DELETION", text: "bucket", hint: null },
      { kind: "TEXT", text: " is in a " },
      { kind: "DELETION", text: "region", hint: null },
      { kind: "TEXT", text: "." },
    ]);
  });

  it("treats text with no markers as one literal segment", () => {
    expect(parseCloze("No markers here")).toEqual([
      { kind: "TEXT", text: "No markers here" },
    ]);
  });

  it("leaves an unclosed marker as literal text instead of throwing", () => {
    // Write-time validation rejects this; render-time parsing must never throw
    // while displaying whatever is stored.
    expect(parseCloze("A {{bucket")).toEqual([
      { kind: "TEXT", text: "A {{bucket" },
    ]);
  });

  it("reads a hint after the separator, without it becoming the answer", () => {
    expect(clozeBlanks("A {{bucket|where objects live}} is regional.")).toEqual(
      [{ kind: "DELETION", text: "bucket", hint: "where objects live" }],
    );
    expect(
      clozeDeletions("A {{bucket|where objects live}} is regional."),
    ).toEqual(["bucket"]);
  });

  it("splits on the first separator only, so a hint may contain one", () => {
    expect(clozeBlanks("{{答案|either A | or B}}")[0]).toEqual({
      kind: "DELETION",
      text: "答案",
      hint: "either A | or B",
    });
  });

  it("treats a separator with nothing after it as no hint", () => {
    // Better than an empty parenthesis on the prompt face.
    expect(clozeBlanks("A {{bucket|}}.")[0]?.hint).toBeNull();
  });

  it("shows the hint beside the blank on the prompt", () => {
    expect(clozePrompt("A {{bucket|where objects live}} is regional.")).toBe(
      `A ${CLOZE_BLANK} (hint: where objects live) is regional.`,
    );
  });

  it("keeps the hint out of the filled-in sentence, which is the answer", () => {
    expect(
      clozeAnswerText("A {{bucket|where objects live}} is regional."),
    ).toBe("A bucket is regional.");
  });

  it("accepts a hinted card and rejects a hint longer than a nudge", () => {
    expect(() =>
      assertValidContent({ type: "CLOZE", text: "A {{bucket|a hint}}." }),
    ).not.toThrow();

    const long = "x".repeat(MAX_CLOZE_HINT_LENGTH + 1);

    expectInvalidField(
      { type: "CLOZE", text: `A {{bucket|${long}}}.` },
      "text",
    );
  });

  it("still counts markers correctly when deletions carry hints", () => {
    // The hint lives inside the existing markers, so the balance check that
    // counts them needs no knowledge of hints at all.
    expect(() =>
      assertValidContent({
        type: "CLOZE",
        text: "A {{bucket|a hint}} in a {{region|another}}.",
      }),
    ).not.toThrow();
    expectInvalidField(
      { type: "CLOZE", text: "A {{bucket|a hint}} in a {{region." },
      "text",
    );
  });

  it("rejects a deletion that is only a hint", () => {
    expectInvalidField({ type: "CLOZE", text: "A {{|a hint}}." }, "text");
  });

  it("lists deletions, blanks the prompt, and restores the answer", () => {
    const text =
      "An S3 bucket name must be {{globally unique}} across {{AWS}}.";

    expect(clozeDeletions(text)).toEqual(["globally unique", "AWS"]);
    expect(clozePrompt(text)).toBe(
      `An S3 bucket name must be ${CLOZE_BLANK} across ${CLOZE_BLANK}.`,
    );
    expect(clozeAnswerText(text)).toBe(
      "An S3 bucket name must be globally unique across AWS.",
    );
  });
});

describe("cardFaces", () => {
  it("prompts a basic card with its front", () => {
    const faces = cardFaces(VALID_CONTENT.BASIC);

    expect(faces.promptLabel).toBe("Front");
    expect(faces.prompt).toEqual([
      { label: null, text: "What does S3 stand for?" },
    ]);
    expect(faces.answer).toEqual([
      { label: null, text: "Simple Storage Service" },
    ]);
  });

  it("prompts a reversed card with its back, which is the point of the type", () => {
    const faces = cardFaces(VALID_CONTENT.REVERSED);

    expect(faces.promptLabel).toBe("Back");
    expect(faces.prompt).toEqual([
      { label: null, text: "lasting for a very short time" },
    ]);
    expect(faces.answer).toEqual([{ label: null, text: "ephemeral" }]);
  });

  it("prompts a cloze card with blanks and answers with the filled sentence", () => {
    const faces = cardFaces(VALID_CONTENT.CLOZE);

    expect(faces.prompt[0]?.text).toBe(
      `An S3 bucket name must be ${CLOZE_BLANK}.`,
    );
    expect(faces.answer[0]?.text).toBe(
      "An S3 bucket name must be globally unique.",
    );
    expect(faces.answer[1]).toEqual({
      label: "Blank 1",
      text: "globally unique",
    });
  });

  it("prompts a vocabulary card with the term and reveals reading, meaning, example", () => {
    const faces = cardFaces(VALID_CONTENT.VOCABULARY);

    expect(faces.prompt).toEqual([{ label: null, text: "学习" }]);
    expect(faces.answer).toEqual([
      { label: "Reading", text: "xuéxí" },
      { label: "Meaning", text: "to study; to learn" },
      { label: "Example", text: "我每天学习汉语。" },
    ]);
  });

  it("omits absent optional vocabulary lines rather than showing empty labels", () => {
    const faces = cardFaces({
      type: "VOCABULARY",
      term: "AZ",
      reading: null,
      meaning: "Availability Zone",
      exampleSentence: null,
    });

    expect(faces.answer).toEqual([
      { label: "Meaning", text: "Availability Zone" },
    ]);
  });

  it("reveals every enriched field as its own labelled line", () => {
    const faces = cardFaces(ENRICHED_VOCABULARY);

    expect(faces.answer).toEqual([
      { label: "Reading", text: "xuéxí" },
      { label: "Meaning", text: "to study; to learn" },
      { label: "Also means", text: "to imitate a good example" },
      { label: "Synonyms", text: "念书, 读书" },
      { label: "Antonyms", text: "玩儿" },
      {
        label: "Example 1",
        text: "我每天学习汉语。",
      },
      {
        label: "Example 2",
        text: "他在学习开车。\ntā zài xuéxí kāichē.\nHe is learning to drive.",
      },
      { label: "Example 3", text: "值得学习。" },
      {
        label: "Usage",
        text: "Neutral register; also used of learning from a person's example.",
      },
    ]);
  });

  it("renders an unenriched card exactly as it did before the fields existed", () => {
    // The regression that matters: the owner's imported bank carries none of the
    // new fields, and its cards must be untouched by their existence.
    expect(cardFaces(VALID_CONTENT.VOCABULARY).answer).toEqual([
      { label: "Reading", text: "xuéxí" },
      { label: "Meaning", text: "to study; to learn" },
      { label: "Example", text: "我每天学习汉语。" },
    ]);
  });

  it("prompts a scenario card with the situation and the question", () => {
    const faces = cardFaces(VALID_CONTENT.SCENARIO);

    expect(faces.prompt.map((line) => line.label)).toEqual([
      "Situation",
      "Question",
    ]);
    expect(faces.answer).toEqual([
      {
        label: null,
        text: "S3 Standard-IA, or Glacier Instant Retrieval if reads are rarer.",
      },
    ]);
  });

  it("gives every card type a non-empty prompt and answer", () => {
    for (const cardType of CARD_TYPES) {
      const faces = cardFaces(VALID_CONTENT[cardType]);

      expect(faces.prompt.length).toBeGreaterThan(0);
      expect(faces.answer.length).toBeGreaterThan(0);
      expect(faces.promptLabel.length).toBeGreaterThan(0);
      expect(faces.answerLabel.length).toBeGreaterThan(0);
    }
  });
});

describe("cardSummary", () => {
  it("summarises a card from its prompt face", () => {
    expect(cardSummary(VALID_CONTENT.BASIC)).toBe("What does S3 stand for?");
    expect(cardSummary(VALID_CONTENT.VOCABULARY)).toBe("学习");
    expect(cardSummary(VALID_CONTENT.SCENARIO)).toContain("20 GB of logs");
  });

  it("summarises every card type without an empty result", () => {
    for (const cardType of CARD_TYPES) {
      expect(cardSummary(VALID_CONTENT[cardType]).length).toBeGreaterThan(0);
    }
  });
});

describe("searchableText", () => {
  it("includes both sides of a two-sided card", () => {
    const text = searchableText(VALID_CONTENT.BASIC);

    expect(text).toContain("What does S3 stand for?");
    expect(text).toContain("Simple Storage Service");
  });

  it("includes cloze answers without the markers", () => {
    const text = searchableText(VALID_CONTENT.CLOZE);

    expect(text).toContain("globally unique");
    expect(text).not.toContain("{{");
  });

  it("includes every vocabulary field that is present", () => {
    const text = searchableText(VALID_CONTENT.VOCABULARY);

    expect(text).toContain("学习");
    expect(text).toContain("xuéxí");
    expect(text).toContain("to study; to learn");
    expect(text).toContain("我每天学习汉语。");
  });

  it("includes the enriched fields, so an enriched card is findable by them", () => {
    const text = searchableText(ENRICHED_VOCABULARY);

    expect(text).toContain("念书");
    expect(text).toContain("to imitate a good example");
    expect(text).toContain("He is learning to drive.");
    expect(text).toContain("Neutral register");
  });

  it("includes all three scenario fields", () => {
    const text = searchableText(VALID_CONTENT.SCENARIO);

    expect(text).toContain("20 GB of logs");
    expect(text).toContain("Which storage class fits?");
    expect(text).toContain("Standard-IA");
  });

  it("produces searchable text for every card type", () => {
    for (const cardType of CARD_TYPES) {
      expect(
        searchableText(VALID_CONTENT[cardType]).trim().length,
      ).toBeGreaterThan(0);
    }
  });
});

describe("vocabularySenses", () => {
  it("puts the primary gloss first, then the further meanings", () => {
    expect(vocabularySenses(ENRICHED_VOCABULARY)).toEqual([
      "to study; to learn",
      "to imitate a good example",
    ]);
  });

  it("is just the primary gloss on an unenriched card", () => {
    expect(vocabularySenses(VALID_CONTENT.VOCABULARY)).toEqual([
      "to study; to learn",
    ]);
  });

  it("shows a sense once when enrichment restates the existing gloss", () => {
    expect(
      vocabularySenses({
        ...VALID_CONTENT.VOCABULARY,
        meanings: ["To Study; To Learn", "to imitate"],
      }),
    ).toEqual(["to study; to learn", "to imitate"]);
  });
});

describe("vocabularyExamples", () => {
  it("keeps the original example first, then the added ones", () => {
    // Precedence is additive: enrichment appends rather than overwriting what the
    // owner or the importer already chose.
    expect(vocabularyExamples(ENRICHED_VOCABULARY).map((e) => e.text)).toEqual([
      "我每天学习汉语。",
      "他在学习开车。",
      "值得学习。",
    ]);
  });

  it("does not double an added example that repeats the original", () => {
    expect(
      vocabularyExamples({
        ...VALID_CONTENT.VOCABULARY,
        examples: [
          {
            text: "我每天学习汉语。",
            translation: "I study Chinese every day.",
          },
        ],
      }),
    ).toEqual([{ text: "我每天学习汉语。" }]);
  });

  it("is empty when the card has no example at all", () => {
    expect(
      vocabularyExamples({
        type: "VOCABULARY",
        term: "AZ",
        reading: null,
        meaning: "Availability Zone",
        exampleSentence: null,
      }),
    ).toEqual([]);
  });
});

describe("isClozeType", () => {
  it("identifies only the cloze type as single-text", () => {
    expect(CARD_TYPES.filter(isClozeType)).toEqual(["CLOZE"]);
  });
});
