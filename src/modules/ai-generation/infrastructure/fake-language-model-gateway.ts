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
import { FAKE_MODEL_PROVIDER } from "@/modules/ai-generation/domain/generation-run";
import { ProviderFailure } from "@/modules/ai-generation/domain/errors";
import {
  ENRICHMENT_SCHEMA_NAME,
  FLASHCARD_SCHEMA_NAME,
  QUESTION_SCHEMA_NAME,
} from "@/modules/ai-generation/application/output-schemas";
import { OBJECTIVE_IMPORT_SCHEMA_NAME } from "@/modules/ai-generation/application/objective-import-schema";
import { OBJECTIVE_MERGE_SCHEMA_NAME } from "@/modules/ai-generation/application/objective-merge-schema";
import { QUESTION_REVIEW_SCHEMA_NAME } from "@/modules/ai-generation/application/question-review-schema";
import { ANSWER_EVALUATION_SCHEMA_NAME } from "@/modules/ai-generation/application/answer-evaluation-schema";
import { QUESTION_CHALLENGE_SCHEMA_NAME } from "@/modules/ai-generation/application/question-challenge-schema";
import { SOURCE_VERIFICATION_SCHEMA_NAME } from "@/modules/ai-generation/application/source-verification-schema";
import { TUTOR_SCHEMA_NAME } from "@/modules/ai-generation/application/tutor-schema";
import {
  TUTOR_ASK_KINDS,
  askInstruction,
} from "@/modules/ai-generation/domain/tutor-exchange";
import type { TutorAskKind } from "@/modules/ai-generation/domain/tutor-exchange";
import { MAX_IMPORT_NODES } from "@/modules/ai-generation/domain/objective-import";
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
  /**
   * What a synthesised objective import returns.
   *
   * `"OUTLINE"` reads the uploaded document out of the prompt and returns the outline
   * it states. `"MALFORMED"` returns an answer that cannot be valid whatever the
   * document said — a node with no title, nested past the depth cap — which is how the
   * repair attempt and the resulting failed run are exercised without scripting a
   * payload by hand. It applies to every turn, so both the first attempt and the
   * repair fail, which is the case the owner sees as `MALFORMED_OUTPUT`.
   */
  readonly objectiveImportMode?: "OUTLINE" | "MALFORMED";
  /**
   * What a synthesised objective merge returns.
   *
   * `"MERGE"` is the ordinary answer and the one worth describing, because it is extractive
   * in both directions at once and that is the whole point. It reads the extracted objectives
   * and the existing objectives out of the prompt, matches them on folded titles, and returns
   * `ENRICH` for a title the track already has *with* something to add, `SKIP` for one it has
   * with nothing to add, and `ADD` for everything else — nesting each addition under the
   * existing objective that its extracted parent matches, or under the addition that its
   * extracted parent became. So a facade that never sent the existing hierarchy produces a
   * plan that adds everything at the top level, and one that never sent the ids produces a
   * plan the checks reject; both are failing tests rather than passes.
   *
   * `"ADD_ALL"` adds every extracted objective at the top level, which is the coarse answer
   * the confirm page has to render sensibly. `"MALFORMED"` returns verdicts about refs that
   * were never sent and an id that does not exist, on every turn, so the failed-merge path —
   * which keeps the extraction and drops the reconciliation — is exercised without scripting a
   * payload by hand.
   */
  readonly objectiveMergeMode?: "MERGE" | "ADD_ALL" | "MALFORMED";
  /**
   * What a synthesised question review returns.
   *
   * `"SOUND"` approves the question, which is the path that promotes an unreviewed
   * question to `AI_REVIEWED`. `"MAJOR_ISSUES"` finds the answer wrong and recommends a
   * dispute, which is the path that must leave the quality state alone and offer the
   * prefilled dispute button. `"MALFORMED"` returns an answer that cannot be valid
   * whatever the question said, on every turn, so the repair attempt and the resulting
   * failed run are exercised without scripting a payload by hand.
   *
   * Three named modes rather than a scripted payload because these are the three
   * behaviours the review flow branches on, and a test that says which one it wants reads
   * better than one carrying a literal verdict object.
   */
  readonly questionReviewMode?: "SOUND" | "MAJOR_ISSUES" | "MALFORMED";
  /**
   * What a synthesised tutor answer returns.
   *
   * `"ANSWER"` answers the ask the prompt carried, in the shape that ask requires.
   * `"MALFORMED"` answers a different ask than the one that was made -- prose for a
   * follow-up request, a follow-up question for everything else -- which no repair can
   * rescue, so the failed-ask path is exercised without scripting a payload by hand.
   *
   * Two modes rather than the review's three, because a tutor answer has no verdict to
   * branch on: the six asks are the variation, and which one was made is read from the
   * prompt rather than configured here.
   */
  readonly tutorMode?: "ANSWER" | "MALFORMED";
  /**
   * What a synthesised answer grading returns.
   *
   * `"COVERED"` marks the answer as covering every concept the question recorded, which is
   * the path whose recommendation is the `CORRECT` self-grade. `"PARTIAL"` covers the first
   * concept and misses the rest, which is the path that recommends nothing — a
   * `PARTIALLY_CORRECT` verdict deliberately leaves the call to the owner. `"MALFORMED"`
   * returns a grading that cannot be valid whatever the question said, on every turn, so
   * the failed-grading path is exercised without scripting a payload by hand.
   *
   * All three read the concepts out of the prompt rather than inventing them, because
   * `checkAnswerEvaluation` rejects a concept the question does not have: a fixture that
   * made them up would turn every grading test into a malformed-output test.
   */
  readonly answerEvaluationMode?: "COVERED" | "PARTIAL" | "MALFORMED";
  /**
   * What a synthesised challenge outcome returns.
   *
   * One mode per branch the challenge panel has: `"STANDS"` upholds the stored answer and
   * recommends `KEEP`, `"OWNER_POINT"` finds the question ambiguous and recommends
   * `DISPUTE` — the path that offers the prefilled dispute button — and `"WRONG_REVISE"`
   * finds the stored answer wrong and recommends `REVISE` with a note, which is the path
   * that sends the owner to the edit form they already have. `"MALFORMED"` violates
   * `checkChallengeConsistency` on every turn.
   */
  readonly challengeMode?:
    "STANDS" | "OWNER_POINT" | "WRONG_REVISE" | "MALFORMED";
  /**
   * What a synthesised source check returns.
   *
   * One mode per branch the verification panel has: `"SUPPORTED"` is the path that offers
   * the `SOURCE_CHECKED` promotion, `"NOT_SUPPORTED"` is the ordinary answer for an
   * incomplete source library and offers nothing, `"CONTRADICTED"` is the path that offers
   * the prefilled dispute, and `"MALFORMED"` returns a verdict that is not a verdict on
   * every turn.
   *
   * Every mode reads the excerpts out of the prompt and cites them by the numbers it was
   * given, so a facade that never sent the passages produces a check that cites nothing —
   * which is the mistake this fixture exists to catch, because a verification of no
   * evidence would otherwise still validate.
   */
  readonly sourceVerificationMode?:
    "SUPPORTED" | "NOT_SUPPORTED" | "CONTRADICTED" | "MALFORMED";
}

/** One prompt as the gateway received it, for tests that inspect what was sent. */
export interface SentPrompt {
  readonly system: string;
  readonly user: string;
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

  private readonly objectiveImportMode: "OUTLINE" | "MALFORMED";

  private readonly objectiveMergeMode: "MERGE" | "ADD_ALL" | "MALFORMED";

  private readonly questionReviewMode: "SOUND" | "MAJOR_ISSUES" | "MALFORMED";

  private readonly tutorMode: "ANSWER" | "MALFORMED";

  private readonly answerEvaluationMode: "COVERED" | "PARTIAL" | "MALFORMED";

  private readonly challengeMode:
    "STANDS" | "OWNER_POINT" | "WRONG_REVISE" | "MALFORMED";

  private readonly sourceVerificationMode:
    "SUPPORTED" | "NOT_SUPPORTED" | "CONTRADICTED" | "MALFORMED";

  private turn = 0;

  private readonly prompts: SentPrompt[] = [];

  constructor(options: FakeLanguageModelGatewayOptions = {}) {
    this.provider = options.provider ?? FAKE_MODEL_PROVIDER;
    this.modelId = options.modelId ?? "fake-deterministic";
    this.responses = options.responses ?? null;
    this.usage = options.usage === undefined ? DEFAULT_USAGE : options.usage;
    this.objectiveImportMode = options.objectiveImportMode ?? "OUTLINE";
    this.objectiveMergeMode = options.objectiveMergeMode ?? "MERGE";
    this.questionReviewMode = options.questionReviewMode ?? "SOUND";
    this.tutorMode = options.tutorMode ?? "ANSWER";
    this.answerEvaluationMode = options.answerEvaluationMode ?? "COVERED";
    this.challengeMode = options.challengeMode ?? "STANDS";
    this.sourceVerificationMode = options.sourceVerificationMode ?? "SUPPORTED";
  }

  /** How many provider turns have been taken, for tests that assert repair. */
  get turnsTaken(): number {
    return this.turn;
  }

  /**
   * Every prompt this gateway was sent, in order.
   *
   * Exposed so an application-level test can assert what actually reached the model
   * without reaching into the template itself: rendering is covered by the template's
   * own tests, but *that the facade passed the right context* is only observable here.
   */
  get promptsSent(): readonly SentPrompt[] {
    return this.prompts;
  }

  async generateStructured<Value>(
    request: StructuredGenerationRequest<Value>,
  ): Promise<StructuredGenerationResult<Value>> {
    this.prompts.push({ system: request.system, user: request.user });

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
      return synthesizePayload(request, {
        objectiveImportMode: this.objectiveImportMode,
        objectiveMergeMode: this.objectiveMergeMode,
        questionReviewMode: this.questionReviewMode,
        tutorMode: this.tutorMode,
        answerEvaluationMode: this.answerEvaluationMode,
        challengeMode: this.challengeMode,
        sourceVerificationMode: this.sourceVerificationMode,
      });
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
  /** The words an enrichment prompt asked about, in the order they were listed. */
  readonly enrichmentTerms: readonly string[];
  /** The uploaded document an import prompt carried, as extracted text. */
  readonly uploadedDocument: string;
  /** The stem of the question a review prompt carried, or empty. */
  readonly reviewedStem: string;
  /** The stem of the question a tutor prompt carried, or empty. */
  readonly tutoredStem: string;
  /** Which of the six things a tutor prompt asked for, or `null` if none did. */
  readonly tutorAskKind: TutorAskKind | null;
  /** The choice identifier a choice-by-choice ask named, or empty. */
  readonly tutorChoiceId: string;
  /** The stem of the question a grading prompt carried, or empty. */
  readonly gradedStem: string;
  /** The concepts a grading prompt listed with that question, in order. */
  readonly gradedConcepts: readonly string[];
  /** The answer the owner wrote, as a grading prompt carried it. */
  readonly writtenAnswer: string;
  /** The stem of the question a challenge prompt carried, or empty. */
  readonly challengedStem: string;
  /** The objection the owner raised, as a challenge prompt carried it. */
  readonly ownerObjection: string;
  /**
   * The numbered source excerpts a grounded prompt carried, in the order they were sent.
   *
   * Read out of `<owner_source_excerpts>` and keyed by the number the template wrote, so a
   * fixture that cites an excerpt cites one that was actually sent. Empty for every
   * ungrounded prompt, which is what makes "cite nothing when nothing was sent" the
   * fixture's default rather than a rule it has to remember.
   */
  readonly sourceExcerpts: readonly {
    readonly index: number;
    readonly text: string;
  }[];
  /**
   * The objectives the track already had, as a merge prompt described them.
   *
   * Keyed by database id, because that is how the merge contract addresses an existing
   * objective and therefore the only key a verdict may name. Empty for every prompt that is
   * not a merge — which is what makes "a merge that was sent no hierarchy can only add"
   * the fixture's behaviour rather than a case it has to special-case.
   */
  readonly mergeExisting: readonly MergeLine[];
  /**
   * The objectives the extraction proposed, as a merge prompt described them.
   *
   * Keyed by the ref the sender assigned (`n1`, `n2`, …), so a fixture's verdicts are about
   * nodes that were actually sent and a facade that forgot to send the extracted outline
   * produces an empty plan rather than a plausible one.
   */
  readonly mergeExtracted: readonly MergeLine[];
}

function synthesizePayload<Value>(
  request: StructuredGenerationRequest<Value>,
  modes: {
    readonly objectiveImportMode: "OUTLINE" | "MALFORMED";
    readonly objectiveMergeMode: "MERGE" | "ADD_ALL" | "MALFORMED";
    readonly questionReviewMode: "SOUND" | "MAJOR_ISSUES" | "MALFORMED";
    readonly tutorMode: "ANSWER" | "MALFORMED";
    readonly answerEvaluationMode: "COVERED" | "PARTIAL" | "MALFORMED";
    readonly challengeMode:
      "STANDS" | "OWNER_POINT" | "WRONG_REVISE" | "MALFORMED";
    readonly sourceVerificationMode:
      "SUPPORTED" | "NOT_SUPPORTED" | "CONTRADICTED" | "MALFORMED";
  },
): unknown {
  const facts = readPrompt(request.user);

  switch (request.schemaName) {
    case QUESTION_SCHEMA_NAME:
      return { questions: synthesizeQuestions(facts) };
    case FLASHCARD_SCHEMA_NAME:
      return { flashcards: synthesizeCards(facts) };
    case ENRICHMENT_SCHEMA_NAME:
      return { words: synthesizeEnrichments(facts) };
    case OBJECTIVE_IMPORT_SCHEMA_NAME:
      return modes.objectiveImportMode === "MALFORMED"
        ? malformedOutline()
        : { objectives: extractOutline(facts.uploadedDocument) };
    case OBJECTIVE_MERGE_SCHEMA_NAME:
      return synthesizeMerge(facts, modes.objectiveMergeMode);
    case QUESTION_REVIEW_SCHEMA_NAME:
      return synthesizeReview(facts, modes.questionReviewMode);
    case TUTOR_SCHEMA_NAME:
      return synthesizeTutorAnswer(facts, modes.tutorMode);
    case ANSWER_EVALUATION_SCHEMA_NAME:
      return synthesizeEvaluation(facts, modes.answerEvaluationMode);
    case QUESTION_CHALLENGE_SCHEMA_NAME:
      return synthesizeChallenge(facts, modes.challengeMode);
    case SOURCE_VERIFICATION_SCHEMA_NAME:
      return synthesizeSourceVerification(facts, modes.sourceVerificationMode);
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
    // One excerpt per question, rotating through the ones that were sent. Cited by the
    // number the prompt gave, so a grounded batch produces questions that pass the
    // grounding check and an ungrounded one cites nothing at all — which is what makes the
    // two modes distinguishable through one fixture. Nothing is cited when nothing was
    // sent, so a model-knowledge batch is unchanged by grounding existing.
    const cited =
      facts.sourceExcerpts.length === 0
        ? null
        : (facts.sourceExcerpts[index % facts.sourceExcerpts.length] ?? null);
    const common = {
      questionType: type,
      difficulty: (index % 5) + 1,
      tags: ["demo", "fake-gateway"],
      objectiveIds,
      explanation:
        cited === null
          ? `Demo explanation ${position}. Option one is the fictional best answer for this made-up situation; the others are wrong because the demo says so.`
          : `Demo explanation ${position}, from excerpt ${cited.index} of the owner's own sources, which begins "${cited.text.slice(0, 80)}". Option one is the fictional best answer; nothing outside the excerpts was used.`,
      ...(cited === null ? {} : { supportingExcerptIndexes: [cited.index] }),
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

/**
 * Enrichment for every word the prompt listed, echoing each term back.
 *
 * The echo is not decoration: matching is by term, so a fixture that invented its
 * own words would be rejected by the same check that catches a real model drifting.
 * That makes the fake exercise the matching path rather than bypassing it.
 *
 * One entry is deliberately produced per word *in the order given*, because the
 * template asks for that and a test asserting per-card outcomes needs to know which
 * answer belongs to which card.
 */
function synthesizeEnrichments(facts: PromptFacts): readonly unknown[] {
  return facts.enrichmentTerms.map((term, index) => {
    const position = index + 1;

    return {
      term,
      meanings: [
        `demo sense ${position} of ${term}`,
        `demo secondary sense ${position}`,
      ],
      synonyms: [`demo-synonym-${position}`],
      antonyms: index % 2 === 0 ? [`demo-antonym-${position}`] : [],
      // Two examples, both containing the term, because the deterministic checks
      // require at least two and require the word to appear in one of them.
      examples: [
        {
          text: `${term}${DEMO_EXAMPLE_TAIL}${position}。`,
          reading: `demo pinyin ${position}`,
          translation: `Demo translation ${position} using ${term}.`,
        },
        {
          text: `${DEMO_EXAMPLE_LEAD}${term}${position}。`,
          reading: `demo pinyin ${position}b`,
          translation: `Second demo translation ${position}.`,
        },
      ],
      usageNotes: `Demo usage note ${position}, written by the fake gateway. Not a real dictionary entry.`,
    };
  });
}

/** Filler around a demo example, so the sentence is not just the term. */
const DEMO_EXAMPLE_TAIL = "是这个示例里的词，编号";
const DEMO_EXAMPLE_LEAD = "示例句子包含";

/**
 * The outline a document states, read out of the prompt rather than invented.
 *
 * This is the fake's one genuinely *extractive* fixture, and it is extractive on
 * purpose. Returning a fixed demo tree would make every objective-import test pass
 * regardless of whether the document ever reached the model, which is the one thing
 * those tests exist to check. So it parses what the prompt actually carried: a line
 * beginning with a dotted number is an objective, its depth is how many segments the
 * number has, and a trailing `(20%)` is its weight. That is enough structure for a
 * synthetic fixture to assert a specific tree, and it means a facade that forgot to
 * pass `syllabusText` produces an empty outline and a failing test.
 *
 * A real model does far more than this — it reads prose, tables, and broken columns.
 * The fake is not pretending otherwise; it is being deterministic about the one shape
 * the test fixtures use, and the caps are applied so the fixture cannot accidentally
 * produce output the validator would reject for size.
 */
function extractOutline(document: string): readonly unknown[] {
  interface Draft {
    code: string;
    title: string;
    weight: number | null;
    depth: number;
    children: Draft[];
  }

  const roots: Draft[] = [];
  // The most recent draft at each depth, so a child attaches to the line above it.
  const openByDepth = new Map<number, Draft>();
  let produced = 0;

  for (const line of document.split("\n")) {
    const match = /^\s*(\d+(?:\.\d+)*)\.?\s+(.+?)\s*$/.exec(line);

    if (match === null || produced >= MAX_IMPORT_NODES) {
      continue;
    }

    const code = match[1] ?? "";
    const rest = match[2] ?? "";
    const weightMatch = /^(.*?)\s*\(\s*(\d+(?:\.\d+)?)\s*%\s*\)$/.exec(rest);
    const title = (weightMatch === null ? rest : (weightMatch[1] ?? "")).trim();

    if (title.length === 0) {
      continue;
    }

    const draft: Draft = {
      code,
      title,
      weight: weightMatch === null ? null : Number(weightMatch[2]),
      depth: code.split(".").length,
      children: [],
    };
    const parent = openByDepth.get(draft.depth - 1);

    if (draft.depth === 1 || parent === undefined) {
      roots.push(draft);
    } else {
      parent.children.push(draft);
    }

    openByDepth.set(draft.depth, draft);
    produced += 1;
  }

  const toPayload = (draft: Draft): unknown => ({
    code: draft.code,
    title: draft.title,
    // No description: the fixture has nothing to say beyond the title, and the
    // template tells a model to leave it out in exactly that case.
    weight: draft.weight,
    children: draft.children.map(toPayload),
  });

  return roots.map(toPayload);
}

/** One line of either outline block, as the merge template writes it. */
interface MergeLine {
  /** `id` for an existing objective, `ref` for an extracted one. */
  readonly key: string;
  readonly title: string;
  readonly description: string | null;
  readonly code: string | null;
  readonly weight: number | null;
  /** The parent's key, or `null` for `parent: none`. */
  readonly parent: string | null;
}

/**
 * The two outlines a merge prompt carried, read out of their own delimiters.
 *
 * `- id: x | title: y | ...` and `- ref: n1 | title: y | ...`, which is exactly what the
 * template writes. Keyed by whichever of `id`/`ref` opens the line, so one reader serves both
 * blocks and a template that stopped writing identifiers produces empty lists — an unusable
 * plan and a failing test rather than an invented pass.
 */
function readMergeLines(user: string, tag: string): readonly MergeLine[] {
  return readDelimitedBlock(user, tag)
    .split("\n")
    .flatMap((line) => {
      const trimmed = line.trim();

      if (!trimmed.startsWith("- ")) {
        return [];
      }

      const fields = new Map(
        trimmed
          .slice(2)
          .split(" | ")
          .flatMap((field) => {
            const separator = field.indexOf(": ");

            return separator === -1
              ? []
              : [
                  [
                    field.slice(0, separator).trim(),
                    field.slice(separator + 2).trim(),
                  ] as const,
                ];
          }),
      );
      const key = fields.get("id") ?? fields.get("ref");
      const title = fields.get("title");

      if (key === undefined || title === undefined) {
        return [];
      }

      const parent = fields.get("parent") ?? "none";
      const weight = fields.get("weight");

      return [
        {
          key,
          title,
          description: fields.get("description") ?? null,
          code: fields.get("code") ?? null,
          weight:
            weight === undefined ? null : Number(weight.replace(/%$/, "")),
          parent: parent === "none" ? null : parent,
        },
      ];
    });
}

/**
 * A reconciliation of the two outlines the prompt carried.
 *
 * Extractive on both sides, for the reason the outline fixture is extractive on one: a fixed
 * demo plan would pass whether or not the facade ever sent the existing hierarchy, and
 * "did the merge actually see the track's objectives" is the single thing the merge tests
 * exist to check. Matching is on folded titles, which is *not* what a real model does — it
 * reads meaning — but it is the one deterministic rule that produces all three verdicts from
 * real inputs, which is what the fixtures need.
 */
function synthesizeMerge(
  facts: PromptFacts,
  mode: "MERGE" | "ADD_ALL" | "MALFORMED",
): unknown {
  const extracted = facts.mergeExtracted;
  const existing = facts.mergeExisting;

  if (mode === "MALFORMED") {
    // Wrong in three independent ways — a ref that was never sent, an existing id that does
    // not exist, and two verdicts for one ref — so no repair rescues it and it stays invalid
    // if any one check is relaxed.
    return {
      items: [
        {
          kind: "ADD",
          ref: "not-a-ref-that-was-sent",
          title: "Invented",
        },
        {
          kind: "ENRICH",
          ref: extracted[0]?.key ?? "n1",
          existingId: "objective-that-does-not-exist",
          description: "Malformed demo enrichment.",
        },
        {
          kind: "ENRICH",
          ref: extracted[0]?.key ?? "n1",
          existingId: "objective-that-does-not-exist",
          description: "Malformed demo enrichment, again.",
        },
      ],
      summary: "Malformed demo merge.",
    };
  }

  if (mode === "ADD_ALL") {
    return {
      items: extracted.map((node) => ({
        kind: "ADD",
        ref: node.key,
        // Deliberately top-level, including for nodes that had a parent: this is the coarse
        // answer, and the confirm page has to render it without inventing nesting.
        parentExistingId: null,
        parentRef: null,
        code: node.code,
        title: node.title,
        description: node.description,
        weight: node.weight,
      })),
      summary: `Demo merge from the fake gateway: all ${extracted.length} extracted objectives added as new top-level objectives. No model was called.`,
    };
  }

  const fold = (value: string) => value.trim().toLowerCase();
  const existingByTitle = new Map(
    existing.map((node) => [fold(node.title), node]),
  );
  /** Which verdict each extracted ref got, so a child can be parented onto it. */
  const verdictByRef = new Map<string, { kind: string; targetId: string }>();
  const items = extracted.map((node) => {
    const match = existingByTitle.get(fold(node.title));

    if (match !== undefined) {
      verdictByRef.set(node.key, { kind: "MATCHED", targetId: match.key });

      // Something to add to what is recorded, so it is an enrichment; nothing to add, so it
      // is a duplicate. The existing description is not in the prompt (the merge template
      // deliberately sends titles and codes only), so "has something to add" is decided by
      // the extracted node carrying a description at all.
      return node.description === null
        ? {
            kind: "SKIP",
            ref: node.key,
            reason: `Demo skip from the fake gateway: "${node.title}" is already on this track and the new material adds nothing to it.`,
            matchedExistingId: match.key,
          }
        : {
            kind: "ENRICH",
            ref: node.key,
            existingId: match.key,
            description: `${node.description} (Demo enrichment from the fake gateway; no model was called.)`,
          };
    }

    // Where the addition goes: under the existing objective its extracted parent matched, or
    // under the addition its extracted parent became, or nowhere.
    const parentVerdict =
      node.parent === null ? undefined : verdictByRef.get(node.parent);

    verdictByRef.set(node.key, { kind: "ADD", targetId: node.key });

    return {
      kind: "ADD",
      ref: node.key,
      parentExistingId:
        parentVerdict?.kind === "MATCHED" ? parentVerdict.targetId : null,
      parentRef: parentVerdict?.kind === "ADD" ? parentVerdict.targetId : null,
      code: node.code,
      title: node.title,
      description: node.description,
      weight: node.weight,
    };
  });
  const adds = items.filter((item) => item.kind === "ADD").length;
  const enriches = items.filter((item) => item.kind === "ENRICH").length;
  const skips = items.filter((item) => item.kind === "SKIP").length;

  return {
    items,
    summary: `Demo merge from the fake gateway against ${existing.length} existing ${existing.length === 1 ? "objective" : "objectives"}: ${adds} added, ${enriches} enriched, ${skips} already covered. No model was called.`,
  };
}

/**
 * An answer that cannot be valid, for exercising the repair bound.
 *
 * Wrong in two independent ways — an empty title and a fourth level of nesting — so it
 * fails whichever check runs first and stays invalid if one of the caps is ever
 * relaxed.
 */
function malformedOutline(): unknown {
  return {
    objectives: [
      {
        title: "",
        children: [
          {
            title: "Too deep",
            children: [{ title: "Deeper", children: [{ title: "Deepest" }] }],
          },
        ],
      },
    ],
  };
}

/**
 * A review of the question the prompt carried.
 *
 * Extractive in the one way that matters: the summary quotes the beginning of the stem the
 * prompt actually contained, read out of the `<owner_question_under_review>` block. A fixed
 * demo verdict would pass whether or not the facade ever sent the revision, which is the
 * one thing the review tests exist to check — so a facade that forgot `reviewedRevision`
 * produces a summary with no stem in it and a failing test.
 *
 * The three modes are shaped to satisfy `checkReviewConsistency` (or, for `MALFORMED`, to
 * violate it in a way no repair can rescue), because a fixture the validator rejects would
 * make every test look like a malformed-output test.
 */
function synthesizeReview(
  facts: PromptFacts,
  mode: "SOUND" | "MAJOR_ISSUES" | "MALFORMED",
): unknown {
  const excerpt = facts.reviewedStem.slice(0, 60);

  switch (mode) {
    case "SOUND":
      return {
        verdict: "SOUND",
        answerCorrect: true,
        findings: [
          {
            severity: "INFO",
            category: "OTHER",
            detail:
              "Demo note from the fake gateway: nothing is wrong with this question. No model was called.",
          },
        ],
        suggestedAction: "APPROVE",
        summary: `Demo review by the fake gateway: the marked answer is correct for "${excerpt}".`,
      };
    case "MAJOR_ISSUES":
      return {
        verdict: "MAJOR_ISSUES",
        answerCorrect: false,
        findings: [
          {
            severity: "MAJOR",
            category: "WRONG_ANSWER",
            detail:
              "Demo finding from the fake gateway: the marked answer is treated as wrong so the failing path can be exercised. No model was called.",
          },
          {
            severity: "MINOR",
            category: "WEAK_DISTRACTOR",
            detail:
              "Demo finding from the fake gateway: one distractor is implausible.",
          },
        ],
        suggestedAction: "DISPUTE",
        summary: `Demo review by the fake gateway: the marked answer looks wrong for "${excerpt}".`,
      };
    case "MALFORMED":
      // Wrong in two independent ways — a verdict of SOUND with a MAJOR finding, and an
      // empty summary — so it stays invalid if either rule is ever relaxed.
      return {
        verdict: "SOUND",
        answerCorrect: true,
        findings: [
          { severity: "MAJOR", category: "WRONG_ANSWER", detail: "Malformed." },
        ],
        suggestedAction: "APPROVE",
        summary: "",
      };
  }
}

/**
 * An answer to the one thing a tutor prompt asked.
 *
 * Extractive in the same way the review fixture is: the answer quotes the start of the stem
 * read out of `<owner_question_being_studied>`, so a facade that forgot to send the
 * revision produces an answer with no stem in it and a failing test. The ask is read from
 * the prompt too, so the *shape* of the payload follows what was actually asked rather than
 * what a test remembered to configure -- which is what makes the six asks testable through
 * one fixture.
 *
 * Every synthesised answer says in words that nothing was looked up, because that is what a
 * real answer must be able to say and a fixture that omitted it would let the panel ship
 * without the claim (`spec/AI-GUIDELINES.md` section 1.2).
 */
function synthesizeTutorAnswer(
  facts: PromptFacts,
  mode: "ANSWER" | "MALFORMED",
): unknown {
  const excerpt = facts.tutoredStem.slice(0, 60);
  const kind = facts.tutorAskKind;

  if (mode === "MALFORMED") {
    // Answers the wrong ask, whichever ask was made, so both the first attempt and the
    // repair fail the kind check and the owner sees MALFORMED_OUTPUT.
    return kind === "FOLLOW_UP_QUESTION"
      ? { kind: "EXPLAIN_ANSWER", text: "Malformed demo answer." }
      : {
          kind: "FOLLOW_UP_QUESTION",
          stem: "Malformed demo follow-up?",
          answer: "Malformed.",
          explanation: "Malformed demo explanation.",
        };
  }

  // No ask was found in the prompt, so there is nothing to answer. Returned as an empty
  // answer rather than thrown, so a template that stopped rendering the ask shows up as a
  // failed run in a facade test rather than as a crash inside the fake.
  if (kind === null) {
    return { kind: "EXPLAIN_ANSWER", text: "" };
  }

  if (kind === "FOLLOW_UP_QUESTION") {
    return {
      kind,
      stem: `Demo follow-up from the fake gateway about "${excerpt}": what would change if the situation were reversed?`,
      answer:
        "Demo answer: the fictional opposite of what the stored question says.",
      explanation:
        "Demo explanation from the fake gateway. No model was called and nothing was looked up.",
    };
  }

  const text = `${describeDemoAsk(kind)} for "${excerpt}". This is demo text from the fake gateway: no model was called and nothing was looked up, so it cites nothing.`;

  return kind === "EXPLAIN_CHOICE"
    ? { kind, choiceId: facts.tutorChoiceId, text }
    : { kind, text };
}

/**
 * A grading of the answer the prompt carried, against the concepts it listed.
 *
 * Extractive twice over, and both halves are load-bearing. The concepts are echoed from the
 * prompt because `checkAnswerEvaluation` refuses a concept the question does not record — so
 * a facade that forgot to send the revision produces a grading naming nothing, and one that
 * forgot the concepts produces empty lists. The feedback quotes the start of the owner's own
 * answer, so a facade that forgot to send *that* is visible too, which is the mistake a
 * grading fixture most needs to catch: a grading of an answer nobody supplied would still
 * validate.
 */
function synthesizeEvaluation(
  facts: PromptFacts,
  mode: "COVERED" | "PARTIAL" | "MALFORMED",
): unknown {
  const concepts = facts.gradedConcepts;
  const excerpt = facts.writtenAnswer.slice(0, 60);
  const [first, ...rest] = concepts;

  switch (mode) {
    case "COVERED":
      return {
        verdict: concepts.length === 0 ? "PARTIALLY_CORRECT" : "CORRECT",
        conceptsCovered: [...concepts],
        conceptsMissed: [],
        feedback: `Demo grading by the fake gateway: your answer, which begins "${excerpt}", mentions everything the question asks for. No model was called.`,
      };
    case "PARTIAL":
      return {
        verdict: "PARTIALLY_CORRECT",
        conceptsCovered: first === undefined ? [] : [first],
        conceptsMissed: [...rest],
        feedback: `Demo grading by the fake gateway: your answer, which begins "${excerpt}", covers part of what the question asks for. No model was called.`,
      };
    case "MALFORMED":
      // Wrong in two independent ways — a CORRECT verdict with a concept missed, and a
      // concept that belongs to no question — so it stays invalid if either rule is
      // relaxed, and no repair can rescue it.
      return {
        verdict: "CORRECT",
        conceptsCovered: [],
        conceptsMissed: ["a concept this question never recorded"],
        feedback: "Malformed demo grading.",
      };
  }
}

/**
 * An outcome for the objection the prompt carried.
 *
 * Extractive in the same way and for the same reason: the reasoning quotes the start of the
 * owner's objection, so a facade that never sent it produces reasoning with nothing in it
 * and a failing test — which matters more here than anywhere else, because a challenge that
 * adjudicated no objection would still be a valid-looking verdict.
 *
 * Each mode satisfies `checkChallengeConsistency`, or for `MALFORMED` violates it in a way
 * no repair can rescue.
 */
function synthesizeChallenge(
  facts: PromptFacts,
  mode: "STANDS" | "OWNER_POINT" | "WRONG_REVISE" | "MALFORMED",
): unknown {
  const objection = facts.ownerObjection.slice(0, 60);
  const excerpt = facts.challengedStem.slice(0, 60);
  const lede = `Demo challenge outcome from the fake gateway, for the objection beginning "${objection}" against "${excerpt}". No model was called and nothing was looked up.`;

  switch (mode) {
    case "STANDS":
      return {
        verdict: "STORED_ANSWER_STANDS",
        reasoning: `${lede} Taking your objection at its strongest, it would hold if the demo scenario were different; as the question is written, the marked answer is the one it calls for.`,
        recommendation: "KEEP",
        suggestedRevisionNote: null,
      };
    case "OWNER_POINT":
      return {
        verdict: "OWNER_HAS_A_POINT",
        reasoning: `${lede} Your reading is defensible and so is the stored answer, which makes the question ambiguous rather than either of you wrong.`,
        recommendation: "DISPUTE",
        suggestedRevisionNote: null,
      };
    case "WRONG_REVISE":
      return {
        verdict: "STORED_ANSWER_WRONG",
        reasoning: `${lede} Your objection holds: the answer this question marks correct is not the one the stem describes.`,
        recommendation: "REVISE",
        suggestedRevisionNote:
          "Demo note from the fake gateway: the stem needs to state the missing condition, and the answer key needs to move to the option your objection named.",
      };
    case "MALFORMED":
      // Wrong in two independent ways — KEEP on a STORED_ANSWER_WRONG verdict, and a note
      // alongside KEEP — so it stays invalid if either rule is relaxed.
      return {
        verdict: "STORED_ANSWER_WRONG",
        reasoning: "Malformed demo challenge outcome.",
        recommendation: "KEEP",
        suggestedRevisionNote: "Malformed note.",
      };
  }
}

/**
 * A verdict on the excerpts the prompt carried.
 *
 * Extractive in the way that matters most for this kind: the summary quotes the start of the
 * first excerpt, and the per-excerpt assessments cite the numbers the prompt gave. So a
 * facade that never sent the passages produces a check citing nothing and quoting nothing,
 * and a facade that sent them under the wrong delimiters produces the same — which is the
 * failure a source check must never pass silently, because a verdict with no evidence behind
 * it still validates and would still be shown to the owner as "checked against my sources".
 *
 * Every mode says in words that only the excerpts were consulted, because that is the claim
 * a real check has to be able to make and a fixture that omitted it would let the panel ship
 * without it (`spec/AI-GUIDELINES.md` section 1.2).
 */
function synthesizeSourceVerification(
  facts: PromptFacts,
  mode: "SUPPORTED" | "NOT_SUPPORTED" | "CONTRADICTED" | "MALFORMED",
): unknown {
  const excerpts = facts.sourceExcerpts;
  const first = excerpts[0];
  const quoted = (first?.text ?? "").slice(0, 60);
  const stem = facts.reviewedStem.slice(0, 60);
  const lede = `Demo source check from the fake gateway for "${stem}", against ${excerpts.length === 1 ? "one passage" : `${excerpts.length} passages`} beginning "${quoted}". No model was called and nothing outside the excerpts was consulted.`;

  if (mode === "MALFORMED") {
    // Not a verdict and not a summary, on every turn, so no repair can rescue it.
    return { verdict: "PROBABLY_FINE", summary: "", excerpts: [] };
  }

  if (mode === "CONTRADICTED") {
    return {
      verdict: "CONTRADICTED",
      summary: `${lede} The passage states the fictional opposite of the answer this question marks correct.`,
      excerpts: excerpts.map((excerpt, index) => ({
        excerptIndex: excerpt.index,
        relevance: index === 0 ? "CONTRADICTS" : "UNRELATED",
        note:
          index === 0
            ? "Demo note: this passage says something incompatible with the marked answer."
            : null,
      })),
    };
  }

  if (mode === "NOT_SUPPORTED") {
    return {
      verdict: "NOT_SUPPORTED",
      summary: `${lede} None of these passages addresses what the question asks, so they are silent about it rather than disagreeing with it.`,
      excerpts: excerpts.map((excerpt) => ({
        excerptIndex: excerpt.index,
        relevance: "UNRELATED",
        note: null,
      })),
    };
  }

  return {
    // With no excerpts there is nothing that could support the answer, so the fixture says
    // so rather than claiming support it was shown no basis for.
    verdict: excerpts.length === 0 ? "NOT_SUPPORTED" : "SUPPORTED",
    summary: `${lede} The passages state what the question marks correct.`,
    excerpts: excerpts.map((excerpt) => ({
      excerptIndex: excerpt.index,
      relevance: "SUPPORTS",
      note: "Demo note: this passage states the marked answer.",
    })),
  };
}

/** How each synthesised answer opens, so the fixture is visibly per-ask. */
function describeDemoAsk(
  kind: Exclude<TutorAskKind, "FOLLOW_UP_QUESTION">,
): string {
  switch (kind) {
    case "EXPLAIN_ANSWER":
      return "Demo explanation of the marked answer";
    case "EXPLAIN_CHOICE":
      return "Demo explanation of why that choice is not the one";
    case "EXPLAIN_SIMPLER":
      return "Demo plain-language explanation";
    case "EXPLAIN_TECHNICAL":
      return "Demo technical explanation";
    case "GIVE_EXAMPLE":
      return "Demo worked example";
  }
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
    enrichmentTerms: readEnrichmentTerms(user),
    uploadedDocument: readDelimitedBlock(user, "owner_uploaded_document"),
    reviewedStem: readStem(user, "owner_question_under_review"),
    tutoredStem: readStem(user, "owner_question_being_studied"),
    tutorAskKind: readTutorAskKind(user),
    tutorChoiceId:
      matchLine(user, /^Return that identifier, (\S+?), as choiceId\b/m) ?? "",
    gradedStem: readStem(user, "owner_question_being_marked"),
    gradedConcepts: readExpectedConcepts(user, "owner_question_being_marked"),
    writtenAnswer: readDelimitedBlock(user, "owner_written_answer"),
    challengedStem: readStem(user, "owner_question_being_challenged"),
    ownerObjection: readDelimitedBlock(user, "owner_objection"),
    sourceExcerpts: readSourceExcerpts(user),
    mergeExisting: readMergeLines(user, "owner_existing_objectives"),
    mergeExtracted: readMergeLines(user, "owner_extracted_objectives"),
  };
}

/**
 * The numbered excerpts inside the source block, in order.
 *
 * Each is introduced by `[Excerpt N] from "title"` and followed by its text, so the number
 * is read from the prompt rather than assumed from position: a template that renumbered its
 * excerpts would produce citations that follow the renumbering, and one that stopped
 * numbering them produces no citations at all.
 */
function readSourceExcerpts(
  user: string,
): readonly { readonly index: number; readonly text: string }[] {
  const block = readDelimitedBlock(user, "owner_source_excerpts");
  const excerpts: { index: number; text: string }[] = [];
  let current: { index: number; text: string } | null = null;

  for (const line of block.split("\n")) {
    const header = /^\[Excerpt (\d+)\] from /.exec(line);

    if (header?.[1] !== undefined) {
      current = { index: Number(header[1]), text: "" };
      excerpts.push(current);
      continue;
    }

    if (current !== null && line.trim().length > 0) {
      current.text =
        current.text.length === 0 ? line : `${current.text}\n${line}`;
    }
  }

  return excerpts;
}

/**
 * The expected concepts listed inside one delimited question, in order.
 *
 * Read from inside the block for the reason `readStem` is: a bullet elsewhere in the
 * message is not a concept. `storedQuestionLines` writes them as `- concept` lines under a
 * heading, so the heading is found first and the bullets after it are taken until the list
 * stops — which means a template that stops listing concepts produces an empty list here,
 * a grading that names none, and a failing test rather than an invented pass.
 */
function readExpectedConcepts(user: string, tag: string): readonly string[] {
  const lines = readDelimitedBlock(user, tag).split("\n");
  const start = lines.findIndex((line) =>
    line.startsWith("Concepts a correct written answer must mention:"),
  );

  if (start === -1) {
    return [];
  }

  const concepts: string[] = [];

  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("- ")) {
      break;
    }

    concepts.push(line.slice(2).trim());
  }

  return concepts;
}

/**
 * The stem of one delimited question, read from inside its own delimiters.
 *
 * The line after `Stem:` within the named block, so a stem is found where the template
 * puts one and text elsewhere in the message cannot be mistaken for it.
 *
 * Parameterised by tag because the review and the tutor use different delimiters on
 * purpose: a fake that read the review's tags for a tutor prompt would find an empty stem
 * and produce an answer with nothing extractive in it, which is exactly the mistake the
 * extractive fixture exists to catch.
 */
function readStem(user: string, tag: string): string {
  const lines = readDelimitedBlock(user, tag).split("\n");
  const index = lines.findIndex((line) => line === "Stem:");

  return index === -1 ? "" : (lines[index + 1] ?? "").trim();
}

/**
 * Which ask a tutor prompt made, recognised by its own instruction sentence.
 *
 * Matched against `askInstruction` rather than against a label written here, so the fake
 * reads the same sentence the model reads. A facade that forgot to render the ask
 * therefore matches nothing, the fixture answers with empty text, and the test fails
 * instead of passing on an invented default.
 */
function readTutorAskKind(user: string): TutorAskKind | null {
  return (
    TUTOR_ASK_KINDS.find((kind) => user.includes(askInstruction(kind))) ?? null
  );
}

/**
 * How many items the prompt asked for.
 *
 * `up to N` as well as `N`, because a grounded batch is asked for at most that many and
 * fewer if the excerpts will not support them. The fake always writes the full number: how
 * many a real model would decide the passages justify is a judgement no fixture can make,
 * and a fake that quietly returned fewer would make every grounded count assertion soft.
 */
function readCount(user: string): number {
  const raw = matchLine(
    user,
    /^(?:Write|Enrich) (?:up to )?(\d+) (?:question|flashcard|word)s?(?:\.| from the excerpts)/m,
  );
  const parsed = Number(raw ?? "");

  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/**
 * The terms inside the owner-data block, one per line.
 *
 * Read from the delimited block rather than from anywhere in the message, so a term
 * that happens to appear in the owner's notes is not mistaken for a word to enrich.
 * Each line is `term | reading | meaning`, and only the first field is the word.
 */
function readEnrichmentTerms(user: string): readonly string[] {
  return readDelimitedBlock(user, "owner_vocabulary")
    .split("\n")
    .map((line) => (line.split("|")[0] ?? "").trim())
    .filter((term) => term.length > 0);
}

/**
 * The text inside one named delimiter pair, or empty.
 *
 * Reading only from inside the delimiters is what makes the fake a fair stand-in for a
 * model that respects them: a document is found where the template puts documents, and
 * owner notes elsewhere in the message are not mistaken for one.
 */
function readDelimitedBlock(user: string, tag: string): string {
  return (
    new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(user)?.[1] ?? ""
  );
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
