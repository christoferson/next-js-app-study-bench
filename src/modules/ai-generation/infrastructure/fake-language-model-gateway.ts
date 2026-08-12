import {
  QUESTION_TYPES,
  describeQuestionType,
} from "@/modules/question-bank/domain/question";
import type { QuestionType } from "@/modules/question-bank/domain/question";
import {
  CARD_TYPES,
  describeCardType,
} from "@/modules/flashcards/domain/flashcard";
import type { CardType } from "@/modules/flashcards/domain/flashcard";
import type {
  GenerationFailureCategory,
  ProviderUsage,
} from "@/modules/ai-generation/domain/generation-run";
import { ProviderFailure } from "@/modules/ai-generation/domain/errors";
import {
  FLASHCARD_SCHEMA_NAME,
  QUESTION_SCHEMA_NAME,
} from "@/modules/ai-generation/application/output-schemas";
import type {
  LanguageModelGateway,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from "@/modules/ai-generation/ports/language-model-gateway";

/**
 * Deterministic language-model gateway for development and tests.
 *
 * It is the default provider locally (`SPEC.md` section 17): the whole generation
 * flow — prompts, validation, the repair attempt, the deterministic checks,
 * persistence, the run review screen — is exercised without an AWS account, a
 * credential, or a cent of spend. `spec/TESTING.md` section 5 requires that the
 * default test suite never calls a real provider, and this is how that is met: the
 * test suite has no other gateway wired into it.
 *
 * Two modes:
 *
 * - **Scripted.** Given `responses`, it returns them in order, one per provider
 *   turn. That is what makes malformed output, a repair that succeeds, a repair
 *   that fails, and a provider outage testable as ordinary unit tests.
 * - **Synthesised.** Given nothing, it composes plausible demo content from the
 *   rendered prompt. It reads the prompt rather than taking a second copy of the
 *   request because that is exactly what a real model gets: if the template stops
 *   stating the count, the allowed types, or the objective identifiers, this
 *   gateway stops producing them too, and a test notices.
 *
 * Synthesised content is obviously fictional and never claims to be official, so
 * the deterministic checks pass for the same reasons real output would.
 */

/** One scripted provider turn: a payload to return, or a failure to raise. */
export type FakeGatewayResponse =
  | { readonly payload: unknown }
  | { readonly failure: GenerationFailureCategory };

export interface FakeLanguageModelGatewayOptions {
  readonly provider?: string;
  readonly modelId?: string;
  /**
   * Provider turns, consumed in order.
   *
   * One entry is the normal case. A second entry is only reached when the first
   * fails the caller's validator, which is the repair attempt.
   */
  readonly responses?: readonly FakeGatewayResponse[];
  /** Token counts to report, or `null` to report none. */
  readonly usage?: ProviderUsage | null;
}

/** Token counts reported for a synthesised response. */
const DEFAULT_USAGE: ProviderUsage = {
  inputTokens: 420,
  outputTokens: 260,
  totalTokens: 680,
};

export class FakeLanguageModelGateway implements LanguageModelGateway {
  readonly provider: string;

  readonly modelId: string;

  private readonly responses: readonly FakeGatewayResponse[] | null;

  private readonly usage: ProviderUsage | null;

  private turn = 0;

  constructor(options: FakeLanguageModelGatewayOptions = {}) {
    this.provider = options.provider ?? "fake";
    this.modelId = options.modelId ?? "fake-deterministic";
    this.responses = options.responses ?? null;
    this.usage = options.usage === undefined ? DEFAULT_USAGE : options.usage;
  }

  /** How many provider turns have been taken, for tests that assert repair. */
  get turnsTaken(): number {
    return this.turn;
  }

  async generateStructured<Value>(
    request: StructuredGenerationRequest<Value>,
  ): Promise<StructuredGenerationResult<Value>> {
    const first = request.validate(this.nextPayload(request));

    if (first.ok) {
      return { value: first.value, usage: this.usage, repairAttempted: false };
    }

    // Exactly one repair attempt, then a clear failure — the same contract the
    // Bedrock adapter honours (`SPEC.md` section 11.2).
    const repaired = request.validate(this.nextPayload(request));

    if (repaired.ok) {
      return {
        value: repaired.value,
        usage: this.usage,
        repairAttempted: true,
      };
    }

    throw new ProviderFailure("MALFORMED_OUTPUT");
  }

  /**
   * The payload for this turn.
   *
   * A scripted run that has run out of entries fails rather than falling back to
   * synthesis: a test that scripted two turns and saw a third has found a bug in
   * the repair bound, and quietly inventing an answer would hide it.
   */
  private nextPayload<Value>(
    request: StructuredGenerationRequest<Value>,
  ): unknown {
    this.turn += 1;

    if (this.responses === null) {
      return synthesizePayload(request);
    }

    const scripted = this.responses[this.turn - 1];

    if (scripted === undefined) {
      throw new ProviderFailure("UNEXPECTED");
    }

    if ("failure" in scripted) {
      throw new ProviderFailure(scripted.failure);
    }

    return scripted.payload;
  }
}

/** What the fake reads back out of a rendered prompt. */
interface PromptFacts {
  readonly trackName: string;
  readonly itemCount: number;
  readonly objectiveIds: readonly string[];
  readonly questionTypes: readonly QuestionType[];
  readonly cardTypes: readonly CardType[];
}

function synthesizePayload<Value>(
  request: StructuredGenerationRequest<Value>,
): unknown {
  const facts = readPrompt(request.user);

  switch (request.schemaName) {
    case QUESTION_SCHEMA_NAME:
      return { questions: synthesizeQuestions(facts) };
    case FLASHCARD_SCHEMA_NAME:
      return { flashcards: synthesizeCards(facts) };
    default:
      // A schema this gateway has no fixture for is a wiring mistake, not a
      // provider problem, so it is loud.
      throw new Error(
        `The fake gateway has no fixture for schema "${request.schemaName}".`,
      );
  }
}

function synthesizeQuestions(facts: PromptFacts): readonly unknown[] {
  const types =
    facts.questionTypes.length > 0 ? facts.questionTypes : QUESTION_TYPES;

  return Array.from({ length: facts.itemCount }, (_unused, index) => {
    const position = index + 1;
    const type = types[index % types.length] ?? "SINGLE_CHOICE";
    const objectiveIds = pickObjective(facts.objectiveIds, index);
    const common = {
      questionType: type,
      difficulty: (index % 5) + 1,
      tags: ["demo", "fake-gateway"],
      objectiveIds,
      explanation: `Demo explanation ${position}. Option one is the fictional best answer for this made-up situation; the others are wrong because the demo says so.`,
    };

    if (type === "SHORT_ANSWER") {
      return {
        ...common,
        stem: `Demo short-answer question ${position} for ${facts.trackName}: describe, in your own words, the fictional approach this demo recommends.`,
        instructions: "Answer in two or three sentences.",
        expectedConcepts: [
          `Demo concept ${position}A`,
          `Demo concept ${position}B`,
        ],
      };
    }

    if (type === "MULTIPLE_RESPONSE") {
      return {
        ...common,
        stem: `Demo multiple-response question ${position} for ${facts.trackName}: which two fictional options does this demo scenario call for?`,
        instructions: "Choose two.",
        choices: [
          `Demo option ${position}A — the first fictional answer`,
          `Demo option ${position}B — the second fictional answer`,
          `Demo option ${position}C — a plausible but wrong demo option`,
          `Demo option ${position}D — another wrong demo option`,
        ],
        correctChoiceIndexes: [0, 1],
      };
    }

    return {
      ...common,
      stem: `Demo single-choice question ${position} for ${facts.trackName}: which fictional option does this demo scenario call for?`,
      instructions: null,
      choices: [
        `Demo option ${position}A — the fictional answer`,
        `Demo option ${position}B — a plausible but wrong demo option`,
        `Demo option ${position}C — another wrong demo option`,
        `Demo option ${position}D — a clearly wrong demo option`,
      ],
      correctChoiceIndexes: [0],
    };
  });
}

/**
 * Demo vocabulary for synthesised vocabulary cards.
 *
 * The first entry is the worked example from `SPEC.md` section 6.4, so a card the
 * specification describes is the first thing the fake produces for an HSK track.
 */
const DEMO_VOCABULARY: readonly {
  readonly term: string;
  readonly reading: string;
  readonly meaning: string;
  readonly exampleSentence: string;
}[] = [
  {
    term: "学习",
    reading: "xuéxí",
    meaning: "to study; to learn",
    exampleSentence: "我每天学习汉语。",
  },
  {
    term: "老师",
    reading: "lǎoshī",
    meaning: "teacher",
    exampleSentence: "我的老师很好。",
  },
  {
    term: "朋友",
    reading: "péngyou",
    meaning: "friend",
    exampleSentence: "他是我的朋友。",
  },
  {
    term: "喜欢",
    reading: "xǐhuan",
    meaning: "to like; to be fond of",
    exampleSentence: "我喜欢看书。",
  },
];

function synthesizeCards(facts: PromptFacts): readonly unknown[] {
  const types = facts.cardTypes.length > 0 ? facts.cardTypes : CARD_TYPES;

  return Array.from({ length: facts.itemCount }, (_unused, index) => {
    const position = index + 1;
    const type = types[index % types.length] ?? "BASIC";
    const objectiveIds = pickObjective(facts.objectiveIds, index);
    const common = {
      cardType: type,
      notes: `Demo note ${position}, written by the fake gateway.`,
      tags: ["demo", "fake-gateway"],
      objectiveIds,
    };

    switch (type) {
      case "BASIC":
        return {
          ...common,
          front: `Demo prompt ${position}: what does this fictional ${facts.trackName} term mean?`,
          back: `Demo answer ${position}: a made-up definition for study purposes.`,
        };
      case "REVERSED":
        return {
          ...common,
          front: `Demo term ${position} (${facts.trackName})`,
          back: `Demo definition ${position}, readable from either side.`,
        };
      case "CLOZE":
        return {
          ...common,
          text: `Demo card ${position}: the fictional answer is {{demo value ${position}}} in this made-up sentence.`,
        };
      case "VOCABULARY": {
        const entry =
          DEMO_VOCABULARY[index % DEMO_VOCABULARY.length] ?? DEMO_VOCABULARY[0];

        return { ...common, ...entry };
      }
      case "SCENARIO":
        return {
          ...common,
          scenario: `Demo scenario ${position}: a fictional situation on the ${facts.trackName} track.`,
          question: `What should the demo learner do first in scenario ${position}?`,
          answer: `Demo answer ${position}: take the fictional first step this demo describes.`,
        };
    }
  });
}

/** Objectives for one item: at most one, rotating through what was offered. */
function pickObjective(
  objectiveIds: readonly string[],
  index: number,
): readonly string[] {
  if (objectiveIds.length === 0) {
    return [];
  }

  const chosen = objectiveIds[index % objectiveIds.length];

  return chosen === undefined ? [] : [chosen];
}

/**
 * Facts the fake needs, read out of the rendered user message.
 *
 * Tolerant by design: a line it cannot find falls back to a usable default, so the
 * gateway keeps working when the template gains a line. What it must not do is
 * invent a *count*, because the item count is what the batch limit controls — an
 * unreadable count falls back to one item rather than to something larger.
 */
function readPrompt(user: string): PromptFacts {
  const questionTypes = QUESTION_TYPES.filter((type) =>
    matchList(user, "Allowed question types:").includes(
      describeQuestionType(type),
    ),
  );
  const cardTypes = CARD_TYPES.filter((type) =>
    matchList(user, "Allowed card types:").includes(describeCardType(type)),
  );

  return {
    trackName: matchLine(user, /^Study track: (.+)$/m) ?? "this study track",
    itemCount: readCount(user),
    objectiveIds: [...user.matchAll(/^- id: (\S+) \|/gm)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    ),
    questionTypes,
    cardTypes,
  };
}

function readCount(user: string): number {
  const raw = matchLine(user, /^Write (\d+) (?:question|flashcard)s?\.$/m);
  const parsed = Number(raw ?? "");

  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function matchLine(user: string, pattern: RegExp): string | null {
  return pattern.exec(user)?.[1] ?? null;
}

/** The comma-separated labels following a heading, or nothing. */
function matchList(user: string, prefix: string): readonly string[] {
  const line = user
    .split("\n")
    .find((candidate) => candidate.startsWith(prefix));

  if (line === undefined) {
    return [];
  }

  return line
    .slice(prefix.length)
    .replace(/\.$/, "")
    .split(",")
    .map((label) => label.trim());
}
