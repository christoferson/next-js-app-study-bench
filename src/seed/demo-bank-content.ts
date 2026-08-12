import { DEMO_TRACK_SLUGS } from "@/modules/certifications/infrastructure/demo-seed";
import type { QuestionInput } from "@/modules/question-bank/application/schemas";
import type { FlashcardInput } from "@/modules/flashcards/application/schemas";

/**
 * The demo questions and demo flashcards that `npm run seed` writes.
 *
 * Every item is invented for this repository. The services, characters, and
 * numbers are illustrative: nothing here comes from an official examination, no
 * item is presented as a real exam question, and the wording says so where it
 * could otherwise be mistaken. That is the same promise the demo tracks make
 * (`SPEC.md` section 3 and section 19.5: "label all seed content as demo").
 *
 * The values are written as parsed facade input rather than as form strings, so
 * the discriminated unions type-check each item field by field: a card that
 * names a `term` under `cardType: "CLOZE"` fails the build rather than the seed.
 * The bank facades still apply every domain invariant on the way in, so a demo
 * item that could not be studied would be refused exactly as the owner's own
 * would be.
 *
 * Each item names the objective it belongs to **by code**. Objective identifiers
 * are generated at seed time, so a code is the only stable way to write this
 * content down; the seeder resolves codes against the track it is seeding and
 * refuses an item whose objective is missing rather than inserting it unmapped.
 */

/** One demo question and the objective code it is mapped to. */
export interface DemoQuestion {
  readonly objectiveCode: string;
  readonly input: QuestionInput;
}

/** One demo flashcard and the objective code it is mapped to. */
export interface DemoFlashcard {
  readonly objectiveCode: string;
  readonly input: FlashcardInput;
}

/** The demo content of one track, addressed by the slug the track is seeded under. */
export interface DemoBank {
  readonly slug: string;
  readonly questions: readonly DemoQuestion[];
  readonly flashcards: readonly DemoFlashcard[];
}

/**
 * Fictional names used throughout the technical demo content.
 *
 * Deliberately not the names of real services: an invented product cannot be
 * mistaken for exam material about a real one, and it keeps the demo bank
 * obviously a demo while still exercising every question type.
 */
const DEMO_MODEL_SERVICE = "Demo Model Foundry";
const DEMO_VECTOR_SERVICE = "Demo Vector Shelf";
const DEMO_GUARDRAIL_SERVICE = "Demo Safety Gate";

const TECHNICAL_QUESTIONS: readonly DemoQuestion[] = [
  {
    objectiveCode: "Demo task 1.1",
    input: {
      questionType: "SINGLE_CHOICE",
      stem: `Demo question. A team is building a summariser for 40-page reports in the fictional service ${DEMO_MODEL_SERVICE}. Which model property should they compare first?`,
      instructions: null,
      explanation:
        "Demo explanation. A document that does not fit the context window cannot be summarised in one call at all, so context length is the property that rules candidates in or out before cost and style are worth comparing.",
      difficulty: 2,
      tags: ["demo", "model-selection"],
      language: "en",
      choiceTexts: [
        "The context window each candidate model accepts",
        "The colour of the console badge shown next to the model",
        "The number of demo regions the model name appears in",
        "The alphabetical order of the model identifiers",
      ],
      correctChoiceIndexes: [0],
    },
  },
  {
    objectiveCode: "Demo task 1.2",
    input: {
      questionType: "MULTIPLE_RESPONSE",
      stem: "Demo question. Which two figures does a demo cost estimate for a chat feature need?",
      instructions: "Choose two.",
      explanation:
        "Demo explanation. Token pricing is charged separately for what goes in and what comes out, so an estimate needs both the expected input tokens per request and the expected output tokens per request. Wall-clock latency and the invented dashboard colour change nothing about the bill.",
      difficulty: 3,
      tags: ["demo", "cost"],
      language: "en",
      choiceTexts: [
        "Expected input tokens per request",
        "Expected output tokens per request",
        "The number of tabs open in the demo console",
        "The alphabetical position of the demo region name",
      ],
      correctChoiceIndexes: [0, 1],
    },
  },
  {
    objectiveCode: "Demo domain 2",
    input: {
      questionType: "SINGLE_CHOICE",
      stem: `Demo question. In this demo scenario, ${DEMO_MODEL_SERVICE} returns a different answer on every run of the same prompt. Which inference setting is the first one to lower?`,
      instructions: null,
      explanation:
        "Demo explanation. Temperature controls how much the sampler is allowed to wander, so lowering it is what makes repeated runs of one prompt agree. Raising the token limit or renaming the prompt changes nothing about sampling.",
      difficulty: 2,
      tags: ["demo", "inference"],
      language: "en",
      choiceTexts: [
        "Temperature",
        "The maximum output token limit",
        "The name of the prompt template file",
        "The number of demo tags on the request",
      ],
      correctChoiceIndexes: [0],
    },
  },
  {
    objectiveCode: "Demo domain 3",
    input: {
      questionType: "SHORT_ANSWER",
      stem: `Demo question. Describe how a demo retrieval step for ${DEMO_VECTOR_SERVICE} decides which passages reach the model.`,
      instructions:
        "Write two or three sentences, then grade yourself against the concepts listed with the answer.",
      explanation:
        "Demo explanation. The demo answer chunks the source into passages, embeds each one, embeds the question, retrieves the nearest passages by similarity, and passes only those into the prompt — which is also what makes the answer citable.",
      difficulty: 4,
      tags: ["demo", "retrieval"],
      language: "en",
      expectedConcepts: [
        "split the source into passages",
        "embed each passage as a vector",
        "embed the question the same way",
        "retrieve the nearest passages by similarity",
        "put only the retrieved passages in the prompt",
      ],
    },
  },
  {
    objectiveCode: "Demo domain 4",
    input: {
      questionType: "MULTIPLE_RESPONSE",
      stem: `Demo question. A demo deployment adds ${DEMO_GUARDRAIL_SERVICE} in front of a model. Which two outcomes are reasonable to expect?`,
      instructions: "Choose two.",
      explanation:
        "Demo explanation. A guardrail inspects requests and responses, so it can block content the team has ruled out and it records what it blocked — at the price of an extra step in the call path. It does not make the underlying model cheaper, and it cannot promise that no unwanted output ever appears.",
      difficulty: 3,
      tags: ["demo", "guardrails"],
      language: "en",
      choiceTexts: [
        "Requests and responses that break the stated rules are refused",
        "The refusals are recorded so they can be reviewed later",
        "The model's per-token price falls",
        "Unwanted output becomes impossible",
      ],
      correctChoiceIndexes: [0, 1],
    },
  },
];

/**
 * Two cards on the technical track.
 *
 * Present so the demo data exercises both banks on both tracks: a certification
 * track studies definitions and situations as well as questions, and a study
 * session mixes the two.
 */
const TECHNICAL_FLASHCARDS: readonly DemoFlashcard[] = [
  {
    objectiveCode: "Demo domain 3",
    input: {
      cardType: "BASIC",
      front: "Demo card. What does grounding mean in this demo material?",
      back: "Answering only from passages the application retrieved and can cite, rather than from the model's own recollection.",
      notes: "Demo content written for this repository, not exam material.",
      tags: ["demo", "retrieval"],
      language: "en",
    },
  },
  {
    objectiveCode: "Demo domain 4",
    input: {
      cardType: "SCENARIO",
      scenario: `Demo scenario. A demo support assistant built on ${DEMO_MODEL_SERVICE} starts answering questions it has no source for.`,
      question: "What is the first change to make?",
      answer:
        "Require retrieval before answering and let the assistant say it does not know when nothing is retrieved, so an ungrounded answer is never produced.",
      notes: null,
      tags: ["demo", "guardrails"],
      language: "en",
    },
  },
];

const LANGUAGE_FLASHCARDS: readonly DemoFlashcard[] = [
  {
    objectiveCode: "Demo unit 1",
    input: {
      // The vocabulary example from `SPEC.md` section 6.4, seeded so the card
      // type the specification illustrates is present from the first run.
      cardType: "VOCABULARY",
      term: "学习",
      reading: "xuéxí",
      meaning: "to study; to learn",
      exampleSentence: "我每天学习汉语。",
      notes: "Demo card written for this repository.",
      tags: ["demo", "hsk"],
      language: "zh",
    },
  },
  {
    objectiveCode: "Demo unit 1.1",
    input: {
      cardType: "VOCABULARY",
      term: "你好",
      reading: "nǐ hǎo",
      meaning: "hello",
      exampleSentence: "你好，我叫小明。",
      notes: null,
      tags: ["demo", "hsk", "greetings"],
      language: "zh",
    },
  },
  {
    objectiveCode: "Demo unit 1",
    input: {
      cardType: "CLOZE",
      text: "我{{每天}}学习汉语。",
      notes: "Demo cloze card. The blanked part means “every day”.",
      tags: ["demo", "hsk"],
      language: "zh",
    },
  },
  {
    objectiveCode: "Demo unit 2",
    input: {
      cardType: "BASIC",
      front: "Demo card. Which tones does 学习 carry?",
      back: "Second tone then second tone: xuéxí.",
      notes: null,
      tags: ["demo", "tones"],
      language: "zh",
    },
  },
  {
    objectiveCode: "Demo unit 3",
    input: {
      // Reversed, so the demo data covers a card that prompts from its back.
      cardType: "REVERSED",
      front: "听",
      back: "to listen (tīng)",
      notes:
        "Demo card. Prompted from the meaning, answered with the character.",
      tags: ["demo", "hsk", "listening"],
      language: "zh",
    },
  },
];

/**
 * Two questions on the language track.
 *
 * Language study is not only cards: the same track has to be able to ask a
 * multiple-choice question and a written one, and seeding both means a quick
 * session on this track has something of each kind to offer.
 */
const LANGUAGE_QUESTIONS: readonly DemoQuestion[] = [
  {
    objectiveCode: "Demo unit 2",
    input: {
      questionType: "SINGLE_CHOICE",
      stem: "Demo question. Which pinyin matches 学习?",
      instructions: null,
      explanation: "Demo explanation. Both syllables take the second tone.",
      difficulty: 1,
      tags: ["demo", "hsk"],
      language: "en",
      choiceTexts: ["xuéxí", "xuèxī", "xuěxì", "xuēxǐ"],
      correctChoiceIndexes: [0],
    },
  },
  {
    objectiveCode: "Demo unit 3",
    input: {
      questionType: "SHORT_ANSWER",
      stem: "Demo question. A demo speaker says 我每天学习汉语。What have they told you?",
      instructions: "Answer in English, then grade yourself.",
      explanation:
        "Demo explanation. The sentence gives the habit and its frequency: they study Chinese, and they do it every day.",
      difficulty: 2,
      tags: ["demo", "hsk", "listening"],
      language: "en",
      expectedConcepts: [
        "they study Chinese",
        "every day",
        "it is a habit rather than a one-off",
      ],
    },
  },
];

/** The demo content of both seeded tracks, in the order it is written. */
export const DEMO_BANKS: readonly DemoBank[] = [
  {
    slug: DEMO_TRACK_SLUGS.technicalCertification,
    questions: TECHNICAL_QUESTIONS,
    flashcards: TECHNICAL_FLASHCARDS,
  },
  {
    slug: DEMO_TRACK_SLUGS.languageProficiency,
    questions: LANGUAGE_QUESTIONS,
    flashcards: LANGUAGE_FLASHCARDS,
  },
];
