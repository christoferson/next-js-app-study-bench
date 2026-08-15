import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { Certification } from "@/modules/certifications/domain/certification";
import { CertificationNotFoundError } from "@/modules/certifications/domain/errors";
import { GRAMMAR_ROOT } from "@/modules/certifications/domain/objective-kind";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import {
  FixedClock,
  SequentialIdGenerator,
  certificationFixture,
  createMigratedDatabase,
  objectiveFixture,
} from "@/modules/certifications/infrastructure/test-support";
import { SqliteQuestionRepository } from "@/modules/question-bank/infrastructure/sqlite-question-repository";
import type { Flashcard } from "@/modules/flashcards/domain/flashcard";
import { SqliteFlashcardRepository } from "@/modules/flashcards/infrastructure/sqlite-flashcard-repository";
import { FlashcardQuestionDependencyChecker } from "@/modules/flashcards/infrastructure/flashcard-question-dependency-checker";
import {
  GeneratedDraftNotRejectableError,
  GenerationBatchTooLargeError,
} from "@/modules/ai-generation/domain/errors";
import {
  MAX_BATCH_ITEMS,
  MAX_ENRICHMENT_ITEMS,
} from "@/modules/ai-generation/domain/generation-limits";
import type { GenerationRun } from "@/modules/ai-generation/domain/generation-run";
import type { FakeGatewayResponse } from "@/modules/ai-generation/infrastructure/fake-language-model-gateway";
import { FakeLanguageModelGateway } from "@/modules/ai-generation/infrastructure/fake-language-model-gateway";
import { SqliteGenerationRunRepository } from "@/modules/ai-generation/infrastructure/sqlite-generation-run-repository";
import { SqliteGenerationUnitOfWork } from "@/modules/ai-generation/infrastructure/sqlite-generation-unit-of-work";
import { SqlitePersonaRepository } from "@/modules/ai-generation/infrastructure/sqlite-persona-repository";
import { storedPersonaFixture } from "@/modules/ai-generation/infrastructure/persona-test-support";
import type { StoredPersona } from "@/modules/ai-generation/domain/stored-persona";
import {
  enrichmentPayload,
  enrichmentPayloadItem,
  flashcardPayload,
  flashcardPayloadItem,
  malformedPayload,
  questionPayload,
  questionPayloadItem,
} from "@/modules/ai-generation/infrastructure/test-support";
import {
  GenerationFacade,
  isDuplicateBatchNotice,
  isEnrichmentDuplicateNotice,
  isNothingToEnrichNotice,
} from "./generation-facade";
import type {
  EnrichmentOutcome,
  EnrichmentResult,
  GenerationOutcome,
  GenerationResult,
} from "./generation-facade";
import type { EnrichmentRequestInput, GenerationRequestInput } from "./schemas";

/**
 * The generation workflow end to end, over the real SQLite adapters and the fake
 * gateway.
 *
 * No test here touches a network or an AWS credential: the gateway is the only thing
 * substituted, and it is substituted for a deterministic one
 * (`spec/TESTING.md` section 5). Everything else — the run repository, the question
 * and flashcard banks, the objective links, the transaction runner — is the code that
 * runs in production.
 */

const AWS_TRACK = certificationFixture();
const HSK_TRACK = certificationFixture({
  id: "certification-2",
  slug: "demo-hsk-2",
  name: "Demo HSK 2",
  provider: "Demo Institute",
  examCode: null,
  studyType: "LANGUAGE_PROFICIENCY",
});

const START = "2026-04-01T09:00:00.000Z";

function request(
  overrides: Partial<GenerationRequestInput> = {},
): GenerationRequestInput {
  return {
    itemKind: "QUESTION",
    itemCount: 2,
    difficulty: null,
    objectiveIds: [],
    additionalInstructions: null,
    questionTypes: [],
    cardTypes: [],
    personaId: null,
    generateAnyway: false,
    ...overrides,
  };
}

/**
 * Words for the seeded vocabulary cards.
 *
 * Distinct single characters, so a test can tell which card an answer landed on and
 * an example sentence can embed its own word without accidentally containing another.
 */
const TERMS = ["学习", "工作", "生活"] as const;

function enrich(
  overrides: Partial<EnrichmentRequestInput> = {},
): EnrichmentRequestInput {
  return {
    count: 2,
    additionalInstructions: null,
    generateAnyway: false,
    ...overrides,
  };
}

/** Narrows a result that a test expects to be a completed run, not a duplicate. */
function outcome(result: GenerationResult): GenerationOutcome {
  if (isDuplicateBatchNotice(result)) {
    throw new Error("Expected a generated batch, not a duplicate notice.");
  }

  return result;
}

describe("GenerationFacade", () => {
  let database: SqliteDatabase;
  let clock: FixedClock;
  let questions: SqliteQuestionRepository;
  let flashcards: SqliteFlashcardRepository;
  let runs: SqliteGenerationRunRepository;
  let ids: SequentialIdGenerator;

  /**
   * A facade wired to a gateway with the given scripted turns.
   *
   * Rebuilding the facade per test rather than swapping a mutable gateway keeps the
   * scripted turns readable at the point of use: each test states exactly what the
   * provider will say. The identifier generator is shared across facades within one
   * test so that two batches in the same test cannot mint the same run identifier.
   */
  function facadeWith(
    responses?: readonly FakeGatewayResponse[],
    options: { readonly usage?: null } = {},
  ): GenerationFacade {
    return facadeForGateway(
      new FakeLanguageModelGateway({
        ...(responses === undefined ? {} : { responses }),
        ...(options.usage === null ? { usage: null } : {}),
      }),
    );
  }

  /** The same facade, for a test that holds its own gateway to inspect afterwards. */
  function facadeForGateway(
    gateway: FakeLanguageModelGateway,
  ): GenerationFacade {
    return new GenerationFacade({
      runs,
      questions,
      flashcards,
      certifications: new SqliteCertificationRepository(database),
      objectives: new SqliteObjectiveRepository(database),
      personas: new SqlitePersonaRepository(database),
      unitOfWork: new SqliteGenerationUnitOfWork(database),
      gateway,
      clock,
      ids,
    });
  }

  beforeEach(async () => {
    database = createMigratedDatabase();
    clock = new FixedClock(START);
    ids = new SequentialIdGenerator("gen");
    questions = new SqliteQuestionRepository(database);
    flashcards = new SqliteFlashcardRepository(database);
    runs = new SqliteGenerationRunRepository(database);

    const certifications = new SqliteCertificationRepository(database);
    const objectives = new SqliteObjectiveRepository(database);

    await certifications.save(AWS_TRACK);
    await certifications.save(HSK_TRACK);
    await objectives.save(objectiveFixture());
    await objectives.save(
      objectiveFixture({
        id: "objective-2",
        code: "Demo domain 2",
        title: "Demo second objective",
        displayOrder: 2,
      }),
    );
    await objectives.save(
      objectiveFixture({
        id: "objective-archived",
        title: "Retired demo objective",
        displayOrder: 3,
        status: "ARCHIVED",
      }),
    );
    await objectives.save(
      objectiveFixture({
        id: "objective-hsk",
        certificationId: HSK_TRACK.id,
        code: "HSK 1",
        title: "Demo HSK vocabulary",
      }),
    );
  });

  afterEach(() => {
    database.close();
  });

  describe("the generate form", () => {
    it("offers the persona, the limit, and the model the owner will pay for", async () => {
      const view = await facadeWith().findGenerationForm(AWS_TRACK.slug);

      expect(view?.persona.id).toBe("technical-certification");
      expect(view?.maxItemCount).toBe(MAX_BATCH_ITEMS);
      expect(view?.modelProvider).toBe("fake");
      expect(view?.modelId).toBe("fake-deterministic");
    });

    it("selects the persona from the study type, not the provider name", async () => {
      const view = await facadeWith().findGenerationForm(HSK_TRACK.slug);

      expect(view?.persona.id).toBe("hsk");
    });

    it("offers active objectives only", async () => {
      const view = await facadeWith().findGenerationForm(AWS_TRACK.slug);

      expect(view?.objectives.map((objective) => objective.id)).toEqual([
        "objective-1",
        "objective-2",
      ]);
    });

    it("is absent for an unknown track", async () => {
      expect(await facadeWith().findGenerationForm("no-such-track")).toBeNull();
    });
  });

  describe("generating questions", () => {
    it("records the run, its provenance, and its fingerprint", async () => {
      const facade = facadeWith();
      const { run } = outcome(
        await facade.requestQuestionGeneration(AWS_TRACK.slug, request()),
      );

      expect(run.status).toBe("COMPLETED");
      expect(run.certificationId).toBe(AWS_TRACK.id);
      expect(run.itemKind).toBe("QUESTION");
      expect(run.generationMode).toBe("MODEL_KNOWLEDGE");
      expect(run.modelProvider).toBe("fake");
      expect(run.modelId).toBe("fake-deterministic");
      expect(run.personaId).toBe("technical-certification");
      expect(run.personaVersion).toBe(1);
      expect(run.promptTemplateId).toBe("question-model-knowledge");
      // v2 since the question template learned to write drill instructions for a
      // language objective. The technical persona's own text did not change, but the
      // version records which template rendered the run, not whether the text moved.
      expect(run.promptTemplateVersion).toBe(2);
      // D6 consults no sources, so the snapshot list is empty rather than absent.
      expect(run.selectedSourceSnapshotIds).toEqual([]);
      expect(run.inputHash).toMatch(/^[0-9a-f]{64}$/);
      expect(run.requestedItemCount).toBe(2);
      expect(run.successfulItemCount).toBe(2);
      expect(run.failedItemCount).toBe(0);
      expect(run.failureReason).toBeNull();
      expect(run.completedAt).toBe(START);
    });

    it("records the token counts the provider reported", async () => {
      const { run } = outcome(
        await facadeWith().requestQuestionGeneration(AWS_TRACK.slug, request()),
      );

      expect(run.usageMetadata).toEqual({
        inputTokens: 420,
        outputTokens: 260,
        totalTokens: 680,
      });
    });

    it("records no usage when the provider reported none", async () => {
      const { run } = outcome(
        await facadeWith(undefined, { usage: null }).requestQuestionGeneration(
          AWS_TRACK.slug,
          request(),
        ),
      );

      expect(run.usageMetadata).toBeNull();
    });

    it("writes each question as an unreviewed draft attributed to the run", async () => {
      const facade = facadeWith();
      const { run } = outcome(
        await facade.requestQuestionGeneration(AWS_TRACK.slug, request()),
      );
      const view = await facade.findRunDetail(AWS_TRACK.slug, run.id);

      expect(view?.items).toHaveLength(2);

      for (const item of view?.items ?? []) {
        expect(item.kind).toBe("QUESTION");

        if (item.kind !== "QUESTION") {
          continue;
        }

        expect(item.item.question.lifecycleStatus).toBe("DRAFT");
        expect(item.item.question.qualityStatus).toBe("UNREVIEWED");
        expect(item.item.question.generationMode).toBe("MODEL_KNOWLEDGE");
        expect(item.item.question.generationRunId).toBe(run.id);
        expect(item.item.revision.revisionNumber).toBe(1);
        expect(item.rejectable).toBe(true);
        expect(item.changedSinceGeneration).toBe(false);
      }
    });

    it("links a generated question to the objective the model named", async () => {
      const facade = facadeWith([
        questionPayload([
          questionPayloadItem({ objectiveIds: ["objective-2"] }),
        ]),
      ]);
      const { run } = outcome(
        await facade.requestQuestionGeneration(
          AWS_TRACK.slug,
          request({ itemCount: 1 }),
        ),
      );
      const view = await facade.findRunDetail(AWS_TRACK.slug, run.id);
      const item = view?.items[0];
      const questionId = item?.kind === "QUESTION" ? item.item.question.id : "";

      expect(await questions.listObjectiveLinks(questionId)).toEqual([
        "objective-2",
      ]);
    });

    it("writes nothing that is not asked for: no card is created by a question run", async () => {
      const facade = facadeWith();

      await facade.requestQuestionGeneration(AWS_TRACK.slug, request());

      const counts = await flashcards.countsByCertification(AWS_TRACK.id);

      expect(counts.total).toBe(0);
    });

    it("refuses a batch larger than the limit even though the schema also refuses it", async () => {
      // Two enforcement points on purpose: cost control must not depend on the
      // schema being reached (`SPEC.md` section 11.6).
      await expect(
        facadeWith().requestQuestionGeneration(
          AWS_TRACK.slug,
          request({ itemCount: MAX_BATCH_ITEMS + 1 }),
        ),
      ).rejects.toBeInstanceOf(GenerationBatchTooLargeError);

      const history = await runs.list({
        certificationId: AWS_TRACK.id,
        limit: 10,
        offset: 0,
      });

      // Refused before anything was recorded: an oversized request is a form error,
      // not a run.
      expect(history.totalCount).toBe(0);
    });

    it("refuses a request for a track that does not exist", async () => {
      await expect(
        facadeWith().requestQuestionGeneration("no-such-track", request()),
      ).rejects.toBeInstanceOf(CertificationNotFoundError);
    });

    it("narrows the request to objectives that belong to this track", async () => {
      // A hand-edited form naming another track's objective and an archived one:
      // neither reaches the prompt, and the batch still runs.
      const facade = facadeWith();
      const { run } = outcome(
        await facade.requestQuestionGeneration(
          AWS_TRACK.slug,
          request({
            itemCount: 1,
            objectiveIds: [
              "objective-hsk",
              "objective-archived",
              "objective-1",
            ],
          }),
        ),
      );
      const view = await facade.findRunDetail(AWS_TRACK.slug, run.id);
      const item = view?.items[0];
      const questionId = item?.kind === "QUESTION" ? item.item.question.id : "";

      expect(run.status).toBe("COMPLETED");
      expect(await questions.listObjectiveLinks(questionId)).toEqual([
        "objective-1",
      ]);
    });
  });

  /**
   * What the facade tells the model about the objective the owner chose.
   *
   * The wording of each drill instruction is the template's business and is tested
   * there. What only this level can show is that the facade *classified* the chosen
   * objective from the stored tree and passed its syllabus text through — a grammar
   * point read out of the database, not a hand-built context object.
   */
  describe("drilling a language objective", () => {
    const GRAMMAR_PATTERN = "与其……不如……";
    const GRAMMAR_DESCRIPTION =
      "Compares two options and prefers the second: 与其 marks the rejected one.";

    /** A grammar root and one point beneath it, shaped as the syllabus import writes them. */
    async function seedGrammarPoint(): Promise<void> {
      const objectives = new SqliteObjectiveRepository(database);

      await objectives.save(
        objectiveFixture({
          id: "objective-grammar-root",
          certificationId: HSK_TRACK.id,
          parentObjectiveId: null,
          code: GRAMMAR_ROOT.code,
          title: GRAMMAR_ROOT.title,
          displayOrder: 2,
        }),
      );
      await objectives.save(
        objectiveFixture({
          id: "objective-grammar-point",
          certificationId: HSK_TRACK.id,
          parentObjectiveId: "objective-grammar-root",
          code: "复句",
          title: GRAMMAR_PATTERN,
          description: GRAMMAR_DESCRIPTION,
          displayOrder: 3,
        }),
      );
    }

    /** The single prompt one batch sent, or a failure that says none was sent. */
    function onlyPrompt(gateway: FakeLanguageModelGateway): string {
      const sent = gateway.promptsSent;

      if (sent.length !== 1) {
        throw new Error(`Expected one prompt, got ${sent.length}.`);
      }

      return sent[0]?.user ?? "";
    }

    it("asks for practice of the pattern and passes the syllabus text as owner data", async () => {
      await seedGrammarPoint();

      const gateway = new FakeLanguageModelGateway();
      const { run } = outcome(
        await facadeForGateway(gateway).requestQuestionGeneration(
          HSK_TRACK.slug,
          request({ itemCount: 1, objectiveIds: ["objective-grammar-point"] }),
        ),
      );
      const user = onlyPrompt(gateway);

      expect(run.status).toBe("COMPLETED");
      expect(user).toContain(GRAMMAR_PATTERN);
      expect(user).toMatch(/exercise the pattern, not describe it/);
      expect(user).toMatch(/gap-fill/);
      // The description reached the model, and it reached it inside the owner-data
      // delimiters rather than as part of the request.
      expect(user).toContain(
        `objective-grammar-point | ${GRAMMAR_DESCRIPTION}`,
      );
      expect(user.indexOf(GRAMMAR_DESCRIPTION)).toBeGreaterThan(
        user.indexOf("<owner_syllabus>"),
      );
    });

    it("keeps the syllabus text out of the system instructions", async () => {
      await seedGrammarPoint();

      const gateway = new FakeLanguageModelGateway();

      await facadeForGateway(gateway).requestQuestionGeneration(
        HSK_TRACK.slug,
        request({ itemCount: 1, objectiveIds: ["objective-grammar-point"] }),
      );

      expect(gateway.promptsSent[0]?.system).not.toContain(GRAMMAR_DESCRIPTION);
    });

    it("asks a flashcard batch for a cloze that blanks the pattern", async () => {
      await seedGrammarPoint();

      const gateway = new FakeLanguageModelGateway();

      await facadeForGateway(gateway).requestFlashcardGeneration(
        HSK_TRACK.slug,
        request({
          itemKind: "FLASHCARD",
          itemCount: 1,
          objectiveIds: ["objective-grammar-point"],
        }),
      );

      expect(onlyPrompt(gateway)).toMatch(/cloze card whose blank/i);
    });

    it("adds nothing to a technical certification's prompt", async () => {
      const gateway = new FakeLanguageModelGateway();

      await facadeForGateway(gateway).requestQuestionGeneration(
        AWS_TRACK.slug,
        request({ itemCount: 1, objectiveIds: ["objective-1"] }),
      );

      const user = onlyPrompt(gateway);

      // An ordinary exam domain is `GENERAL`: no drill block, no syllabus block, so
      // the AWS persona's prompt is the one it always was.
      expect(user).not.toMatch(/grammar patterns/);
      expect(user).not.toContain("<owner_syllabus>");
      expect(user).toContain("- id: objective-1");
    });

    it("classifies the objective from the tree even when the parent is archived", async () => {
      await seedGrammarPoint();

      const objectives = new SqliteObjectiveRepository(database);
      const root = await objectives.findById("objective-grammar-root");

      if (root === null) {
        throw new Error("Expected the seeded grammar root.");
      }

      await objectives.save({ ...root, status: "ARCHIVED" });

      const gateway = new FakeLanguageModelGateway();

      await facadeForGateway(gateway).requestQuestionGeneration(
        HSK_TRACK.slug,
        request({ itemCount: 1, objectiveIds: ["objective-grammar-point"] }),
      );

      const user = onlyPrompt(gateway);

      // The archived root is not offered as a target, but it still says which root
      // its child descends from.
      expect(user).not.toContain("objective-grammar-root");
      expect(user).toMatch(/exercise the pattern, not describe it/);
    });
  });

  /**
   * Personas the owner stored, rather than the two built into the code.
   *
   * The persona is what the prompt mostly *is*, so "did the stored one take effect" is
   * asserted on the rendered prompt: a role sentence that exists nowhere in the built-in
   * registry either reached the model or it did not. Provenance is asserted separately,
   * because the run records the persona's stable key and version — never its identifier,
   * which is a row id and would stop resolving the moment the persona was deleted.
   */
  describe("a stored persona", () => {
    const STORED_ROLE =
      "You are the owner's own AWS instructor, writing in their house style.";

    let personas: SqlitePersonaRepository;

    beforeEach(() => {
      personas = new SqlitePersonaRepository(database);
    });

    /** A stored persona, saved and assigned to nothing until a test asks. */
    async function storePersona(
      overrides: Partial<StoredPersona> = {},
    ): Promise<StoredPersona> {
      const persona = storedPersonaFixture({
        role: STORED_ROLE,
        version: 3,
        ...overrides,
      });

      await personas.insert(persona);

      return persona;
    }

    /** Assigns a stored persona to a seeded track. */
    async function assignTo(
      track: Certification,
      persona: StoredPersona,
    ): Promise<void> {
      await new SqliteCertificationRepository(database).save({
        ...track,
        personaId: persona.id,
      });
    }

    it("offers the assignable personas and the track's own assignment on the form", async () => {
      const technical = await storePersona();
      const language = await storePersona({
        id: "persona-2",
        personaKey: "my-hsk",
        archetype: "LANGUAGE",
        label: "My HSK",
      });

      await assignTo(AWS_TRACK, technical);

      const view = await facadeWith().findGenerationForm(AWS_TRACK.slug);

      // Only the technical one: a language persona on an AWS track is not a choice the
      // form should offer, because the assignment would be refused.
      expect(view?.personaChoices.map((choice) => choice.id)).toEqual([
        technical.id,
      ]);
      expect(view?.assignedPersonaId).toBe(technical.id);
      // The default shown is the track's own, not the built-in.
      expect(view?.persona.id).toBe(technical.personaKey);
      expect(language.archetype).toBe("LANGUAGE");
    });

    it("uses the track's assigned persona for the prompt and the provenance", async () => {
      const persona = await storePersona();

      await assignTo(AWS_TRACK, persona);

      const gateway = new FakeLanguageModelGateway();
      const { run } = outcome(
        await facadeForGateway(gateway).requestQuestionGeneration(
          AWS_TRACK.slug,
          request({ itemCount: 1 }),
        ),
      );

      expect(gateway.promptsSent[0]?.system).toContain(STORED_ROLE);
      // The stable key and the stored version, not the row identifier.
      expect(run.personaId).toBe(persona.personaKey);
      expect(run.personaVersion).toBe(3);
    });

    it("lets a choice on the form override the track's assignment", async () => {
      const assigned = await storePersona();
      const chosen = await storePersona({
        id: "persona-2",
        personaKey: "my-other-aws",
        label: "My other AWS persona",
        role: "You are a second instructor entirely.",
      });

      await assignTo(AWS_TRACK, assigned);

      const gateway = new FakeLanguageModelGateway();
      const { run } = outcome(
        await facadeForGateway(gateway).requestQuestionGeneration(
          AWS_TRACK.slug,
          request({ itemCount: 1, personaId: chosen.id }),
        ),
      );

      expect(gateway.promptsSent[0]?.system).toContain(
        "You are a second instructor entirely.",
      );
      expect(run.personaId).toBe(chosen.personaKey);
    });

    it("names the stored persona on the run review", async () => {
      const persona = await storePersona();

      await assignTo(AWS_TRACK, persona);

      const facade = facadeWith();
      const { run } = outcome(
        await facade.requestQuestionGeneration(
          AWS_TRACK.slug,
          request({ itemCount: 1 }),
        ),
      );
      const view = await facade.findRunDetail(AWS_TRACK.slug, run.id);

      expect(view?.persona?.label).toBe(persona.label);
      expect(view?.persona?.version).toBe(3);
    });

    it("reports no persona for a key nothing answers to any more", async () => {
      // A deleted persona's runs stay readable; the review page then shows the raw key
      // rather than inventing a label.
      const facade = facadeWith();
      const { run } = outcome(
        await facade.requestQuestionGeneration(
          AWS_TRACK.slug,
          request({ itemCount: 1 }),
        ),
      );

      database
        .prepare(`UPDATE generation_runs SET persona_id = ? WHERE id = ?`)
        .run("a-persona-nobody-has", run.id);

      const view = await facade.findRunDetail(AWS_TRACK.slug, run.id);

      expect(view?.persona).toBeNull();
      expect(view?.run.personaId).toBe("a-persona-nobody-has");
    });

    it("falls back to the built-in persona when the assignment no longer suits the track", async () => {
      // A stale assignment — the study type was changed after the persona was chosen —
      // must not fail a request the owner is paying for. The form is where a mismatch is
      // refused; here it degrades to the automatic choice.
      const persona = await storePersona({
        archetype: "LANGUAGE",
        personaKey: "my-hsk",
      });

      await assignTo(AWS_TRACK, persona);

      const gateway = new FakeLanguageModelGateway();
      const { run } = outcome(
        await facadeForGateway(gateway).requestQuestionGeneration(
          AWS_TRACK.slug,
          request({ itemCount: 1 }),
        ),
      );

      expect(run.personaId).toBe("technical-certification");
      expect(gateway.promptsSent[0]?.system).not.toContain(STORED_ROLE);
    });

    it("leaves the automatic choice exactly as it was", async () => {
      // The regression this whole slice risks: a track with no assignment, and an owner
      // with personas stored, still generates with the built-in persona.
      await storePersona();

      const { run } = outcome(
        await facadeWith().requestQuestionGeneration(
          AWS_TRACK.slug,
          request({ itemCount: 1 }),
        ),
      );

      expect(run.personaId).toBe("technical-certification");
      expect(run.personaVersion).toBe(1);
    });
  });

  describe("generating flashcards", () => {
    it("writes each card as a draft attributed to the run", async () => {
      const facade = facadeWith();
      const { run } = outcome(
        await facade.requestFlashcardGeneration(
          HSK_TRACK.slug,
          request({ itemKind: "FLASHCARD", itemCount: 2 }),
        ),
      );
      const view = await facade.findRunDetail(HSK_TRACK.slug, run.id);

      expect(run.itemKind).toBe("FLASHCARD");
      expect(run.personaId).toBe("hsk");
      expect(run.promptTemplateId).toBe("flashcard-model-knowledge");
      expect(view?.items).toHaveLength(2);

      for (const item of view?.items ?? []) {
        if (item.kind !== "FLASHCARD") {
          throw new Error("Expected a flashcard review row.");
        }

        expect(item.item.flashcard.lifecycleStatus).toBe("DRAFT");
        expect(item.item.flashcard.generationMode).toBe("MODEL_KNOWLEDGE");
        expect(item.item.flashcard.generationRunId).toBe(run.id);
        // Generated, not converted: a card the model wrote has no source question.
        expect(item.item.flashcard.sourceQuestionId).toBeNull();
        expect(item.item.revision.revisionNumber).toBe(1);
      }
    });

    it("writes the card in the persona's content language", async () => {
      const facade = facadeWith([flashcardPayload([flashcardPayloadItem()])]);
      const { run } = outcome(
        await facade.requestFlashcardGeneration(
          HSK_TRACK.slug,
          request({ itemKind: "FLASHCARD", itemCount: 1 }),
        ),
      );
      const view = await facade.findRunDetail(HSK_TRACK.slug, run.id);
      const item = view?.items[0];

      if (item?.kind !== "FLASHCARD") {
        throw new Error("Expected a flashcard review row.");
      }

      expect(item.item.revision.language).toBe("zh");
      expect(item.item.revision.content).toEqual({
        type: "VOCABULARY",
        term: "学习",
        reading: "xuéxí",
        meaning: "to study; to learn",
        exampleSentence: "我每天学习汉语。",
      });
    });

    it("links a generated card to the objective the model named", async () => {
      const facade = facadeWith([
        flashcardPayload([
          flashcardPayloadItem({ objectiveIds: ["objective-hsk"] }),
        ]),
      ]);
      const { run } = outcome(
        await facade.requestFlashcardGeneration(
          HSK_TRACK.slug,
          request({ itemKind: "FLASHCARD", itemCount: 1 }),
        ),
      );
      const view = await facade.findRunDetail(HSK_TRACK.slug, run.id);
      const item = view?.items[0];
      const cardId = item?.kind === "FLASHCARD" ? item.item.flashcard.id : "";

      expect(await flashcards.listObjectiveLinks(cardId)).toEqual([
        "objective-hsk",
      ]);
    });
  });

  describe("output that does not survive validation", () => {
    it("repairs a malformed first answer and keeps the second", async () => {
      const gateway = new FakeLanguageModelGateway({
        responses: [
          malformedPayload(),
          questionPayload([questionPayloadItem()]),
        ],
      });
      const facade = facadeForGateway(gateway);

      const { run } = outcome(
        await facade.requestQuestionGeneration(
          AWS_TRACK.slug,
          request({ itemCount: 1 }),
        ),
      );

      // Exactly two turns: the bad answer and the one repair attempt.
      expect(gateway.turnsTaken).toBe(2);
      expect(run.status).toBe("COMPLETED");
      expect(run.successfulItemCount).toBe(1);
    });

    it("fails the run when the repair attempt is also malformed", async () => {
      const facade = facadeWith([malformedPayload(), malformedPayload()]);
      const { run, rejected } = outcome(
        await facade.requestQuestionGeneration(
          AWS_TRACK.slug,
          request({ itemCount: 3 }),
        ),
      );

      expect(run.status).toBe("FAILED");
      expect(run.failureReason).toBe("MALFORMED_OUTPUT");
      expect(run.successfulItemCount).toBe(0);
      // Everything asked for failed to arrive.
      expect(run.failedItemCount).toBe(3);
      expect(run.usageMetadata).toBeNull();
      expect(rejected).toEqual([]);
    });

    it("stores nothing when the provider call fails", async () => {
      const facade = facadeWith([{ failure: "PROVIDER_THROTTLED" }]);
      const { run } = outcome(
        await facade.requestQuestionGeneration(AWS_TRACK.slug, request()),
      );

      expect(run.status).toBe("FAILED");
      expect(run.failureReason).toBe("PROVIDER_THROTTLED");
      expect(await runs.listItemIds(run.id)).toEqual([]);
      expect((await questions.countsByCertification(AWS_TRACK.id)).total).toBe(
        0,
      );
    });

    it("is a recorded run rather than a thrown error, so the owner can read it", async () => {
      const facade = facadeWith([{ failure: "MODEL_ACCESS_DENIED" }]);
      const { run } = outcome(
        await facade.requestQuestionGeneration(AWS_TRACK.slug, request()),
      );
      const reread = await facade.findRunDetail(AWS_TRACK.slug, run.id);

      expect(reread?.run.status).toBe("FAILED");
      expect(reread?.run.failureReason).toBe("MODEL_ACCESS_DENIED");
      expect(reread?.items).toEqual([]);
    });
  });

  describe("items the deterministic checks refuse", () => {
    it("keeps the usable items and counts the rest as partial", async () => {
      const facade = facadeWith([
        questionPayload([
          questionPayloadItem(),
          // Names an objective this track does not have.
          questionPayloadItem({ objectiveIds: ["objective-hsk"] }),
          questionPayloadItem(),
        ]),
      ]);
      const { run, rejected } = outcome(
        await facade.requestQuestionGeneration(
          AWS_TRACK.slug,
          request({ itemCount: 3 }),
        ),
      );

      expect(run.status).toBe("PARTIAL");
      expect(run.successfulItemCount).toBe(2);
      expect(run.failedItemCount).toBe(1);
      expect(run.failureReason).toBeNull();
      expect(rejected).toEqual([
        { position: 2, reason: expect.stringMatching(/do not exist/i) },
      ]);
      expect(await runs.listItemIds(run.id)).toHaveLength(2);
    });

    it("fails the run with a reason when nothing survives", async () => {
      const facade = facadeWith([
        questionPayload([questionPayloadItem({ stem: "Why?" })]),
      ]);
      const { run, rejected } = outcome(
        await facade.requestQuestionGeneration(
          AWS_TRACK.slug,
          request({ itemCount: 1 }),
        ),
      );

      expect(run.status).toBe("FAILED");
      expect(run.failureReason).toBe("NO_USABLE_ITEMS");
      expect(rejected).toHaveLength(1);
      expect((await questions.countsByCertification(AWS_TRACK.id)).total).toBe(
        0,
      );
    });

    it("refuses an item claiming to be a real exam question", async () => {
      const facade = facadeWith([
        questionPayload([
          questionPayloadItem({
            stem: "This is an actual exam question from the real certification exam.",
          }),
        ]),
      ]);
      const { rejected } = outcome(
        await facade.requestQuestionGeneration(
          AWS_TRACK.slug,
          request({ itemCount: 1 }),
        ),
      );

      expect(rejected[0]?.reason).toMatch(/official or real/i);
    });
  });

  describe("the duplicate-batch guard", () => {
    it("reports an equivalent earlier batch instead of generating again", async () => {
      const facade = facadeWith();
      const first = outcome(
        await facade.requestQuestionGeneration(AWS_TRACK.slug, request()),
      );
      const second = await facadeWith().requestQuestionGeneration(
        AWS_TRACK.slug,
        request(),
      );

      expect(isDuplicateBatchNotice(second)).toBe(true);

      if (!isDuplicateBatchNotice(second)) {
        return;
      }

      expect(second.duplicateOf.id).toBe(first.run.id);

      const history = await runs.list({
        certificationId: AWS_TRACK.id,
        limit: 10,
        offset: 0,
      });

      // No second run was recorded, so no model call was paid for.
      expect(history.totalCount).toBe(1);
    });

    it("generates anyway when the owner has seen the notice and asked for it", async () => {
      await facadeWith().requestQuestionGeneration(AWS_TRACK.slug, request());

      const second = outcome(
        await facadeWith().requestQuestionGeneration(
          AWS_TRACK.slug,
          request({ generateAnyway: true }),
        ),
      );

      expect(second.run.status).toBe("COMPLETED");

      const history = await runs.list({
        certificationId: AWS_TRACK.id,
        limit: 10,
        offset: 0,
      });

      expect(history.totalCount).toBe(2);
      expect(history.items[0]?.inputHash).toBe(history.items[1]?.inputHash);
    });

    it("does not treat a different request as a duplicate", async () => {
      await facadeWith().requestQuestionGeneration(AWS_TRACK.slug, request());

      const different = await facadeWith().requestQuestionGeneration(
        AWS_TRACK.slug,
        request({ itemCount: 3 }),
      );

      expect(isDuplicateBatchNotice(different)).toBe(false);
    });

    it("does not treat the other item kind as a duplicate of the same request", async () => {
      await facadeWith().requestQuestionGeneration(AWS_TRACK.slug, request());

      const cards = await facadeWith().requestFlashcardGeneration(
        AWS_TRACK.slug,
        request({ itemKind: "FLASHCARD" }),
      );

      expect(isDuplicateBatchNotice(cards)).toBe(false);
    });

    it("does not treat another track's identical request as a duplicate", async () => {
      await facadeWith().requestQuestionGeneration(AWS_TRACK.slug, request());

      const other = await facadeWith().requestQuestionGeneration(
        HSK_TRACK.slug,
        request(),
      );

      expect(isDuplicateBatchNotice(other)).toBe(false);
    });

    it("does not block a repeat of a batch that produced nothing", async () => {
      // A failed run left no content behind, so asking again is a first attempt
      // rather than a repeat.
      await facadeWith([{ failure: "TIMED_OUT" }]).requestQuestionGeneration(
        AWS_TRACK.slug,
        request(),
      );

      const retry = await facadeWith().requestQuestionGeneration(
        AWS_TRACK.slug,
        request(),
      );

      expect(isDuplicateBatchNotice(retry)).toBe(false);
    });
  });

  describe("run history", () => {
    it("lists a track's runs newest first with their surviving item counts", async () => {
      const facade = facadeWith();

      await facade.requestQuestionGeneration(
        AWS_TRACK.slug,
        request({ itemCount: 1 }),
      );
      clock.set("2026-04-02T09:00:00.000Z");
      await facadeWith().requestQuestionGeneration(
        AWS_TRACK.slug,
        request({ itemCount: 2 }),
      );

      const view = await facadeWith().findRuns(AWS_TRACK.slug, { page: 1 });

      expect(view?.totalCount).toBe(2);
      expect(view?.pageCount).toBe(1);
      expect(
        view?.runs.map((summary) => summary.run.requestedItemCount),
      ).toEqual([2, 1]);
      expect(view?.runs[0]?.counts).toEqual({ total: 2, draft: 2, active: 0 });
    });

    it("shows only the asking track's runs", async () => {
      await facadeWith().requestQuestionGeneration(HSK_TRACK.slug, request());

      const view = await facadeWith().findRuns(AWS_TRACK.slug, { page: 1 });

      expect(view?.runs).toEqual([]);
    });

    it("is absent for an unknown track", async () => {
      expect(
        await facadeWith().findRuns("no-such-track", { page: 1 }),
      ).toBeNull();
    });

    it("hides a run belonging to another track behind a 404", async () => {
      const { run } = outcome(
        await facadeWith().requestQuestionGeneration(HSK_TRACK.slug, request()),
      );

      expect(
        await facadeWith().findRunDetail(AWS_TRACK.slug, run.id),
      ).toBeNull();
    });

    it("has no detail for an unknown run", async () => {
      expect(
        await facadeWith().findRunDetail(AWS_TRACK.slug, "run-that-never-was"),
      ).toBeNull();
    });

    it("expands the recorded persona for the review screen", async () => {
      const { run } = outcome(
        await facadeWith().requestFlashcardGeneration(
          HSK_TRACK.slug,
          request({ itemKind: "FLASHCARD", itemCount: 1 }),
        ),
      );
      const view = await facadeWith().findRunDetail(HSK_TRACK.slug, run.id);

      expect(view?.persona?.label).toBe("HSK Chinese proficiency");
    });
  });

  describe("rejecting a draft", () => {
    /** Generates one question and returns the run and the question identifier. */
    async function oneDraft(): Promise<{
      readonly runId: string;
      readonly questionId: string;
    }> {
      const facade = facadeWith();
      const { run } = outcome(
        await facade.requestQuestionGeneration(
          AWS_TRACK.slug,
          request({ itemCount: 1 }),
        ),
      );
      const itemIds = await runs.listItemIds(run.id);
      const questionId = itemIds[0];

      if (questionId === undefined) {
        throw new Error("Expected the run to have produced a question.");
      }

      return { runId: run.id, questionId };
    }

    it("deletes the draft and returns the track it belonged to", async () => {
      const { runId, questionId } = await oneDraft();

      expect(await facadeWith().rejectDraft(runId, questionId)).toBe(
        AWS_TRACK.id,
      );
      expect(await questions.findById(questionId)).toBeNull();
    });

    it("leaves the run and its counts as the record of what happened", async () => {
      const { runId, questionId } = await oneDraft();

      await facadeWith().rejectDraft(runId, questionId);

      const view = await facadeWith().findRunDetail(AWS_TRACK.slug, runId);

      // The run still says one item was written; the counts say none survive.
      expect(view?.run.successfulItemCount).toBe(1);
      expect(view?.counts).toEqual({ total: 0, draft: 0, active: 0 });
      expect(view?.items).toEqual([]);
    });

    it("refuses to delete an item the owner has since activated", async () => {
      const { runId, questionId } = await oneDraft();

      await questions.setLifecycleStatus(questionId, "ACTIVE", START);

      await expect(
        facadeWith().rejectDraft(runId, questionId),
      ).rejects.toBeInstanceOf(GeneratedDraftNotRejectableError);
      expect(await questions.findById(questionId)).not.toBeNull();
    });

    it("marks an activated item as changed and no longer rejectable", async () => {
      const { runId, questionId } = await oneDraft();

      await questions.setLifecycleStatus(questionId, "ACTIVE", START);

      const view = await facadeWith().findRunDetail(AWS_TRACK.slug, runId);

      expect(view?.items[0]?.rejectable).toBe(false);
      expect(view?.items[0]?.changedSinceGeneration).toBe(true);
      expect(view?.counts).toEqual({ total: 1, draft: 0, active: 1 });
    });

    it("refuses an item that was produced by a different run", async () => {
      const { questionId } = await oneDraft();
      const other = outcome(
        await facadeWith().requestQuestionGeneration(
          AWS_TRACK.slug,
          request({ itemCount: 1, generateAnyway: true }),
        ),
      );

      await expect(
        facadeWith().rejectDraft(other.run.id, questionId),
      ).rejects.toBeInstanceOf(GeneratedDraftNotRejectableError);
      expect(await questions.findById(questionId)).not.toBeNull();
    });

    it("refuses a second rejection of the same draft", async () => {
      const { runId, questionId } = await oneDraft();

      await facadeWith().rejectDraft(runId, questionId);

      await expect(
        facadeWith().rejectDraft(runId, questionId),
      ).rejects.toBeInstanceOf(GeneratedDraftNotRejectableError);
    });

    it("refuses a rejection against a run that does not exist", async () => {
      const { questionId } = await oneDraft();

      await expect(
        facadeWith().rejectDraft("run-that-never-was", questionId),
      ).rejects.toBeInstanceOf(Error);
    });

    it("rejects a generated flashcard the same way", async () => {
      const facade = facadeWith();
      const { run } = outcome(
        await facade.requestFlashcardGeneration(
          HSK_TRACK.slug,
          request({ itemKind: "FLASHCARD", itemCount: 1 }),
        ),
      );
      const cardId = (await runs.listItemIds(run.id))[0] ?? "";

      expect(await facadeWith().rejectDraft(run.id, cardId)).toBe(HSK_TRACK.id);
      expect(await flashcards.findById(cardId)).toBeNull();
    });
  });

  describe("enriching vocabulary", () => {
    /**
     * Seeds `count` active vocabulary cards with only a gloss.
     *
     * Written through the repository the manual path uses, and one minute apart, so
     * the created-at order the selection relies on is unambiguous rather than a tie
     * broken by identifier.
     */
    async function seedVocabulary(
      count: number,
      overrides: Partial<Flashcard> = {},
    ): Promise<readonly string[]> {
      const created: string[] = [];

      for (let index = 0; index < count; index += 1) {
        const id = `card-${index + 1}`;
        const at = `2026-03-0${index + 1}T09:00:00.000Z`;

        await flashcards.create(
          {
            id,
            certificationId: HSK_TRACK.id,
            currentRevisionId: `${id}-revision-1`,
            lifecycleStatus: "ACTIVE",
            sourceQuestionId: null,
            generationMode: "MANUAL",
            generationRunId: null,
            createdAt: at,
            updatedAt: at,
            ...overrides,
          },
          {
            id: `${id}-revision-1`,
            flashcardId: id,
            revisionNumber: 1,
            cardType: "VOCABULARY",
            content: {
              type: "VOCABULARY",
              term: TERMS[index] ?? `词${index}`,
              reading: null,
              meaning: `demo gloss ${index + 1}`,
              exampleSentence: null,
            },
            notes: null,
            tags: ["imported"],
            language: "zh",
            generationRunId: null,
            createdAt: at,
          },
        );
        created.push(id);
      }

      return created;
    }

    /** A one-turn script returning the given entries. */
    function answering(
      items: readonly Record<string, unknown>[],
    ): readonly FakeGatewayResponse[] {
      return [enrichmentPayload(items)];
    }

    /** A one-turn script whose single answer enriches exactly the given terms. */
    function answerFor(
      terms: readonly string[],
    ): readonly FakeGatewayResponse[] {
      return answering(terms.map((term) => enrichmentPayloadItem({ term })));
    }

    /**
     * A one-turn script that names a word the run did not ask about.
     *
     * The run then enriches nothing, which is what makes it useful twice: as the
     * whole-answer-drifted case, and as a way to leave the same cards unenriched so a
     * second identical request is a genuine duplicate.
     */
    function driftedAnswer(): readonly FakeGatewayResponse[] {
      return answering([enrichmentPayloadItem({ term: "不相关" })]);
    }

    /** Narrows a result a test expects to be a completed enrichment run. */
    function enriched(result: EnrichmentResult): EnrichmentOutcome {
      if (
        isNothingToEnrichNotice(result) ||
        isEnrichmentDuplicateNotice(result)
      ) {
        throw new Error("Expected an enrichment run, not a notice.");
      }

      return result;
    }

    async function currentContent(id: string) {
      const found = await flashcards.findWithCurrentRevision(id);

      if (found === null) {
        throw new Error(`Expected card ${id} to exist.`);
      }

      return found;
    }

    describe("the enrichment form", () => {
      it("counts the cards still waiting and offers the run's own cap", async () => {
        await seedVocabulary(3);

        const view = await facadeWith().findEnrichmentForm(HSK_TRACK.slug);

        expect(view?.persona.id).toBe("hsk");
        expect(view?.unenrichedCount).toBe(3);
        // A separate, smaller cap than generation: an enriched word is a longer
        // answer than a flashcard.
        expect(view?.maxItemCount).toBe(MAX_ENRICHMENT_ITEMS);
        expect(view?.modelProvider).toBe("fake");
      });

      it("is absent for an unknown track", async () => {
        expect(
          await facadeWith().findEnrichmentForm("no-such-track"),
        ).toBeNull();
      });
    });

    it("takes the next unenriched cards in the bank's own order", async () => {
      await seedVocabulary(3);

      const facade = facadeWith(answerFor(TERMS.slice(0, 2)));
      const { run } = enriched(
        await facade.requestVocabularyEnrichment(
          HSK_TRACK.slug,
          enrich({ count: 2 }),
        ),
      );

      expect(run.requestedItemCount).toBe(2);
      expect(run.successfulItemCount).toBe(2);
      // The oldest two, so repeated runs walk the deck front to back.
      expect((await currentContent("card-1")).revision.revisionNumber).toBe(2);
      expect((await currentContent("card-2")).revision.revisionNumber).toBe(2);
      expect((await currentContent("card-3")).revision.revisionNumber).toBe(1);
    });

    it("continues where the previous run stopped", async () => {
      await seedVocabulary(3);

      await facadeWith(
        answerFor(TERMS.slice(0, 2)),
      ).requestVocabularyEnrichment(HSK_TRACK.slug, enrich({ count: 2 }));
      const second = enriched(
        await facadeWith(
          answerFor(TERMS.slice(2, 3)),
        ).requestVocabularyEnrichment(HSK_TRACK.slug, enrich({ count: 2 })),
      );

      // Only one card was left, so the run truthfully records asking for one.
      expect(second.run.requestedItemCount).toBe(1);
      expect(second.run.successfulItemCount).toBe(1);
      expect((await currentContent("card-3")).revision.revisionNumber).toBe(2);
      expect(
        await facadeWith().findEnrichmentForm(HSK_TRACK.slug),
      ).toMatchObject({ unenrichedCount: 0 });
    });

    it("enriches every card with the fake gateway's own fixtures", async () => {
      // No script: the gateway reads the words out of the rendered prompt and echoes
      // each one back. That exercises the term-matching path rather than bypassing
      // it, so the local development flow proves the same code a real provider does.
      await seedVocabulary(3);

      const { run, unenriched, rejected } = enriched(
        await facadeWith().requestVocabularyEnrichment(
          HSK_TRACK.slug,
          enrich({ count: 3 }),
        ),
      );

      expect(run.status).toBe("COMPLETED");
      expect(run.successfulItemCount).toBe(3);
      expect(unenriched).toBe(0);
      expect(rejected).toEqual([]);

      for (const id of ["card-1", "card-2", "card-3"]) {
        expect((await currentContent(id)).revision.revisionNumber).toBe(2);
      }
    });

    it("records the run with the enrichment template and its own item kind", async () => {
      await seedVocabulary(1);

      const { run } = enriched(
        await facadeWith(
          answerFor(TERMS.slice(0, 1)),
        ).requestVocabularyEnrichment(HSK_TRACK.slug, enrich({ count: 1 })),
      );

      expect(run.itemKind).toBe("ENRICH_VOCABULARY");
      expect(run.status).toBe("COMPLETED");
      expect(run.personaId).toBe("hsk");
      expect(run.promptTemplateId).toBe("vocabulary-enrichment");
      expect(run.promptTemplateVersion).toBe(1);
      expect(run.generationMode).toBe("MODEL_KNOWLEDGE");
      expect(run.failureReason).toBeNull();
      expect(run.usageMetadata).not.toBeNull();
      expect(run.completedAt).toBe(START);
    });

    it("appends a revision that keeps everything the card already said", async () => {
      await seedVocabulary(1);

      await facadeWith(
        answerFor(TERMS.slice(0, 1)),
      ).requestVocabularyEnrichment(HSK_TRACK.slug, enrich({ count: 1 }));

      const { flashcard, revision } = await currentContent("card-1");

      expect(revision.revisionNumber).toBe(2);
      expect(revision.cardType).toBe("VOCABULARY");
      expect(revision.notes).toBeNull();
      expect(revision.tags).toEqual(["imported"]);
      expect(revision.language).toBe("zh");

      if (revision.content.type !== "VOCABULARY") {
        throw new Error("Expected vocabulary content.");
      }

      expect(revision.content.term).toBe(TERMS[0]);
      expect(revision.content.meaning).toBe("demo gloss 1");
      expect(revision.content.meanings).toEqual([
        "to study",
        "to learn as a discipline",
      ]);
      expect(revision.content.examples).toHaveLength(2);
      expect(revision.content.usageNotes).not.toBeUndefined();
      // Additive, so the previous text is still readable as revision 1.
      expect(flashcard.currentRevisionId).not.toBe("card-1-revision-1");
    });

    it("leaves the card's lifecycle and its own provenance alone", async () => {
      await seedVocabulary(1);

      await facadeWith(
        answerFor(TERMS.slice(0, 1)),
      ).requestVocabularyEnrichment(HSK_TRACK.slug, enrich({ count: 1 }));

      const { flashcard } = await currentContent("card-1");

      // An enrichment run must not pull a card the owner studies out of study, and
      // the card was not created by this run, so its creation provenance is untouched.
      expect(flashcard.lifecycleStatus).toBe("ACTIVE");
      expect(flashcard.generationMode).toBe("MANUAL");
      expect(flashcard.generationRunId).toBeNull();
    });

    it("records the run on the revision it wrote, which is the linkage", async () => {
      await seedVocabulary(1);

      const { run } = enriched(
        await facadeWith(
          answerFor(TERMS.slice(0, 1)),
        ).requestVocabularyEnrichment(HSK_TRACK.slug, enrich({ count: 1 })),
      );
      const { revision } = await currentContent("card-1");

      expect(revision.generationRunId).toBe(run.id);
    });

    it("counts a card the model failed to answer for as left unchanged", async () => {
      await seedVocabulary(2);

      const { run, unenriched, rejected } = enriched(
        await facadeWith(
          answerFor(TERMS.slice(0, 1)),
        ).requestVocabularyEnrichment(HSK_TRACK.slug, enrich({ count: 2 })),
      );

      expect(run.status).toBe("PARTIAL");
      expect(run.successfulItemCount).toBe(1);
      expect(run.failedItemCount).toBe(1);
      expect(unenriched).toBe(1);
      expect(rejected).toEqual([]);
      // Untouched, so the next run offers it again.
      expect((await currentContent("card-2")).revision.revisionNumber).toBe(1);
      expect(
        await facadeWith().findEnrichmentForm(HSK_TRACK.slug),
      ).toMatchObject({ unenrichedCount: 1 });
    });

    it("reports a rejected answer and leaves that card alone", async () => {
      await seedVocabulary(2);

      const facade = facadeWith(
        answering([
          enrichmentPayloadItem({ term: TERMS[0] }),
          // Fewer than two examples, so the deterministic checks refuse it.
          enrichmentPayloadItem({
            term: TERMS[1],
            examples: [{ text: `${TERMS[1]}很好。` }],
          }),
        ]),
      );
      const { run, rejected, unenriched } = enriched(
        await facade.requestVocabularyEnrichment(
          HSK_TRACK.slug,
          enrich({ count: 2 }),
        ),
      );

      expect(run.status).toBe("PARTIAL");
      expect(rejected).toEqual([
        { position: 2, reason: expect.stringMatching(/fewer than 2 example/i) },
      ]);
      expect(unenriched).toBe(1);
      expect((await currentContent("card-2")).revision.revisionNumber).toBe(1);
    });

    it("fails the run when no answer was usable", async () => {
      await seedVocabulary(1);

      const { run } = enriched(
        await facadeWith(driftedAnswer()).requestVocabularyEnrichment(
          HSK_TRACK.slug,
          enrich({ count: 1 }),
        ),
      );

      expect(run.status).toBe("FAILED");
      expect(run.failureReason).toBe("NO_USABLE_ITEMS");
      expect(run.successfulItemCount).toBe(0);
      expect((await currentContent("card-1")).revision.revisionNumber).toBe(1);
    });

    it("records a provider failure as a failed run rather than throwing", async () => {
      await seedVocabulary(2);

      const { run, unenriched } = enriched(
        await facadeWith([
          { failure: "PROVIDER_THROTTLED" },
        ]).requestVocabularyEnrichment(HSK_TRACK.slug, enrich({ count: 2 })),
      );

      expect(run.status).toBe("FAILED");
      expect(run.failureReason).toBe("PROVIDER_THROTTLED");
      expect(run.failedItemCount).toBe(2);
      expect(unenriched).toBe(2);
      expect((await currentContent("card-1")).revision.revisionNumber).toBe(1);
    });

    it("says there is nothing to enrich rather than recording an empty run", async () => {
      const result = await facadeWith().requestVocabularyEnrichment(
        HSK_TRACK.slug,
        enrich({ count: 5 }),
      );

      expect(isNothingToEnrichNotice(result)).toBe(true);

      const history = await runs.list({
        certificationId: HSK_TRACK.id,
        limit: 10,
        offset: 0,
      });

      // No run row, because no model was called and nothing was spent.
      expect(history.totalCount).toBe(0);
    });

    it("ignores a card that is not active and one that is already enriched", async () => {
      await seedVocabulary(2);
      await flashcards.setLifecycleStatus("card-1", "RETIRED", START);
      await facadeWith(
        answerFor(TERMS.slice(1, 2)),
      ).requestVocabularyEnrichment(HSK_TRACK.slug, enrich({ count: 5 }));

      const result = await facadeWith().requestVocabularyEnrichment(
        HSK_TRACK.slug,
        enrich({ count: 5 }),
      );

      expect(isNothingToEnrichNotice(result)).toBe(true);
    });

    it("refuses a request past the enrichment cap without recording a run", async () => {
      await seedVocabulary(1);

      await expect(
        facadeWith().requestVocabularyEnrichment(
          HSK_TRACK.slug,
          enrich({ count: MAX_ENRICHMENT_ITEMS + 1 }),
        ),
      ).rejects.toBeInstanceOf(GenerationBatchTooLargeError);

      const history = await runs.list({
        certificationId: HSK_TRACK.id,
        limit: 10,
        offset: 0,
      });

      expect(history.totalCount).toBe(0);
    });

    it("refuses a request for a track that does not exist", async () => {
      await expect(
        facadeWith().requestVocabularyEnrichment("no-such-track", enrich()),
      ).rejects.toBeInstanceOf(CertificationNotFoundError);
    });

    describe("the duplicate guard", () => {
      /**
       * Enriches card 1, then has the owner rewrite it back to a plain gloss.
       *
       * This is what a genuine enrichment repeat looks like. The scope normally moves
       * forward, so the *same* cards can only come up twice if a card that was
       * enriched stopped being enriched — which happens when the owner edits the
       * detail away. Asking again is then a request the owner has already paid for.
       */
      async function enrichedThenReverted(): Promise<GenerationRun> {
        await seedVocabulary(1);

        const { run } = enriched(
          await facadeWith(
            answerFor(TERMS.slice(0, 1)),
          ).requestVocabularyEnrichment(HSK_TRACK.slug, enrich({ count: 1 })),
        );

        await flashcards.appendRevision(
          {
            id: "card-1-revision-3",
            flashcardId: "card-1",
            revisionNumber: 3,
            cardType: "VOCABULARY",
            content: {
              type: "VOCABULARY",
              term: TERMS[0] ?? "",
              reading: null,
              meaning: "demo gloss 1",
              exampleSentence: null,
            },
            notes: null,
            tags: ["imported"],
            language: "zh",
            generationRunId: null,
            createdAt: START,
          },
          START,
        );

        return run;
      }

      it("reports the earlier run when the same cards are asked for again", async () => {
        const first = await enrichedThenReverted();
        const second = await facadeWith(
          answerFor(TERMS.slice(0, 1)),
        ).requestVocabularyEnrichment(HSK_TRACK.slug, enrich({ count: 1 }));

        expect(isEnrichmentDuplicateNotice(second)).toBe(true);

        if (!isEnrichmentDuplicateNotice(second)) {
          return;
        }

        expect(second.duplicateOf.id).toBe(first.id);
        // No second run, so no model call was paid for twice.
        expect((await currentContent("card-1")).revision.revisionNumber).toBe(
          3,
        );
      });

      it("enriches anyway once the owner has seen the notice", async () => {
        await enrichedThenReverted();

        const second = enriched(
          await facadeWith(
            answerFor(TERMS.slice(0, 1)),
          ).requestVocabularyEnrichment(
            HSK_TRACK.slug,
            enrich({ count: 1, generateAnyway: true }),
          ),
        );

        expect(second.run.successfulItemCount).toBe(1);
        expect((await currentContent("card-1")).revision.revisionNumber).toBe(
          4,
        );
      });

      it("does not block a retry of a run that enriched nothing", async () => {
        await seedVocabulary(1);

        // The failed run left the card exactly as it was, so asking again is a first
        // attempt rather than a repeat.
        await facadeWith(driftedAnswer()).requestVocabularyEnrichment(
          HSK_TRACK.slug,
          enrich({ count: 1 }),
        );
        const retry = await facadeWith(
          answerFor(TERMS.slice(0, 1)),
        ).requestVocabularyEnrichment(HSK_TRACK.slug, enrich({ count: 1 }));

        expect(isEnrichmentDuplicateNotice(retry)).toBe(false);
      });

      it("does not treat the next batch of cards as a duplicate", async () => {
        await seedVocabulary(2);

        // The scope moves forward as cards are enriched, so the same count over
        // different cards is a different request.
        await facadeWith(
          answerFor(TERMS.slice(0, 1)),
        ).requestVocabularyEnrichment(HSK_TRACK.slug, enrich({ count: 1 }));
        const second = await facadeWith(
          answerFor(TERMS.slice(1, 2)),
        ).requestVocabularyEnrichment(HSK_TRACK.slug, enrich({ count: 1 }));

        expect(isEnrichmentDuplicateNotice(second)).toBe(false);
      });

      it("does not treat a flashcard run as a duplicate of an enrichment run", async () => {
        await enrichedThenReverted();

        const cards = await facadeWith().requestFlashcardGeneration(
          HSK_TRACK.slug,
          request({ itemKind: "FLASHCARD", itemCount: 1 }),
        );

        expect(isDuplicateBatchNotice(cards)).toBe(false);
      });
    });

    describe("the run review screen", () => {
      it("shows each enriched card as something that cannot be rejected", async () => {
        await seedVocabulary(1);

        const facade = facadeWith(answerFor(TERMS.slice(0, 1)));
        const { run } = enriched(
          await facade.requestVocabularyEnrichment(
            HSK_TRACK.slug,
            enrich({ count: 1 }),
          ),
        );
        const view = await facade.findRunDetail(HSK_TRACK.slug, run.id);
        const item = view?.items[0];

        if (item?.kind !== "ENRICH_VOCABULARY") {
          throw new Error("Expected an enrichment review row.");
        }

        // The card was the owner's before the run, so there is nothing to take back.
        expect(item.rejectable).toBe(false);
        expect(item.changedSinceGeneration).toBe(false);
        expect(item.item.revision.revisionNumber).toBe(2);
      });

      it("marks a card the owner has edited since the run", async () => {
        await seedVocabulary(1);

        const facade = facadeWith(answerFor(TERMS.slice(0, 1)));
        const { run } = enriched(
          await facade.requestVocabularyEnrichment(
            HSK_TRACK.slug,
            enrich({ count: 1 }),
          ),
        );
        const { revision } = await currentContent("card-1");

        await flashcards.appendRevision(
          {
            ...revision,
            id: "card-1-revision-3",
            revisionNumber: 3,
            generationRunId: null,
          },
          START,
        );

        const view = await facade.findRunDetail(HSK_TRACK.slug, run.id);

        expect(view?.items[0]?.changedSinceGeneration).toBe(true);
      });

      it("refuses to reject an enriched card as though it were a draft", async () => {
        await seedVocabulary(1);

        const { run } = enriched(
          await facadeWith(
            answerFor(TERMS.slice(0, 1)),
          ).requestVocabularyEnrichment(HSK_TRACK.slug, enrich({ count: 1 })),
        );

        // Deleting the card would destroy content the owner already had.
        await expect(
          facadeWith().rejectDraft(run.id, "card-1"),
        ).rejects.toBeInstanceOf(GeneratedDraftNotRejectableError);
        expect(await flashcards.findById("card-1")).not.toBeNull();
      });
    });

    it("does not offer a card whose current revision stopped being vocabulary", async () => {
      await seedVocabulary(1);

      const facade = facadeWith(answerFor(TERMS.slice(0, 1)));

      // Rewritten as a basic card between selection and the write: the enrichment
      // describes text that is no longer the card's text, so it is skipped.
      await flashcards.appendRevision(
        {
          id: "card-1-revision-2",
          flashcardId: "card-1",
          revisionNumber: 2,
          cardType: "BASIC",
          content: { type: "BASIC", front: "Front side", back: "Back side" },
          notes: null,
          tags: [],
          language: "zh",
          generationRunId: null,
          createdAt: START,
        },
        START,
      );

      const result = await facade.requestVocabularyEnrichment(
        HSK_TRACK.slug,
        enrich({ count: 1 }),
      );

      expect(isNothingToEnrichNotice(result)).toBe(true);
    });
  });

  describe("generated content in the rest of the application", () => {
    it("is not offered to a study session while it is still a draft", async () => {
      await facadeWith().requestQuestionGeneration(AWS_TRACK.slug, request());

      expect(await questions.countStudyCandidates(AWS_TRACK.id)).toBe(0);
    });

    it("becomes studiable once the owner activates it", async () => {
      const { run } = outcome(
        await facadeWith().requestQuestionGeneration(
          AWS_TRACK.slug,
          request({ itemCount: 1 }),
        ),
      );
      const questionId = (await runs.listItemIds(run.id))[0] ?? "";

      await questions.setLifecycleStatus(questionId, "ACTIVE", START);

      expect(await questions.countStudyCandidates(AWS_TRACK.id)).toBe(1);
    });

    it("still reports a converted flashcard as a reason not to delete the question", async () => {
      // Regression: the generation path writes through `QuestionRepository.create`,
      // so a generated question must behave exactly like a hand-written one where
      // deletion eligibility is concerned.
      const { run } = outcome(
        await facadeWith().requestQuestionGeneration(
          AWS_TRACK.slug,
          request({ itemCount: 1 }),
        ),
      );
      const questionId = (await runs.listItemIds(run.id))[0] ?? "";
      const checker = new FlashcardQuestionDependencyChecker(flashcards);

      expect(await checker.checkDeletionEligibility(questionId)).toEqual({
        deletable: true,
        blockingDependencies: [],
      });
    });
  });
});
