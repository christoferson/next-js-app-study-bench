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
import type {
  Question,
  QuestionWithRevision,
} from "@/modules/question-bank/domain/question";
import type { FlashcardWithRevision } from "@/modules/flashcards/domain/flashcard";
import type { QuestionRepository } from "@/modules/question-bank/ports/question-repository";
import type { FlashcardRepository } from "@/modules/flashcards/ports/flashcard-repository";
import {
  GeneratedDraftNotRejectableError,
  GenerationBatchTooLargeError,
  GenerationRunNotFoundError,
  ProviderFailure,
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
import type {
  GeneratedItemKind,
  GenerationRun,
  GenerationRunId,
  ProviderUsage,
} from "@/modules/ai-generation/domain/generation-run";
import { resolveRunStatus } from "@/modules/ai-generation/domain/generation-run";
import type { Persona } from "@/modules/ai-generation/domain/personas";
import {
  findPersona,
  personaForStudyType,
} from "@/modules/ai-generation/domain/personas";
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
  readonly persona: Persona;
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

/** The run review screen (`SPEC.md` section 24.2, generation preview). */
export interface GenerationRunDetailView {
  readonly certification: Certification;
  readonly run: GenerationRun;
  readonly counts: GenerationRunItemCounts;
  readonly items: readonly GeneratedItemReview[];
  /** Expanded from the recorded identifier, or `null` if it is no longer known. */
  readonly persona: Persona | null;
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
  readonly unitOfWork: GenerationUnitOfWork;
  /** The model. Composed in, so the fake gateway is a wiring choice. */
  readonly gateway: LanguageModelGateway;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export class GenerationFacade {
  constructor(private readonly deps: GenerationFacadeDependencies) {}

  /** What the generate form offers for one track. */
  async findGenerationForm(
    slug: CertificationSlug,
  ): Promise<GenerationFormView | null> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      return null;
    }

    const objectives = await this.deps.objectives.listByCertification(
      certification.id,
    );

    return {
      certification,
      objectives: objectives.filter(
        (objective) => objective.status === "ACTIVE",
      ),
      persona: personaForStudyType(certification.studyType),
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
      persona: findPersonaFor(run),
    };
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

    const persona = personaForStudyType(certification.studyType);
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
    persona: Persona,
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
    persona: Persona,
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

/**
 * The persona a recorded run used, when the registry still knows it.
 *
 * `null` rather than a throw: a run generated by a persona that has since been
 * renamed must still render, showing its recorded identifier and version.
 */
function findPersonaFor(run: GenerationRun): Persona | null {
  return findPersona(run.personaId);
}
