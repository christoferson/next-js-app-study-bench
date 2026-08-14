import { describe, expect, it } from "vitest";
import { CARD_TYPES } from "@/modules/flashcards/domain/flashcard";
import { QUESTION_TYPES } from "@/modules/question-bank/domain/question";
import {
  flashcardPayloadItem,
  questionPayloadItem,
} from "@/modules/ai-generation/infrastructure/test-support";
import {
  ENRICHMENT_SCHEMA_NAME,
  FLASHCARD_SCHEMA_NAME,
  QUESTION_SCHEMA_NAME,
  enrichmentOutputJsonSchema,
  flashcardOutputJsonSchema,
  questionOutputJsonSchema,
  validateEnrichmentOutput,
  validateFlashcardOutput,
  validateQuestionOutput,
} from "./output-schemas";

/**
 * Validation of model output.
 *
 * The provider's answer is external input, so these tests are about refusing what is
 * wrong as much as accepting what is right — and about the repair feedback, which is
 * sent straight back to the provider and must therefore carry no owner data.
 */

const CONTEXT = { contentLanguage: "en" } as const;

function validQuestions(items: readonly Record<string, unknown>[]) {
  return validateQuestionOutput({ questions: items }, CONTEXT);
}

function validCards(items: readonly Record<string, unknown>[]) {
  return validateFlashcardOutput(
    { flashcards: items },
    { contentLanguage: "zh" },
  );
}

describe("validateQuestionOutput", () => {
  it("reads a well-formed single-choice answer into a draft", () => {
    const result = validQuestions([questionPayloadItem()]);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    const draft = result.value[0];

    expect(draft?.questionType).toBe("SINGLE_CHOICE");
    expect(draft?.language).toBe("en");
    expect(draft?.content).toEqual({
      type: "SINGLE_CHOICE",
      choices: [
        { id: "choice-1", text: "Demo option A — the fictional answer" },
        { id: "choice-2", text: "Demo option B — a wrong demo option" },
        { id: "choice-3", text: "Demo option C — another wrong demo option" },
      ],
      correctChoiceId: "choice-1",
    });
  });

  it("assigns choice identifiers by position rather than trusting the model", () => {
    const result = validQuestions([
      questionPayloadItem({
        questionType: "MULTIPLE_RESPONSE",
        correctChoiceIndexes: [0, 2],
      }),
    ]);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value[0]?.content).toMatchObject({
      type: "MULTIPLE_RESPONSE",
      correctChoiceIds: ["choice-1", "choice-3"],
    });
  });

  it("collapses a repeated correct index", () => {
    const result = validQuestions([
      questionPayloadItem({
        questionType: "MULTIPLE_RESPONSE",
        correctChoiceIndexes: [0, 0, 1],
      }),
    ]);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value[0]?.content).toMatchObject({
      correctChoiceIds: ["choice-1", "choice-2"],
    });
  });

  it("turns an out-of-range correct index into an answer that names nothing", () => {
    // Rather than dropping it: the deterministic checks then reject the item for the
    // failure the model actually made.
    const result = validQuestions([
      questionPayloadItem({ correctChoiceIndexes: [7] }),
    ]);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value[0]?.content).toMatchObject({
      correctChoiceId: "choice-8",
    });
  });

  it("treats an absent, null, and blank optional field as the same answer", () => {
    for (const explanation of [undefined, null, "   "]) {
      const item = questionPayloadItem();

      if (explanation === undefined) {
        delete item.explanation;
      } else {
        item.explanation = explanation;
      }

      const result = validQuestions([item]);

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.value[0]?.explanation).toBeNull();
      }
    }
  });

  it("reads a short-answer question with no choices", () => {
    const result = validQuestions([
      questionPayloadItem({
        questionType: "SHORT_ANSWER",
        choices: [],
        correctChoiceIndexes: [],
        expectedConcepts: ["demo durability", "demo availability"],
      }),
    ]);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value[0]?.content).toEqual({
        type: "SHORT_ANSWER",
        expectedConcepts: ["demo durability", "demo availability"],
      });
    }
  });

  it("de-duplicates and trims tags", () => {
    const result = validQuestions([
      questionPayloadItem({ tags: [" demo ", "demo", "storage", "  "] }),
    ]);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value[0]?.tags).toEqual(["demo", "storage"]);
    }
  });

  it("refuses an answer that is not the right shape at all", () => {
    expect(validateQuestionOutput({ questions: "many" }, CONTEXT).ok).toBe(
      false,
    );
    expect(validateQuestionOutput(null, CONTEXT).ok).toBe(false);
    expect(validateQuestionOutput("questions", CONTEXT).ok).toBe(false);
    expect(validateQuestionOutput({}, CONTEXT).ok).toBe(false);
  });

  it("refuses an unrecognised question type", () => {
    const result = validQuestions([
      questionPayloadItem({ questionType: "DRAG_AND_DROP" }),
    ]);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors.join(" ")).toContain(QUESTION_TYPES[0] ?? "");
    }
  });

  it("refuses a missing stem", () => {
    const item = questionPayloadItem();

    delete item.stem;

    expect(validQuestions([item]).ok).toBe(false);
  });

  it("refuses more items than any batch could have asked for", () => {
    const items = Array.from({ length: 26 }, () => questionPayloadItem());

    expect(validQuestions(items).ok).toBe(false);
  });

  it("names the failing field path in its repair feedback", () => {
    const result = validQuestions([questionPayloadItem({ stem: 42 })]);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors.some((error) => error.includes("stem"))).toBe(true);
    }
  });

  it("never echoes the offending value back to the provider", () => {
    const secret = "a-value-that-must-not-be-echoed";
    const result = validQuestions([
      questionPayloadItem({ tags: [secret.repeat(10)] }),
    ]);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors.join(" ")).not.toContain(secret);
    }
  });

  it("bounds the repair feedback", () => {
    const items = Array.from({ length: 20 }, () =>
      questionPayloadItem({ stem: 1, questionType: "NOPE", tags: 3 }),
    );
    const result = validQuestions(items);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors.length).toBeLessThanOrEqual(12);
    }
  });

  it("accepts an empty batch as well-formed but empty", () => {
    // Shape-valid: "the model returned nothing" is a count problem the run status
    // reports, not a malformed answer worth a repair turn.
    const result = validQuestions([]);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });
});

describe("validateFlashcardOutput", () => {
  it("reads the vocabulary example from the specification", () => {
    const result = validCards([flashcardPayloadItem()]);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value[0]?.content).toEqual({
        type: "VOCABULARY",
        term: "学习",
        reading: "xuéxí",
        meaning: "to study; to learn",
        exampleSentence: "我每天学习汉语。",
      });
      expect(result.value[0]?.language).toBe("zh");
    }
  });

  it("reads every card type into its own content shape", () => {
    const items = [
      { cardType: "BASIC", front: "Front side", back: "Back side" },
      { cardType: "REVERSED", front: "Front side", back: "Back side" },
      { cardType: "CLOZE", text: "A demo bucket name is {{globally unique}}." },
      flashcardPayloadItem(),
      {
        cardType: "SCENARIO",
        scenario: "A demo workload writes rarely-read logs.",
        question: "Which demo storage class fits?",
        answer: "The cheaper demo class.",
      },
    ];
    const result = validCards(items);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.map((draft) => draft.content.type)).toEqual([
        "BASIC",
        "REVERSED",
        "CLOZE",
        "VOCABULARY",
        "SCENARIO",
      ]);
    }
  });

  it("refuses a card that names one type and carries another's fields", () => {
    const result = validCards([
      { cardType: "VOCABULARY", front: "Front", back: "Back" },
    ]);

    expect(result.ok).toBe(false);
  });

  it("refuses an unrecognised card type", () => {
    const result = validCards([{ cardType: "AUDIO", front: "a", back: "b" }]);

    expect(result.ok).toBe(false);
  });

  it("refuses a card missing a field its type requires", () => {
    expect(validCards([{ cardType: "CLOZE" }]).ok).toBe(false);
    expect(validCards([{ cardType: "BASIC", front: "only a front" }]).ok).toBe(
      false,
    );
  });
});

describe("validateEnrichmentOutput", () => {
  function validWords(items: readonly Record<string, unknown>[]) {
    return validateEnrichmentOutput({ words: items });
  }

  function enrichmentPayloadItem(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      term: "学习",
      meanings: ["to study", "to learn"],
      synonyms: ["念书"],
      antonyms: [],
      examples: [
        {
          text: "我每天学习汉语。",
          reading: "wǒ měi tiān xuéxí hànyǔ.",
          translation: "I study Chinese every day.",
        },
      ],
      usageNotes: "Neutral register.",
      ...overrides,
    };
  }

  it("reads a well-formed entry into a draft", () => {
    const result = validWords([enrichmentPayloadItem()]);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value[0]).toEqual({
        term: "学习",
        meanings: ["to study", "to learn"],
        synonyms: ["念书"],
        antonyms: [],
        examples: [
          {
            text: "我每天学习汉语。",
            reading: "wǒ měi tiān xuéxí hànyǔ.",
            translation: "I study Chinese every day.",
          },
        ],
        usageNotes: "Neutral register.",
      });
    }
  });

  it("treats an absent, null, and empty list as the same answer", () => {
    // "This word has no antonym" is a real answer, and refusing it would cost the
    // card for being honest. Which of the three ways the model says it is not a
    // difference the domain should see.
    for (const antonyms of [undefined, null, []]) {
      const item = enrichmentPayloadItem();

      if (antonyms === undefined) {
        delete item.antonyms;
      } else {
        item.antonyms = antonyms;
      }

      const result = validWords([item]);

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.value[0]?.antonyms).toEqual([]);
      }
    }
  });

  it("drops blank entries and collapses repeats within a list", () => {
    const result = validWords([
      enrichmentPayloadItem({
        meanings: [" to study ", "to study", "TO STUDY", "  ", "to learn"],
      }),
    ]);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value[0]?.meanings).toEqual(["to study", "to learn"]);
    }
  });

  it("treats an absent, null, and blank usage note as the same answer", () => {
    for (const usageNotes of [undefined, null, "   "]) {
      const item = enrichmentPayloadItem();

      if (usageNotes === undefined) {
        delete item.usageNotes;
      } else {
        item.usageNotes = usageNotes;
      }

      const result = validWords([item]);

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.value[0]?.usageNotes).toBeNull();
      }
    }
  });

  it("reads an example with no reading or translation", () => {
    const result = validWords([
      enrichmentPayloadItem({ examples: [{ text: "我学习。" }] }),
    ]);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value[0]?.examples[0]).toEqual({
        text: "我学习。",
        reading: null,
        translation: null,
      });
    }
  });

  it("accepts an entry with no examples so the checks can refuse it for that", () => {
    // Shape-valid, then rejected by `matchEnrichments` for having too few examples:
    // the count rule belongs to the domain, not to the wire format, so the owner is
    // told which card failed rather than that the whole answer was malformed.
    const result = validWords([enrichmentPayloadItem({ examples: null })]);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value[0]?.examples).toEqual([]);
    }
  });

  it("refuses an answer that is not the right shape at all", () => {
    expect(validateEnrichmentOutput({ words: "several" }).ok).toBe(false);
    expect(validateEnrichmentOutput(null).ok).toBe(false);
    expect(validateEnrichmentOutput({}).ok).toBe(false);
  });

  it("refuses an entry with no term at all", () => {
    const item = enrichmentPayloadItem();

    delete item.term;

    expect(validWords([item]).ok).toBe(false);
    expect(validWords([enrichmentPayloadItem({ term: 42 })]).ok).toBe(false);
  });

  it("passes a blank term through for the checks to reject", () => {
    // Shape-valid but unmatchable: a blank term matches no card, so `matchEnrichments`
    // rejects that one entry. Failing the whole answer here would lose the other
    // nineteen words for one bad echo.
    const result = validWords([enrichmentPayloadItem({ term: "   " })]);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value[0]?.term).toBe("");
    }
  });

  it("refuses an example whose sentence is not text", () => {
    expect(
      validWords([
        enrichmentPayloadItem({ examples: [{ text: 7, reading: "wǒ" }] }),
      ]).ok,
    ).toBe(false);
  });

  it("refuses a list longer than the domain could store", () => {
    const meanings = Array.from({ length: 13 }, (_unused, i) => `sense ${i}`);

    expect(validWords([enrichmentPayloadItem({ meanings })]).ok).toBe(false);
  });

  it("refuses more entries than any run could have asked for", () => {
    const items = Array.from({ length: 26 }, () => enrichmentPayloadItem());

    expect(validWords(items).ok).toBe(false);
  });

  it("never echoes the offending value back to the provider", () => {
    const secret = "a-value-that-must-not-be-echoed";
    const result = validWords([
      enrichmentPayloadItem({ meanings: [secret.repeat(60)] }),
    ]);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.errors.join(" ")).not.toContain(secret);
    }
  });

  it("accepts an empty answer as well-formed but empty", () => {
    const result = validWords([]);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });
});

describe("provider-facing JSON schemas", () => {
  it("names one tool per item kind", () => {
    expect(QUESTION_SCHEMA_NAME).toBe("practice_questions");
    expect(FLASHCARD_SCHEMA_NAME).toBe("study_flashcards");
    expect(ENRICHMENT_SCHEMA_NAME).toBe("enriched_vocabulary");
  });

  it("requires the term the enrichment is matched back by", () => {
    const items = enrichmentOutputJsonSchema().properties?.words?.items;

    expect(items?.required).toContain("term");
    expect(items?.properties?.term?.description ?? "").toMatch(
      /copied exactly as it was given/i,
    );
  });

  it("describes only the types the request allows", () => {
    const schema = questionOutputJsonSchema(["SHORT_ANSWER"]);
    const type =
      schema.properties?.questions?.items?.properties?.questionType?.enum;

    expect(type).toEqual(["SHORT_ANSWER"]);
  });

  it("falls back to every type when the request names none", () => {
    expect(
      questionOutputJsonSchema([]).properties?.questions?.items?.properties
        ?.questionType?.enum,
    ).toEqual([...QUESTION_TYPES]);
    expect(
      flashcardOutputJsonSchema([]).properties?.flashcards?.items?.properties
        ?.cardType?.enum,
    ).toEqual([...CARD_TYPES]);
  });

  it("requires the fields the validator requires", () => {
    expect(
      questionOutputJsonSchema(["SINGLE_CHOICE"]).properties?.questions?.items
        ?.required,
    ).toContain("stem");
    expect(
      flashcardOutputJsonSchema(["BASIC"]).properties?.flashcards?.items
        ?.required,
    ).toContain("cardType");
  });

  it("tells the model not to invent a citation", () => {
    const tags =
      questionOutputJsonSchema(["SINGLE_CHOICE"]).properties?.questions?.items
        ?.properties?.tags?.description ?? "";

    expect(tags).toMatch(/never a url/i);
  });
});
