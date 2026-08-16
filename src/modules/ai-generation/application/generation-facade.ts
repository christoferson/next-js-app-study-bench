import type { Clock } from "@/platform/clock";
import type { IdGenerator } from "@/platform/id-generator";
import { sha256Hex } from "@/platform/hash";
import type {
  Certification,
  CertificationId,
  CertificationSlug,
} from "@/modules/certifications/domain/certification";
import { CertificationNotFoundError } from "@/modules/certifications/domain/errors";
import type { Objective } from "@/modules/certifications/domain/objective";
import { objectiveKind } from "@/modules/certifications/domain/objective-kind";
import type { CertificationRepository } from "@/modules/certifications/ports/certification-repository";
import type { ObjectiveRepository } from "@/modules/certifications/ports/objective-repository";
import { contentChoices } from "@/modules/question-bank/domain/question";
import type {
  Question,
  QuestionLifecycleStatus,
  QuestionWithRevision,
} from "@/modules/question-bank/domain/question";
import { choiceLetter } from "@/modules/question-bank/domain/question-content";
import type { FlashcardWithRevision } from "@/modules/flashcards/domain/flashcard";
import type { QuestionRepository } from "@/modules/question-bank/ports/question-repository";
import type { FlashcardRepository } from "@/modules/flashcards/ports/flashcard-repository";
import {
  AnswerNotGradableError,
  GeneratedDraftNotRejectableError,
  GenerationBatchTooLargeError,
  GenerationRunNotFoundError,
  ProviderFailure,
  QuestionNotChallengeableError,
  QuestionNotReviewableError,
  TutorAskNotAnswerableError,
} from "@/modules/ai-generation/domain/errors";
import {
  checkFlashcardDrafts,
  checkQuestionDrafts,
  matchEnrichments,
  mergeEnrichment,
} from "@/modules/ai-generation/domain/deterministic-checks";
import type {
  CheckContext,
  EnrichmentMatchResult,
} from "@/modules/ai-generation/domain/deterministic-checks";
import type {
  GeneratedFlashcardDraft,
  GeneratedQuestionDraft,
  GenerationRequestSpec,
  MatchedEnrichment,
  RejectedDraft,
  VocabularyEnrichmentTarget,
} from "@/modules/ai-generation/domain/generated-draft";
import {
  MAX_BATCH_ITEMS,
  MAX_ENRICHMENT_ITEMS,
  maxOutputTokensFor,
} from "@/modules/ai-generation/domain/generation-limits";
import {
  QUESTION_REVIEW_ITEM_COUNT,
  qualityStatusAfterReview,
  recommendsDispute,
} from "@/modules/ai-generation/domain/question-review";
import type { QuestionReview } from "@/modules/ai-generation/domain/question-review";
import {
  ANSWER_EVALUATION_ITEM_COUNT,
  recommendedSelfGrade,
} from "@/modules/ai-generation/domain/answer-evaluation";
import type { AnswerEvaluation } from "@/modules/ai-generation/domain/answer-evaluation";
import {
  QUESTION_CHALLENGE_ITEM_COUNT,
  recommendsDispute as challengeRecommendsDispute,
  recommendsRevision,
} from "@/modules/ai-generation/domain/question-challenge";
import type { QuestionChallenge } from "@/modules/ai-generation/domain/question-challenge";
import {
  TUTOR_EXCHANGE_LIMIT,
  TUTOR_ITEM_COUNT,
} from "@/modules/ai-generation/domain/tutor-exchange";
import type {
  TutorAsk,
  TutorResponse,
} from "@/modules/ai-generation/domain/tutor-exchange";
import type {
  GeneratedItemKind,
  GenerationRun,
  GenerationRunId,
  ProviderUsage,
} from "@/modules/ai-generation/domain/generation-run";
import { resolveRunStatus } from "@/modules/ai-generation/domain/generation-run";
import type {
  EffectivePersona,
  Persona,
} from "@/modules/ai-generation/domain/personas";
import {
  findPersona,
  personaForStudyType,
} from "@/modules/ai-generation/domain/personas";
import type { StoredPersona } from "@/modules/ai-generation/domain/stored-persona";
import { storedPersonaToPersona } from "@/modules/ai-generation/domain/stored-persona";
import type { PersonaRepository } from "@/modules/ai-generation/ports/persona-repository";
import {
  assignablePersonas,
  resolveEffectivePersona,
} from "./persona-selection";
import {
  renderPrompt,
  templateIdForItemKind,
  templateVersionForItemKind,
} from "@/modules/ai-generation/domain/prompt-templates";
import type { RenderedPrompt } from "@/modules/ai-generation/domain/prompt-templates";
import { canonicalRequestText } from "@/modules/ai-generation/domain/request-fingerprint";
import type {
  GenerationRunItemCounts,
  GenerationRunRepository,
} from "@/modules/ai-generation/ports/generation-run-repository";
import type { LanguageModelGateway } from "@/modules/ai-generation/ports/language-model-gateway";
import type {
  GenerationTransactionRepositories,
  GenerationUnitOfWork,
} from "@/modules/ai-generation/ports/unit-of-work";
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
import {
  QUESTION_REVIEW_SCHEMA_DESCRIPTION,
  QUESTION_REVIEW_SCHEMA_NAME,
  questionReviewJsonSchema,
  readQuestionReview,
  serializeQuestionReview,
  validateQuestionReview,
} from "./question-review-schema";
import {
  ANSWER_EVALUATION_SCHEMA_DESCRIPTION,
  ANSWER_EVALUATION_SCHEMA_NAME,
  answerEvaluationJsonSchema,
  answerEvaluationValidator,
  serializeAnswerEvaluation,
} from "./answer-evaluation-schema";
import {
  QUESTION_CHALLENGE_SCHEMA_DESCRIPTION,
  QUESTION_CHALLENGE_SCHEMA_NAME,
  questionChallengeJsonSchema,
  readQuestionChallenge,
  serializeQuestionChallenge,
  validateQuestionChallenge,
} from "./question-challenge-schema";
import {
  TUTOR_SCHEMA_DESCRIPTION,
  TUTOR_SCHEMA_NAME,
  readTutorResponse,
  serializeTutorResponse,
  tutorJsonSchema,
  tutorResponseValidator,
} from "./tutor-schema";
import type {
  EnrichmentRequestInput,
  GenerationRequestInput,
  GenerationRunFilterInput,
} from "./schemas";

/**
 * AI-generation capability facade.
 *
 * Owns one workflow: the owner asks for a small batch of study material, a model
 * produces it, the output is validated and checked, and whatever survives lands in
 * the bank as `DRAFT` content linked to a run that explains where it came from.
 *
 * Two properties shape the whole class:
 *
 * - **Nothing generated is trusted.** Model output is validated against an
 *   application-owned schema, then checked by pure domain rules, before anything is
 *   persisted (`spec/AI-GUIDELINES.md` sections 1.5 and 1.8). An item that fails is
 *   counted, not stored.
 * - **A failed run is a recorded outcome, not an exception.** A provider outage
 *   produces a `FAILED` run the owner can read, with a category and safe advice. The
 *   only exceptions that escape are domain errors about the *request* — a batch that
 *   is too large, a track that does not exist — because those belong on the form.
 *
 * Generation is synchronous (`SPEC.md` section 11.6): the owner waits on the page
 * that started the request, and there is no queue, worker, or job table. The batch
 * limit is what makes that acceptable.
 */

/** How many runs one page of history shows. */
export const RUN_PAGE_SIZE = 20;

/** The generate form's own view: what the owner may choose. */
export interface GenerationFormView {
  readonly certification: Certification;
  /** Active objectives only: a batch is never targeted at an archived objective. */
  readonly objectives: readonly Objective[];
  /**
   * The persona this request would use with nothing chosen on the form: the track's
   * assigned persona, or the built-in one for its study type.
   */
  readonly persona: EffectivePersona;
  /**
   * Stored personas the owner may generate this batch with instead, restricted to the
   * archetype the track's study type calls for.
   */
  readonly personaChoices: readonly StoredPersona[];
  /** The track's assignment, so the select can default to it. `null` is automatic. */
  readonly assignedPersonaId: string | null;
  readonly maxItemCount: number;
  /** Provider and model that would be used, so the cost is not a surprise. */
  readonly modelProvider: string;
  readonly modelId: string;
}

/** One row of run history. */
export interface GenerationRunSummary {
  readonly run: GenerationRun;
  readonly counts: GenerationRunItemCounts;
}

/** Run history for one track, bounded. */
export interface GenerationRunListView {
  readonly certification: Certification;
  readonly runs: readonly GenerationRunSummary[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageCount: number;
}

/**
 * One generated item on the review screen.
 *
 * `rejectable` is computed rather than left to the view: a draft may be rejected,
 * and anything the owner has since activated may not, so the review page cannot
 * offer a control that would fail.
 */
export interface GeneratedQuestionReview {
  readonly kind: "QUESTION";
  readonly item: QuestionWithRevision;
  readonly rejectable: boolean;
  /** Set when the owner has edited or activated the item since it was generated. */
  readonly changedSinceGeneration: boolean;
}

export interface GeneratedFlashcardReview {
  readonly kind: "FLASHCARD";
  readonly item: FlashcardWithRevision;
  readonly rejectable: boolean;
  readonly changedSinceGeneration: boolean;
}

/**
 * One card an enrichment run rewrote.
 *
 * A third variant rather than reusing `GeneratedFlashcardReview`, because the two
 * describe different situations and the review screen must not confuse them. An
 * enriched card is not a draft awaiting acceptance: it is the owner's card, already
 * in whatever lifecycle it was in, with one more revision on it. So there is nothing
 * to reject — rejecting would mean deleting a card the owner already had — and the
 * useful facts are which revision the run wrote and whether it is still the current
 * one.
 */
export interface EnrichedFlashcardReview {
  readonly kind: "ENRICH_VOCABULARY";
  readonly item: FlashcardWithRevision;
  /** Always false: an enriched card predates the run, so it is not the run's to delete. */
  readonly rejectable: false;
  /** Set when the owner has edited the card since the run enriched it. */
  readonly changedSinceGeneration: boolean;
}

export type GeneratedItemReview =
  GeneratedQuestionReview | GeneratedFlashcardReview | EnrichedFlashcardReview;

/** The enrichment form's own view: how much is left, and what it will cost. */
export interface EnrichmentFormView {
  readonly certification: Certification;
  /**
   * The built-in persona for the study type, deliberately, even when the track is
   * assigned a stored one.
   *
   * Enrichment is the one flow this slice leaves on the built-in personas. The
   * enrichment prompt and the matching rules are written against the HSK persona's
   * vocabulary fields — readings, meanings, examples — and a stored persona has no way
   * yet to say that it produces them. Applying an arbitrary language persona here would
   * change what the model is asked to return without changing what the matcher expects.
   * Slice 3 or later.
   */
  readonly persona: Persona;
  /** Active vocabulary cards with no `meanings` yet. */
  readonly unenrichedCount: number;
  readonly maxItemCount: number;
  readonly modelProvider: string;
  readonly modelId: string;
}

/**
 * What one enrichment request produced.
 *
 * `unenriched` counts the cards the run left untouched — a rejected answer, an answer
 * that never arrived, or a card that changed while the model was answering. They are
 * still unenriched, so the next run offers them again.
 */
export interface EnrichmentOutcome {
  readonly run: GenerationRun;
  readonly rejected: readonly RejectedDraft[];
  readonly unenriched: number;
}

/**
 * There was nothing left to enrich.
 *
 * Distinct from a run that enriched nothing: no model was called, so there is no run
 * to show and nothing was spent. The form says so rather than redirecting to an empty
 * run page.
 */
export interface NothingToEnrichNotice {
  readonly nothingToEnrich: true;
}

export type EnrichmentResult =
  EnrichmentOutcome | DuplicateBatchNotice | NothingToEnrichNotice;

export function isNothingToEnrichNotice(
  result: EnrichmentResult,
): result is NothingToEnrichNotice {
  return "nothingToEnrich" in result;
}

export function isEnrichmentDuplicateNotice(
  result: EnrichmentResult,
): result is DuplicateBatchNotice {
  return "duplicateOf" in result;
}

/**
 * The latest AI review of one question, as the question's page shows it.
 *
 * A view rather than the run row, because the panel needs three things the run row cannot
 * answer on its own: the findings parsed back through their schema, whether the revision
 * reviewed is still the question's current one, and whether the review's own
 * recommendation warrants offering the dispute button.
 *
 * `review` is `null` when the stored payload can no longer be read — a hand-edited row, or
 * a payload from a schema that has since changed. The panel then says the review cannot be
 * read rather than rendering an empty verdict, which is the same choice the objective-import
 * confirm page makes.
 */
export interface QuestionReviewView {
  readonly run: GenerationRun;
  readonly review: QuestionReview | null;
  /**
   * Set when the question has been edited since this review was made.
   *
   * The review judged one immutable revision, so an edit does not make it wrong — it makes
   * it about wording the owner no longer has. Saying so is the honest option: silently
   * showing it beside the new text would attribute findings to text the reviewer never saw
   * (`SPEC.md` section 25.3).
   */
  readonly staleRevision: boolean;
  /**
   * Whether the panel offers the prefilled dispute button.
   *
   * `false` for a question that is already disputed: the button would set the state it is
   * already in and overwrite the owner's own recorded reason with the model's summary.
   */
  readonly offersDispute: boolean;
  /**
   * Whether the panel offers "Mark as AI-reviewed" — true only when the stored
   * review is clean, current, and the question is still `UNREVIEWED`, i.e. when
   * accepting would actually succeed.
   */
  readonly offersAccept: boolean;
}

/**
 * One recorded tutor exchange, as the question's page shows it.
 *
 * A view rather than the run row for the reason `QuestionReviewView` is one: the panel
 * needs the answer parsed back through its schema, and it needs to know whether the
 * revision the tutor was shown is still the question's current one.
 *
 * `response` is `null` when the stored payload can no longer be read — a hand-edited row,
 * or a payload from a schema that has since changed. The panel says so rather than
 * rendering an empty answer.
 */
export interface TutorExchangeView {
  readonly run: GenerationRun;
  readonly response: TutorResponse | null;
  /**
   * Set when the question has been edited since this exchange.
   *
   * The tutor explained one immutable revision, so an edit does not make the explanation
   * wrong — it makes it about wording the owner no longer has. Saying so is the honest
   * option, and it is the visible half of the acceptance criterion: the tutor receives
   * the exact revision being discussed (`SPEC.md` section 25.3), so an answer about a
   * different one has to be labelled as such.
   */
  readonly staleRevision: boolean;
}

/**
 * What one ask produced.
 *
 * The run either way, and the answer only when there was one: a provider failure is a
 * recorded outcome rather than an exception here, exactly as it is for a review, so the
 * caller gets a `FAILED` run with a category rather than a thrown error to translate.
 */
export interface TutorAskOutcome {
  readonly run: GenerationRun;
  readonly response: TutorResponse | null;
}

/**
 * What one review request produced.
 *
 * The run is always here, including when it failed, for the reason `GenerationOutcome`
 * gives: the caller returns to the question's page either way, and a provider outage is
 * something the owner reads rather than an error screen.
 *
 * `qualityStatusChanged` is what the page needs to say what happened. A review that found
 * nothing wrong promotes an unreviewed question to `AI_REVIEWED`; every other combination
 * leaves the question exactly as it was, and the difference is not visible from the run.
 */
export interface QuestionReviewOutcome {
  readonly run: GenerationRun;
  readonly review: QuestionReview | null;
  readonly qualityStatusChanged: boolean;
}

/**
 * What one grading produced.
 *
 * The run either way and the grading only when there was one, exactly as a tutor ask
 * reports itself: a provider outage is a recorded outcome the feedback screen reads rather
 * than an exception it has to render.
 *
 * `recommendedSelfGrade` is the point of the whole flow, and it is deliberately a
 * *recommendation* the view may act on rather than anything written anywhere. It is `null`
 * for a `PARTIALLY_CORRECT` verdict, because a partial answer is exactly the case where
 * only the owner can decide (`domain/answer-evaluation.ts`).
 */
export interface AnswerEvaluationOutcome {
  readonly run: GenerationRun;
  readonly evaluation: AnswerEvaluation | null;
  readonly recommendedSelfGrade: "CORRECT" | "INCORRECT" | null;
}

/**
 * The latest AI challenge of one question, as the question's page shows it.
 *
 * A view rather than the run row for the reasons `QuestionReviewView` is one, plus the one
 * that makes a challenge different: the outcome may recommend an action, and whether that
 * action is actually available is a fact about the question *now* rather than about the
 * challenge.
 *
 * `offersDispute` and `revisionNote` are the two wirings the acceptance criteria ask for,
 * and both stop short of doing anything: the first prefills a button the owner clicks, and
 * the second is a note shown beside the edit form the owner already has. Nothing here
 * writes a revision (`spec/AI-GUIDELINES.md` section 1.10).
 */
export interface QuestionChallengeView {
  readonly run: GenerationRun;
  readonly challenge: QuestionChallenge | null;
  /** Set when the question has been edited since this challenge was judged. */
  readonly staleRevision: boolean;
  /**
   * Whether the panel offers the prefilled dispute button.
   *
   * `false` for a question that is already disputed, for the reason the review's is: the
   * button would set the state it is already in and overwrite the owner's own recorded
   * reason.
   */
  readonly offersDispute: boolean;
  /**
   * What the challenge said a new revision would have to change, or `null`.
   *
   * Lifted out of the outcome so the view does not have to know the `REVISE`-plus-note
   * rule, and named a *note* here as well, because that is all it is.
   */
  readonly revisionNote: string | null;
}

/** What one challenge produced. */
export interface QuestionChallengeOutcome {
  readonly run: GenerationRun;
  readonly challenge: QuestionChallenge | null;
}

/** The run review screen (`SPEC.md` section 24.2, generation preview). */
export interface GenerationRunDetailView {
  readonly certification: Certification;
  readonly run: GenerationRun;
  readonly counts: GenerationRunItemCounts;
  readonly items: readonly GeneratedItemReview[];
  /**
   * Expanded from the recorded identifier, or `null` if it is no longer known.
   *
   * The identifier may name a built-in persona or a stored one's key, so both registries
   * are consulted. `null` is a normal outcome — a stored persona the owner has since
   * deleted — and the review screen then shows the recorded key and version, which is
   * the whole reason a run records text rather than a foreign key.
   */
  readonly persona: EffectivePersona | null;
}

/**
 * What one generation request produced.
 *
 * The run is always present, including when it failed: the caller redirects to the
 * run's review page either way, so a failure is something the owner reads rather
 * than an error screen.
 */
export interface GenerationOutcome {
  readonly run: GenerationRun;
  readonly rejected: readonly RejectedDraft[];
}

/**
 * An equivalent batch already exists (`SPEC.md` section 11.6).
 *
 * Returned rather than thrown, and carrying the earlier run so the form can link to
 * it. The owner then either opens that run or ticks "generate anyway", which is a
 * decision the application must not make for them.
 */
export interface DuplicateBatchNotice {
  readonly duplicateOf: GenerationRun;
}

export type GenerationResult = GenerationOutcome | DuplicateBatchNotice;

export function isDuplicateBatchNotice(
  result: GenerationResult,
): result is DuplicateBatchNotice {
  return "duplicateOf" in result;
}

/**
 * A checked batch, ready to be written.
 *
 * `write` is a closure over the accepted drafts, so the two item kinds share one
 * transaction and one status calculation without `storeBatch` needing to know which
 * kind it holds or narrowing a union with a cast.
 */
interface ProducedBatch {
  readonly accepted: number;
  readonly rejected: readonly RejectedDraft[];
  readonly usage: ProviderUsage | null;
  write(
    repositories: GenerationTransactionRepositories,
    run: GenerationRun,
  ): Promise<void>;
}

/** One enrichment turn's matched answers plus what the provider reported. */
interface ProducedEnrichment {
  readonly matched: EnrichmentMatchResult;
  readonly usage: ProviderUsage | null;
}

export interface GenerationFacadeDependencies {
  readonly runs: GenerationRunRepository;
  readonly questions: QuestionRepository;
  readonly flashcards: FlashcardRepository;
  readonly certifications: CertificationRepository;
  readonly objectives: ObjectiveRepository;
  /** The owner's own personas, for track assignment and per-request choice. */
  readonly personas: PersonaRepository;
  readonly unitOfWork: GenerationUnitOfWork;
  /**
   * The model that writes content. Composed in, so the fake gateway is a wiring
   * choice.
   */
  readonly gateway: LanguageModelGateway;
  /**
   * The model that judges content — currently only `reviewQuestion`.
   *
   * Optional, defaulting to `gateway`, because writing and judging are separately
   * configurable (`BEDROCK_REVIEW_MODEL_ID`) but not separately *required*: an owner
   * who configures one model, and every existing caller that composes one gateway, get
   * the same behaviour as before. A second dependency rather than a per-call model
   * argument keeps the property the runs depend on — a gateway reports the one model it
   * calls, and the run records that — true of both paths.
   */
  readonly reviewGateway?: LanguageModelGateway;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export class GenerationFacade {
  constructor(private readonly deps: GenerationFacadeDependencies) {}

  /**
   * The gateway a review call goes through.
   *
   * Falls back to the writing gateway, so "not separately configured" means "the same
   * model", never "no model".
   */
  private get reviewGateway(): LanguageModelGateway {
    return this.deps.reviewGateway ?? this.deps.gateway;
  }

  /**
   * The persona one request generates with.
   *
   * Delegates to `resolveEffectivePersona`, which states the order: the persona chosen
   * on the form, else the track's assignment, else the built-in one for the study type.
   * A method rather than a call at each site so the form's preview and the run that
   * follows it cannot resolve differently.
   */
  private async resolvePersona(
    certification: Certification,
    requestedPersonaId: string | null,
  ): Promise<EffectivePersona> {
    return resolveEffectivePersona(
      this.deps.personas,
      certification,
      requestedPersonaId,
    );
  }

  /**
   * The persona a recorded run used, when it can still be found.
   *
   * The recorded identifier is either a built-in persona's id or a stored persona's key,
   * so both are consulted — built-ins first, because those identifiers are code and
   * cannot be taken by a stored key. `null` when neither knows it, which the review
   * screen renders as the recorded key and version rather than as an error: that is why
   * a run records text.
   */
  private async findRecordedPersona(
    run: GenerationRun,
  ): Promise<EffectivePersona | null> {
    const builtIn = findPersona(run.personaId);

    if (builtIn !== null) {
      return builtIn;
    }

    const stored = await this.deps.personas.findByKey(run.personaId);

    return stored === null ? null : storedPersonaToPersona(stored);
  }

  /** What the generate form offers for one track. */
  async findGenerationForm(
    slug: CertificationSlug,
  ): Promise<GenerationFormView | null> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      return null;
    }

    const [objectives, personas] = await Promise.all([
      this.deps.objectives.listByCertification(certification.id),
      this.deps.personas.list(),
    ]);

    return {
      certification,
      objectives: objectives.filter(
        (objective) => objective.status === "ACTIVE",
      ),
      persona: await this.resolvePersona(certification, null),
      personaChoices: assignablePersonas(personas, certification),
      assignedPersonaId: certification.personaId,
      maxItemCount: MAX_BATCH_ITEMS,
      modelProvider: this.deps.gateway.provider,
      modelId: this.deps.gateway.modelId,
    };
  }

  /** Bounded run history for one track, newest first. */
  async findRuns(
    slug: CertificationSlug,
    filters: GenerationRunFilterInput,
  ): Promise<GenerationRunListView | null> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      return null;
    }

    const page = Math.max(1, filters.page);
    const result = await this.deps.runs.list({
      certificationId: certification.id,
      limit: RUN_PAGE_SIZE,
      offset: (page - 1) * RUN_PAGE_SIZE,
    });

    const runs = await Promise.all(
      result.items.map(async (run) => ({
        run,
        counts: await this.deps.runs.countItems(run.id),
      })),
    );

    return {
      certification,
      runs,
      totalCount: result.totalCount,
      page,
      pageCount: Math.max(1, Math.ceil(result.totalCount / RUN_PAGE_SIZE)),
    };
  }

  /**
   * One run with the items it produced.
   *
   * Returns `null` for an unknown run and for a run belonging to another track, so a
   * guessed address is a 404 rather than a window into a different bank.
   */
  async findRunDetail(
    slug: CertificationSlug,
    runId: GenerationRunId,
  ): Promise<GenerationRunDetailView | null> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      return null;
    }

    const run = await this.deps.runs.findById(runId);

    if (run === null || run.certificationId !== certification.id) {
      return null;
    }

    const [counts, itemIds] = await Promise.all([
      this.deps.runs.countItems(run.id),
      this.deps.runs.listItemIds(run.id),
    ]);

    return {
      certification,
      run,
      counts,
      items: await this.loadItems(run.itemKind, run.id, itemIds),
      persona: await this.findRecordedPersona(run),
    };
  }

  /**
   * The latest AI review of one question, for the findings panel on its page.
   *
   * Returns `null` when the question has never been reviewed, which is the ordinary case
   * and not a failure: the page then shows the Review button and no panel.
   */
  async findQuestionReview(
    questionId: string,
  ): Promise<QuestionReviewView | null> {
    const run = await this.deps.runs.findLatestReviewForQuestion(questionId);

    if (run === null) {
      return null;
    }

    const current =
      await this.deps.questions.findWithCurrentRevision(questionId);

    if (current === null) {
      return null;
    }

    const review = readQuestionReview(run.proposedPayload);
    const staleRevision =
      run.subjectRevisionId !== null &&
      run.subjectRevisionId !== current.question.currentRevisionId;

    return {
      run,
      review,
      staleRevision,
      offersDispute:
        review !== null &&
        recommendsDispute(review) &&
        current.question.qualityStatus !== "DISPUTED",
      // The explicit accept: offered only while the one allowed promotion is
      // actually available, so the button never renders just to refuse.
      offersAccept:
        review !== null &&
        !staleRevision &&
        qualityStatusAfterReview(review, current.question.qualityStatus) !==
          null,
    };
  }

  /**
   * Asks a model to review one question, and records what it said.
   *
   * On `GenerationFacade` rather than in a facade of its own — unlike the objective
   * import, which got one. The deciding difference is that a review is *the same shape of
   * flow* as a generation run: resolve the track, resolve the persona, render a versioned
   * prompt, make one structured call, record a run with its provenance and its tokens.
   * Every one of those steps is already here, and `findRecordedPersona`, the failure
   * handling, and the run history are shared unchanged. The import needed its own facade
   * because its flow has three phases with an owner decision in the middle and a write
   * into a different module's hierarchy; a review has one phase and writes nothing but a
   * run row and, at most, one quality flag.
   *
   * What this method must never do is the substance of the acceptance criteria
   * (`SPEC.md` section 25.3, `spec/AI-GUIDELINES.md` section 1.10):
   *
   * - **It never touches the question's content.** No revision is appended, no field is
   *   rewritten. The answer shape has no room for replacement text, and this method has no
   *   call that could write it if it did.
   * - **It never touches the lifecycle.** A review does not activate, retire, or archive
   *   anything. A `MAJOR_ISSUES` verdict on an active question leaves it active and in
   *   study, because pulling a question out of study is the owner's decision — offered as
   *   the prefilled dispute button, which is one click and the owner's click.
   * - **The only thing it may write to the question is a quality promotion**, and only the
   *   one `qualityStatusAfterReview` allows: `UNREVIEWED` to `AI_REVIEWED`, on a `SOUND`
   *   verdict with a correct answer. Every other case leaves the state alone.
   *
   * The order matches every other run in this module: the `PENDING` row is written before
   * the provider is called, the provider is called outside any transaction, and the
   * outcome is recorded afterwards.
   */
  async reviewQuestion(
    slug: CertificationSlug,
    questionId: string,
  ): Promise<QuestionReviewOutcome> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      throw new CertificationNotFoundError(slug);
    }

    const current =
      await this.deps.questions.findWithCurrentRevision(questionId);

    // Scoped to the track as well as to the identifier, so a question of another track
    // cannot be reviewed — and paid for — through this track's address.
    if (
      current === null ||
      current.question.certificationId !== certification.id
    ) {
      throw new QuestionNotReviewableError(
        "That question no longer exists in this track.",
      );
    }

    if (!isReviewableLifecycle(current.question.lifecycleStatus)) {
      throw new QuestionNotReviewableError(
        "Only a draft or active question can be reviewed. Reviewing a retired or archived question would spend a model call on something you have taken out of study.",
      );
    }

    const [objectives, linkedIds] = await Promise.all([
      this.deps.objectives.listByCertification(certification.id),
      this.deps.questions.listObjectiveLinks(questionId),
    ]);
    const persona = await this.resolvePersona(certification, null);
    const prompt = renderPrompt("QUESTION_REVIEW", {
      persona,
      trackName: certification.name,
      examCode: certification.examCode,
      // Only the objectives this question is actually mapped to. The whole track's
      // syllabus would be pages of context for a judgement about one item, and the
      // reviewer maps nothing back, so there is no identifier list it needs to choose from.
      objectives: objectives
        .filter((objective) => linkedIds.includes(objective.id))
        .map((objective) => ({
          id: objective.id,
          code: objective.code,
          title: objective.title,
          description: objective.description,
          kind: objectiveKind(objectives, objective.id),
        })),
      spec: {
        itemCount: QUESTION_REVIEW_ITEM_COUNT,
        objectiveIds: [],
        difficulty: null,
        additionalInstructions: null,
        questionTypes: [],
        cardTypes: [],
      },
      reviewedRevision: current.revision,
    });
    // Over the revision identifier rather than over the question's text: the revision is
    // immutable, so the same revision reviewed twice hashes the same and an edit changes
    // the fingerprint by construction. The stem itself is deliberately not hashed — a
    // fingerprint column must not become a copy of the bank.
    const inputHash = sha256Hex(
      [
        `certification=${certification.id}`,
        "kind=QUESTION_REVIEW",
        `question=${questionId}`,
        `revision=${current.revision.id}`,
      ].join("\n"),
    );
    const pending: GenerationRun = {
      id: this.deps.ids.nextId(),
      certificationId: certification.id,
      itemKind: "QUESTION_REVIEW",
      // The reviewer judged from its own knowledge and consulted nothing, which is what
      // MODEL_KNOWLEDGE records. Claiming a grounded mode would be a false provenance
      // record, and it is the same claim the panel makes to the owner in words
      // (`spec/AI-GUIDELINES.md` section 1.2).
      generationMode: "MODEL_KNOWLEDGE",
      // The *review* gateway, not the writing one: a review may be configured to a
      // different model, and the run must record the model that was actually asked
      // (`spec/AI-GUIDELINES.md` provenance). Read from the same gateway the call below
      // goes through, so the two cannot drift apart.
      modelProvider: this.reviewGateway.provider,
      modelId: this.reviewGateway.modelId,
      personaId: persona.id,
      personaVersion: persona.version,
      promptTemplateId: templateIdForItemKind("QUESTION_REVIEW"),
      promptTemplateVersion: templateVersionForItemKind("QUESTION_REVIEW"),
      inputHash,
      selectedSourceSnapshotIds: [],
      requestedItemCount: QUESTION_REVIEW_ITEM_COUNT,
      successfulItemCount: 0,
      failedItemCount: 0,
      usageMetadata: null,
      failureReason: null,
      proposedPayload: null,
      // Stays null forever for a review: `proposesForConfirmation("QUESTION_REVIEW")` is
      // false, because a finding is not a proposal waiting to be written to the bank.
      appliedAt: null,
      subjectQuestionId: questionId,
      // The exact revision judged, recorded before the call, so a failed review still
      // says what it was looking at and a later edit makes the review visibly stale.
      subjectRevisionId: current.revision.id,
      startedAt: this.deps.clock.now(),
      completedAt: null,
      status: "PENDING",
    };

    // Deliberately no duplicate-batch guard. Re-reviewing the same revision is a
    // reasonable thing to want — a second opinion after an edit elsewhere, or after
    // changing the model — and a review is one cheap call rather than a batch of ten.
    await this.deps.unitOfWork.transaction(async ({ runs }) => {
      await runs.create(pending);
    });

    try {
      const produced = await this.reviewGateway.generateStructured({
        system: prompt.system,
        user: prompt.user,
        schemaName: QUESTION_REVIEW_SCHEMA_NAME,
        schemaDescription: QUESTION_REVIEW_SCHEMA_DESCRIPTION,
        schema: questionReviewJsonSchema(),
        validate: validateQuestionReview,
        maxOutputTokens: maxOutputTokensFor(
          "QUESTION_REVIEW",
          QUESTION_REVIEW_ITEM_COUNT,
        ),
      });
      const review = produced.value;
      const completed: GenerationRun = {
        ...pending,
        successfulItemCount: QUESTION_REVIEW_ITEM_COUNT,
        failedItemCount: 0,
        usageMetadata: produced.usage,
        proposedPayload: serializeQuestionReview(review),
        completedAt: this.deps.clock.now(),
        status: "COMPLETED",
      };

      // The review records findings and nothing else. Even a clean verdict does
      // not move the quality state by itself — the owner accepts it with an
      // explicit click (`acceptQuestionReview`), by their decision (2026-08-15):
      // every state change on a question is theirs to make.
      await this.deps.unitOfWork.transaction(async ({ runs }) => {
        await runs.complete(completed);
      });

      return {
        run: completed,
        review,
        qualityStatusChanged: false,
      };
    } catch (error) {
      if (error instanceof ProviderFailure) {
        return {
          run: await this.failRun(
            pending,
            error.category,
            QUESTION_REVIEW_ITEM_COUNT,
          ),
          review: null,
          // A failed review changes nothing about the question, including its quality
          // state. Malformed output is one of these paths, so a model that answers
          // gibberish cannot promote anything.
          qualityStatusChanged: false,
        };
      }

      throw error;
    }
  }

  /**
   * The most recent tutor exchanges about one question, newest first.
   *
   * Bounded to `TUTOR_EXCHANGE_LIMIT`, and each one parsed back through the same schema
   * that accepted it, so the panel cannot render an answer that would not have been
   * accepted. The current revision is read once and every exchange compared against it,
   * rather than per exchange, because they are all about the same question.
   */
  async findTutorExchanges(
    questionId: string,
    limit: number = TUTOR_EXCHANGE_LIMIT,
  ): Promise<readonly TutorExchangeView[]> {
    const [runs, current] = await Promise.all([
      this.deps.runs.listTutorExchangesForQuestion(questionId, limit),
      this.deps.questions.findWithCurrentRevision(questionId),
    ]);

    return runs.map((run) => ({
      run,
      response: readTutorResponse(run.proposedPayload),
      staleRevision:
        current !== null &&
        run.subjectRevisionId !== null &&
        run.subjectRevisionId !== current.question.currentRevisionId,
    }));
  }

  /**
   * Asks the tutor one thing about one question, and records what it said.
   *
   * On `GenerationFacade` beside `reviewQuestion` rather than in a facade of its own, and
   * for the same reason: an ask is the same shape of flow as every other run here —
   * resolve the track, resolve the persona, render a versioned prompt, make one structured
   * call, record a run with its provenance and its tokens. `findRecordedPersona`, the
   * failure handling, and the run history are all shared unchanged.
   *
   * **One ask is one call.** There is no conversation, no thread, and no accumulated
   * context; `tutor-exchange.ts` states why, and the consequence is that the port's
   * `converse` method is still not implemented. Asking a second thing is a second run,
   * independently recorded.
   *
   * What this method must never do is the substance of the acceptance criteria
   * (`SPEC.md` section 25.3, `spec/AI-GUIDELINES.md` section 1.10):
   *
   * - **It receives the exact revision.** The question's current revision is rendered
   *   verbatim by the same builder the review uses, and its identifier is recorded on the
   *   run before the call — so a later edit makes the exchange visibly stale rather than
   *   silently misattributed.
   * - **It never touches the question.** No revision is appended, no field is rewritten,
   *   no lifecycle transition happens, and — unlike a review — not even the quality state
   *   moves. There is no field in `TutorResponse` that could carry a rewrite and no call
   *   here that could write one.
   * - **It records model-knowledge provenance.** `MODEL_KNOWLEDGE` is the honest mode:
   *   D8's sources do not exist, no source was consulted, and the panel says so in words
   *   as well (`spec/AI-GUIDELINES.md` section 1.2).
   *
   * **Any lifecycle is allowed**, deliberately unlike `reviewQuestion`. A review is a
   * decision aid, so spending a call reviewing something the owner has taken out of study
   * is waste; tutoring is *learning*, and wanting to understand a retired question while
   * reading through the bank's history is a legitimate thing to want. The owner is the one
   * pressing the button and paying for it.
   *
   * The order matches every other run in this module: the `PENDING` row is written before
   * the provider is called, the provider is called outside any transaction, and the
   * outcome is recorded afterwards.
   */
  async askTutor(
    slug: CertificationSlug,
    questionId: string,
    ask: TutorAsk,
  ): Promise<TutorAskOutcome> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      throw new CertificationNotFoundError(slug);
    }

    const current =
      await this.deps.questions.findWithCurrentRevision(questionId);

    // Scoped to the track as well as to the identifier, so a question of another track
    // cannot be asked about — and paid for — through this track's address.
    if (
      current === null ||
      current.question.certificationId !== certification.id
    ) {
      throw new TutorAskNotAnswerableError(
        "That question no longer exists in this track.",
      );
    }

    const choices = contentChoices(current.revision.content);
    const choiceIds = choices.map((choice) => choice.id);
    const asked = choices.findIndex((choice) => choice.id === ask.choiceId);

    // Refused before the call rather than after it: an ask about a choice the question
    // does not have cannot be answered, and finding that out from a validation failure
    // would mean paying for the discovery.
    if (ask.kind === "EXPLAIN_CHOICE" && asked === -1) {
      throw new TutorAskNotAnswerableError(
        choiceIds.length === 0
          ? "This question has no choices to ask about."
          : "That choice is not part of this question any more. Reload the page and pick one of the choices shown.",
      );
    }

    const chosen = choices[asked];
    const [objectives, linkedIds] = await Promise.all([
      this.deps.objectives.listByCertification(certification.id),
      this.deps.questions.listObjectiveLinks(questionId),
    ]);
    const persona = await this.resolvePersona(certification, null);
    const prompt = renderPrompt("TUTOR_EXPLANATION", {
      persona,
      trackName: certification.name,
      examCode: certification.examCode,
      // Only the objectives this question is mapped to, for the reason the review sends
      // only those: the whole syllabus would be pages of context for one explanation, and
      // the tutor maps nothing back.
      objectives: objectives
        .filter((objective) => linkedIds.includes(objective.id))
        .map((objective) => ({
          id: objective.id,
          code: objective.code,
          title: objective.title,
          description: objective.description,
          kind: objectiveKind(objectives, objective.id),
        })),
      spec: {
        itemCount: TUTOR_ITEM_COUNT,
        objectiveIds: [],
        difficulty: null,
        // The owner's note travels on the ask rather than here, so the tutor template
        // reads one field and cannot render the note twice.
        additionalInstructions: null,
        questionTypes: [],
        cardTypes: [],
      },
      reviewedRevision: current.revision,
      tutorAsk: ask,
      // Spread rather than assigned as `undefined`, because the field is genuinely absent
      // for the five asks that are not about a choice, and the template branches on that
      // absence.
      ...(chosen === undefined
        ? {}
        : {
            tutorChoice: {
              id: chosen.id,
              // The letter the owner sees, computed the same way the question page and the
              // answer form compute it, so "why is B wrong" names the same B.
              letter: choiceLetter(asked),
              text: chosen.text,
            },
          }),
    });
    // Over the revision identifier and the ask rather than over the question's text: the
    // revision is immutable, so the same ask about the same revision hashes the same and
    // an edit changes the fingerprint by construction. The owner's note is hashed too,
    // because a different note is a different request. The stem itself is deliberately
    // not hashed — a fingerprint column must not become a copy of the bank.
    const inputHash = sha256Hex(
      [
        `certification=${certification.id}`,
        "kind=TUTOR_EXPLANATION",
        `question=${questionId}`,
        `revision=${current.revision.id}`,
        `ask=${ask.kind}`,
        `choice=${ask.choiceId ?? ""}`,
        `note=${ask.note ?? ""}`,
      ].join("\n"),
    );
    const pending: GenerationRun = {
      id: this.deps.ids.nextId(),
      certificationId: certification.id,
      itemKind: "TUTOR_EXPLANATION",
      // The tutor answered from its own knowledge and consulted nothing, which is what
      // MODEL_KNOWLEDGE records. D8's sources do not exist, so there is no other honest
      // value, and the panel makes the same claim to the owner in words
      // (`spec/AI-GUIDELINES.md` section 1.2).
      generationMode: "MODEL_KNOWLEDGE",
      // The *review* gateway, not the writing one. Tutoring is a judging-and-explaining
      // job rather than an authoring one, so it belongs on the model
      // `BEDROCK_REVIEW_MODEL_ID` configures: an owner who pays for a stronger model to
      // scrutinise questions wants that model explaining them too, and an owner who
      // picked a cheaper one for sweeping the bank has said what an explanation is worth
      // to them. Read from the same gateway the call below goes through, so the recorded
      // model and the called model cannot drift apart.
      modelProvider: this.reviewGateway.provider,
      modelId: this.reviewGateway.modelId,
      personaId: persona.id,
      personaVersion: persona.version,
      promptTemplateId: templateIdForItemKind("TUTOR_EXPLANATION"),
      promptTemplateVersion: templateVersionForItemKind("TUTOR_EXPLANATION"),
      inputHash,
      selectedSourceSnapshotIds: [],
      requestedItemCount: TUTOR_ITEM_COUNT,
      successfulItemCount: 0,
      failedItemCount: 0,
      usageMetadata: null,
      failureReason: null,
      proposedPayload: null,
      // Stays null forever: `proposesForConfirmation("TUTOR_EXPLANATION")` is false,
      // because an explanation is not a proposal waiting to be written to the bank.
      appliedAt: null,
      subjectQuestionId: questionId,
      // The exact revision the tutor was shown, recorded before the call, so a failed ask
      // still says what it was looking at and a later edit makes the exchange visibly
      // stale (`SPEC.md` section 25.3).
      subjectRevisionId: current.revision.id,
      startedAt: this.deps.clock.now(),
      completedAt: null,
      status: "PENDING",
    };

    // Deliberately no duplicate-request guard. Asking the same thing twice is a
    // reasonable thing to want — a second explanation of something that did not land the
    // first time is the whole point — and an ask is one cheap call rather than a batch.
    await this.deps.unitOfWork.transaction(async ({ runs }) => {
      await runs.create(pending);
    });

    try {
      const produced = await this.reviewGateway.generateStructured({
        system: prompt.system,
        user: prompt.user,
        schemaName: TUTOR_SCHEMA_NAME,
        schemaDescription: TUTOR_SCHEMA_DESCRIPTION,
        schema: tutorJsonSchema(ask.kind),
        // Closed over the ask and the question's real choice identifiers, so the gateway
        // stays ignorant of both and the answer is still checked against them.
        validate: tutorResponseValidator(ask, choiceIds),
        maxOutputTokens: maxOutputTokensFor(
          "TUTOR_EXPLANATION",
          TUTOR_ITEM_COUNT,
        ),
      });
      const response = produced.value;
      const completed: GenerationRun = {
        ...pending,
        successfulItemCount: TUTOR_ITEM_COUNT,
        failedItemCount: 0,
        usageMetadata: produced.usage,
        proposedPayload: serializeTutorResponse(response),
        completedAt: this.deps.clock.now(),
        status: "COMPLETED",
      };

      await this.deps.unitOfWork.transaction(async ({ runs }) => {
        await runs.complete(completed);
      });

      return { run: completed, response };
    } catch (error) {
      if (error instanceof ProviderFailure) {
        return {
          run: await this.failRun(pending, error.category, TUTOR_ITEM_COUNT),
          response: null,
        };
      }

      throw error;
    }
  }

  /**
   * Asks a model what it makes of one written answer, and records what it said.
   *
   * **The grading is advice. The owner's own verdict is the record.** That is the design
   * decision this method exists to express, and it is why nothing here touches the attempt:
   * the owner has already self-graded, the attempt keeps `SELF_ASSESSED`, and what comes
   * back is a second opinion beside it. The one thing the outcome offers the interface is
   * `recommendedSelfGrade`, which the feedback screen may use to *highlight* a button —
   * never to press one (`domain/answer-evaluation.ts`).
   *
   * The answer text is passed in rather than read back from the attempt. The page has it,
   * and reading it back would make this module depend on study-sessions for a string it was
   * handed — the same boundary the module-boundaries test enforces in the other direction.
   *
   * Refused before the call, rather than after paying for the discovery:
   *
   * - a question that is not in this track, so a guessed address cannot spend a call;
   * - a question that is not `SHORT_ANSWER`, because grading compares an answer against
   *   expected concepts and a choice question has none — a marked choice is graded by
   *   comparison, which needs no model at all;
   * - a question whose revision records no expected concepts, because there is then
   *   nothing to grade against and `checkAnswerEvaluation` would reject every answer.
   *
   * Any lifecycle is allowed, deliberately as for the tutor: the owner answered this
   * question, so understanding their answer is legitimate whatever has happened to the
   * question since.
   */
  async evaluateShortAnswer(
    slug: CertificationSlug,
    questionId: string,
    answerText: string,
  ): Promise<AnswerEvaluationOutcome> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      throw new CertificationNotFoundError(slug);
    }

    const current =
      await this.deps.questions.findWithCurrentRevision(questionId);

    if (
      current === null ||
      current.question.certificationId !== certification.id
    ) {
      throw new AnswerNotGradableError(
        "That question no longer exists in this track.",
      );
    }

    const { content } = current.revision;

    if (content.type !== "SHORT_ANSWER") {
      throw new AnswerNotGradableError(
        "Only a written answer can be graded this way. A question with choices is marked by comparing what you picked, which needs no model call.",
      );
    }

    const expectedConcepts = content.expectedConcepts;

    if (expectedConcepts.length === 0) {
      throw new AnswerNotGradableError(
        "This question records no expected concepts, so there is nothing to grade an answer against. Add them by editing the question.",
      );
    }

    const answer = answerText.trim();

    if (answer.length === 0) {
      throw new AnswerNotGradableError("There is no answer text to grade.");
    }

    const [objectives, linkedIds] = await Promise.all([
      this.deps.objectives.listByCertification(certification.id),
      this.deps.questions.listObjectiveLinks(questionId),
    ]);
    const persona = await this.resolvePersona(certification, null);
    const prompt = renderPrompt("ANSWER_EVALUATION", {
      persona,
      trackName: certification.name,
      examCode: certification.examCode,
      objectives: objectives
        .filter((objective) => linkedIds.includes(objective.id))
        .map((objective) => ({
          id: objective.id,
          code: objective.code,
          title: objective.title,
          description: objective.description,
          kind: objectiveKind(objectives, objective.id),
        })),
      spec: {
        itemCount: ANSWER_EVALUATION_ITEM_COUNT,
        objectiveIds: [],
        difficulty: null,
        additionalInstructions: null,
        questionTypes: [],
        cardTypes: [],
      },
      reviewedRevision: current.revision,
      gradedAnswer: answer,
    });
    // The answer is hashed rather than named, unlike the revision: a fingerprint column
    // must not become a copy of what the owner typed, and grading the same answer twice
    // still has to fingerprint the same. The revision travels as its identifier, which is
    // immutable, so an edit changes the fingerprint by construction.
    const inputHash = sha256Hex(
      [
        `certification=${certification.id}`,
        "kind=ANSWER_EVALUATION",
        `question=${questionId}`,
        `revision=${current.revision.id}`,
        `answer=${sha256Hex(answer)}`,
      ].join("\n"),
    );
    const pending: GenerationRun = {
      id: this.deps.ids.nextId(),
      certificationId: certification.id,
      itemKind: "ANSWER_EVALUATION",
      // Marked from the model's own knowledge against concepts the owner recorded. No
      // source was consulted, and the panel says so in words too.
      generationMode: "MODEL_KNOWLEDGE",
      // The review gateway, for the reason the tutor uses it: marking is a judging job
      // rather than an authoring one, and the run has to record the model actually asked.
      modelProvider: this.reviewGateway.provider,
      modelId: this.reviewGateway.modelId,
      personaId: persona.id,
      personaVersion: persona.version,
      promptTemplateId: templateIdForItemKind("ANSWER_EVALUATION"),
      promptTemplateVersion: templateVersionForItemKind("ANSWER_EVALUATION"),
      inputHash,
      selectedSourceSnapshotIds: [],
      requestedItemCount: ANSWER_EVALUATION_ITEM_COUNT,
      successfulItemCount: 0,
      failedItemCount: 0,
      usageMetadata: null,
      failureReason: null,
      proposedPayload: null,
      // Stays null forever: a grading proposes nothing to write, not even to the attempt.
      appliedAt: null,
      subjectQuestionId: questionId,
      // The exact revision whose concepts the answer was marked against, so a later edit
      // makes the grading visibly historical rather than silently misattributed.
      subjectRevisionId: current.revision.id,
      startedAt: this.deps.clock.now(),
      completedAt: null,
      status: "PENDING",
    };

    await this.deps.unitOfWork.transaction(async ({ runs }) => {
      await runs.create(pending);
    });

    try {
      const produced = await this.reviewGateway.generateStructured({
        system: prompt.system,
        user: prompt.user,
        schemaName: ANSWER_EVALUATION_SCHEMA_NAME,
        schemaDescription: ANSWER_EVALUATION_SCHEMA_DESCRIPTION,
        schema: answerEvaluationJsonSchema(),
        // Closed over the question's own concepts, so the gateway stays ignorant of them
        // and a grading that names a concept the question does not have is still refused.
        validate: answerEvaluationValidator(expectedConcepts),
        maxOutputTokens: maxOutputTokensFor(
          "ANSWER_EVALUATION",
          ANSWER_EVALUATION_ITEM_COUNT,
        ),
      });
      const evaluation = produced.value;
      const completed: GenerationRun = {
        ...pending,
        successfulItemCount: ANSWER_EVALUATION_ITEM_COUNT,
        failedItemCount: 0,
        usageMetadata: produced.usage,
        proposedPayload: serializeAnswerEvaluation(evaluation),
        completedAt: this.deps.clock.now(),
        status: "COMPLETED",
      };

      await this.deps.unitOfWork.transaction(async ({ runs }) => {
        await runs.complete(completed);
      });

      return {
        run: completed,
        evaluation,
        recommendedSelfGrade: recommendedSelfGrade(evaluation.verdict),
      };
    } catch (error) {
      if (error instanceof ProviderFailure) {
        return {
          run: await this.failRun(
            pending,
            error.category,
            ANSWER_EVALUATION_ITEM_COUNT,
          ),
          evaluation: null,
          recommendedSelfGrade: null,
        };
      }

      throw error;
    }
  }

  /**
   * The latest AI challenge of one question, for the panel on its page.
   *
   * `null` when the question has never been challenged, which is the ordinary case: the
   * page then shows the challenge form and no outcome.
   */
  async findQuestionChallenge(
    questionId: string,
  ): Promise<QuestionChallengeView | null> {
    const run = await this.deps.runs.findLatestChallengeForQuestion(questionId);

    if (run === null) {
      return null;
    }

    const current =
      await this.deps.questions.findWithCurrentRevision(questionId);

    if (current === null) {
      return null;
    }

    const challenge = readQuestionChallenge(run.proposedPayload);

    return {
      run,
      challenge,
      staleRevision:
        run.subjectRevisionId !== null &&
        run.subjectRevisionId !== current.question.currentRevisionId,
      offersDispute:
        challenge !== null &&
        challengeRecommendsDispute(challenge) &&
        current.question.qualityStatus !== "DISPUTED",
      revisionNote:
        challenge !== null && recommendsRevision(challenge)
          ? challenge.suggestedRevisionNote
          : null,
    };
  }

  /**
   * Asks a model to adjudicate one objection the owner raised, and records what it said.
   *
   * This is the acceptance criterion "a challenge can produce a structured quality
   * finding" (`SPEC.md` section 25.2 item 11), and the criterion it must not break is the
   * next one: the AI never rewrites the question
   * (`spec/AI-GUIDELINES.md` section 1.10, item 12).
   *
   * Both are held by construction rather than by care here:
   *
   * - **The finding is structured.** A verdict about whose reading holds, a recommendation,
   *   the argument, and at most a *note* about what a revision would change — validated,
   *   consistency-checked, and stored on the run so it is readable months later beside the
   *   question (`domain/question-challenge.ts`).
   * - **The revision stays the owner's.** There is no field in `QuestionChallenge` that can
   *   carry a replacement stem, choice, answer key, or explanation, and no call in this
   *   method that writes to a question at all. A `DISPUTE` recommendation becomes a
   *   prefilled button the owner clicks; a `REVISE` recommendation becomes a note beside
   *   the edit form they already have.
   * - **The objection is data, not instruction.** It travels in the user message inside its
   *   own delimiter pair, labelled as the person's words, and the system message says the
   *   adjudicator's job cannot be changed by anything inside those markers
   *   (`spec/SECURITY.md`, `spec/AI-GUIDELINES.md` section 1.7).
   *
   * The lifecycle rule is the review's rather than the tutor's: challenging something the
   * owner has already retired or archived would spend a call on a decision that has been
   * made.
   */
  async challengeQuestion(
    slug: CertificationSlug,
    questionId: string,
    reason: string,
  ): Promise<QuestionChallengeOutcome> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      throw new CertificationNotFoundError(slug);
    }

    const current =
      await this.deps.questions.findWithCurrentRevision(questionId);

    if (
      current === null ||
      current.question.certificationId !== certification.id
    ) {
      throw new QuestionNotChallengeableError(
        "That question no longer exists in this track.",
      );
    }

    if (!isReviewableLifecycle(current.question.lifecycleStatus)) {
      throw new QuestionNotChallengeableError(
        "Only a draft or active question can be challenged. You have already taken this one out of study.",
      );
    }

    const objection = reason.trim();

    if (objection.length === 0) {
      throw new QuestionNotChallengeableError(
        "Say what you disagree with, so there is something to judge.",
      );
    }

    const [objectives, linkedIds] = await Promise.all([
      this.deps.objectives.listByCertification(certification.id),
      this.deps.questions.listObjectiveLinks(questionId),
    ]);
    const persona = await this.resolvePersona(certification, null);
    const prompt = renderPrompt("QUESTION_CHALLENGE", {
      persona,
      trackName: certification.name,
      examCode: certification.examCode,
      objectives: objectives
        .filter((objective) => linkedIds.includes(objective.id))
        .map((objective) => ({
          id: objective.id,
          code: objective.code,
          title: objective.title,
          description: objective.description,
          kind: objectiveKind(objectives, objective.id),
        })),
      spec: {
        itemCount: QUESTION_CHALLENGE_ITEM_COUNT,
        objectiveIds: [],
        difficulty: null,
        additionalInstructions: null,
        questionTypes: [],
        cardTypes: [],
      },
      reviewedRevision: current.revision,
      challengeReason: objection,
    });
    // The objection is hashed rather than carried, for the reason the graded answer is: a
    // fingerprint must not become a copy of what the owner wrote, and two different
    // objections to the same revision are two different requests.
    const inputHash = sha256Hex(
      [
        `certification=${certification.id}`,
        "kind=QUESTION_CHALLENGE",
        `question=${questionId}`,
        `revision=${current.revision.id}`,
        `reason=${sha256Hex(objection)}`,
      ].join("\n"),
    );
    const pending: GenerationRun = {
      id: this.deps.ids.nextId(),
      certificationId: certification.id,
      itemKind: "QUESTION_CHALLENGE",
      generationMode: "MODEL_KNOWLEDGE",
      modelProvider: this.reviewGateway.provider,
      modelId: this.reviewGateway.modelId,
      personaId: persona.id,
      personaVersion: persona.version,
      promptTemplateId: templateIdForItemKind("QUESTION_CHALLENGE"),
      promptTemplateVersion: templateVersionForItemKind("QUESTION_CHALLENGE"),
      inputHash,
      selectedSourceSnapshotIds: [],
      requestedItemCount: QUESTION_CHALLENGE_ITEM_COUNT,
      successfulItemCount: 0,
      failedItemCount: 0,
      usageMetadata: null,
      failureReason: null,
      proposedPayload: null,
      // Stays null forever, including for a challenge that recommends a revision: the
      // revision is the owner's own edit, so there is nothing here to apply.
      appliedAt: null,
      subjectQuestionId: questionId,
      subjectRevisionId: current.revision.id,
      startedAt: this.deps.clock.now(),
      completedAt: null,
      status: "PENDING",
    };

    await this.deps.unitOfWork.transaction(async ({ runs }) => {
      await runs.create(pending);
    });

    try {
      const produced = await this.reviewGateway.generateStructured({
        system: prompt.system,
        user: prompt.user,
        schemaName: QUESTION_CHALLENGE_SCHEMA_NAME,
        schemaDescription: QUESTION_CHALLENGE_SCHEMA_DESCRIPTION,
        schema: questionChallengeJsonSchema(),
        validate: validateQuestionChallenge,
        maxOutputTokens: maxOutputTokensFor(
          "QUESTION_CHALLENGE",
          QUESTION_CHALLENGE_ITEM_COUNT,
        ),
      });
      const challenge = produced.value;
      const completed: GenerationRun = {
        ...pending,
        successfulItemCount: QUESTION_CHALLENGE_ITEM_COUNT,
        failedItemCount: 0,
        usageMetadata: produced.usage,
        proposedPayload: serializeQuestionChallenge(challenge),
        completedAt: this.deps.clock.now(),
        status: "COMPLETED",
      };

      // Nothing is written to the question, not even on a STORED_ANSWER_WRONG verdict.
      // Disputing is the owner's click, offered prefilled by `findQuestionChallenge`.
      await this.deps.unitOfWork.transaction(async ({ runs }) => {
        await runs.complete(completed);
      });

      return { run: completed, challenge };
    } catch (error) {
      if (error instanceof ProviderFailure) {
        return {
          run: await this.failRun(
            pending,
            error.category,
            QUESTION_CHALLENGE_ITEM_COUNT,
          ),
          challenge: null,
        };
      }

      throw error;
    }
  }

  /**
   * The owner accepts a clean review: `UNREVIEWED` becomes `AI_REVIEWED`.
   *
   * On demand only — a review records findings and never moves the state itself
   * (owner decision, 2026-08-15). This is the explicit click. It re-reads the
   * stored review and applies `qualityStatusAfterReview`, so it can only perform
   * the one promotion that function allows: a `SOUND`, answer-correct review of a
   * currently `UNREVIEWED` question whose revision has not changed since.
   */
  async acceptQuestionReview(
    slug: CertificationSlug,
    questionId: string,
  ): Promise<void> {
    const view = await this.findQuestionReview(questionId);
    const current =
      await this.deps.questions.findWithCurrentRevision(questionId);
    const certification = await this.deps.certifications.findBySlug(slug);

    if (
      certification === null ||
      current === null ||
      current.question.certificationId !== certification.id
    ) {
      throw new QuestionNotReviewableError(
        "That question no longer exists in this track.",
      );
    }

    if (view === null || view.review === null || view.staleRevision) {
      throw new QuestionNotReviewableError(
        "There is no current review to accept. Review the question first.",
      );
    }

    const promoted = qualityStatusAfterReview(
      view.review,
      current.question.qualityStatus,
    );

    if (promoted === null) {
      throw new QuestionNotReviewableError(
        "This review does not support marking the question AI-reviewed. Only a clean review of an unreviewed question can be accepted.",
      );
    }

    await this.deps.questions.setQualityStatus(
      questionId,
      promoted,
      current.question.disputeReason,
      this.deps.clock.now(),
    );
  }

  /**
   * Generates a batch of questions.
   *
   * Separate from `requestFlashcardGeneration` rather than one method taking a kind,
   * because the two produce different aggregates through different repositories and
   * the shared part is small. The private `generate` below is where the shared part
   * lives.
   */
  async requestQuestionGeneration(
    slug: CertificationSlug,
    input: GenerationRequestInput,
  ): Promise<GenerationResult> {
    return this.generate("QUESTION", slug, input);
  }

  async requestFlashcardGeneration(
    slug: CertificationSlug,
    input: GenerationRequestInput,
  ): Promise<GenerationResult> {
    return this.generate("FLASHCARD", slug, input);
  }

  /** What the enrichment form offers: how many cards are left to do. */
  async findEnrichmentForm(
    slug: CertificationSlug,
  ): Promise<EnrichmentFormView | null> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      return null;
    }

    return {
      certification,
      persona: personaForStudyType(certification.studyType),
      unenrichedCount: await this.deps.flashcards.countUnenrichedVocabulary(
        certification.id,
      ),
      maxItemCount: MAX_ENRICHMENT_ITEMS,
      modelProvider: this.deps.gateway.provider,
      modelId: this.deps.gateway.modelId,
    };
  }

  /**
   * Enriches the next unenriched vocabulary cards of one track.
   *
   * Its own method rather than a third branch of `generate`, because the two differ
   * everywhere `generate`'s sequence matters. There is no item count the owner
   * chooses items *for* — the cards are chosen by the bank's own order, so the run's
   * requested count is however many cards were actually available. There is no
   * objective mapping, no difficulty, and no content type. And the write is an
   * appended revision on a card that already exists rather than a new aggregate,
   * which means `DRAFT` is not involved at all: the card keeps the lifecycle it had,
   * because an enrichment run must not quietly pull a card the owner is studying out
   * of study.
   *
   * What is shared is what makes a run a run, and it is shared by following the same
   * order: write the `PENDING` row before the provider is called, call the provider
   * outside any transaction, then store and complete in one transaction.
   */
  async requestVocabularyEnrichment(
    slug: CertificationSlug,
    input: EnrichmentRequestInput,
  ): Promise<EnrichmentResult> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      throw new CertificationNotFoundError(slug);
    }

    if (input.count > MAX_ENRICHMENT_ITEMS) {
      throw new GenerationBatchTooLargeError(input.count, MAX_ENRICHMENT_ITEMS);
    }

    const cards = await this.deps.flashcards.findUnenrichedVocabulary({
      certificationId: certification.id,
      limit: input.count,
    });
    const targets = cards.flatMap(toEnrichmentTarget);

    if (targets.length === 0) {
      // No run row, because there is nothing to record: no model was called and no
      // tokens were spent. A run with a requested count of zero would also be a row
      // the schema refuses, and rightly — it would describe a request nobody made.
      return { nothingToEnrich: true };
    }

    const spec: GenerationRequestSpec = {
      // However many cards were found, which may be fewer than asked for near the
      // end of the bank. The run then truthfully records what it set out to do.
      itemCount: targets.length,
      objectiveIds: [],
      difficulty: null,
      additionalInstructions: input.additionalInstructions,
      questionTypes: [],
      cardTypes: [],
    };
    // The selected cards are part of the fingerprint, because "enrich twenty cards"
    // is a different request every time it is asked: the scope moves forward as
    // cards are enriched. Including the identifiers means the duplicate guard can
    // only fire for the *same* cards, which is what a genuine repeat would be.
    const inputHash = sha256Hex(
      [
        canonicalRequestText({
          certificationId: certification.id,
          itemKind: "ENRICH_VOCABULARY",
          spec,
        }),
        `cards=${targets.map((target) => target.flashcardId).join(",")}`,
      ].join("\n"),
    );

    if (!input.generateAnyway) {
      const duplicate = await this.deps.runs.findLatestByInputHash(
        certification.id,
        inputHash,
        "ENRICH_VOCABULARY",
      );

      if (duplicate !== null) {
        return { duplicateOf: duplicate };
      }
    }

    const persona = personaForStudyType(certification.studyType);
    const pending: GenerationRun = {
      id: this.deps.ids.nextId(),
      certificationId: certification.id,
      itemKind: "ENRICH_VOCABULARY",
      generationMode: "MODEL_KNOWLEDGE",
      modelProvider: this.deps.gateway.provider,
      modelId: this.deps.gateway.modelId,
      personaId: persona.id,
      personaVersion: persona.version,
      promptTemplateId: templateIdForItemKind("ENRICH_VOCABULARY"),
      promptTemplateVersion: templateVersionForItemKind("ENRICH_VOCABULARY"),
      inputHash,
      selectedSourceSnapshotIds: [],
      requestedItemCount: spec.itemCount,
      successfulItemCount: 0,
      failedItemCount: 0,
      usageMetadata: null,
      failureReason: null,
      // Only an objective-import run proposes anything for the owner to confirm; a
      // generation run's items are written by the run itself.
      proposedPayload: null,
      appliedAt: null,
      // Only a review is about one existing question. Enrichment touches many cards, and
      // which ones is recorded on the revisions it wrote.
      subjectQuestionId: null,
      subjectRevisionId: null,
      startedAt: this.deps.clock.now(),
      completedAt: null,
      status: "PENDING",
    };

    await this.deps.unitOfWork.transaction(async ({ runs }) => {
      await runs.create(pending);
    });

    const prompt = renderPrompt("ENRICH_VOCABULARY", {
      persona,
      trackName: certification.name,
      examCode: certification.examCode,
      // No objectives: an enriched card is the card it already was, and its
      // objective links are not generation's to change.
      objectives: [],
      spec,
      enrichmentTargets: targets,
    });

    try {
      return await this.storeEnrichment(
        pending,
        targets,
        await this.produceEnrichment(prompt, spec, targets),
      );
    } catch (error) {
      if (error instanceof ProviderFailure) {
        return {
          run: await this.failRun(pending, error.category, spec.itemCount),
          rejected: [],
          unenriched: targets.length,
        };
      }

      throw error;
    }
  }

  /**
   * Deletes one still-draft generated item.
   *
   * Rejection is a hard delete, which is why it is confined to drafts: an item the
   * owner has activated is content in their bank, and generation's opinion of it
   * ended when they accepted it.
   *
   * *Accept* has no method here on purpose. Accepting a generated draft is
   * activating it, which the question bank and the flashcard module already own, with
   * their own transition rules and their own audit of when it happened. A second
   * "accept" path in this module would be a second way to activate content and could
   * disagree with the first (`spec/ARCHITECTURE.md` section 3). The review screen
   * therefore links to the item, where Activate lives.
   */
  async rejectDraft(
    runId: GenerationRunId,
    itemId: string,
  ): Promise<CertificationId> {
    return this.deps.unitOfWork.transaction(
      async ({ runs, questions, flashcards }) => {
        const run = await runs.findById(runId);

        if (run === null) {
          throw new GenerationRunNotFoundError(runId);
        }

        if (run.itemKind === "QUESTION") {
          const question = await questions.findById(itemId);

          assertRejectable(
            question === null ? null : question.lifecycleStatus,
            question?.generationRunId ?? null,
            runId,
            "question",
          );
          await questions.delete(itemId);
        } else {
          const flashcard = await flashcards.findById(itemId);

          assertRejectable(
            flashcard === null ? null : flashcard.lifecycleStatus,
            flashcard?.generationRunId ?? null,
            runId,
            "flashcard",
          );
          await flashcards.delete(itemId);
        }

        return run.certificationId;
      },
    );
  }

  /**
   * The whole generation flow.
   *
   * The order is deliberate and is the milestone's core sequence:
   *
   * 1. Resolve the track and its objectives, and refuse an oversized batch.
   * 2. Fingerprint the request and check for an equivalent earlier batch.
   * 3. Write a `PENDING` run — *before* the provider is called, so a crashed
   *    process still leaves evidence that a call was made and paid for.
   * 4. Render the versioned prompt and call the gateway.
   * 5. Validate, then run the deterministic checks.
   * 6. In one transaction: store the survivors and complete the run.
   *
   * Steps 3 and 6 are separate transactions on purpose. Holding a write transaction
   * open across a network call to a model would block every other write in the
   * application for as long as the model takes to answer.
   */
  private async generate(
    kind: GeneratedItemKind,
    slug: CertificationSlug,
    input: GenerationRequestInput,
  ): Promise<GenerationResult> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      throw new CertificationNotFoundError(slug);
    }

    if (input.itemCount > MAX_BATCH_ITEMS) {
      throw new GenerationBatchTooLargeError(input.itemCount, MAX_BATCH_ITEMS);
    }

    const objectives = await this.deps.objectives.listByCertification(
      certification.id,
    );
    const spec = toSpec(input, objectives);
    const inputHash = sha256Hex(
      canonicalRequestText({
        certificationId: certification.id,
        itemKind: kind,
        spec,
      }),
    );

    if (!input.generateAnyway) {
      const duplicate = await this.deps.runs.findLatestByInputHash(
        certification.id,
        inputHash,
        kind,
      );

      if (duplicate !== null) {
        return { duplicateOf: duplicate };
      }
    }

    const persona = await this.resolvePersona(certification, input.personaId);
    const startedAt = this.deps.clock.now();
    const pending: GenerationRun = {
      id: this.deps.ids.nextId(),
      certificationId: certification.id,
      itemKind: kind,
      // D6 generates from model knowledge only. Sources arrive in D8, and
      // claiming a grounded mode without a source would be a false provenance
      // record (`spec/AI-GUIDELINES.md` section 1.2).
      generationMode: "MODEL_KNOWLEDGE",
      modelProvider: this.deps.gateway.provider,
      modelId: this.deps.gateway.modelId,
      // For a built-in persona this is its `PersonaId`; for one of the owner's, its
      // `personaKey` and its own version. Text either way, and never the stored
      // persona's uuid: the run must stay explicable after the persona is deleted,
      // which a foreign key would not allow and a uuid would not explain.
      personaId: persona.id,
      personaVersion: persona.version,
      promptTemplateId: templateIdForItemKind(kind),
      promptTemplateVersion: templateVersionForItemKind(kind),
      inputHash,
      selectedSourceSnapshotIds: [],
      requestedItemCount: spec.itemCount,
      successfulItemCount: 0,
      failedItemCount: 0,
      usageMetadata: null,
      failureReason: null,
      // See `requestVocabularyEnrichment`: nothing here is proposed for confirmation.
      proposedPayload: null,
      appliedAt: null,
      // A generation run creates its items rather than being about one that exists.
      subjectQuestionId: null,
      subjectRevisionId: null,
      startedAt,
      completedAt: null,
      status: "PENDING",
    };

    await this.deps.unitOfWork.transaction(async ({ runs }) => {
      await runs.create(pending);
    });

    const prompt = renderPrompt(kind, {
      persona,
      trackName: certification.name,
      examCode: certification.examCode,
      // Active objectives only, but the *kind* is judged against the full set: an
      // archived parent still says which root its children descend from.
      objectives: objectives
        .filter((objective) => objective.status === "ACTIVE")
        .map((objective) => ({
          id: objective.id,
          code: objective.code,
          title: objective.title,
          description: objective.description,
          kind: objectiveKind(objectives, objective.id),
        })),
      spec,
    });

    const context: CheckContext = {
      objectiveIds: objectives
        .filter((objective) => objective.status === "ACTIVE")
        .map((objective) => objective.id),
    };

    try {
      const produced =
        kind === "QUESTION"
          ? await this.produceQuestions(prompt, persona, spec, context)
          : await this.produceFlashcards(prompt, persona, spec, context);

      return await this.storeBatch(pending, produced);
    } catch (error) {
      if (error instanceof ProviderFailure) {
        // The provider failed, so nothing was generated and nothing is stored. The
        // run records the category, which is all the owner is shown: the provider's
        // own message never reaches the run, the interface, or a log
        // (`spec/SECURITY.md`).
        return {
          run: await this.failRun(pending, error.category, spec.itemCount),
          rejected: [],
        };
      }

      throw error;
    }
  }

  /**
   * Asks the model for questions, validates them, and checks them.
   *
   * Returns a `write` closure rather than the drafts themselves so that the two
   * item kinds converge on one persistence path without either the type or the
   * table being narrowed by a cast: the closure already knows which repository its
   * drafts belong to.
   */
  private async produceQuestions(
    prompt: RenderedPrompt,
    persona: EffectivePersona,
    spec: GenerationRequestSpec,
    context: CheckContext,
  ): Promise<ProducedBatch> {
    const types =
      spec.questionTypes.length > 0
        ? spec.questionTypes
        : persona.defaultQuestionTypes;
    const result = await this.deps.gateway.generateStructured({
      system: prompt.system,
      user: prompt.user,
      schemaName: QUESTION_SCHEMA_NAME,
      schemaDescription:
        "Records the practice questions written for this request.",
      schema: questionOutputJsonSchema(types),
      validate: (value) =>
        validateQuestionOutput(value, {
          contentLanguage: persona.contentLanguage,
        }),
      maxOutputTokens: maxOutputTokensFor("QUESTION", spec.itemCount),
    });
    const checked = checkQuestionDrafts(result.value, context);

    return {
      accepted: checked.accepted.length,
      rejected: checked.rejected,
      usage: result.usage,
      write: async (repositories, run) => {
        for (const draft of checked.accepted) {
          await this.storeQuestion(repositories.questions, run, draft);
        }
      },
    };
  }

  private async produceFlashcards(
    prompt: RenderedPrompt,
    persona: EffectivePersona,
    spec: GenerationRequestSpec,
    context: CheckContext,
  ): Promise<ProducedBatch> {
    const types =
      spec.cardTypes.length > 0 ? spec.cardTypes : persona.defaultCardTypes;
    const result = await this.deps.gateway.generateStructured({
      system: prompt.system,
      user: prompt.user,
      schemaName: FLASHCARD_SCHEMA_NAME,
      schemaDescription: "Records the flashcards written for this request.",
      schema: flashcardOutputJsonSchema(types),
      validate: (value) =>
        validateFlashcardOutput(value, {
          contentLanguage: persona.contentLanguage,
        }),
      maxOutputTokens: maxOutputTokensFor("FLASHCARD", spec.itemCount),
    });
    const checked = checkFlashcardDrafts(result.value, context);

    return {
      accepted: checked.accepted.length,
      rejected: checked.rejected,
      usage: result.usage,
      write: async (repositories, run) => {
        for (const draft of checked.accepted) {
          await this.storeFlashcard(repositories.flashcards, run, draft);
        }
      },
    };
  }

  /** Asks the model to enrich the given cards, then matches its answers to them. */
  private async produceEnrichment(
    prompt: RenderedPrompt,
    spec: GenerationRequestSpec,
    targets: readonly VocabularyEnrichmentTarget[],
  ): Promise<ProducedEnrichment> {
    const result = await this.deps.gateway.generateStructured({
      system: prompt.system,
      user: prompt.user,
      schemaName: ENRICHMENT_SCHEMA_NAME,
      schemaDescription:
        "Records the dictionary detail written for these words.",
      schema: enrichmentOutputJsonSchema(),
      validate: validateEnrichmentOutput,
      maxOutputTokens: maxOutputTokensFor("ENRICH_VOCABULARY", spec.itemCount),
    });

    return {
      matched: matchEnrichments(targets, result.value),
      usage: result.usage,
    };
  }

  /**
   * Appends one revision per accepted enrichment and completes the run.
   *
   * Every card that failed — a rejected answer, or a card no answer covered — is left
   * exactly as it was. That is the whole failure mode: enrichment is additive, so
   * "not enriched" is the same state the card was already in, and the next run picks
   * it up again because it still has no `meanings`.
   */
  private async storeEnrichment(
    pending: GenerationRun,
    targets: readonly VocabularyEnrichmentTarget[],
    produced: ProducedEnrichment,
  ): Promise<EnrichmentOutcome> {
    const matched = produced.matched;
    const successfulItemCount = matched.matched.length;
    const failedItemCount = targets.length - successfulItemCount;
    const completed: GenerationRun = {
      ...pending,
      successfulItemCount,
      failedItemCount,
      usageMetadata: produced.usage,
      failureReason: successfulItemCount === 0 ? "NO_USABLE_ITEMS" : null,
      completedAt: this.deps.clock.now(),
      status: resolveRunStatus({ successfulItemCount, failedItemCount }),
    };

    await this.deps.unitOfWork.transaction(async ({ runs, flashcards }) => {
      for (const enrichment of matched.matched) {
        await this.storeEnrichedRevision(flashcards, pending, enrichment);
      }

      await runs.complete(completed);
    });

    return {
      run: completed,
      rejected: matched.rejected,
      unenriched: matched.unmatched.length,
    };
  }

  /**
   * One enrichment as a new revision of the card it belongs to.
   *
   * Append-only, like every other card edit (`spec/DOMAIN-RULES.md` section 1.1):
   * the text the owner or the importer wrote stays readable as the revision before
   * this one, so an enrichment the owner dislikes is a revision they can compare
   * against rather than a change they cannot see.
   *
   * The card's lifecycle, its own `generationRunId`, its notes, its tags, and its
   * language are all carried through untouched. Only the content changes, and only
   * by addition.
   */
  private async storeEnrichedRevision(
    flashcards: FlashcardRepository,
    run: GenerationRun,
    enrichment: MatchedEnrichment,
  ): Promise<void> {
    const current = await flashcards.findWithCurrentRevision(
      enrichment.target.flashcardId,
    );

    // Gone or rewritten since it was selected: another tab retired it, or the owner
    // edited it while the model was answering. Skipping is right either way, because
    // the enrichment describes text that is no longer the card's current text.
    if (current === null || current.revision.cardType !== "VOCABULARY") {
      return;
    }

    const now = this.deps.clock.now();

    await flashcards.appendRevision(
      {
        id: this.deps.ids.nextId(),
        flashcardId: current.flashcard.id,
        revisionNumber: current.revision.revisionNumber + 1,
        cardType: "VOCABULARY",
        content: mergeEnrichment(enrichment.target.content, enrichment.draft),
        notes: current.revision.notes,
        tags: current.revision.tags,
        language: current.revision.language,
        // This revision's text came from the run, even though the card did not.
        generationRunId: run.id,
        createdAt: now,
      },
      now,
    );
  }

  /**
   * Stores what survived the checks and completes the run, in one transaction.
   *
   * The run row, the items, and their objective links commit together: a run
   * claiming items that were never written, or items pointing at a rolled-back run,
   * would both be provenance that lies.
   *
   * Items are written through the bank repositories the manual authoring path uses,
   * so a generated question is stored by `QuestionRepository.create` exactly as a
   * hand-written one is and this module contributes no insert SQL of its own.
   */
  private async storeBatch(
    pending: GenerationRun,
    produced: ProducedBatch,
  ): Promise<GenerationOutcome> {
    const successfulItemCount = produced.accepted;
    const failedItemCount = produced.rejected.length;
    const completed: GenerationRun = {
      ...pending,
      successfulItemCount,
      failedItemCount,
      usageMetadata: produced.usage,
      // A batch where nothing survived is a failure with a reason, not a silent
      // empty success.
      failureReason: successfulItemCount === 0 ? "NO_USABLE_ITEMS" : null,
      completedAt: this.deps.clock.now(),
      status: resolveRunStatus({ successfulItemCount, failedItemCount }),
    };

    await this.deps.unitOfWork.transaction(async (repositories) => {
      await produced.write(repositories, pending);
      await repositories.runs.complete(completed);
    });

    return { run: completed, rejected: produced.rejected };
  }

  /**
   * One generated question as a draft.
   *
   * `DRAFT` and `UNREVIEWED` are written literally and there is no parameter to
   * change them (`SPEC.md` section 11.3): generated content never enters study
   * without the owner activating it, so "lifecycle defaults to DRAFT" is a property
   * of this code path rather than a value that could be checked and got wrong.
   */
  private async storeQuestion(
    questions: QuestionRepository,
    run: GenerationRun,
    draft: GeneratedQuestionDraft,
  ): Promise<void> {
    const now = this.deps.clock.now();
    const questionId = this.deps.ids.nextId();
    const question: Question = {
      id: questionId,
      certificationId: run.certificationId,
      currentRevisionId: this.deps.ids.nextId(),
      lifecycleStatus: "DRAFT",
      qualityStatus: "UNREVIEWED",
      generationMode: run.generationMode,
      // Provenance is the run identifier alone. The run row holds the model,
      // persona, and template, so the two cannot disagree.
      generationRunId: run.id,
      disputeReason: null,
      createdAt: now,
      updatedAt: now,
    };

    await questions.create(question, {
      id: question.currentRevisionId,
      questionId,
      revisionNumber: 1,
      stem: draft.stem,
      instructions: draft.instructions,
      questionType: draft.questionType,
      content: draft.content,
      explanation: draft.explanation,
      difficulty: draft.difficulty,
      tags: draft.tags,
      language: draft.language,
      createdAt: now,
    });

    if (draft.objectiveIds.length > 0) {
      await questions.replaceObjectiveLinks(
        questionId,
        draft.objectiveIds,
        now,
      );
    }
  }

  private async storeFlashcard(
    flashcards: FlashcardRepository,
    run: GenerationRun,
    draft: GeneratedFlashcardDraft,
  ): Promise<void> {
    const now = this.deps.clock.now();
    const flashcardId = this.deps.ids.nextId();
    const currentRevisionId = this.deps.ids.nextId();

    await flashcards.create(
      {
        id: flashcardId,
        certificationId: run.certificationId,
        currentRevisionId,
        lifecycleStatus: "DRAFT",
        sourceQuestionId: null,
        generationMode: run.generationMode,
        generationRunId: run.id,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: currentRevisionId,
        flashcardId,
        revisionNumber: 1,
        cardType: draft.cardType,
        content: draft.content,
        notes: draft.notes,
        tags: draft.tags,
        language: draft.language,
        // The same run both created the card and wrote its first text.
        generationRunId: run.id,
        createdAt: now,
      },
    );

    if (draft.objectiveIds.length > 0) {
      await flashcards.replaceObjectiveLinks(
        flashcardId,
        draft.objectiveIds,
        now,
      );
    }
  }

  /** Records a provider failure on the pending run. */
  private async failRun(
    pending: GenerationRun,
    category: GenerationRun["failureReason"],
    requestedItemCount: number,
  ): Promise<GenerationRun> {
    const failed: GenerationRun = {
      ...pending,
      successfulItemCount: 0,
      // Everything asked for failed to arrive, which is what the count says.
      failedItemCount: requestedItemCount,
      usageMetadata: null,
      failureReason: category,
      completedAt: this.deps.clock.now(),
      status: "FAILED",
    };

    await this.deps.unitOfWork.transaction(async ({ runs }) => {
      await runs.complete(failed);
    });

    return failed;
  }

  /**
   * The items a run produced, loaded from the bank that owns them.
   *
   * An identifier with no item is skipped rather than erroring: the owner may have
   * rejected or deleted the item since, and a run whose items are gone must still
   * render its counts and its provenance.
   */
  private async loadItems(
    kind: GeneratedItemKind,
    runId: GenerationRunId,
    itemIds: readonly string[],
  ): Promise<readonly GeneratedItemReview[]> {
    if (kind === "QUESTION") {
      const loaded = await Promise.all(
        itemIds.map(async (id) =>
          this.deps.questions.findWithCurrentRevision(id),
        ),
      );

      return loaded.flatMap((found): readonly GeneratedQuestionReview[] =>
        found === null
          ? []
          : [
              {
                kind: "QUESTION",
                item: found,
                rejectable: found.question.lifecycleStatus === "DRAFT",
                changedSinceGeneration:
                  found.revision.revisionNumber > 1 ||
                  found.question.lifecycleStatus !== "DRAFT",
              },
            ],
      );
    }

    const loaded = await Promise.all(
      itemIds.map(async (id) =>
        this.deps.flashcards.findWithCurrentRevision(id),
      ),
    );

    if (kind === "ENRICH_VOCABULARY") {
      return loaded.flatMap((found): readonly EnrichedFlashcardReview[] =>
        found === null
          ? []
          : [
              {
                kind: "ENRICH_VOCABULARY",
                item: found,
                rejectable: false,
                // The card's current revision is no longer the one this run wrote,
                // so the owner has edited it since — or a later enrichment has.
                changedSinceGeneration:
                  found.revision.generationRunId !== runId,
              },
            ],
      );
    }

    return loaded.flatMap((found): readonly GeneratedFlashcardReview[] =>
      found === null
        ? []
        : [
            {
              kind: "FLASHCARD",
              item: found,
              rejectable: found.flashcard.lifecycleStatus === "DRAFT",
              changedSinceGeneration:
                found.revision.revisionNumber > 1 ||
                found.flashcard.lifecycleStatus !== "DRAFT",
            },
          ],
    );
  }
}

/**
 * Turns parsed form input into the request specification.
 *
 * Objective identifiers are narrowed to active objectives of this track, so a stale
 * or hand-edited form cannot target another track's syllabus or an archived
 * objective. The narrowing is silent because the alternative — refusing the batch —
 * would fail a request the owner can no longer fix from the form they are looking
 * at.
 */
function toSpec(
  input: GenerationRequestInput,
  objectives: readonly Objective[],
): GenerationRequestSpec {
  const targetable = new Set(
    objectives
      .filter((objective) => objective.status === "ACTIVE")
      .map((objective) => objective.id),
  );

  return {
    itemCount: input.itemCount,
    objectiveIds: input.objectiveIds.filter((id) => targetable.has(id)),
    difficulty: input.difficulty,
    additionalInstructions: input.additionalInstructions,
    questionTypes: input.questionTypes,
    cardTypes: input.cardTypes,
  };
}

/**
 * A selected card as an enrichment target.
 *
 * Returns a list so it composes with `flatMap`: the repository selects vocabulary
 * cards, but the revision's content is a union, and narrowing it here means the rest
 * of the flow works with `VocabularyContent` rather than re-checking the type at
 * every step. A card whose content is not vocabulary cannot occur through that query
 * and is dropped rather than asserted away.
 */
function toEnrichmentTarget(
  card: FlashcardWithRevision,
): readonly VocabularyEnrichmentTarget[] {
  const content = card.revision.content;

  return content.type === "VOCABULARY"
    ? [{ flashcardId: card.flashcard.id, content }]
    : [];
}

/**
 * Which questions are worth spending a review call on.
 *
 * Draft and active, and nothing else. A draft is the case the feature exists for — freshly
 * generated content nobody has checked — and an active question is the other real one,
 * because the owner may want a second opinion on something already in study. Retired and
 * archived questions are excluded: they are out of study by the owner's own decision, so a
 * review of one would be a model call bought to learn something about material they have
 * already set aside.
 *
 * Exhaustive over the lifecycle union, so a new status has to decide rather than
 * defaulting into either answer.
 */
function isReviewableLifecycle(status: QuestionLifecycleStatus): boolean {
  switch (status) {
    case "DRAFT":
    case "ACTIVE":
      return true;
    case "RETIRED":
    case "ARCHIVED":
      return false;
  }
}

/**
 * Refuses a rejection that would delete the wrong thing.
 *
 * Three separate refusals rather than one: an item that has gone, an item from
 * another run, and an item the owner has activated are three different mistakes, and
 * the owner is told which one happened.
 */
function assertRejectable(
  lifecycleStatus: string | null,
  generationRunId: string | null,
  runId: GenerationRunId,
  noun: string,
): void {
  if (lifecycleStatus === null) {
    throw new GeneratedDraftNotRejectableError(
      `That ${noun} no longer exists — it may already have been rejected.`,
    );
  }

  if (generationRunId !== runId) {
    throw new GeneratedDraftNotRejectableError(
      `That ${noun} was not produced by this generation run.`,
    );
  }

  if (lifecycleStatus !== "DRAFT") {
    throw new GeneratedDraftNotRejectableError(
      `That ${noun} is no longer a draft, so it is yours now. Retire it from its own page instead.`,
    );
  }
}
