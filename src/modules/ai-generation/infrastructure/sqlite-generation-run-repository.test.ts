import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import {
  certificationFixture,
  createMigratedDatabase,
} from "@/modules/certifications/infrastructure/test-support";
import { SqliteQuestionRepository } from "@/modules/question-bank/infrastructure/sqlite-question-repository";
import {
  questionFixture,
  revisionFixture,
} from "@/modules/question-bank/infrastructure/test-support";
import { SqliteFlashcardRepository } from "@/modules/flashcards/infrastructure/sqlite-flashcard-repository";
import {
  cardRevisionFixture,
  flashcardFixture,
} from "@/modules/flashcards/infrastructure/test-support";
import { GenerationRunNotFoundError } from "@/modules/ai-generation/domain/errors";
import { SqliteGenerationRunRepository } from "./sqlite-generation-run-repository";
import { generationRunFixture } from "./test-support";

/**
 * Repository contract for `generation_runs`, against the real schema.
 *
 * The interesting behaviour is not the round-trip but the linkage: the counts and
 * the identifier list are read from whichever bank table the run's own `itemKind`
 * names, and a run must never report the other bank's items. There is deliberately
 * no `delete` to test — a run explains where bank content came from.
 */

const TRACK = certificationFixture();
const OTHER_TRACK = certificationFixture({
  id: "certification-2",
  slug: "second-demo-track",
  name: "Second Demo Track",
});

describe("SqliteGenerationRunRepository", () => {
  let database: SqliteDatabase;
  let repository: SqliteGenerationRunRepository;
  let questions: SqliteQuestionRepository;
  let flashcards: SqliteFlashcardRepository;

  beforeEach(async () => {
    database = createMigratedDatabase();
    repository = new SqliteGenerationRunRepository(database);
    questions = new SqliteQuestionRepository(database);
    flashcards = new SqliteFlashcardRepository(database);

    const certifications = new SqliteCertificationRepository(database);

    await certifications.save(TRACK);
    await certifications.save(OTHER_TRACK);
  });

  afterEach(() => {
    database.close();
  });

  describe("round-tripping a run", () => {
    it("stores and reads back every recorded field", async () => {
      const run = generationRunFixture({
        modelProvider: "bedrock",
        modelId: "demo.model-id:0",
        personaId: "hsk",
        personaVersion: 2,
        promptTemplateId: "flashcard-model-knowledge",
        promptTemplateVersion: 3,
        itemKind: "FLASHCARD",
        requestedItemCount: 5,
      });

      await repository.create(run);

      expect(await repository.findById(run.id)).toEqual(run);
    });

    it("reads back an empty source snapshot list as an empty list", async () => {
      // D6 consults no sources, so this column is `[]` on every run it writes; a
      // reader that turned it into `null` would make the field untrustworthy in D8.
      const run = generationRunFixture();

      await repository.create(run);

      expect(
        (await repository.findById(run.id))?.selectedSourceSnapshotIds,
      ).toEqual([]);
    });

    it("has no run for an unknown identifier", async () => {
      expect(await repository.findById("run-that-never-was")).toBeNull();
    });

    it("records the outcome of a finished run", async () => {
      const run = generationRunFixture();

      await repository.create(run);

      const completed = {
        ...run,
        successfulItemCount: 2,
        failedItemCount: 1,
        usageMetadata: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
        completedAt: "2026-01-01T00:00:05.000Z",
        status: "PARTIAL" as const,
      };

      await repository.complete(completed);

      expect(await repository.findById(run.id)).toEqual(completed);
    });

    it("leaves identity and provenance untouched when a run completes", async () => {
      // `complete` writes only the outcome columns, so a caller that assembled a
      // completion from a stale run cannot silently rewrite what the run claims
      // produced it.
      const run = generationRunFixture();

      await repository.create(run);
      await repository.complete({
        ...run,
        modelId: "some-other-model",
        personaId: "some-other-persona",
        inputHash: "b".repeat(64),
        status: "COMPLETED",
        successfulItemCount: 2,
        completedAt: "2026-01-01T00:00:05.000Z",
      });

      const stored = await repository.findById(run.id);

      expect(stored?.modelId).toBe(run.modelId);
      expect(stored?.personaId).toBe(run.personaId);
      expect(stored?.inputHash).toBe(run.inputHash);
      expect(stored?.status).toBe("COMPLETED");
    });

    it("refuses to complete a run that was never created", async () => {
      await expect(
        repository.complete(generationRunFixture({ status: "COMPLETED" })),
      ).rejects.toBeInstanceOf(GenerationRunNotFoundError);
    });

    it("records a failure category and no usage", async () => {
      const run = generationRunFixture();

      await repository.create(run);
      await repository.complete({
        ...run,
        failedItemCount: 2,
        failureReason: "MODEL_ACCESS_DENIED",
        completedAt: "2026-01-01T00:00:02.000Z",
        status: "FAILED",
      });

      const stored = await repository.findById(run.id);

      expect(stored?.failureReason).toBe("MODEL_ACCESS_DENIED");
      expect(stored?.usageMetadata).toBeNull();
    });
  });

  describe("run history", () => {
    beforeEach(async () => {
      await repository.create(
        generationRunFixture({
          id: "run-1",
          startedAt: "2026-01-01T00:00:00.000Z",
        }),
      );
      await repository.create(
        generationRunFixture({
          id: "run-2",
          startedAt: "2026-01-02T00:00:00.000Z",
        }),
      );
      await repository.create(
        generationRunFixture({
          id: "run-other",
          certificationId: OTHER_TRACK.id,
          startedAt: "2026-01-03T00:00:00.000Z",
        }),
      );
    });

    it("lists one track's runs newest first with the total that matched", async () => {
      const page = await repository.list({
        certificationId: TRACK.id,
        limit: 10,
        offset: 0,
      });

      expect(page.items.map((run) => run.id)).toEqual(["run-2", "run-1"]);
      expect(page.totalCount).toBe(2);
      expect(page.limit).toBe(10);
      expect(page.offset).toBe(0);
    });

    it("pages without changing the total", async () => {
      const page = await repository.list({
        certificationId: TRACK.id,
        limit: 1,
        offset: 1,
      });

      expect(page.items.map((run) => run.id)).toEqual(["run-1"]);
      expect(page.totalCount).toBe(2);
    });

    it("breaks a tie on the identifier so paging is deterministic", async () => {
      await repository.create(
        generationRunFixture({
          id: "run-3",
          startedAt: "2026-01-02T00:00:00.000Z",
        }),
      );

      const page = await repository.list({
        certificationId: TRACK.id,
        limit: 10,
        offset: 0,
      });

      expect(page.items.map((run) => run.id)).toEqual([
        "run-3",
        "run-2",
        "run-1",
      ]);
    });

    it("is empty for a track with no runs", async () => {
      const page = await repository.list({
        certificationId: "certification-with-no-runs",
        limit: 10,
        offset: 0,
      });

      expect(page.items).toEqual([]);
      expect(page.totalCount).toBe(0);
    });
  });

  describe("finding an equivalent earlier batch", () => {
    const HASH = "c".repeat(64);

    /**
     * A finished run, as the schema insists one looks.
     *
     * The table checks that `status = 'PENDING'` exactly when `completed_at` is null,
     * so a finished run must carry a completion time; these tests write finished runs
     * directly rather than through the facade, so they honour that here.
     */
    function finished(
      overrides: Partial<Parameters<typeof generationRunFixture>[0]> = {},
    ) {
      return generationRunFixture({
        inputHash: HASH,
        successfulItemCount: 2,
        completedAt: "2026-01-05T00:00:00.000Z",
        status: "COMPLETED",
        ...overrides,
      });
    }

    it("finds the most recent run with the same fingerprint", async () => {
      await repository.create(
        finished({ id: "run-old", startedAt: "2026-01-01T00:00:00.000Z" }),
      );
      await repository.create(
        finished({ id: "run-new", startedAt: "2026-01-02T00:00:00.000Z" }),
      );

      const found = await repository.findLatestByInputHash(
        TRACK.id,
        HASH,
        "QUESTION",
      );

      expect(found?.id).toBe("run-new");
    });

    it("counts a partial run, which did produce content", async () => {
      await repository.create(
        finished({
          id: "run-partial",
          successfulItemCount: 1,
          failedItemCount: 1,
          status: "PARTIAL",
        }),
      );

      expect(
        (await repository.findLatestByInputHash(TRACK.id, HASH, "QUESTION"))
          ?.id,
      ).toBe("run-partial");
    });

    it("ignores a failed or still-pending run, which produced nothing", async () => {
      await repository.create(
        finished({
          id: "run-failed",
          successfulItemCount: 0,
          failedItemCount: 2,
          failureReason: "TIMED_OUT",
          status: "FAILED",
        }),
      );
      await repository.create(
        generationRunFixture({ id: "run-pending", inputHash: HASH }),
      );

      expect(
        await repository.findLatestByInputHash(TRACK.id, HASH, "QUESTION"),
      ).toBeNull();
    });

    it("does not match another track, another kind, or another fingerprint", async () => {
      await repository.create(
        finished({ id: "run-match", successfulItemCount: 1 }),
      );

      expect(
        await repository.findLatestByInputHash(
          OTHER_TRACK.id,
          HASH,
          "QUESTION",
        ),
      ).toBeNull();
      expect(
        await repository.findLatestByInputHash(TRACK.id, HASH, "FLASHCARD"),
      ).toBeNull();
      expect(
        await repository.findLatestByInputHash(
          TRACK.id,
          "d".repeat(64),
          "QUESTION",
        ),
      ).toBeNull();
    });
  });

  describe("the items a run produced", () => {
    /** Creates a question attributed to `runId`, in the given lifecycle state. */
    async function createQuestion(
      id: string,
      runId: string | null,
      lifecycleStatus: "DRAFT" | "ACTIVE" = "DRAFT",
      createdAt = "2026-01-01T00:00:00.000Z",
    ): Promise<void> {
      await questions.create(
        questionFixture({
          id,
          currentRevisionId: `${id}-revision`,
          lifecycleStatus,
          generationMode: runId === null ? "MANUAL" : "MODEL_KNOWLEDGE",
          generationRunId: runId,
          createdAt,
          updatedAt: createdAt,
        }),
        revisionFixture({
          id: `${id}-revision`,
          questionId: id,
          createdAt,
        }),
      );
    }

    async function createCard(id: string, runId: string | null): Promise<void> {
      await flashcards.create(
        flashcardFixture({
          id,
          currentRevisionId: `${id}-revision`,
          generationMode: runId === null ? "MANUAL" : "MODEL_KNOWLEDGE",
          generationRunId: runId,
        }),
        cardRevisionFixture({ id: `${id}-revision`, flashcardId: id }),
      );
    }

    beforeEach(async () => {
      await repository.create(generationRunFixture({ id: "run-1" }));
      await repository.create(
        generationRunFixture({ id: "run-cards", itemKind: "FLASHCARD" }),
      );
    });

    it("counts the run's items by lifecycle state", async () => {
      await createQuestion("question-draft", "run-1");
      await createQuestion("question-active", "run-1", "ACTIVE");
      await createQuestion("question-manual", null);

      expect(await repository.countItems("run-1")).toEqual({
        total: 2,
        draft: 1,
        active: 1,
      });
    });

    it("counts nothing for a run whose items are all gone", async () => {
      expect(await repository.countItems("run-1")).toEqual({
        total: 0,
        draft: 0,
        active: 0,
      });
    });

    it("lists the run's item identifiers oldest first", async () => {
      await createQuestion(
        "question-second",
        "run-1",
        "DRAFT",
        "2026-01-01T00:00:02.000Z",
      );
      await createQuestion(
        "question-first",
        "run-1",
        "DRAFT",
        "2026-01-01T00:00:01.000Z",
      );

      expect(await repository.listItemIds("run-1")).toEqual([
        "question-first",
        "question-second",
      ]);
    });

    it("reads the bank its own item kind names, never the other one", async () => {
      // A question run with a card that claims it — impossible through the facade,
      // but the guarantee is that the run reads `questions` because that is what its
      // `itemKind` says.
      await createQuestion("question-of-run-1", "run-1");
      await createCard("card-of-run-1", "run-1");

      expect(await repository.listItemIds("run-1")).toEqual([
        "question-of-run-1",
      ]);
      expect((await repository.countItems("run-1")).total).toBe(1);
    });

    it("reads the flashcard bank for a flashcard run", async () => {
      await createCard("card-of-cards-run", "run-cards");

      expect(await repository.listItemIds("run-cards")).toEqual([
        "card-of-cards-run",
      ]);
      expect(await repository.countItems("run-cards")).toEqual({
        total: 1,
        draft: 1,
        active: 0,
      });
    });

    it("refuses to count or list the items of a run that does not exist", async () => {
      await expect(
        repository.countItems("run-that-never-was"),
      ).rejects.toBeInstanceOf(GenerationRunNotFoundError);
      await expect(
        repository.listItemIds("run-that-never-was"),
      ).rejects.toBeInstanceOf(GenerationRunNotFoundError);
    });

    it("keeps the item when the run it points at is gone from the reader's view", async () => {
      // The provenance column is `ON DELETE SET NULL`, so a question survives a run
      // it can no longer name. Runs are never deleted, but the schema says what
      // happens if one ever were, and the bank must not lose content.
      await createQuestion("question-orphan", "run-1");

      database.prepare("DELETE FROM generation_runs WHERE id = ?").run("run-1");

      const stored = await questions.findById("question-orphan");

      expect(stored).not.toBeNull();
      expect(stored?.generationRunId).toBeNull();
      expect(stored?.generationMode).toBe("MODEL_KNOWLEDGE");
    });
  });
});
