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
} from "@/modules/ai-generation/domain/generation-run";
import {
  OBJECTIVE_IMPORT_ITEM_COUNT,
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
import type { EffectivePersona } from "@/modules/ai-generation/domain/personas";
import type { StoredPersona } from "@/modules/ai-generation/domain/stored-persona";
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
import type { PromptObjective } from "@/modules/ai-generation/domain/prompt-templates";
import type {
  DocumentKind,
  DocumentTextExtractor,
} from "@/modules/ai-generation/ports/document-text-extractor";
import { DocumentUnreadableError } from "@/modules/ai-generation/ports/document-text-extractor";
import type { LanguageModelGateway } from "@/modules/ai-generation/ports/language-model-gateway";
import type { GenerationUnitOfWork } from "@/modules/ai-generation/ports/unit-of-work";
import {
  OBJECTIVE_IMPORT_SCHEMA_NAME,
  objectiveImportJsonSchema,
  readProposedTree,
  serializeProposedTree,
  validateProposedObjectives,
} from "./objective-import-schema";
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
}

/** One uploaded document, as the action hands it over. */
export interface UploadedDocument {
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly kind: DocumentKind;
}

/** What the confirm page needs: the proposal, and what has happened to it. */
export interface ObjectiveImportConfirmationView {
  readonly certification: Certification;
  readonly run: GenerationRun;
  /** `null` when the run proposed nothing, or its payload can no longer be read. */
  readonly tree: ProposedObjectiveTree | null;
  readonly nodeCount: number;
  /** Set once the tree has been added, so the page offers no second Apply. */
  readonly applied: boolean;
  readonly modelProvider: string;
}

/** The outcome of one extraction: always a run, sometimes with a proposal on it. */
export interface ObjectiveImportResult {
  readonly run: GenerationRun;
  /** How many objectives were proposed. Zero for a failed extraction. */
  readonly proposedCount: number;
  /** Set when the document was longer than the character cap and was cut. */
  readonly truncated: boolean;
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
    document: UploadedDocument | null,
  ): Promise<ObjectiveImportResult> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      throw new CertificationNotFoundError(slug);
    }

    const source = await this.readSource(input, document);
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
      const completed: GenerationRun = {
        ...pending,
        // How many objectives the document turned out to state. The requested count
        // stays one — one document — so the two numbers say different true things.
        successfulItemCount: nodeCount,
        failedItemCount: 0,
        usageMetadata: produced.usage,
        proposedPayload: serializeProposedTree(produced.value),
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

        return { run: failed, proposedCount: 0, truncated: source.truncated };
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

    const tree = readProposedTree(run.proposedPayload);

    return {
      certification,
      run,
      tree,
      nodeCount: tree === null ? 0 : countProposedObjectives(tree.roots),
      applied: run.appliedAt !== null,
      modelProvider: run.modelProvider,
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
   * never edits, renumbers, or archives an objective the owner already had.
   */
  async applyImport(
    slug: CertificationSlug,
    runId: GenerationRunId,
    sourceType: ImportSourceChoice,
  ): Promise<{
    readonly certification: Certification;
    readonly added: number;
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

      const tree = readProposedTree(run.proposedPayload);

      if (tree === null || tree.roots.length === 0) {
        throw new ObjectiveImportNothingToApplyError(runId);
      }

      const now = this.deps.clock.now();

      if (!(await runs.markApplied(runId, now))) {
        throw new ObjectiveImportAlreadyAppliedError(runId);
      }

      const existing = await objectives.listByCertification(certification.id);
      const firstRootOrder =
        existing
          .filter((objective) => objective.parentObjectiveId === null)
          .reduce(
            (highest, objective) => Math.max(highest, objective.displayOrder),
            0,
          ) + 1;

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

      await insert(tree.roots, null, firstRootOrder);

      return { certification, added };
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
