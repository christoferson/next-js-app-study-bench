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
import type { Question } from "@/modules/question-bank/domain/question";
import { SqliteQuestionRepository } from "@/modules/question-bank/infrastructure/sqlite-question-repository";
import {
  questionFixture,
  revisionFixture,
} from "@/modules/question-bank/infrastructure/test-support";
import type { Flashcard } from "@/modules/flashcards/domain/flashcard";
import { SqliteFlashcardRepository } from "@/modules/flashcards/infrastructure/sqlite-flashcard-repository";
import { FlashcardQuestionDependencyChecker } from "@/modules/flashcards/infrastructure/flashcard-question-dependency-checker";
import {
  AnswerNotGradableError,
  GeneratedDraftNotRejectableError,
  GenerationBatchTooLargeError,
  QuestionNotChallengeableError,
  QuestionNotReviewableError,
  TutorAskNotAnswerableError,
} from "@/modules/ai-generation/domain/errors";
import { TUTOR_ASK_KINDS } from "@/modules/ai-generation/domain/tutor-exchange";
import type { TutorAsk } from "@/modules/ai-generation/domain/tutor-exchange";
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

  /**
   * Reviewing a question.
   *
   * The properties under test are the ones the acceptance criteria name
   * (`SPEC.md` section 25.3): the reviewer receives the exact revision, the review cannot
   * rewrite the question, a structured finding is produced and readable back, and the one
   * quality promotion it may make is the only thing it writes to the question.
   *
   * The gateway is the deterministic fake in one of its three review modes, and its
   * `promptsSent` is how a test proves the facade passed the revision rather than
   * remembering to — the fake reads the stem back out of the prompt, so a facade that
   * forgot the context could not produce a passing summary.
   */
  describe("reviewing a question", () => {
    /** One draft question of the AWS track, with a revision worth judging. */
    async function seedQuestion(
      overrides: Partial<Question> = {},
    ): Promise<string> {
      const question = questionFixture({
        id: "question-under-review",
        certificationId: AWS_TRACK.id,
        currentRevisionId: "revision-under-review",
        ...overrides,
      });

      await questions.create(
        question,
        revisionFixture({
          // Whatever the question says its current revision is, so a test that seeds a
          // second question does not collide on the revision identifier.
          id: question.currentRevisionId,
          questionId: question.id,
          stem: "Which demo service stores objects?",
          explanation: "Because objects live in buckets.",
        }),
      );

      return question.id;
    }

    function reviewFacade(mode: "SOUND" | "MAJOR_ISSUES" | "MALFORMED"): {
      facade: GenerationFacade;
      gateway: FakeLanguageModelGateway;
    } {
      const gateway = new FakeLanguageModelGateway({
        questionReviewMode: mode,
      });

      return { facade: facadeForGateway(gateway), gateway };
    }

    it("records a review run with its provenance and its subject", async () => {
      const questionId = await seedQuestion();
      const { facade } = reviewFacade("SOUND");
      const { run } = await facade.reviewQuestion(AWS_TRACK.slug, questionId);

      expect(run.status).toBe("COMPLETED");
      expect(run.itemKind).toBe("QUESTION_REVIEW");
      expect(run.certificationId).toBe(AWS_TRACK.id);
      // The reviewer consulted nothing, and the run says so rather than claiming a
      // grounded mode it did not have.
      expect(run.generationMode).toBe("MODEL_KNOWLEDGE");
      expect(run.promptTemplateId).toBe("question-review");
      expect(run.promptTemplateVersion).toBe(1);
      expect(run.personaId).toBe("technical-certification");
      expect(run.personaVersion).toBe(1);
      expect(run.inputHash).toMatch(/^[0-9a-f]{64}$/);
      expect(run.requestedItemCount).toBe(1);
      expect(run.successfulItemCount).toBe(1);
      expect(run.usageMetadata).not.toBeNull();
      // The exact question and revision judged, so an edit later makes the review
      // visibly stale rather than silently misattributed.
      expect(run.subjectQuestionId).toBe(questionId);
      expect(run.subjectRevisionId).toBe("revision-under-review");
    });

    it("records the review model, not the writing one, when the two differ", async () => {
      // `BEDROCK_REVIEW_MODEL_ID` lets the owner judge with a different model than they
      // write with, so provenance has to name the model that was actually asked. Two
      // gateways reporting different identifiers is the only way to observe it.
      const questionId = await seedQuestion();
      const writer = new FakeLanguageModelGateway({
        provider: "writer-provider",
        modelId: "demo.writer:0",
      });
      const judge = new FakeLanguageModelGateway({
        provider: "judge-provider",
        modelId: "demo.judge:0",
        questionReviewMode: "SOUND",
      });
      const facade = new GenerationFacade({
        runs,
        questions,
        flashcards,
        certifications: new SqliteCertificationRepository(database),
        objectives: new SqliteObjectiveRepository(database),
        personas: new SqlitePersonaRepository(database),
        unitOfWork: new SqliteGenerationUnitOfWork(database),
        gateway: writer,
        reviewGateway: judge,
        clock,
        ids,
      });
      const { run } = await facade.reviewQuestion(AWS_TRACK.slug, questionId);

      expect(run.modelId).toBe("demo.judge:0");
      expect(run.modelProvider).toBe("judge-provider");
      // And the call itself went to the review gateway: the writing one was never
      // asked, so nothing was spent on the model that does not do this job.
      expect(judge.turnsTaken).toBe(1);
      expect(writer.turnsTaken).toBe(0);
      // Read back from the database, so it is the stored provenance rather than the
      // returned object that is asserted.
      expect((await runs.findById(run.id))?.modelId).toBe("demo.judge:0");
    });

    it("reviews with the writing gateway when no review gateway is configured", async () => {
      // The ordinary case: one model configured, both purposes use it, and every
      // existing caller that composes a single gateway keeps working.
      const questionId = await seedQuestion();
      const { facade, gateway } = reviewFacade("SOUND");
      const { run } = await facade.reviewQuestion(AWS_TRACK.slug, questionId);

      expect(run.modelId).toBe(gateway.modelId);
      expect(gateway.turnsTaken).toBe(1);
    });

    it("sends the exact revision to the model, as data", async () => {
      const questionId = await seedQuestion();
      const { facade, gateway } = reviewFacade("SOUND");

      await facade.reviewQuestion(AWS_TRACK.slug, questionId);

      const prompt = gateway.promptsSent[0];

      expect(prompt?.user).toContain("<owner_question_under_review>");
      expect(prompt?.user).toContain("Which demo service stores objects?");
      expect(prompt?.user).toContain("Marked as correct: choice-1");
      // And none of it in the system message.
      expect(prompt?.system).not.toContain(
        "Which demo service stores objects?",
      );
    });

    it("gives the reviewer the objectives the question is mapped to", async () => {
      const questionId = await seedQuestion();

      await questions.replaceObjectiveLinks(questionId, ["objective-2"], START);

      const { facade, gateway } = reviewFacade("SOUND");

      await facade.reviewQuestion(AWS_TRACK.slug, questionId);

      const prompt = gateway.promptsSent[0];

      expect(prompt?.user).toContain("Demo second objective");
      // Only the mapped one: the whole syllabus would be pages of context for a
      // judgement about one item.
      expect(prompt?.user).not.toContain("Demo objective");
    });

    it("stores the findings so they can be read back through the same schema", async () => {
      const questionId = await seedQuestion();
      const { facade } = reviewFacade("MAJOR_ISSUES");
      const { run } = await facade.reviewQuestion(AWS_TRACK.slug, questionId);
      const view = await facade.findQuestionReview(questionId);

      expect(view?.run.id).toBe(run.id);
      expect(view?.review?.verdict).toBe("MAJOR_ISSUES");
      expect(view?.review?.answerCorrect).toBe(false);
      expect(view?.review?.findings.length).toBeGreaterThan(0);
      expect(view?.review?.findings[0]?.category).toBe("WRONG_ANSWER");
      expect(view?.staleRevision).toBe(false);
    });

    it("never changes the quality state by itself, even on a clean verdict", async () => {
      // Owner decision (2026-08-15): a review records findings only. Marking the
      // question AI-reviewed is the owner's explicit accept, tested below.
      const questionId = await seedQuestion();
      const { facade } = reviewFacade("SOUND");
      const outcome = await facade.reviewQuestion(AWS_TRACK.slug, questionId);

      expect(outcome.qualityStatusChanged).toBe(false);
      expect((await questions.findById(questionId))?.qualityStatus).toBe(
        "UNREVIEWED",
      );
    });

    it("offers the accept only for a clean, current review of an unreviewed question", async () => {
      const questionId = await seedQuestion();
      const { facade } = reviewFacade("SOUND");
      await facade.reviewQuestion(AWS_TRACK.slug, questionId);

      const view = await facade.findQuestionReview(questionId);

      expect(view?.offersAccept).toBe(true);
    });

    it("accepts a clean review into AI_REVIEWED on the owner's explicit call", async () => {
      const questionId = await seedQuestion();
      const { facade } = reviewFacade("SOUND");
      await facade.reviewQuestion(AWS_TRACK.slug, questionId);

      await facade.acceptQuestionReview(AWS_TRACK.slug, questionId);

      expect((await questions.findById(questionId))?.qualityStatus).toBe(
        "AI_REVIEWED",
      );
      // Once accepted, the offer is gone: the promotion is no longer available.
      const after = await facade.findQuestionReview(questionId);

      expect(after?.offersAccept).toBe(false);
    });

    it("refuses to accept a review that found problems", async () => {
      const questionId = await seedQuestion();
      const { facade } = reviewFacade("MAJOR_ISSUES");
      await facade.reviewQuestion(AWS_TRACK.slug, questionId);

      const view = await facade.findQuestionReview(questionId);

      expect(view?.offersAccept).toBe(false);
      await expect(
        facade.acceptQuestionReview(AWS_TRACK.slug, questionId),
      ).rejects.toThrow(/does not support/i);
      expect((await questions.findById(questionId))?.qualityStatus).toBe(
        "UNREVIEWED",
      );
    });

    it("refuses to accept when the question has never been reviewed", async () => {
      const questionId = await seedQuestion();
      const { facade } = reviewFacade("SOUND");

      await expect(
        facade.acceptQuestionReview(AWS_TRACK.slug, questionId),
      ).rejects.toThrow(/no current review/i);
    });

    it("leaves the quality state alone when it found problems", async () => {
      // The whole point of `qualityStatusAfterReview`: a bad verdict is a recommendation,
      // and pulling a question out of study is the owner's decision.
      const questionId = await seedQuestion();
      const { facade } = reviewFacade("MAJOR_ISSUES");
      const outcome = await facade.reviewQuestion(AWS_TRACK.slug, questionId);

      expect(outcome.qualityStatusChanged).toBe(false);
      expect((await questions.findById(questionId))?.qualityStatus).toBe(
        "UNREVIEWED",
      );
    });

    it("never overwrites a state the owner reached themselves", async () => {
      const questionId = await seedQuestion({ qualityStatus: "USER_APPROVED" });
      const { facade } = reviewFacade("SOUND");
      const outcome = await facade.reviewQuestion(AWS_TRACK.slug, questionId);

      expect(outcome.qualityStatusChanged).toBe(false);
      expect((await questions.findById(questionId))?.qualityStatus).toBe(
        "USER_APPROVED",
      );
    });

    it("changes nothing about the question's content or lifecycle", async () => {
      // The acceptance criterion in full: a review may not rewrite a question, and there
      // is no path in the facade that could.
      const questionId = await seedQuestion();
      const before = await questions.findWithCurrentRevision(questionId);
      const { facade } = reviewFacade("MAJOR_ISSUES");

      await facade.reviewQuestion(AWS_TRACK.slug, questionId);

      const after = await questions.findWithCurrentRevision(questionId);

      expect(after?.revision).toEqual(before?.revision);
      expect(await questions.listRevisions(questionId)).toHaveLength(1);
      expect(after?.question.lifecycleStatus).toBe("DRAFT");
      expect(after?.question.disputeReason).toBeNull();
    });

    it("offers the prefilled dispute when the reviewer recommends one", async () => {
      const questionId = await seedQuestion();
      const { facade } = reviewFacade("MAJOR_ISSUES");

      await facade.reviewQuestion(AWS_TRACK.slug, questionId);

      const view = await facade.findQuestionReview(questionId);

      expect(view?.review?.suggestedAction).toBe("DISPUTE");
      expect(view?.offersDispute).toBe(true);
      // And the summary that would be prefilled is about this question, not a canned line.
      expect(view?.review?.summary).toContain("Which demo service");
    });

    it("offers no dispute for a question that is already disputed", async () => {
      // The button would set the state it is already in and overwrite the owner's own
      // recorded reason with the model's summary.
      const questionId = await seedQuestion({
        qualityStatus: "DISPUTED",
        disputeReason: "The owner's own reason.",
      });
      const { facade } = reviewFacade("MAJOR_ISSUES");

      await facade.reviewQuestion(AWS_TRACK.slug, questionId);

      expect((await facade.findQuestionReview(questionId))?.offersDispute).toBe(
        false,
      );
    });

    it("offers no dispute when the reviewer approved", async () => {
      const questionId = await seedQuestion();
      const { facade } = reviewFacade("SOUND");

      await facade.reviewQuestion(AWS_TRACK.slug, questionId);

      expect((await facade.findQuestionReview(questionId))?.offersDispute).toBe(
        false,
      );
    });

    it("marks a review stale once the question is edited", async () => {
      const questionId = await seedQuestion();
      const { facade } = reviewFacade("SOUND");

      await facade.reviewQuestion(AWS_TRACK.slug, questionId);
      await questions.appendRevision(
        revisionFixture({
          id: "revision-2",
          questionId,
          revisionNumber: 2,
          stem: "Which demo service stores objects, exactly?",
        }),
        START,
      );

      const view = await facade.findQuestionReview(questionId);

      expect(view?.staleRevision).toBe(true);
      // Still shown, because the findings are real — just about wording the owner no
      // longer has.
      expect(view?.review?.verdict).toBe("SOUND");
    });

    it("records a failed run and changes nothing when the answer is unusable", async () => {
      // Malformed on every turn, including the repair attempt. A model answering gibberish
      // must not be able to promote anything.
      const questionId = await seedQuestion();
      const { facade } = reviewFacade("MALFORMED");
      const outcome = await facade.reviewQuestion(AWS_TRACK.slug, questionId);

      expect(outcome.run.status).toBe("FAILED");
      expect(outcome.run.failureReason).toBe("MALFORMED_OUTPUT");
      expect(outcome.review).toBeNull();
      expect(outcome.qualityStatusChanged).toBe(false);
      expect((await questions.findById(questionId))?.qualityStatus).toBe(
        "UNREVIEWED",
      );
      // A failed run is not the latest *readable* review, so the panel shows nothing.
      expect(await facade.findQuestionReview(questionId)).toBeNull();
    });

    it("keeps the failed run's subject, so the history says what it was looking at", async () => {
      const questionId = await seedQuestion();
      const { facade } = reviewFacade("MALFORMED");
      const { run } = await facade.reviewQuestion(AWS_TRACK.slug, questionId);

      expect(run.subjectQuestionId).toBe(questionId);
      expect(run.subjectRevisionId).toBe("revision-under-review");
    });

    it("allows a re-review and shows the newest one", async () => {
      const questionId = await seedQuestion();
      const { facade } = reviewFacade("SOUND");
      const first = await facade.reviewQuestion(AWS_TRACK.slug, questionId);

      clock.set("2026-04-01T10:00:00.000Z");

      const second = await facade.reviewQuestion(AWS_TRACK.slug, questionId);

      expect(second.run.id).not.toBe(first.run.id);
      // No duplicate-batch guard: a second opinion is a reasonable request.
      expect((await facade.findQuestionReview(questionId))?.run.id).toBe(
        second.run.id,
      );
      // And the second promotion is a no-op, because the state is already recorded.
      expect(second.qualityStatusChanged).toBe(false);
    });

    it("shows the review in the track's run history, labelled as a review", async () => {
      const questionId = await seedQuestion();
      const { facade } = reviewFacade("SOUND");
      const { run } = await facade.reviewQuestion(AWS_TRACK.slug, questionId);
      const history = await facade.findRuns(AWS_TRACK.slug, { page: 1 });
      const row = history?.runs.find((summary) => summary.run.id === run.id);

      expect(row?.run.itemKind).toBe("QUESTION_REVIEW");
      expect(row?.run.subjectQuestionId).toBe(questionId);
    });

    it("refuses to review a question of another track", async () => {
      // Scoped to the slug as well as the identifier, so a cross-track address cannot
      // spend a model call on somebody else's question.
      const questionId = await seedQuestion();

      await expect(
        reviewFacade("SOUND").facade.reviewQuestion(HSK_TRACK.slug, questionId),
      ).rejects.toBeInstanceOf(QuestionNotReviewableError);
    });

    it("refuses to review a question that no longer exists", async () => {
      await expect(
        reviewFacade("SOUND").facade.reviewQuestion(
          AWS_TRACK.slug,
          "no-such-question",
        ),
      ).rejects.toBeInstanceOf(QuestionNotReviewableError);
    });

    it("refuses an unknown track before anything else", async () => {
      await expect(
        reviewFacade("SOUND").facade.reviewQuestion(
          "no-such-track",
          "question-under-review",
        ),
      ).rejects.toBeInstanceOf(CertificationNotFoundError);
    });

    it("refuses to review a question taken out of study", async () => {
      // Retired and archived questions are not studied, so a review would spend a call on
      // something the owner is not using.
      for (const status of ["RETIRED", "ARCHIVED"] as const) {
        const questionId = await seedQuestion({
          id: `question-${status}`,
          currentRevisionId: `revision-${status}`,
          lifecycleStatus: status,
        });

        await expect(
          reviewFacade("SOUND").facade.reviewQuestion(
            AWS_TRACK.slug,
            questionId,
          ),
        ).rejects.toBeInstanceOf(QuestionNotReviewableError);
      }
    });

    it("reviews an active question as readily as a draft", async () => {
      const questionId = await seedQuestion({ lifecycleStatus: "ACTIVE" });
      const { run } = await reviewFacade("SOUND").facade.reviewQuestion(
        AWS_TRACK.slug,
        questionId,
      );

      expect(run.status).toBe("COMPLETED");
    });

    it("has nothing to show for a question that was never reviewed", async () => {
      const questionId = await seedQuestion();

      expect(
        await reviewFacade("SOUND").facade.findQuestionReview(questionId),
      ).toBeNull();
    });

    it("does not mistake a generation run for a review of its question", async () => {
      // `findLatestReviewForQuestion` filters on the item kind as well as the subject
      // column, so no other run kind can leak into the findings panel.
      const { run } = outcome(
        await facadeWith().requestQuestionGeneration(
          AWS_TRACK.slug,
          request({ itemCount: 1 }),
        ),
      );
      const generatedId = (await runs.listItemIds(run.id))[0] ?? "";

      expect(
        await reviewFacade("SOUND").facade.findQuestionReview(generatedId),
      ).toBeNull();
    });
  });

  describe("asking the tutor", () => {
    /** One question of the AWS track with something worth explaining. */
    async function seedTutoredQuestion(
      overrides: Partial<Question> = {},
    ): Promise<string> {
      const question = questionFixture({
        id: "question-being-studied",
        certificationId: AWS_TRACK.id,
        currentRevisionId: "revision-being-studied",
        ...overrides,
      });

      await questions.create(
        question,
        revisionFixture({
          id: question.currentRevisionId,
          questionId: question.id,
          stem: "Which demo service stores objects?",
          explanation: "Because objects live in buckets.",
        }),
      );

      return question.id;
    }

    function tutorFacade(mode: "ANSWER" | "MALFORMED" = "ANSWER"): {
      facade: GenerationFacade;
      gateway: FakeLanguageModelGateway;
    } {
      const gateway = new FakeLanguageModelGateway({ tutorMode: mode });

      return { facade: facadeForGateway(gateway), gateway };
    }

    function ask(overrides: Partial<TutorAsk> = {}): TutorAsk {
      return {
        kind: "EXPLAIN_ANSWER",
        choiceId: null,
        note: null,
        ...overrides,
      };
    }

    it("answers every one of the six asks and records each as its own run", async () => {
      const questionId = await seedTutoredQuestion();
      const { facade } = tutorFacade();

      for (const kind of TUTOR_ASK_KINDS) {
        const outcome = await facade.askTutor(
          AWS_TRACK.slug,
          questionId,
          ask({
            kind,
            choiceId: kind === "EXPLAIN_CHOICE" ? "choice-2" : null,
          }),
        );

        expect(outcome.run.status).toBe("COMPLETED");
        expect(outcome.response?.kind).toBe(kind);
      }

      // Six asks, six runs. There is no thread being extended, so nothing is amended.
      const history = await runs.list({
        certificationId: AWS_TRACK.id,
        limit: 50,
        offset: 0,
      });

      expect(
        history.items.filter((run) => run.itemKind === "TUTOR_EXPLANATION"),
      ).toHaveLength(TUTOR_ASK_KINDS.length);
    });

    it("records a tutor run with its provenance and its subject", async () => {
      const questionId = await seedTutoredQuestion();
      const { run } = await tutorFacade().facade.askTutor(
        AWS_TRACK.slug,
        questionId,
        ask(),
      );

      expect(run.itemKind).toBe("TUTOR_EXPLANATION");
      expect(run.certificationId).toBe(AWS_TRACK.id);
      // Nothing was looked up, and the run says so rather than claiming a grounded mode.
      expect(run.generationMode).toBe("MODEL_KNOWLEDGE");
      expect(run.promptTemplateId).toBe("tutor-explanation");
      expect(run.promptTemplateVersion).toBe(1);
      expect(run.personaId).toBe("technical-certification");
      expect(run.inputHash).toMatch(/^[0-9a-f]{64}$/);
      expect(run.requestedItemCount).toBe(1);
      expect(run.successfulItemCount).toBe(1);
      expect(run.usageMetadata).not.toBeNull();
      // The exact question and revision explained, recorded on the run so a later edit
      // makes the exchange visibly stale (`SPEC.md` section 25.3).
      expect(run.subjectQuestionId).toBe(questionId);
      expect(run.subjectRevisionId).toBe("revision-being-studied");
      // An explanation is not a proposal, so there is nothing to apply.
      expect(run.appliedAt).toBeNull();
    });

    it("sends the exact revision to the model, as data", async () => {
      const questionId = await seedTutoredQuestion();
      const { facade, gateway } = tutorFacade();

      await facade.askTutor(AWS_TRACK.slug, questionId, ask());

      const prompt = gateway.promptsSent[0];

      expect(prompt?.user).toContain("<owner_question_being_studied>");
      expect(prompt?.user).toContain("Which demo service stores objects?");
      expect(prompt?.user).toContain("Marked as correct: choice-1");
      // And none of it in the system message, where it would be an instruction.
      expect(prompt?.system).not.toContain(
        "Which demo service stores objects?",
      );
    });

    it("carries the owner's note as data rather than as instructions", async () => {
      const questionId = await seedTutoredQuestion();
      const { facade, gateway } = tutorFacade();

      await facade.askTutor(
        AWS_TRACK.slug,
        questionId,
        ask({ note: "I thought EBS was object storage" }),
      );

      const prompt = gateway.promptsSent[0];

      expect(prompt?.user).toContain("<owner_request>");
      expect(prompt?.user).toContain("I thought EBS was object storage");
      expect(prompt?.system).not.toContain("I thought EBS was object storage");
    });

    it("asks the review model, not the writing one, when the two differ", async () => {
      // Tutoring is a judging-and-explaining job, so it goes to whatever
      // `BEDROCK_REVIEW_MODEL_ID` names.
      const questionId = await seedTutoredQuestion();
      const writer = new FakeLanguageModelGateway({
        provider: "writer-provider",
        modelId: "demo.writer:0",
      });
      const judge = new FakeLanguageModelGateway({
        provider: "judge-provider",
        modelId: "demo.judge:0",
      });
      const facade = new GenerationFacade({
        runs,
        questions,
        flashcards,
        certifications: new SqliteCertificationRepository(database),
        objectives: new SqliteObjectiveRepository(database),
        personas: new SqlitePersonaRepository(database),
        unitOfWork: new SqliteGenerationUnitOfWork(database),
        gateway: writer,
        reviewGateway: judge,
        clock,
        ids,
      });
      const { run } = await facade.askTutor(AWS_TRACK.slug, questionId, ask());

      expect(run.modelId).toBe("demo.judge:0");
      expect(run.modelProvider).toBe("judge-provider");
      expect(judge.turnsTaken).toBe(1);
      expect(writer.turnsTaken).toBe(0);
      expect((await runs.findById(run.id))?.modelId).toBe("demo.judge:0");
    });

    it("stores the answer so it can be read back through the same schema", async () => {
      const questionId = await seedTutoredQuestion();
      const { facade } = tutorFacade();
      const { run } = await facade.askTutor(
        AWS_TRACK.slug,
        questionId,
        ask({ kind: "EXPLAIN_SIMPLER" }),
      );
      const exchanges = await facade.findTutorExchanges(questionId);

      expect(exchanges).toHaveLength(1);
      expect(exchanges[0]?.run.id).toBe(run.id);
      expect(exchanges[0]?.response?.kind).toBe("EXPLAIN_SIMPLER");
      expect(exchanges[0]?.staleRevision).toBe(false);
    });

    it("keeps a follow-up question out of the bank", async () => {
      // The whole point of the ephemeral follow-up: it is tutoring content, not an item.
      const questionId = await seedTutoredQuestion();
      const before = await questions.countsByCertification(AWS_TRACK.id);
      const { facade } = tutorFacade();
      const { run, response } = await facade.askTutor(
        AWS_TRACK.slug,
        questionId,
        ask({ kind: "FOLLOW_UP_QUESTION" }),
      );

      expect(response?.kind).toBe("FOLLOW_UP_QUESTION");
      expect(await questions.countsByCertification(AWS_TRACK.id)).toEqual(
        before,
      );
      // And the run claims no items either, so the run screen cannot offer one to accept.
      expect(await runs.listItemIds(run.id)).toEqual([]);
      expect((await runs.countItems(run.id)).total).toBe(0);
    });

    it("changes nothing at all about the question", async () => {
      // The acceptance criterion: "the tutor cannot silently rewrite a question". Not even
      // the quality state moves, unlike a review.
      const questionId = await seedTutoredQuestion();
      const before = await questions.findWithCurrentRevision(questionId);
      const { facade } = tutorFacade();

      await facade.askTutor(AWS_TRACK.slug, questionId, ask());

      expect(await questions.findWithCurrentRevision(questionId)).toEqual(
        before,
      );
    });

    it("marks an exchange stale once the question is edited", async () => {
      const questionId = await seedTutoredQuestion();
      const { facade } = tutorFacade();

      await facade.askTutor(AWS_TRACK.slug, questionId, ask());
      await questions.appendRevision(
        revisionFixture({
          id: "revision-after-the-ask",
          questionId,
          revisionNumber: 2,
          stem: "Which demo service stores objects, revised?",
        }),
        START,
      );

      const exchanges = await facade.findTutorExchanges(questionId);

      expect(exchanges[0]?.staleRevision).toBe(true);
    });

    it("returns the recent exchanges newest first, bounded by the limit", async () => {
      const questionId = await seedTutoredQuestion();
      const { facade } = tutorFacade();
      const askedKinds = [
        "EXPLAIN_ANSWER",
        "EXPLAIN_SIMPLER",
        "EXPLAIN_TECHNICAL",
      ] as const;

      for (const [index, kind] of askedKinds.entries()) {
        // Distinct timestamps, so "newest first" is about the recorded order rather than
        // about insertion luck.
        clock.set(`2026-04-0${index + 1}T09:00:00.000Z`);
        await facade.askTutor(AWS_TRACK.slug, questionId, ask({ kind }));
      }

      const all = await facade.findTutorExchanges(questionId);

      expect(all.map((exchange) => exchange.response?.kind)).toEqual([
        "EXPLAIN_TECHNICAL",
        "EXPLAIN_SIMPLER",
        "EXPLAIN_ANSWER",
      ]);

      const limited = await facade.findTutorExchanges(questionId, 2);

      expect(limited.map((exchange) => exchange.response?.kind)).toEqual([
        "EXPLAIN_TECHNICAL",
        "EXPLAIN_SIMPLER",
      ]);
    });

    it("shows only exchanges about the question that was asked about", async () => {
      const first = await seedTutoredQuestion();
      const second = await seedTutoredQuestion({
        id: "question-other",
        currentRevisionId: "revision-other",
      });
      const { facade } = tutorFacade();

      await facade.askTutor(AWS_TRACK.slug, first, ask());

      expect(await facade.findTutorExchanges(second)).toEqual([]);
    });

    it("does not mistake a review of the same question for a tutor answer", async () => {
      // Both kinds set `subject_question_id`, so the item-kind filter is load-bearing in
      // both directions rather than defensive.
      const questionId = await seedTutoredQuestion();

      await facadeForGateway(
        new FakeLanguageModelGateway({ questionReviewMode: "SOUND" }),
      ).reviewQuestion(AWS_TRACK.slug, questionId);

      const { facade } = tutorFacade();

      expect(await facade.findTutorExchanges(questionId)).toEqual([]);

      await facade.askTutor(AWS_TRACK.slug, questionId, ask());

      // And the review is still the review, not the answer that was just recorded.
      expect((await facade.findQuestionReview(questionId))?.run.itemKind).toBe(
        "QUESTION_REVIEW",
      );
      expect(await facade.findTutorExchanges(questionId)).toHaveLength(1);
    });

    it("records a failed run rather than throwing when the answer never validates", async () => {
      const questionId = await seedTutoredQuestion();
      const { facade, gateway } = tutorFacade("MALFORMED");
      const outcome = await facade.askTutor(AWS_TRACK.slug, questionId, ask());

      expect(outcome.run.status).toBe("FAILED");
      expect(outcome.run.failureReason).toBe("MALFORMED_OUTPUT");
      expect(outcome.response).toBeNull();
      // One repair attempt, then it stops: an ask does not retry forever.
      expect(gateway.turnsTaken).toBe(2);
      // The failed run still says what it was looking at, because the subject is recorded
      // before the call.
      expect(outcome.run.subjectQuestionId).toBe(questionId);
      expect(outcome.run.subjectRevisionId).toBe("revision-being-studied");
      // And it is not shown as an exchange, because it has no answer to show.
      expect(await facade.findTutorExchanges(questionId)).toEqual([]);
    });

    it("records a failed run when the provider itself fails", async () => {
      const questionId = await seedTutoredQuestion();
      const gateway = new FakeLanguageModelGateway({
        responses: [{ failure: "PROVIDER_THROTTLED" }],
      });
      const outcome = await facadeForGateway(gateway).askTutor(
        AWS_TRACK.slug,
        questionId,
        ask(),
      );

      expect(outcome.run.status).toBe("FAILED");
      expect(outcome.run.failureReason).toBe("PROVIDER_THROTTLED");
      expect(outcome.response).toBeNull();
    });

    it("names the choice being asked about, and files the answer against it", async () => {
      const questionId = await seedTutoredQuestion();
      const { facade, gateway } = tutorFacade();
      const outcome = await facade.askTutor(
        AWS_TRACK.slug,
        questionId,
        ask({ kind: "EXPLAIN_CHOICE", choiceId: "choice-2" }),
      );
      const prompt = gateway.promptsSent[0];

      // The letter the owner reads, computed the same way the question page computes it —
      // lower case, because that is what `choiceLetter` renders on the page the owner was
      // looking at when they pressed the button.
      expect(prompt?.user).toContain("whose identifier is choice-2");
      expect(prompt?.user).toContain("The choice they asked about is b,");
      expect(
        outcome.response?.kind === "EXPLAIN_CHOICE"
          ? outcome.response.choiceId
          : null,
      ).toBe("choice-2");
    });

    it("refuses an ask about a choice the question does not have, before spending a call", async () => {
      const questionId = await seedTutoredQuestion();
      const { facade, gateway } = tutorFacade();

      await expect(
        facade.askTutor(
          AWS_TRACK.slug,
          questionId,
          ask({ kind: "EXPLAIN_CHOICE", choiceId: "choice-gone" }),
        ),
      ).rejects.toBeInstanceOf(TutorAskNotAnswerableError);
      // Nothing was asked and nothing was recorded: discovering this from a validation
      // failure would mean paying for the discovery.
      expect(gateway.turnsTaken).toBe(0);
      expect(
        (
          await runs.list({
            certificationId: AWS_TRACK.id,
            limit: 10,
            offset: 0,
          })
        ).items,
      ).toEqual([]);
    });

    it("refuses to answer about a question of another track", async () => {
      const questionId = await seedTutoredQuestion();

      await expect(
        tutorFacade().facade.askTutor(HSK_TRACK.slug, questionId, ask()),
      ).rejects.toBeInstanceOf(TutorAskNotAnswerableError);
    });

    it("refuses to answer about a question that no longer exists", async () => {
      await expect(
        tutorFacade().facade.askTutor(
          AWS_TRACK.slug,
          "no-such-question",
          ask(),
        ),
      ).rejects.toBeInstanceOf(TutorAskNotAnswerableError);
    });

    it("refuses an unknown track before anything else", async () => {
      await expect(
        tutorFacade().facade.askTutor(
          "no-such-track",
          "question-being-studied",
          ask(),
        ),
      ).rejects.toBeInstanceOf(CertificationNotFoundError);
    });

    it("tutors a question at any lifecycle, including one out of study", async () => {
      // Deliberately unlike a review: wanting to understand a retired question while
      // reading through the bank is a legitimate thing to want, and the owner is the one
      // pressing the button.
      for (const status of [
        "DRAFT",
        "ACTIVE",
        "RETIRED",
        "ARCHIVED",
      ] as const) {
        const questionId = await seedTutoredQuestion({
          id: `question-${status}`,
          currentRevisionId: `revision-${status}`,
          lifecycleStatus: status,
        });
        const outcome = await tutorFacade().facade.askTutor(
          AWS_TRACK.slug,
          questionId,
          ask(),
        );

        expect(outcome.run.status).toBe("COMPLETED");
      }
    });

    it("asks again when the same thing is asked twice", async () => {
      // No duplicate guard: a second explanation of something that did not land the first
      // time is the point, and an ask is one cheap call rather than a batch.
      const questionId = await seedTutoredQuestion();
      const { facade, gateway } = tutorFacade();

      await facade.askTutor(AWS_TRACK.slug, questionId, ask());
      await facade.askTutor(AWS_TRACK.slug, questionId, ask());

      expect(gateway.turnsTaken).toBe(2);
      expect(await facade.findTutorExchanges(questionId)).toHaveLength(2);
    });

    it("fingerprints the ask, so a different ask about the same revision differs", async () => {
      const questionId = await seedTutoredQuestion();
      const { facade } = tutorFacade();
      const same = await facade.askTutor(AWS_TRACK.slug, questionId, ask());
      const repeat = await facade.askTutor(AWS_TRACK.slug, questionId, ask());
      const other = await facade.askTutor(
        AWS_TRACK.slug,
        questionId,
        ask({ kind: "EXPLAIN_SIMPLER" }),
      );
      const noted = await facade.askTutor(
        AWS_TRACK.slug,
        questionId,
        ask({ note: "in terms of durability" }),
      );

      expect(repeat.run.inputHash).toBe(same.run.inputHash);
      expect(other.run.inputHash).not.toBe(same.run.inputHash);
      expect(noted.run.inputHash).not.toBe(same.run.inputHash);
      // The fingerprint is not a copy of the bank.
      expect(same.run.inputHash).not.toContain("objects");
    });

    it("has nothing to show for a question never asked about", async () => {
      const questionId = await seedTutoredQuestion();

      expect(await tutorFacade().facade.findTutorExchanges(questionId)).toEqual(
        [],
      );
    });
  });

  describe("grading a written answer", () => {
    /** One short-answer question of the AWS track, with concepts to mark against. */
    async function seedShortAnswer(
      overrides: Partial<Question> = {},
      expectedConcepts: readonly string[] = ["object storage", "eleven nines"],
    ): Promise<string> {
      const question = questionFixture({
        id: "question-being-marked",
        certificationId: AWS_TRACK.id,
        currentRevisionId: "revision-being-marked",
        ...overrides,
      });

      await questions.create(
        question,
        revisionFixture({
          id: question.currentRevisionId,
          questionId: question.id,
          questionType: "SHORT_ANSWER",
          stem: "Describe the demo object store's durability.",
          content: { type: "SHORT_ANSWER", expectedConcepts },
        }),
      );

      return question.id;
    }

    function gradingFacade(
      mode: "COVERED" | "PARTIAL" | "MALFORMED" = "COVERED",
    ): {
      facade: GenerationFacade;
      gateway: FakeLanguageModelGateway;
    } {
      const gateway = new FakeLanguageModelGateway({
        answerEvaluationMode: mode,
      });

      return { facade: facadeForGateway(gateway), gateway };
    }

    const ANSWER = "It stores objects and gives eleven nines of durability.";

    it("records a grading run with its provenance and its subject", async () => {
      const questionId = await seedShortAnswer();
      const { run, evaluation } =
        await gradingFacade().facade.evaluateShortAnswer(
          AWS_TRACK.slug,
          questionId,
          ANSWER,
        );

      expect(run.itemKind).toBe("ANSWER_EVALUATION");
      expect(run.status).toBe("COMPLETED");
      expect(run.certificationId).toBe(AWS_TRACK.id);
      // Nothing was looked up: the mark is against concepts the owner recorded.
      expect(run.generationMode).toBe("MODEL_KNOWLEDGE");
      expect(run.promptTemplateId).toBe("answer-evaluation");
      expect(run.promptTemplateVersion).toBe(1);
      expect(run.personaId).toBe("technical-certification");
      expect(run.inputHash).toMatch(/^[0-9a-f]{64}$/);
      expect(run.requestedItemCount).toBe(1);
      expect(run.successfulItemCount).toBe(1);
      expect(run.usageMetadata).not.toBeNull();
      expect(run.subjectQuestionId).toBe(questionId);
      expect(run.subjectRevisionId).toBe("revision-being-marked");
      // A grading proposes nothing to write, not even to the attempt.
      expect(run.appliedAt).toBeNull();
      expect(evaluation?.verdict).toBe("CORRECT");
    });

    it("marks against the question's own concepts and echoes them back", async () => {
      const questionId = await seedShortAnswer();
      const { evaluation } = await gradingFacade(
        "PARTIAL",
      ).facade.evaluateShortAnswer(AWS_TRACK.slug, questionId, ANSWER);

      expect(evaluation?.verdict).toBe("PARTIALLY_CORRECT");
      expect(evaluation?.conceptsCovered).toEqual(["object storage"]);
      expect(evaluation?.conceptsMissed).toEqual(["eleven nines"]);
    });

    it("recommends a self-grade without recording one", async () => {
      // The advisory design: the verdict pre-selects what the owner might click, and the
      // attempt keeps whatever they actually did (`domain/answer-evaluation.ts`).
      const questionId = await seedShortAnswer();
      const covered = await gradingFacade().facade.evaluateShortAnswer(
        AWS_TRACK.slug,
        questionId,
        ANSWER,
      );
      const partial = await gradingFacade("PARTIAL").facade.evaluateShortAnswer(
        AWS_TRACK.slug,
        questionId,
        ANSWER,
      );

      expect(covered.recommendedSelfGrade).toBe("CORRECT");
      // "Some of it" is exactly the case a two-button record cannot express.
      expect(partial.recommendedSelfGrade).toBeNull();
    });

    it("stores the grading so the run screen can read it back", async () => {
      const questionId = await seedShortAnswer();
      const { run } = await gradingFacade().facade.evaluateShortAnswer(
        AWS_TRACK.slug,
        questionId,
        ANSWER,
      );
      const stored = await runs.findById(run.id);

      expect(JSON.parse(stored?.proposedPayload ?? "null")).toMatchObject({
        verdict: "CORRECT",
        conceptsCovered: ["object storage", "eleven nines"],
      });
    });

    it("sends the question and the answer as delimited data", async () => {
      const questionId = await seedShortAnswer();
      const { facade, gateway } = gradingFacade();

      await facade.evaluateShortAnswer(AWS_TRACK.slug, questionId, ANSWER);

      const prompt = gateway.promptsSent[0];

      expect(prompt?.user).toContain("<owner_question_being_marked>");
      expect(prompt?.user).toContain("<owner_written_answer>");
      expect(prompt?.user).toContain(ANSWER);
      expect(prompt?.user).toContain("Describe the demo object store");
      // And neither in the system message, where either would be an instruction.
      expect(prompt?.system).not.toContain(ANSWER);
      expect(prompt?.system).not.toContain("Describe the demo object store");
    });

    it("changes nothing at all about the question or the bank", async () => {
      const questionId = await seedShortAnswer();
      const before = await questions.findWithCurrentRevision(questionId);
      const counts = await questions.countsByCertification(AWS_TRACK.id);
      const { facade, gateway } = gradingFacade();

      await facade.evaluateShortAnswer(AWS_TRACK.slug, questionId, ANSWER);

      expect(await questions.findWithCurrentRevision(questionId)).toEqual(
        before,
      );
      expect(await questions.countsByCertification(AWS_TRACK.id)).toEqual(
        counts,
      );
      expect(gateway.turnsTaken).toBe(1);
    });

    it("refuses to grade a question with choices", async () => {
      // Marked by comparing identifiers already, so a model call would buy nothing.
      const question = questionFixture({
        id: "question-with-choices",
        certificationId: AWS_TRACK.id,
        currentRevisionId: "revision-with-choices",
      });

      await questions.create(
        question,
        revisionFixture({
          id: question.currentRevisionId,
          questionId: question.id,
        }),
      );

      await expect(
        gradingFacade().facade.evaluateShortAnswer(
          AWS_TRACK.slug,
          question.id,
          ANSWER,
        ),
      ).rejects.toBeInstanceOf(AnswerNotGradableError);
    });

    it("refuses to grade against a question that records no concepts", async () => {
      const questionId = await seedShortAnswer(
        {
          id: "question-no-concepts",
          currentRevisionId: "revision-no-concepts",
        },
        [],
      );

      await expect(
        gradingFacade().facade.evaluateShortAnswer(
          AWS_TRACK.slug,
          questionId,
          ANSWER,
        ),
      ).rejects.toBeInstanceOf(AnswerNotGradableError);
    });

    it("refuses an empty answer, and a question from another track", async () => {
      const questionId = await seedShortAnswer();

      await expect(
        gradingFacade().facade.evaluateShortAnswer(
          AWS_TRACK.slug,
          questionId,
          "   ",
        ),
      ).rejects.toBeInstanceOf(AnswerNotGradableError);
      await expect(
        gradingFacade().facade.evaluateShortAnswer(
          HSK_TRACK.slug,
          questionId,
          ANSWER,
        ),
      ).rejects.toBeInstanceOf(AnswerNotGradableError);
      await expect(
        gradingFacade().facade.evaluateShortAnswer(
          "no-such-track",
          questionId,
          ANSWER,
        ),
      ).rejects.toBeInstanceOf(CertificationNotFoundError);
    });

    it("records a failed run rather than throwing when the grading is malformed", async () => {
      // The gateway exhausts its repair attempt and raises `ProviderFailure`; the facade
      // records the spent call and returns it, so the panel says the grading did not arrive
      // and the owner's own verdict is untouched.
      const questionId = await seedShortAnswer();
      const { facade, gateway } = gradingFacade("MALFORMED");
      const { run, evaluation, recommendedSelfGrade } =
        await facade.evaluateShortAnswer(AWS_TRACK.slug, questionId, ANSWER);

      expect(run.status).toBe("FAILED");
      expect(run.failureReason).toBe("MALFORMED_OUTPUT");
      expect(evaluation).toBeNull();
      expect(recommendedSelfGrade).toBeNull();
      expect(gateway.turnsTaken).toBe(2);
      expect((await runs.findById(run.id))?.status).toBe("FAILED");
    });

    it("grades an answer to a question at any lifecycle", async () => {
      // A question can be retired between the session that asked it and the feedback screen
      // that grades the answer, and the answer was still given.
      for (const status of [
        "DRAFT",
        "ACTIVE",
        "RETIRED",
        "ARCHIVED",
      ] as const) {
        const questionId = await seedShortAnswer({
          id: `graded-question-${status}`,
          currentRevisionId: `graded-revision-${status}`,
          lifecycleStatus: status,
        });
        const { run } = await gradingFacade().facade.evaluateShortAnswer(
          AWS_TRACK.slug,
          questionId,
          ANSWER,
        );

        expect(run.status).toBe("COMPLETED");
      }
    });

    it("fingerprints the answer without copying it", async () => {
      const questionId = await seedShortAnswer();
      const { facade } = gradingFacade();
      const first = await facade.evaluateShortAnswer(
        AWS_TRACK.slug,
        questionId,
        ANSWER,
      );
      const same = await facade.evaluateShortAnswer(
        AWS_TRACK.slug,
        questionId,
        ANSWER,
      );
      const other = await facade.evaluateShortAnswer(
        AWS_TRACK.slug,
        questionId,
        "A different answer entirely.",
      );

      expect(same.run.inputHash).toBe(first.run.inputHash);
      expect(other.run.inputHash).not.toBe(first.run.inputHash);
      // A fingerprint column must not become a copy of what the owner typed.
      expect(first.run.inputHash).not.toContain("objects");
      expect(first.run.inputHash).not.toContain("eleven");
    });
  });

  describe("challenging a question", () => {
    /** One question of the AWS track worth objecting to. */
    async function seedChallengedQuestion(
      overrides: Partial<Question> = {},
    ): Promise<string> {
      const question = questionFixture({
        id: "question-being-challenged",
        certificationId: AWS_TRACK.id,
        currentRevisionId: "revision-being-challenged",
        ...overrides,
      });

      await questions.create(
        question,
        revisionFixture({
          id: question.currentRevisionId,
          questionId: question.id,
          stem: "Which demo service stores objects?",
        }),
      );

      return question.id;
    }

    function challengeFacade(
      mode: "STANDS" | "OWNER_POINT" | "WRONG_REVISE" | "MALFORMED" = "STANDS",
    ): {
      facade: GenerationFacade;
      gateway: FakeLanguageModelGateway;
    } {
      const gateway = new FakeLanguageModelGateway({ challengeMode: mode });

      return { facade: facadeForGateway(gateway), gateway };
    }

    const OBJECTION =
      "choice-2 is also correct, because block storage is durable too";

    it("records a challenge run with its provenance and its subject", async () => {
      const questionId = await seedChallengedQuestion();
      const { run, challenge } =
        await challengeFacade().facade.challengeQuestion(
          AWS_TRACK.slug,
          questionId,
          OBJECTION,
        );

      expect(run.itemKind).toBe("QUESTION_CHALLENGE");
      expect(run.status).toBe("COMPLETED");
      expect(run.certificationId).toBe(AWS_TRACK.id);
      expect(run.generationMode).toBe("MODEL_KNOWLEDGE");
      expect(run.promptTemplateId).toBe("question-challenge");
      expect(run.promptTemplateVersion).toBe(1);
      expect(run.personaId).toBe("technical-certification");
      expect(run.inputHash).toMatch(/^[0-9a-f]{64}$/);
      expect(run.requestedItemCount).toBe(1);
      expect(run.successfulItemCount).toBe(1);
      expect(run.usageMetadata).not.toBeNull();
      expect(run.subjectQuestionId).toBe(questionId);
      expect(run.subjectRevisionId).toBe("revision-being-challenged");
      // A recommendation is not a proposal to apply: the owner's click is the action.
      expect(run.appliedAt).toBeNull();
      expect(challenge?.verdict).toBe("STORED_ANSWER_STANDS");
      expect(challenge?.recommendation).toBe("KEEP");
    });

    it("produces a structured finding, not prose", async () => {
      // The acceptance criterion (`SPEC.md` section 25.2 item 11): a verdict, an argument,
      // and a recommendation the owner can act on with one click.
      const questionId = await seedChallengedQuestion();
      const { challenge } = await challengeFacade(
        "WRONG_REVISE",
      ).facade.challengeQuestion(AWS_TRACK.slug, questionId, OBJECTION);

      expect(challenge?.verdict).toBe("STORED_ANSWER_WRONG");
      expect(challenge?.recommendation).toBe("REVISE");
      expect(challenge?.suggestedRevisionNote).not.toBeNull();
      expect(challenge?.reasoning.length).toBeGreaterThan(0);
    });

    it("sends the question and the objection as delimited data", async () => {
      const questionId = await seedChallengedQuestion();
      const { facade, gateway } = challengeFacade();

      await facade.challengeQuestion(AWS_TRACK.slug, questionId, OBJECTION);

      const prompt = gateway.promptsSent[0];

      expect(prompt?.user).toContain("<owner_question_being_challenged>");
      expect(prompt?.user).toContain("<owner_objection>");
      expect(prompt?.user).toContain(OBJECTION);
      expect(prompt?.user).toContain("Which demo service stores objects?");
      // The objection is written by somebody who wants the ruling to go their way, so it
      // may not reach the system message (`spec/AI-GUIDELINES.md` section 1.7).
      expect(prompt?.system).not.toContain(OBJECTION);
      expect(prompt?.system).not.toContain(
        "Which demo service stores objects?",
      );
    });

    it("writes nothing to the question, whatever the verdict", async () => {
      // The acceptance criterion the challenge must not break: the AI never rewrites the
      // question, and never moves its state either
      // (`spec/AI-GUIDELINES.md` section 1.10, item 12).
      for (const mode of ["STANDS", "OWNER_POINT", "WRONG_REVISE"] as const) {
        const questionId = await seedChallengedQuestion({
          id: `challenged-${mode}`,
          currentRevisionId: `challenged-revision-${mode}`,
        });
        const before = await questions.findWithCurrentRevision(questionId);

        await challengeFacade(mode).facade.challengeQuestion(
          AWS_TRACK.slug,
          questionId,
          OBJECTION,
        );

        expect(await questions.findWithCurrentRevision(questionId)).toEqual(
          before,
        );
      }
    });

    it("adds nothing to the bank and claims no items", async () => {
      const questionId = await seedChallengedQuestion();
      const counts = await questions.countsByCertification(AWS_TRACK.id);
      const { run } = await challengeFacade(
        "WRONG_REVISE",
      ).facade.challengeQuestion(AWS_TRACK.slug, questionId, OBJECTION);

      expect(await questions.countsByCertification(AWS_TRACK.id)).toEqual(
        counts,
      );
      expect(await runs.listItemIds(run.id)).toEqual([]);
    });

    it("reads the latest challenge back, with the dispute it offers", async () => {
      const questionId = await seedChallengedQuestion();
      const { facade } = challengeFacade("OWNER_POINT");
      const { run } = await facade.challengeQuestion(
        AWS_TRACK.slug,
        questionId,
        OBJECTION,
      );
      const view = await facade.findQuestionChallenge(questionId);

      expect(view?.run.id).toBe(run.id);
      expect(view?.challenge?.verdict).toBe("OWNER_HAS_A_POINT");
      expect(view?.staleRevision).toBe(false);
      // A DISPUTE recommendation on a question not yet disputed becomes the prefilled
      // button; the owner's click is what changes the question.
      expect(view?.offersDispute).toBe(true);
      expect(view?.revisionNote).toBeNull();
    });

    it("shows the revision note beside the edit form, and offers no dispute for it", async () => {
      const questionId = await seedChallengedQuestion();
      const { facade } = challengeFacade("WRONG_REVISE");

      await facade.challengeQuestion(AWS_TRACK.slug, questionId, OBJECTION);

      const view = await facade.findQuestionChallenge(questionId);

      expect(view?.revisionNote).toMatch(/the stem needs to state/);
      expect(view?.offersDispute).toBe(false);
    });

    it("stops offering a dispute once the question is disputed", async () => {
      const questionId = await seedChallengedQuestion({
        qualityStatus: "DISPUTED",
        disputeReason: "already taken out of study",
      });
      const { facade } = challengeFacade("OWNER_POINT");

      await facade.challengeQuestion(AWS_TRACK.slug, questionId, OBJECTION);

      expect(
        (await facade.findQuestionChallenge(questionId))?.offersDispute,
      ).toBe(false);
    });

    it("shows only the latest of several challenges", async () => {
      // A question objected to twice has two runs in the history and one current outcome:
      // the panel is where the verdict is useful, not where it is archived.
      const questionId = await seedChallengedQuestion();

      await challengeFacade("STANDS").facade.challengeQuestion(
        AWS_TRACK.slug,
        questionId,
        OBJECTION,
      );

      const { facade } = challengeFacade("OWNER_POINT");
      const second = await facade.challengeQuestion(
        AWS_TRACK.slug,
        questionId,
        "and here is a second, different objection",
      );

      expect((await facade.findQuestionChallenge(questionId))?.run.id).toBe(
        second.run.id,
      );
    });

    it("marks an outcome stale once the question is edited", async () => {
      const questionId = await seedChallengedQuestion();
      const { facade } = challengeFacade();

      await facade.challengeQuestion(AWS_TRACK.slug, questionId, OBJECTION);
      await questions.appendRevision(
        revisionFixture({
          id: "revision-after-the-challenge",
          questionId,
          revisionNumber: 2,
          stem: "Which demo service stores objects, revised?",
        }),
        START,
      );

      expect(
        (await facade.findQuestionChallenge(questionId))?.staleRevision,
      ).toBe(true);
    });

    it("refuses to challenge a question already out of study", async () => {
      // The review's rule rather than the tutor's: a verdict on something the owner has
      // retired changes nothing they are using.
      for (const status of ["RETIRED", "ARCHIVED"] as const) {
        const questionId = await seedChallengedQuestion({
          id: `challenge-refused-${status}`,
          currentRevisionId: `challenge-refused-revision-${status}`,
          lifecycleStatus: status,
        });

        await expect(
          challengeFacade().facade.challengeQuestion(
            AWS_TRACK.slug,
            questionId,
            OBJECTION,
          ),
        ).rejects.toBeInstanceOf(QuestionNotChallengeableError);
      }
    });

    it("refuses an empty objection, and a question from another track", async () => {
      const questionId = await seedChallengedQuestion();

      await expect(
        challengeFacade().facade.challengeQuestion(
          AWS_TRACK.slug,
          questionId,
          "   ",
        ),
      ).rejects.toBeInstanceOf(QuestionNotChallengeableError);
      await expect(
        challengeFacade().facade.challengeQuestion(
          HSK_TRACK.slug,
          questionId,
          OBJECTION,
        ),
      ).rejects.toBeInstanceOf(QuestionNotChallengeableError);
      await expect(
        challengeFacade().facade.challengeQuestion(
          "no-such-track",
          questionId,
          OBJECTION,
        ),
      ).rejects.toBeInstanceOf(CertificationNotFoundError);
    });

    it("records a failed run rather than throwing when the outcome is inconsistent", async () => {
      const questionId = await seedChallengedQuestion();
      const { facade, gateway } = challengeFacade("MALFORMED");
      const { run, challenge } = await facade.challengeQuestion(
        AWS_TRACK.slug,
        questionId,
        OBJECTION,
      );

      expect(run.status).toBe("FAILED");
      expect(run.failureReason).toBe("MALFORMED_OUTPUT");
      expect(challenge).toBeNull();
      expect(gateway.turnsTaken).toBe(2);
      // A failed challenge is not an outcome the panel shows, because only completed runs
      // are read back.
      expect(await facade.findQuestionChallenge(questionId)).toBeNull();
    });

    it("fingerprints the objection without copying it", async () => {
      const questionId = await seedChallengedQuestion();
      const { facade } = challengeFacade();
      const first = await facade.challengeQuestion(
        AWS_TRACK.slug,
        questionId,
        OBJECTION,
      );
      const same = await facade.challengeQuestion(
        AWS_TRACK.slug,
        questionId,
        OBJECTION,
      );
      const other = await facade.challengeQuestion(
        AWS_TRACK.slug,
        questionId,
        "a different objection about a different reading",
      );

      expect(same.run.inputHash).toBe(first.run.inputHash);
      expect(other.run.inputHash).not.toBe(first.run.inputHash);
      expect(first.run.inputHash).not.toContain("choice-2");
    });

    it("has nothing to show for a question never challenged", async () => {
      const questionId = await seedChallengedQuestion();

      expect(
        await challengeFacade().facade.findQuestionChallenge(questionId),
      ).toBeNull();
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
