import type { Clock } from "@/platform/clock";
import type { IdGenerator } from "@/platform/id-generator";
import { sha256Hex } from "@/platform/hash";
import { normalizeExtractedText } from "@/shared/text-normalization";
import type {
  Certification,
  CertificationSlug,
} from "@/modules/certifications/domain/certification";
import { CertificationNotFoundError } from "@/modules/certifications/domain/errors";
import type { Objective } from "@/modules/certifications/domain/objective";
import type { CertificationRepository } from "@/modules/certifications/ports/certification-repository";
import {
  ObjectiveImportAlreadyAppliedError,
  ObjectiveImportNothingToApplyError,
  ProviderFailure,
  SyllabusUnreadableError,
} from "@/modules/ai-generation/domain/errors";
import type {
  GenerationRun,
  GenerationRunId,
  ProviderUsage,
} from "@/modules/ai-generation/domain/generation-run";
import {
  OBJECTIVE_IMPORT_ITEM_COUNT,
  OBJECTIVE_MERGE_OUTPUT_TOKENS,
  maxOutputTokensFor,
} from "@/modules/ai-generation/domain/generation-limits";
import {
  MAX_IMPORT_NODES,
  countProposedObjectives,
} from "@/modules/ai-generation/domain/objective-import";
import type {
  ImportSourceChoice,
  ProposedObjective,
  ProposedObjectiveTree,
} from "@/modules/ai-generation/domain/objective-import";
import {
  MAX_MERGE_EXISTING_NODES,
  countMergeItems,
  defaultCheckedMergeKeys,
  flattenForMerge,
  mergeItemKey,
  selectableMergeAdds,
  selectedMergeEnriches,
} from "@/modules/ai-generation/domain/objective-merge";
import type {
  ExistingObjectiveNode,
  MergeCounts,
  MergeItem,
  MergeSourceNode,
} from "@/modules/ai-generation/domain/objective-merge";
import {
  OBJECTIVE_MERGE_SCHEMA_NAME,
  objectiveMergeJsonSchema,
  objectiveMergeValidator,
} from "./objective-merge-schema";
import {
  DETERMINISTIC_MODEL_PROVIDER,
  DETERMINISTIC_PROMPT_TEMPLATE_ID,
  DETERMINISTIC_PROMPT_TEMPLATE_VERSION,
  MAX_IMPORT_STRATEGY_FILES,
  defaultImportStrategy,
  findImportStrategy,
  importNodeCapForRun,
  importStrategiesFor,
  importStrategy,
} from "@/modules/ai-generation/domain/import-strategy";
import type {
  ImportStrategy,
  ImportStrategyKey,
} from "@/modules/ai-generation/domain/import-strategy";
import { personaArchetypeForStudyType } from "@/modules/ai-generation/domain/stored-persona";
import { readHskImportFiles } from "./hsk-import/hsk-import-strategy";
import type {
  HskFileReading,
  HskFileRole,
} from "./hsk-import/hsk-import-strategy";
import type { EffectivePersona } from "@/modules/ai-generation/domain/personas";
import type { StoredPersona } from "@/modules/ai-generation/domain/stored-persona";
import type { PersonaRepository } from "@/modules/ai-generation/ports/persona-repository";
import {
  assignablePersonas,
  resolveEffectivePersona,
} from "./persona-selection";
import {
  renderObjectiveMergePrompt,
  renderPrompt,
  templateIdForItemKind,
  templateVersionForItemKind,
} from "@/modules/ai-generation/domain/prompt-templates";
import type { PromptObjective } from "@/modules/ai-generation/domain/prompt-templates";
import type {
  DocumentKind,
  DocumentTextExtractor,
} from "@/platform/documents/document-text-extractor";
import { DocumentUnreadableError } from "@/platform/documents/document-text-extractor";
import type { LanguageModelGateway } from "@/modules/ai-generation/ports/language-model-gateway";
import type { GenerationUnitOfWork } from "@/modules/ai-generation/ports/unit-of-work";
import {
  OBJECTIVE_IMPORT_SCHEMA_NAME,
  objectiveImportJsonSchema,
  readImportPayload,
  serializeImportPayload,
  validateProposedObjectives,
} from "./objective-import-schema";
import type { StoredImportPayload } from "./objective-import-schema";
import { MAX_SYLLABUS_CHARACTERS, MAX_SYLLABUS_FILE_BYTES } from "./schemas";
import type { ObjectiveImportRequestInput } from "./schemas";

/**
 * Objective-import capability: a syllabus in, a confirmed objective tree out.
 *
 * Its own facade rather than three more methods on `GenerationFacade`, because the flow
 * it owns is a different shape from every other generation flow and mixing them would
 * mean a second meaning for almost every step. A generation run's output *is* bank
 * content the moment the run completes; an import run's output is a proposal that the
 * owner reads and then accepts or throws away, and the objectives it becomes are the
 * track's outline rather than bank content. Sharing a class would have meant one method
 * that sometimes writes and sometimes does not.
 *
 * Three operations, and the middle one is the point:
 *
 * 1. `extractObjectives` — read the upload, call the model, validate, and record a run
 *    carrying the proposal. **Nothing is written to the objective hierarchy.**
 * 2. `findConfirmation` — read the proposal back for the confirm page.
 * 3. `applyImport` — insert the whole tree in one transaction, once.
 *
 * Two properties hold across all three:
 *
 * - **The uploaded file is never persisted.** Its bytes exist for the duration of one
 *   request, are turned into text, and are dropped. There is no source library yet
 *   (that is D8), so storing the file would mean inventing one with no reader; and a
 *   syllabus PDF is somebody else's copyrighted document, which this application has no
 *   reason to keep a copy of. What survives is the *extracted outline*, which is the
 *   part the owner is entitled to and the only part they asked for.
 * - **Confirmation is not optional.** Extraction and application are separate calls
 *   with a separate owner decision between them, and the source type — official syllabus
 *   or AI-assisted — is chosen at that point, because whether the document was official
 *   is a fact only the owner knows.
 */

/** What the upload form needs to render. */
export interface ObjectiveImportFormView {
  readonly certification: Certification;
  /** The persona this import would use with nothing chosen: assigned, else built-in. */
  readonly persona: EffectivePersona;
  /** Stored personas the owner may import with instead, archetype-restricted. */
  readonly personaChoices: readonly StoredPersona[];
  readonly assignedPersonaId: string | null;
  readonly modelProvider: string;
  readonly modelId: string;
  readonly maxFileBytes: number;
  readonly maxCharacters: number;
  /** Objectives the track already has, so the form can say what will be added to. */
  readonly existingObjectiveCount: number;
  /**
   * Every strategy, ordered for this track's archetype, plus the default.
   *
   * Both are sent rather than only the default, because the form is a choice: a language
   * track is offered the HSK reader first and the AI extractor second, and a technical
   * track the other way round, but neither list is filtered
   * (`domain/import-strategy.ts` explains why filtering would be wrong).
   */
  readonly strategies: readonly ImportStrategy[];
  readonly defaultStrategyKey: ImportStrategyKey;
  readonly maxFiles: number;
}

/** One uploaded document, as the action hands it over. */
export interface UploadedDocument {
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly kind: DocumentKind;
  /**
   * The role the owner set for this file, for a strategy that reads several.
   *
   * `null` means "classify it". Ignored by `GENERIC_OUTLINE`, which has one input and
   * therefore no roles to assign.
   */
  readonly role?: HskFileRole | null;
}

/**
 * One merge verdict, with everything the confirm page needs to render it in words.
 *
 * Resolved here rather than in the component, because every label on the screen is a join:
 * a verdict carries identifiers, and "add *Adverbs of degree* under *Grammar*" needs the
 * extracted node the ref names and the existing objective the id names. Doing that join in
 * the facade keeps the component a renderer and means an id that no longer resolves is
 * visible as a missing label rather than a crash.
 */
export interface MergeItemView {
  readonly item: MergeItem;
  /** The checkbox this item is applied by, or `null` for a skip. */
  readonly key: string | null;
  /** The extracted node the verdict is about, or `null` if the ref no longer resolves. */
  readonly source: MergeSourceNode | null;
  /**
   * Where an addition will land, in the owner's words.
   *
   * The existing objective's title for a nested add, the title of the addition it sits
   * under for an intra-batch one, and `null` for a new top-level objective.
   */
  readonly parentLabel: string | null;
  /** True when the parent is another addition rather than an existing objective. */
  readonly parentIsNew: boolean;
  /** The existing objective an enrichment or a skip refers to. */
  readonly existingTitle: string | null;
  /** What that objective's description says now, so the change can be read as a diff. */
  readonly existingDescription: string | null;
}

/** The reconciliation, as the confirm page renders it. */
export interface ObjectiveMergeView {
  /** The model's own sentence about the reconciliation as a whole. */
  readonly summary: string;
  readonly items: readonly MergeItemView[];
  readonly counts: MergeCounts;
  /** How many existing objectives the merge was shown. */
  readonly existingConsidered: number;
  /** Set when the track holds more objectives than one merge can be shown. */
  readonly existingTruncated: boolean;
  /** The keys checked when the page first renders: every add and every enrichment. */
  readonly defaultCheckedKeys: readonly string[];
}

/** What the confirm page needs: the proposal, and what has happened to it. */
export interface ObjectiveImportConfirmationView {
  readonly certification: Certification;
  readonly run: GenerationRun;
  /** `null` when the run proposed nothing, or its payload can no longer be read. */
  readonly tree: ProposedObjectiveTree | null;
  readonly nodeCount: number;
  /**
   * The reconciliation against the objectives the track already had, or `null`.
   *
   * `null` means no merge ran, and there are exactly two ways that happens: the track had
   * no objectives when the import ran, so there was nothing to reconcile against and every
   * extracted objective is simply added; or the payload was written before the merge
   * existed. Both render the plain tree, which is what they are.
   *
   * When it is set, the tree is still carried — the verdicts reference it by ref — but the
   * *decision* on screen is per verdict rather than per root.
   */
  readonly merge: ObjectiveMergeView | null;
  /** Objectives that would actually be written. Enrichments are not additions. */
  readonly addableCount: number;
  /** Set once the tree has been added, so the page offers no second Apply. */
  readonly applied: boolean;
  readonly modelProvider: string;
  /** The strategy the run used, so the page can say a model was or was not called. */
  readonly strategy: ImportStrategy;
}

/** The outcome of one extraction: always a run, sometimes with a proposal on it. */
export interface ObjectiveImportResult {
  readonly run: GenerationRun;
  /** How many objectives were proposed. Zero for a failed extraction. */
  readonly proposedCount: number;
  /** Set when the document was longer than the character cap and was cut. */
  readonly truncated: boolean;
  /**
   * What the merge decided, when one ran. `null` for a track with no objectives yet.
   *
   * Returned as well as stored so the action can say what happened without re-reading the
   * run; the confirm page reads it back off the payload either way.
   */
  readonly mergeCounts: MergeCounts | null;
  /**
   * What each uploaded file turned out to be, for a multi-file strategy.
   *
   * Empty for `GENERIC_OUTLINE`. Returned rather than stored, because it describes the
   * *upload* — filenames and roles — and the run row deliberately keeps nothing about the
   * files it read (`extractObjectives` documents why the upload is never persisted).
   */
  readonly fileReadings: readonly HskFileReading[];
}

export interface ObjectiveImportFacadeDependencies {
  readonly certifications: CertificationRepository;
  /** The owner's own personas, for the same resolution order the generate flow uses. */
  readonly personas: PersonaRepository;
  readonly unitOfWork: GenerationUnitOfWork;
  readonly gateway: LanguageModelGateway;
  readonly extractor: DocumentTextExtractor;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export class ObjectiveImportFacade {
  constructor(private readonly deps: ObjectiveImportFacadeDependencies) {}

  async findImportForm(
    slug: CertificationSlug,
  ): Promise<ObjectiveImportFormView | null> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      return null;
    }

    const objectives = await this.deps.unitOfWork.transaction(
      async ({ objectives: repository }) =>
        repository.listByCertification(certification.id),
    );

    return {
      certification,
      persona: await resolveEffectivePersona(
        this.deps.personas,
        certification,
        null,
      ),
      personaChoices: assignablePersonas(
        await this.deps.personas.list(),
        certification,
      ),
      assignedPersonaId: certification.personaId,
      modelProvider: this.deps.gateway.provider,
      modelId: this.deps.gateway.modelId,
      maxFileBytes: MAX_SYLLABUS_FILE_BYTES,
      maxCharacters: MAX_SYLLABUS_CHARACTERS,
      existingObjectiveCount: objectives.length,
      strategies: importStrategiesFor(archetype(certification)),
      defaultStrategyKey: defaultImportStrategy(archetype(certification)).key,
      maxFiles: MAX_IMPORT_STRATEGY_FILES,
    };
  }

  /**
   * Reads one upload and asks a model for the outline it states.
   *
   * The order is the one every run in this module follows, for the reasons
   * `GenerationFacade.generate` documents: write the `PENDING` row before the provider
   * is called so a crashed process still shows that a call was paid for, call the
   * provider outside any transaction so a model's latency does not hold a write lock,
   * then record the outcome.
   *
   * The one step before all of that is extraction, and it deliberately raises a form
   * error rather than recording a failed run: an unreadable file means no model was
   * called, and a run row for it would claim a call that never happened.
   */
  async extractObjectives(
    slug: CertificationSlug,
    input: ObjectiveImportRequestInput,
    documents: readonly UploadedDocument[] | UploadedDocument | null,
  ): Promise<ObjectiveImportResult> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      throw new CertificationNotFoundError(slug);
    }

    const uploads = toUploadList(documents);
    const strategy = importStrategy(input.strategyKey);

    // The one dispatch in the flow, and it is a lookup rather than a condition: a
    // strategy states whether it calls a model, and there are exactly two ways an
    // objective tree can come into being — a provider answered, or the repository's own
    // parsers read the files. Everything after this point is shared.
    if (!strategy.callsModel) {
      return this.runDeterministicImport(certification, strategy, uploads);
    }

    const source = await this.readSource(input, uploads[0] ?? null);
    const objectives = await this.deps.unitOfWork.transaction(
      async ({ objectives: repository }) =>
        repository.listByCertification(certification.id),
    );
    const persona = await resolveEffectivePersona(
      this.deps.personas,
      certification,
      input.personaId,
    );
    const prompt = renderPrompt("OBJECTIVE_IMPORT", {
      persona,
      trackName: certification.name,
      examCode: certification.examCode,
      // Sent as a count only — see the template. The existing objectives' own text is
      // not sent, because the model is reading a document, not reconciling two trees.
      objectives: objectives.map(toPromptObjective),
      spec: {
        itemCount: OBJECTIVE_IMPORT_ITEM_COUNT,
        objectiveIds: [],
        difficulty: null,
        additionalInstructions: input.additionalInstructions,
        questionTypes: [],
        cardTypes: [],
      },
      syllabusText: source.text,
    });
    // The document's text is the request, so it is what the fingerprint is over. The
    // hash rather than the text: a fingerprint column must not become a copy of
    // somebody's syllabus.
    const inputHash = sha256Hex(
      [
        `certification=${certification.id}`,
        "kind=OBJECTIVE_IMPORT",
        `notes=${input.additionalInstructions ?? ""}`,
        `text=${source.text}`,
      ].join("\n"),
    );
    const pending: GenerationRun = {
      id: this.deps.ids.nextId(),
      certificationId: certification.id,
      itemKind: "OBJECTIVE_IMPORT",
      // The model read a document the owner supplied, which is what SOURCE_GROUNDED
      // means: this is the first run kind in the application whose answer is supposed to
      // come from a source rather than from the model's own knowledge
      // (`spec/AI-GUIDELINES.md` section 1.2).
      generationMode: "SOURCE_GROUNDED",
      modelProvider: this.deps.gateway.provider,
      modelId: this.deps.gateway.modelId,
      // A built-in persona's id, or one of the owner's personas' key and version. Text,
      // never the stored persona's uuid, so the run stays readable after a deletion.
      personaId: persona.id,
      personaVersion: persona.version,
      promptTemplateId: templateIdForItemKind("OBJECTIVE_IMPORT"),
      promptTemplateVersion: templateVersionForItemKind("OBJECTIVE_IMPORT"),
      inputHash,
      // Empty, and it stays empty until D8 gives the application a source library. The
      // uploaded file is not snapshotted, so there is no snapshot identifier to record
      // and claiming one would be a false provenance record.
      selectedSourceSnapshotIds: [],
      requestedItemCount: OBJECTIVE_IMPORT_ITEM_COUNT,
      successfulItemCount: 0,
      failedItemCount: 0,
      usageMetadata: null,
      failureReason: null,
      proposedPayload: null,
      appliedAt: null,
      // An import is about a document, not about a question in the bank.
      subjectQuestionId: null,
      subjectRevisionId: null,
      startedAt: this.deps.clock.now(),
      completedAt: null,
      status: "PENDING",
    };

    await this.deps.unitOfWork.transaction(async ({ runs }) => {
      await runs.create(pending);
    });

    try {
      const produced = await this.deps.gateway.generateStructured({
        system: prompt.system,
        user: prompt.user,
        schemaName: OBJECTIVE_IMPORT_SCHEMA_NAME,
        schemaDescription:
          "The study outline the uploaded document states, as a tree of objectives.",
        schema: objectiveImportJsonSchema(),
        validate: validateProposedObjectives,
        maxOutputTokens: maxOutputTokensFor(
          "OBJECTIVE_IMPORT",
          OBJECTIVE_IMPORT_ITEM_COUNT,
        ),
      });
      const nodeCount = countProposedObjectives(produced.value.roots);
      // The second call, and only when there is something to reconcile against. The
      // objectives read for the prompt above are reused rather than re-read: they are from
      // the same request, and reading them twice would only widen the window in which the
      // hierarchy could change under the merge.
      const merged = await this.mergeIntoExisting(
        certification,
        produced.value,
        persona,
        objectives,
      );
      const completed: GenerationRun = {
        ...pending,
        // How many objectives the document turned out to state. The requested count
        // stays one — one document — so the two numbers say different true things.
        successfulItemCount: nodeCount,
        failedItemCount: 0,
        // Both calls, added together, on the one run that made them. Splitting them would
        // need a column; leaving the merge's out would understate what the import cost.
        usageMetadata: addUsage(produced.usage, merged.usage),
        proposedPayload: serializeImportPayload(merged.payload),
        completedAt: this.deps.clock.now(),
        status: "COMPLETED",
      };

      await this.deps.unitOfWork.transaction(async ({ runs }) => {
        await runs.complete(completed);
      });

      return {
        run: completed,
        proposedCount: nodeCount,
        truncated: source.truncated,
        mergeCounts:
          merged.payload.kind === "MERGE"
            ? countMergeItems(merged.payload.plan.items)
            : null,
        fileReadings: [],
      };
    } catch (error) {
      if (error instanceof ProviderFailure) {
        const failed: GenerationRun = {
          ...pending,
          failedItemCount: OBJECTIVE_IMPORT_ITEM_COUNT,
          failureReason: error.category,
          completedAt: this.deps.clock.now(),
          status: "FAILED",
        };

        await this.deps.unitOfWork.transaction(async ({ runs }) => {
          await runs.complete(failed);
        });

        return {
          run: failed,
          proposedCount: 0,
          truncated: source.truncated,
          mergeCounts: null,
          fileReadings: [],
        };
      }

      throw error;
    }
  }

  /**
   * Reconciles an extracted outline with the outline the track already has.
   *
   * Skipped entirely for a track with no objectives, and that is the first design decision
   * rather than an optimisation. There is nothing to merge into: every extracted objective is
   * new by construction, and a model asked to prove it would spend tokens returning four
   * hundred verdicts all saying ADD-at-top-level — with some chance of getting one wrong. So
   * an empty track produces a `TREE` payload and the flow is exactly what it was before this
   * step existed.
   *
   * When the track *does* have objectives, one structured call decides per extracted node.
   * Three properties of it are deliberate:
   *
   * - **It runs outside any transaction**, like every other provider call in this module: a
   *   model's latency must not hold a write lock.
   * - **A failed merge is not a failed import.** `ProviderFailure` is caught here and the
   *   extraction is kept as a plain `TREE` payload, because the expensive half already
   *   succeeded and the owner would rather confirm a coarse proposal than lose the document
   *   read. The run stays `COMPLETED` and says what it proposed; what it does not do is claim
   *   a reconciliation that did not happen.
   * - **The existing hierarchy is bounded before it is sent.** A track with more objectives
   *   than `MAX_MERGE_EXISTING_NODES` has the first of them described and the truncation
   *   stated in the prompt and on screen, rather than a prompt that grows without limit.
   */
  private async mergeIntoExisting(
    certification: Certification,
    tree: ProposedObjectiveTree,
    persona: EffectivePersona,
    existingObjectives: readonly Objective[],
  ): Promise<{
    readonly payload: StoredImportPayload;
    readonly usage: ProviderUsage | null;
  }> {
    const active = existingObjectives.filter(
      (objective) => objective.status === "ACTIVE",
    );

    if (active.length === 0 || tree.roots.length === 0) {
      return { payload: { kind: "TREE", tree }, usage: null };
    }

    const ordered = orderForMerge(active);
    const existing = ordered.slice(0, MAX_MERGE_EXISTING_NODES);
    const existingTruncated = ordered.length > existing.length;
    const sourceNodes = flattenForMerge(tree.roots);
    const prompt = renderObjectiveMergePrompt({
      persona,
      trackName: certification.name,
      examCode: certification.examCode,
      existing,
      existingTruncated,
      extracted: sourceNodes,
    });

    try {
      const produced = await this.deps.gateway.generateStructured({
        system: prompt.system,
        user: prompt.user,
        schemaName: OBJECTIVE_MERGE_SCHEMA_NAME,
        schemaDescription:
          "How each extracted objective reconciles with the ones the track already has.",
        schema: objectiveMergeJsonSchema(),
        validate: objectiveMergeValidator(sourceNodes, existing),
        maxOutputTokens: OBJECTIVE_MERGE_OUTPUT_TOKENS,
      });

      return {
        payload: {
          kind: "MERGE",
          tree,
          plan: produced.value,
          existingConsidered: existing.length,
          existingTruncated,
          templateId: prompt.templateId,
          templateVersion: prompt.templateVersion,
          provider: this.deps.gateway.provider,
          modelId: this.deps.gateway.modelId,
        },
        usage: produced.usage,
      };
    } catch (error) {
      if (error instanceof ProviderFailure) {
        return { payload: { kind: "TREE", tree }, usage: null };
      }

      throw error;
    }
  }

  /**
   * Reads several files with a certification family's own parsers, no model involved.
   *
   * A run is still recorded, and that is the interesting decision. Nothing was spent and
   * no provider was called, so there is an argument for writing the objectives directly —
   * but the run row is what carries the proposal between the upload and the confirm page,
   * and the confirm step is not optional for a deterministic import either: a parser can
   * read the wrong file perfectly well, and the owner reading the tree is the check that
   * catches it. Recording it also means the track's history says where its objectives came
   * from, which is the whole point of the history.
   *
   * The provenance is honest about calling nothing:
   *
   * - `modelProvider` is `deterministic`, not the configured provider.
   * - `modelId` is the strategy key, which is the thing that actually did the reading —
   *   and which `importNodeCapForRun` reads back to apply the right cap.
   * - `generationMode` is `IMPORTED`, the mode that exists for exactly this: a
   *   deterministic import of a known format rather than an extraction.
   * - `usageMetadata` stays `null`. Zero tokens recorded as zero would look like a call
   *   that returned nothing; no usage is the true statement.
   * - The persona is the track's, at its version, because that is a fact about the run's
   *   configuration — but the prompt template id says `deterministic`, because no template
   *   was rendered.
   *
   * The plan is validated through the same schema an extraction's answer is, at the
   * strategy's own cap. Validating trusted input looks redundant and is not: it is what
   * guarantees the payload the confirm page reads back is one the apply step can insert,
   * and a parser that produced a four-level tree should fail here rather than at the
   * database.
   */
  private async runDeterministicImport(
    certification: Certification,
    strategy: ImportStrategy,
    uploads: readonly UploadedDocument[],
  ): Promise<ObjectiveImportResult> {
    if (uploads.length === 0) {
      throw new SyllabusUnreadableError(
        "Choose at least one file. This reader takes the syllabus text, the grammar appendix JSON, or your topic notes — any one of them, or several at once.",
      );
    }

    const files = await Promise.all(
      uploads.map(async (upload) => ({
        filename: upload.filename,
        text: normalizeExtractedText(await this.readUploadText(upload)),
        role: upload.role ?? null,
      })),
    );
    const reading = readHskImportFiles(files);
    const persona = await resolveEffectivePersona(
      this.deps.personas,
      certification,
      null,
    );
    // Over the files' text, like an extraction's hash, and for the same reason: the
    // fingerprint identifies the request without the column becoming a copy of the
    // document. Roles are part of it, because the same files under different roles are a
    // different request.
    const inputHash = sha256Hex(
      [
        `certification=${certification.id}`,
        "kind=OBJECTIVE_IMPORT",
        `strategy=${strategy.key}`,
        ...files.map(
          (file) => `role=${file.role ?? "auto"}\ntext=${file.text}`,
        ),
      ].join("\n"),
    );
    const validated = validateProposedObjectives(
      { objectives: reading.roots },
      strategy.maxNodes,
    );
    // The merge runs for a deterministic parse too, and this is the case it was actually
    // built for: the HSK grammar appendix imported onto a track that already has a Grammar
    // root. The parse is free and the reconciliation is not, so a deterministic import of a
    // *first* outline still calls nothing at all — `mergeIntoExisting` returns without a
    // provider call when the track is empty.
    const merged = validated.ok
      ? await this.mergeIntoExisting(
          certification,
          validated.value,
          persona,
          await this.deps.unitOfWork.transaction(
            async ({ objectives: repository }) =>
              repository.listByCertification(certification.id),
          ),
        )
      : null;
    const now = this.deps.clock.now();
    // Two ways this can fail, and they are different things. `MALFORMED_OUTPUT` is a plan
    // the import's own schema rejected — a parser bug, effectively. `NO_USABLE_ITEMS` is
    // every file being unrecognised or ignored, which is the owner's mis-selection and the
    // one a message can actually help with. An extraction that returns nothing is recorded
    // COMPLETED-with-zero instead, because a model answering "no outline here" is an
    // answer; a reader recognising none of its own documents is not.
    const failure =
      validated.ok === false
        ? "MALFORMED_OUTPUT"
        : reading.roots.length === 0
          ? "NO_USABLE_ITEMS"
          : null;
    const run: GenerationRun = {
      id: this.deps.ids.nextId(),
      certificationId: certification.id,
      itemKind: "OBJECTIVE_IMPORT",
      generationMode: "IMPORTED",
      modelProvider: DETERMINISTIC_MODEL_PROVIDER,
      modelId: strategy.key,
      personaId: persona.id,
      personaVersion: persona.version,
      promptTemplateId: DETERMINISTIC_PROMPT_TEMPLATE_ID,
      promptTemplateVersion: DETERMINISTIC_PROMPT_TEMPLATE_VERSION,
      inputHash,
      selectedSourceSnapshotIds: [],
      requestedItemCount: OBJECTIVE_IMPORT_ITEM_COUNT,
      successfulItemCount: failure === null ? reading.nodeCount : 0,
      failedItemCount: failure === null ? 0 : OBJECTIVE_IMPORT_ITEM_COUNT,
      // The merge's tokens and nothing else, because the parse spent none. Still `null` when
      // no merge ran: zero tokens recorded as zero would look like a call that returned
      // nothing, and no usage is the true statement.
      usageMetadata: merged?.usage ?? null,
      failureReason: failure,
      proposedPayload:
        merged === null ? null : serializeImportPayload(merged.payload),
      appliedAt: null,
      subjectQuestionId: null,
      subjectRevisionId: null,
      startedAt: now,
      // Completed in one step rather than written PENDING first: the PENDING row exists so
      // a crash mid-provider-call still shows a spent call, and there is no call to spend.
      completedAt: now,
      status: failure === null ? "COMPLETED" : "FAILED",
    };

    // One insert, already complete. `create` writes every column including the outcome,
    // and `complete` exists to record an outcome that arrived later — which here it did
    // not.
    await this.deps.unitOfWork.transaction(async ({ runs }) => {
      await runs.create(run);
    });

    return {
      run,
      proposedCount: failure === null ? reading.nodeCount : 0,
      truncated: false,
      mergeCounts:
        merged?.payload.kind === "MERGE"
          ? countMergeItems(merged.payload.plan.items)
          : null,
      fileReadings: reading.files,
    };
  }

  /** One upload as text: extracted for a PDF, decoded for anything else. */
  private async readUploadText(upload: UploadedDocument): Promise<string> {
    if (upload.bytes.byteLength === 0) {
      throw new SyllabusUnreadableError(
        `${upload.filename} is empty. Leave it out, or choose the file with the content in it.`,
      );
    }

    if (upload.bytes.byteLength > MAX_SYLLABUS_FILE_BYTES) {
      throw new SyllabusUnreadableError(
        `${upload.filename} is larger than ${Math.floor(MAX_SYLLABUS_FILE_BYTES / (1024 * 1024))} MB. Upload the syllabus documents themselves rather than a whole course bundle.`,
      );
    }

    try {
      const extracted = await this.deps.extractor.extract(
        upload.bytes,
        upload.kind,
      );

      return extracted.text;
    } catch (error) {
      if (error instanceof DocumentUnreadableError) {
        throw new SyllabusUnreadableError(
          `${upload.filename}: ${error.message}`,
        );
      }

      throw error;
    }
  }

  /** The proposal, for the confirm page. `null` when the run is not this track's. */
  async findConfirmation(
    slug: CertificationSlug,
    runId: GenerationRunId,
  ): Promise<ObjectiveImportConfirmationView | null> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      return null;
    }

    const run = await this.deps.unitOfWork.transaction(async ({ runs }) =>
      runs.findById(runId),
    );

    // Scoped to the track in the query as well as in the route, so a run identifier
    // from another track cannot be read through this track's URL.
    if (
      run === null ||
      run.certificationId !== certification.id ||
      run.itemKind !== "OBJECTIVE_IMPORT"
    ) {
      return null;
    }

    // The cap the run itself was validated at, so a deterministic plan of 117 objectives
    // does not become unreadable the moment the confirm page asks for it.
    const payload = readImportPayload(
      run.proposedPayload,
      importNodeCapForRun(run),
    );
    const tree = payload === null ? null : payload.tree;
    const nodeCount = tree === null ? 0 : countProposedObjectives(tree.roots);

    if (payload === null || payload.kind === "TREE") {
      return {
        certification,
        run,
        tree,
        nodeCount,
        merge: null,
        // Nothing was reconciled, so the whole tree is what would be written. That is the
        // correct answer for both of the ways a `TREE` payload happens: an empty track, and
        // a payload from before the merge existed.
        addableCount: nodeCount,
        applied: run.appliedAt !== null,
        modelProvider: run.modelProvider,
        strategy: strategyForRun(run),
      };
    }

    // Read live rather than trusted from the payload: the owner may have edited an
    // objective since the merge ran, and the description shown as "what it says now" has to
    // be what it actually says now or the before-and-after on screen is a lie.
    const existing = await this.deps.unitOfWork.transaction(
      async ({ objectives: repository }) =>
        repository.listByCertification(certification.id),
    );
    const merge = describeMerge(payload, existing);

    return {
      certification,
      run,
      tree,
      nodeCount,
      merge,
      addableCount: merge.counts.adds,
      applied: run.appliedAt !== null,
      modelProvider: run.modelProvider,
      strategy: strategyForRun(run),
    };
  }

  /**
   * Adds a confirmed outline to the track, once.
   *
   * One transaction for the whole tree: a half-inserted outline would leave the owner
   * with orphaned children and no way to tell which parts were the model's proposal.
   *
   * The idempotence guard runs *first, inside the same transaction*: `markApplied` is a
   * conditional update that succeeds for exactly one caller, so a second Apply — from a
   * stale tab, a double submit, or a back-and-resubmit — is refused rather than doubling
   * every objective. Because it is in the transaction, a failure anywhere in the insert
   * rolls the claim back too, so a crash does not leave a run marked applied with
   * nothing applied.
   *
   * Roots are appended after whatever the track already has, ordered as proposed, and
   * nothing existing is read for anything except its display order. An import adds; it
   * never edits, renumbers, or archives an objective the owner already had — with exactly
   * one exception, which the merge introduced and which is bounded to a single column: an
   * `ENRICH` verdict rewrites an existing objective's **description**. Not its title, not its
   * code, not its parent, not its weight, not its source type, not its display order, not its
   * status. That boundary is enforced here rather than trusted from the payload, because it is
   * the one place a bad merge could damage something the owner wrote.
   *
   * `checkedKeys` is what the owner left ticked. `null` means "everything actionable", which
   * is what a plain-tree payload gets and what a caller with no per-item form sends.
   */
  async applyImport(
    slug: CertificationSlug,
    runId: GenerationRunId,
    sourceType: ImportSourceChoice,
    checkedKeys: readonly string[] | null = null,
  ): Promise<{
    readonly certification: Certification;
    readonly added: number;
    /** Objectives whose description was extended from the new material. */
    readonly enriched: number;
    /** Verdicts left out: the merge's skips, plus anything the owner unticked. */
    readonly skipped: number;
    /**
     * Additions dropped because the addition they belonged under was not applied.
     *
     * Reported rather than silently folded into `skipped`, because it is the one outcome the
     * owner did not directly ask for: unticking a new category takes the points inside it
     * with it, and the message after the apply says so.
     */
    readonly omitted: number;
  }> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      throw new CertificationNotFoundError(slug);
    }

    return this.deps.unitOfWork.transaction(async ({ runs, objectives }) => {
      const run = await runs.findById(runId);

      if (
        run === null ||
        run.certificationId !== certification.id ||
        run.itemKind !== "OBJECTIVE_IMPORT"
      ) {
        throw new ObjectiveImportNothingToApplyError(runId);
      }

      // Read before the duplicate check, and reported as its own outcome, because a run
      // that has already been applied has *necessarily* put all of its roots on the track
      // — so the skip rule below would otherwise report "nothing to apply" for what is
      // really "you already did this". `markApplied` still guards the race; this only
      // decides which of the two true things the owner is told.
      if (run.appliedAt !== null) {
        throw new ObjectiveImportAlreadyAppliedError(runId);
      }

      const payload = readImportPayload(
        run.proposedPayload,
        importNodeCapForRun(run),
      );

      if (payload === null || payload.tree.roots.length === 0) {
        throw new ObjectiveImportNothingToApplyError(runId);
      }

      const existing = await objectives.listByCertification(certification.id);
      const now = this.deps.clock.now();
      // Where a new *root* goes: after everything the track already has at the top level.
      // Nothing existing is renumbered.
      const nextRootOrder =
        existing
          .filter((objective) => objective.parentObjectiveId === null)
          .reduce(
            (highest, objective) => Math.max(highest, objective.displayOrder),
            0,
          ) + 1;

      if (payload.kind === "TREE") {
        // The unmerged path, unchanged: the whole tree, appended. This is a track that had no
        // objectives when the import ran, or a payload from before the merge existed.
        if (!(await runs.markApplied(runId, now))) {
          throw new ObjectiveImportAlreadyAppliedError(runId);
        }

        let added = 0;

        const insert = async (
          nodes: readonly ProposedObjective[],
          parentObjectiveId: string | null,
          firstOrder: number,
        ): Promise<void> => {
          for (const [index, node] of nodes.entries()) {
            const objective: Objective = {
              id: this.deps.ids.nextId(),
              certificationId: certification.id,
              parentObjectiveId,
              code: node.code,
              title: node.title,
              description: node.description,
              weight: node.weight,
              sourceType,
              displayOrder: firstOrder + index,
              status: "ACTIVE",
              createdAt: now,
              updatedAt: now,
            };

            await objectives.save(objective);
            added += 1;

            // Children start at 1: they are a new sibling group under a parent that did
            // not exist a moment ago, so there is nothing to append after.
            await insert(node.children, objective.id, 1);
          }
        };

        await insert(payload.tree.roots, null, nextRootOrder);

        return {
          certification,
          added,
          enriched: 0,
          skipped: 0,
          omitted: 0,
        };
      }

      const items = payload.plan.items;
      const checked = new Set(checkedKeys ?? defaultCheckedMergeKeys(items));
      const existingById = new Map(
        existing.map((objective) => [objective.id, objective]),
      );
      const selected = selectableMergeAdds(items, checked);
      // Resolved against the rows this transaction is about to write beside, not against the
      // hierarchy the merge saw: an objective archived or deleted since then cannot be
      // enriched or nested under, and dropping that one verdict is a far better answer than
      // failing the whole apply or writing an orphan.
      const adds = selected.adds.filter(
        (add) =>
          add.parentExistingId === null ||
          existingById.get(add.parentExistingId)?.status === "ACTIVE",
      );
      const enriches = selectedMergeEnriches(items, checked).filter(
        (enrich) => existingById.get(enrich.existingId)?.status === "ACTIVE",
      );

      // Neither half has anything to do. The same error an empty proposal gets, for the same
      // reason: from the owner's side it is one outcome, and the run must not be marked
      // applied for it — unticking everything and pressing Apply should leave the proposal
      // readable and re-appliable.
      if (adds.length === 0 && enriches.length === 0) {
        throw new ObjectiveImportNothingToApplyError(runId);
      }

      if (!(await runs.markApplied(runId, now))) {
        throw new ObjectiveImportAlreadyAppliedError(runId);
      }

      /** The database id each added ref got, so a later add can parent onto it. */
      const idByRef = new Map<string, string>();
      /** The next display order within each parent, existing rows counted. */
      const nextOrder = new Map<string | null, number>([[null, nextRootOrder]]);

      const orderUnder = (parentId: string | null): number => {
        const known = nextOrder.get(parentId);

        if (known !== undefined) {
          nextOrder.set(parentId, known + 1);

          return known;
        }

        // First addition under this existing parent: append after its current children,
        // which is what makes a merge into a populated subtree keep the owner's own order.
        const highest = existing
          .filter((objective) => objective.parentObjectiveId === parentId)
          .reduce((top, objective) => Math.max(top, objective.displayOrder), 0);

        nextOrder.set(parentId, highest + 2);

        return highest + 1;
      };

      // In plan order, which is document order, and parents precede their children by
      // construction — `checkObjectiveMerge` refuses a forward `parentRef` — so one pass
      // resolves every intra-batch parent from `idByRef`.
      for (const add of adds) {
        const parentObjectiveId =
          add.parentExistingId ??
          (add.parentRef === null
            ? null
            : (idByRef.get(add.parentRef) ?? null));
        const objective: Objective = {
          id: this.deps.ids.nextId(),
          certificationId: certification.id,
          parentObjectiveId,
          code: add.code,
          title: add.title,
          description: add.description,
          weight: add.weight,
          sourceType,
          displayOrder: orderUnder(parentObjectiveId),
          status: "ACTIVE",
          createdAt: now,
          updatedAt: now,
        };

        await objectives.save(objective);
        idByRef.set(add.ref, objective.id);
      }

      for (const enrich of enriches) {
        const target = existingById.get(enrich.existingId);

        if (target === undefined) {
          continue;
        }

        // Spread-then-override on the row that was read, so every other column is written
        // back exactly as it was found. The description and `updatedAt` are the only two
        // things a merge is allowed to change about an objective the owner already had.
        await objectives.save({
          ...target,
          description: enrich.description,
          updatedAt: now,
        });
      }

      return {
        certification,
        added: adds.length,
        enriched: enriches.length,
        skipped: items.length - adds.length - enriches.length,
        omitted: selected.omitted.length,
      };
    });
  }

  /**
   * The document's text, normalized and capped.
   *
   * A paste and a file are the same kind of input by the time they get here, and both
   * are accepted: the paste box is not a lesser path but the robust one, because it works
   * for a syllabus on a web page, in an email, or in a PDF this extractor reads badly.
   * When both are supplied the file wins and the paste is appended, so neither is
   * silently discarded.
   *
   * Truncation is reported rather than hidden. It is a real loss of the end of a long
   * document, and the confirm step says so, so an owner whose appendix went missing can
   * see why.
   */
  private async readSource(
    input: ObjectiveImportRequestInput,
    document: UploadedDocument | null,
  ): Promise<{ readonly text: string; readonly truncated: boolean }> {
    const parts: string[] = [];

    if (document !== null) {
      if (document.bytes.byteLength === 0) {
        throw new SyllabusUnreadableError(
          "That file is empty. Choose a PDF or text file with the syllabus in it.",
        );
      }

      if (document.bytes.byteLength > MAX_SYLLABUS_FILE_BYTES) {
        throw new SyllabusUnreadableError(
          `That file is larger than ${Math.floor(MAX_SYLLABUS_FILE_BYTES / (1024 * 1024))} MB. Upload the syllabus on its own rather than a whole course bundle, or paste the outline instead.`,
        );
      }

      try {
        const extracted = await this.deps.extractor.extract(
          document.bytes,
          document.kind,
        );

        parts.push(extracted.text);
      } catch (error) {
        if (error instanceof DocumentUnreadableError) {
          throw new SyllabusUnreadableError(error.message);
        }

        throw error;
      }
    }

    if (input.pastedText !== null) {
      parts.push(input.pastedText);
    }

    const normalized = normalizeExtractedText(parts.join("\n\n"));

    if (normalized.length === 0) {
      throw new SyllabusUnreadableError(
        "No text could be read from that. A PDF that is a scan has no text layer; paste the outline instead.",
      );
    }

    return normalized.length <= MAX_SYLLABUS_CHARACTERS
      ? { text: normalized, truncated: false }
      : {
          text: normalized.slice(0, MAX_SYLLABUS_CHARACTERS),
          truncated: true,
        };
  }
}

/** How many objectives an import is allowed to propose, for the form to state. */
export { MAX_IMPORT_NODES };

/** The uploads as a list, whichever way the caller passed them. */
function toUploadList(
  documents: readonly UploadedDocument[] | UploadedDocument | null,
): readonly UploadedDocument[] {
  if (documents === null) {
    return [];
  }

  // `Array.isArray` does not narrow a `readonly T[]` union member, so the shape is tested
  // instead: a single upload has bytes, a list does not.
  return "bytes" in documents ? [documents] : documents;
}

/** Which archetype's strategy ordering this track gets. */
function archetype(certification: Certification) {
  return personaArchetypeForStudyType(certification.studyType);
}

/**
 * The strategy a recorded run used.
 *
 * Read from the provenance columns rather than from a column of its own: a deterministic
 * run's `modelId` *is* its strategy key, and a run with a real provider was necessarily
 * the extraction. That keeps this change out of the schema, which matters because
 * migrations 0001–0015 are settled.
 */
function strategyForRun(run: GenerationRun): ImportStrategy {
  return run.modelProvider === DETERMINISTIC_MODEL_PROVIDER
    ? (findImportStrategy(run.modelId) ?? importStrategy("GENERIC_OUTLINE"))
    : importStrategy("GENERIC_OUTLINE");
}

/**
 * The existing hierarchy in tree order, as the merge step describes it.
 *
 * Tree order rather than the repository's order, because the prompt renders it indented and
 * an indented list whose parents do not precede their children is unreadable — to a model as
 * much as to a person. Siblings keep their display order, so what the model sees is the outline
 * as the track page shows it.
 *
 * Archived objectives are already filtered out by the caller: an archived objective is one the
 * owner has retired, and offering it as a parent for new material, or enriching its
 * description, would be reviving it by a side door.
 */
function orderForMerge(
  objectives: readonly Objective[],
): readonly ExistingObjectiveNode[] {
  const byParent = new Map<string | null, Objective[]>();

  for (const objective of objectives) {
    const siblings = byParent.get(objective.parentObjectiveId) ?? [];

    siblings.push(objective);
    byParent.set(objective.parentObjectiveId, siblings);
  }

  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => left.displayOrder - right.displayOrder);
  }

  const ordered: ExistingObjectiveNode[] = [];

  const walk = (parentId: string | null, depth: number): void => {
    for (const objective of byParent.get(parentId) ?? []) {
      ordered.push({
        id: objective.id,
        code: objective.code,
        title: objective.title,
        depth,
        parentId: objective.parentObjectiveId,
      });
      walk(objective.id, depth + 1);
    }
  };

  walk(null, 1);

  return ordered;
}

/**
 * The stored plan, joined against the tree and the live hierarchy, for the confirm page.
 *
 * Every label the screen shows is resolved here (see `MergeItemView`). An id that no longer
 * resolves — an objective deleted since the merge ran — leaves its label `null` rather than
 * dropping the verdict: the owner should see that the merge wanted to enrich something that
 * is gone, and the apply step drops it for real.
 */
function describeMerge(
  payload: Extract<StoredImportPayload, { readonly kind: "MERGE" }>,
  existing: readonly Objective[],
): ObjectiveMergeView {
  const sourceByRef = new Map(
    flattenForMerge(payload.tree.roots).map((node) => [node.ref, node]),
  );
  const existingById = new Map(
    existing.map((objective) => [objective.id, objective]),
  );
  const addTitleByRef = new Map(
    payload.plan.items.flatMap((item) =>
      item.kind === "ADD" ? [[item.ref, item.title] as const] : [],
    ),
  );
  const items = payload.plan.items.map((item): MergeItemView => {
    const source = sourceByRef.get(item.ref) ?? null;
    const key = mergeItemKey(item);

    if (item.kind === "ADD") {
      const parentExisting =
        item.parentExistingId === null
          ? null
          : (existingById.get(item.parentExistingId) ?? null);

      return {
        item,
        key,
        source,
        parentLabel:
          item.parentExistingId !== null
            ? (parentExisting?.title ?? null)
            : item.parentRef === null
              ? null
              : (addTitleByRef.get(item.parentRef) ?? null),
        parentIsNew: item.parentExistingId === null && item.parentRef !== null,
        existingTitle: null,
        existingDescription: null,
      };
    }

    const referenced =
      item.kind === "ENRICH"
        ? (existingById.get(item.existingId) ?? null)
        : item.matchedExistingId === null
          ? null
          : (existingById.get(item.matchedExistingId) ?? null);

    return {
      item,
      key,
      source,
      parentLabel: null,
      parentIsNew: false,
      existingTitle: referenced?.title ?? null,
      existingDescription: referenced?.description ?? null,
    };
  });

  return {
    summary: payload.plan.summary,
    items,
    counts: countMergeItems(payload.plan.items),
    existingConsidered: payload.existingConsidered,
    existingTruncated: payload.existingTruncated,
    defaultCheckedKeys: defaultCheckedMergeKeys(payload.plan.items),
  };
}

/**
 * Two calls' token counts as one figure.
 *
 * An import into a populated track really is two provider calls, and the run row has one usage
 * column, so the honest number in it is the sum: what this import cost. Reporting only the
 * extraction's would understate a merge that was the more expensive half of the two.
 *
 * `null` plus something is that something, which is what makes the deterministic path work
 * without a branch: its parse reports no usage, so the run's usage is the merge's alone.
 */
function addUsage(
  first: ProviderUsage | null,
  second: ProviderUsage | null,
): ProviderUsage | null {
  if (first === null) {
    return second;
  }

  if (second === null) {
    return first;
  }

  return {
    inputTokens: first.inputTokens + second.inputTokens,
    outputTokens: first.outputTokens + second.outputTokens,
    totalTokens: first.totalTokens + second.totalTokens,
  };
}

/**
 * An existing objective, as the import template sees it.
 *
 * Only the count reaches the prompt (see `renderObjectiveImportPrompt`), so this is
 * shape-satisfaction rather than data transfer: `GENERAL` is stated because the import
 * template renders no drill instructions and the kind is therefore never read.
 */
function toPromptObjective(objective: Objective): PromptObjective {
  return {
    id: objective.id,
    code: objective.code,
    title: objective.title,
    description: objective.description,
    kind: "GENERAL",
  };
}
