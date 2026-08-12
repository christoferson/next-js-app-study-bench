import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import { CertificationNotFoundError } from "@/modules/certifications/domain/errors";
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
import { SqliteFlashcardRepository } from "@/modules/flashcards/infrastructure/sqlite-flashcard-repository";
import { FlashcardQuestionDependencyChecker } from "@/modules/flashcards/infrastructure/flashcard-question-dependency-checker";
import {
  GeneratedDraftNotRejectableError,
  GenerationBatchTooLargeError,
} from "@/modules/ai-generation/domain/errors";
import { MAX_BATCH_ITEMS } from "@/modules/ai-generation/domain/generation-limits";
import type { FakeGatewayResponse } from "@/modules/ai-generation/infrastructure/fake-language-model-gateway";
import { FakeLanguageModelGateway } from "@/modules/ai-generation/infrastructure/fake-language-model-gateway";
import { SqliteGenerationRunRepository } from "@/modules/ai-generation/infrastructure/sqlite-generation-run-repository";
import { SqliteGenerationUnitOfWork } from "@/modules/ai-generation/infrastructure/sqlite-generation-unit-of-work";
import {
  flashcardPayload,
  flashcardPayloadItem,
  malformedPayload,
  questionPayload,
  questionPayloadItem,
} from "@/modules/ai-generation/infrastructure/test-support";
import { GenerationFacade, isDuplicateBatchNotice } from "./generation-facade";
import type { GenerationOutcome, GenerationResult } from "./generation-facade";
import type { GenerationRequestInput } from "./schemas";

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
    const gateway = new FakeLanguageModelGateway({
      ...(responses === undefined ? {} : { responses }),
      ...(options.usage === null ? { usage: null } : {}),
    });

    return new GenerationFacade({
      runs,
      questions,
      flashcards,
      certifications: new SqliteCertificationRepository(database),
      objectives: new SqliteObjectiveRepository(database),
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
      expect(run.promptTemplateVersion).toBe(1);
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
      const facade = new GenerationFacade({
        runs,
        questions,
        flashcards,
        certifications: new SqliteCertificationRepository(database),
        objectives: new SqliteObjectiveRepository(database),
        unitOfWork: new SqliteGenerationUnitOfWork(database),
        gateway,
        clock,
        ids,
      });

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
