import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import {
  CyclicObjectiveParentError,
  InvalidParentObjectiveError,
  ObjectiveNotFoundError,
  SlugConflictError,
} from "@/modules/certifications/domain/errors";
import type { ObjectiveTreeNode } from "@/modules/certifications/domain/objective";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import { SqliteUnitOfWork } from "@/modules/certifications/infrastructure/sqlite-unit-of-work";
import {
  FixedClock,
  SequentialIdGenerator,
  createMigratedDatabase,
} from "@/modules/certifications/infrastructure/test-support";
import { CertificationFacade } from "./certification-facade";
import type { CertificationInput, ObjectiveInput } from "./schemas";

/**
 * Facade behaviour over the real SQLite adapter.
 *
 * Each test gets a fresh in-memory database plus an injected clock and ID
 * generator, so results are deterministic and order-independent.
 */

const CERTIFICATION_INPUT: CertificationInput = {
  name: "Demo Cloud Practitioner",
  provider: "Demo Provider",
  examCode: "DEMO-001",
  version: null,
  studyType: "TECHNICAL_CERTIFICATION",
  description: "Fictional track used only by the test suite.",
  targetDate: null,
  priority: 3,
  defaultSessionMinutes: 20,
};

function objectiveInput(
  overrides: Partial<ObjectiveInput> = {},
): ObjectiveInput {
  return {
    parentObjectiveId: null,
    code: null,
    title: "Demo objective",
    description: null,
    weight: null,
    sourceType: "USER_DEFINED",
    ...overrides,
  };
}

/** Flattens the tree into `id` order for compact ordering assertions. */
function flatten(nodes: readonly ObjectiveTreeNode[]): readonly string[] {
  return nodes.flatMap((node) => [
    node.objective.title,
    ...flatten(node.children),
  ]);
}

/**
 * Raw schema-shaped rows covering every table that hangs off a certification,
 * including every RESTRICT edge: a question with a revision, link, and attempt;
 * a flashcard with a revision, review, and schedule; a session including the
 * track with one item of each kind; and a generation run. Raw SQL rather than
 * the other modules' facades, because this module must not depend on them and
 * a purge regression should fail here, not in a cross-module import.
 */
function seedDependentRows(
  database: SqliteDatabase,
  certificationId: string,
  objectiveId: string,
): void {
  const now = "2026-08-14T00:00:00.000Z";
  const run = (sql: string, params: unknown[]): void => {
    database.prepare(sql).run(...params);
  };

  run(
    `INSERT INTO generation_runs (id, certification_id, item_kind, generation_mode,
       model_provider, model_id, persona_id, persona_version, prompt_template_id,
       prompt_template_version, input_hash, selected_source_snapshot_ids,
       requested_item_count, successful_item_count, failed_item_count, started_at,
       completed_at, status)
     VALUES ('run-1', ?, 'QUESTION', 'MODEL_KNOWLEDGE', 'fake', 'model', 'technical-certification',
       1, 'question-model-knowledge', 1, 'hash', '[]', 1, 1, 0, ?, ?, 'COMPLETED')`,
    [certificationId, now, now],
  );
  run(
    `INSERT INTO questions (id, certification_id, lifecycle_status, quality_status,
       generation_mode, created_at, updated_at)
     VALUES ('q-1', ?, 'ACTIVE', 'UNREVIEWED', 'MANUAL', ?, ?)`,
    [certificationId, now, now],
  );
  run(
    `INSERT INTO question_revisions (id, question_id, revision_number, stem,
       question_type, content_payload, tags, created_at)
     VALUES ('qr-1', 'q-1', 1, 'Doomed stem?', 'SHORT_ANSWER',
       '{"type":"SHORT_ANSWER","expectedConcepts":["x"]}', '[]', ?)`,
    [now],
  );
  run(`UPDATE questions SET current_revision_id = 'qr-1' WHERE id = 'q-1'`, []);
  run(
    `INSERT INTO question_objective_links (question_id, objective_id, created_at)
     VALUES ('q-1', ?, ?)`,
    [objectiveId, now],
  );
  run(
    `INSERT INTO flashcards (id, certification_id, lifecycle_status, created_at, updated_at)
     VALUES ('f-1', ?, 'ACTIVE', ?, ?)`,
    [certificationId, now, now],
  );
  run(
    `INSERT INTO flashcard_revisions (id, flashcard_id, revision_number, card_type,
       content_payload, search_text, tags, created_at)
     VALUES ('fr-1', 'f-1', 1, 'BASIC', '{"type":"BASIC","front":"A","back":"B"}', 'a b', '[]', ?)`,
    [now],
  );
  run(
    `UPDATE flashcards SET current_revision_id = 'fr-1' WHERE id = 'f-1'`,
    [],
  );
  run(
    `INSERT INTO flashcard_reviews (id, flashcard_id, flashcard_revision_id, rating,
       reviewed_at, interval_minutes, due_at, scheduler_id)
     VALUES ('rev-1', 'f-1', 'fr-1', 'GOOD', ?, 4320, ?, 'deterministic-v1')`,
    [now, now],
  );
  run(
    `INSERT INTO review_schedules (flashcard_id, interval_minutes, due_at, lapse_count,
       review_count, last_reviewed_at, scheduler_id, updated_at)
     VALUES ('f-1', 4320, ?, 0, 1, ?, 'deterministic-v1', ?)`,
    [now, now, now],
  );
  run(
    `INSERT INTO study_sessions (id, mode, status, target_minutes, created_at)
     VALUES ('s-1', 'SINGLE_TRACK', 'COMPLETED', 10, ?)`,
    [now],
  );
  run(
    `INSERT INTO session_certifications (session_id, certification_id)
     VALUES ('s-1', ?)`,
    [certificationId],
  );
  run(
    `INSERT INTO study_session_items (id, session_id, position, item_type, status,
       question_id, question_revision_id)
     VALUES ('si-1', 's-1', 1, 'QUESTION', 'COMPLETED', 'q-1', 'qr-1')`,
    [],
  );
  run(
    `INSERT INTO study_session_items (id, session_id, position, item_type, status,
       flashcard_id, flashcard_revision_id)
     VALUES ('si-2', 's-1', 2, 'FLASHCARD', 'COMPLETED', 'f-1', 'fr-1')`,
    [],
  );
  run(
    `INSERT INTO question_attempts (id, session_id, question_id, question_revision_id,
       submitted_answer, is_correct, confidence, attempted_at, evaluation_mode)
     VALUES ('a-1', 's-1', 'q-1', 'qr-1', '{"type":"SHORT_ANSWER","text":"x"}', 1,
       'CONFIDENT', ?, 'SELF_ASSESSED')`,
    [now],
  );
}

describe("CertificationFacade", () => {
  let database: SqliteDatabase;
  let clock: FixedClock;
  let facade: CertificationFacade;

  beforeEach(() => {
    database = createMigratedDatabase();
    clock = new FixedClock();
    facade = new CertificationFacade({
      certifications: new SqliteCertificationRepository(database),
      objectives: new SqliteObjectiveRepository(database),
      unitOfWork: new SqliteUnitOfWork(database),
      clock,
      ids: new SequentialIdGenerator(),
    });
  });

  afterEach(() => {
    database.close();
  });

  describe("creating a certification", () => {
    it("derives a slug from the name and stores the record", async () => {
      const created = await facade.createCertification(CERTIFICATION_INPUT);

      expect(created.slug).toBe("demo-cloud-practitioner");
      expect(created.status).toBe("ACTIVE");
      expect(created.origin).toBe("OWNER");
      expect(created.createdAt).toBe("2026-01-01T00:00:00.000Z");

      const view = await facade.findDetailBySlug("demo-cloud-practitioner");
      expect(view?.certification).toEqual(created);
    });

    it("disambiguates a duplicate name with a slug suffix", async () => {
      await facade.createCertification(CERTIFICATION_INPUT);
      const second = await facade.createCertification(CERTIFICATION_INPUT);
      const third = await facade.createCertification(CERTIFICATION_INPUT);

      expect(second.slug).toBe("demo-cloud-practitioner-2");
      expect(third.slug).toBe("demo-cloud-practitioner-3");
    });

    it("never claims a slug reserved by a static route", async () => {
      const created = await facade.createCertification({
        ...CERTIFICATION_INPUT,
        name: "New",
      });

      expect(created.slug).toBe("new-2");
    });

    it("reports a slug conflict once the bounded retry is exhausted", async () => {
      for (let index = 0; index < 25; index += 1) {
        await facade.createCertification(CERTIFICATION_INPUT);
      }

      await expect(
        facade.createCertification(CERTIFICATION_INPUT),
      ).rejects.toBeInstanceOf(SlugConflictError);
    });

    it("marks seeded content with the demo origin", async () => {
      const created = await facade.createCertification(
        CERTIFICATION_INPUT,
        "DEMO",
      );

      expect(created.origin).toBe("DEMO");
    });
  });

  describe("updating a certification", () => {
    it("keeps the slug stable when the name changes", async () => {
      const created = await facade.createCertification(CERTIFICATION_INPUT);
      clock.set("2026-02-01T00:00:00.000Z");

      const updated = await facade.updateCertification(created.id, {
        ...CERTIFICATION_INPUT,
        name: "Completely Different Name",
        priority: 1,
      });

      expect(updated.slug).toBe("demo-cloud-practitioner");
      expect(updated.name).toBe("Completely Different Name");
      expect(updated.priority).toBe(1);
      expect(updated.createdAt).toBe("2026-01-01T00:00:00.000Z");
      expect(updated.updatedAt).toBe("2026-02-01T00:00:00.000Z");
    });
  });

  describe("listing certifications", () => {
    it("hides archived tracks by default and reports how many exist", async () => {
      const kept = await facade.createCertification(CERTIFICATION_INPUT);
      const archived = await facade.createCertification({
        ...CERTIFICATION_INPUT,
        name: "Archived Track",
      });
      await facade.archiveCertification(archived.id);

      const hidden = await facade.listCertifications({
        includeArchived: false,
      });

      expect(hidden.active.map((entry) => entry.id)).toEqual([kept.id]);
      expect(hidden.archived).toEqual([]);
      expect(hidden.archivedCount).toBe(1);
    });

    it("reveals archived tracks on request", async () => {
      const archived = await facade.createCertification(CERTIFICATION_INPUT);
      await facade.archiveCertification(archived.id);

      const revealed = await facade.listCertifications({
        includeArchived: true,
      });

      expect(revealed.archived.map((entry) => entry.id)).toEqual([archived.id]);
      expect(revealed.active).toEqual([]);
    });

    it("restores an archived track to the active list", async () => {
      const track = await facade.createCertification(CERTIFICATION_INPUT);
      await facade.archiveCertification(track.id);

      const restored = await facade.restoreCertification(track.id);

      expect(restored.status).toBe("ACTIVE");
      await expect(
        facade.listCertifications({ includeArchived: false }),
      ).resolves.toMatchObject({ archivedCount: 0 });
    });

    it("returns null for an unknown slug", async () => {
      await expect(
        facade.findDetailBySlug("no-such-track"),
      ).resolves.toBeNull();
    });
  });

  describe("deleting a certification", () => {
    it("refuses to delete a track that is not archived", async () => {
      const track = await facade.createCertification(CERTIFICATION_INPUT);

      await expect(facade.deleteCertification(track.id)).rejects.toThrow(
        /archived/i,
      );
      await expect(facade.findDetailBySlug(track.slug)).resolves.not.toBeNull();
    });

    it("purges an archived track with every dependent record", async () => {
      const track = await facade.createCertification(CERTIFICATION_INPUT);
      const objective = await facade.addObjective(
        track.id,
        objectiveInput({ title: "Doomed objective" }),
      );
      // Dependent rows straight into the schema: a question with a revision and
      // an objective link, a flashcard with a revision, review, and schedule, a
      // session that included the track with an item and an attempt, and a
      // generation run. Every RESTRICT edge in the schema is represented, so
      // this test fails if the purge order ever regresses.
      seedDependentRows(database, track.id, objective.id);
      await facade.archiveCertification(track.id);

      await facade.deleteCertification(track.id);

      await expect(facade.findDetailBySlug(track.slug)).resolves.toBeNull();
      for (const table of [
        "certifications",
        "certification_objectives",
        "questions",
        "question_revisions",
        "question_objective_links",
        "flashcards",
        "flashcard_revisions",
        "flashcard_reviews",
        "review_schedules",
        "study_sessions",
        "study_session_items",
        "question_attempts",
        "session_certifications",
        "generation_runs",
      ]) {
        const row = database
          .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
          .get() as { n: number };

        expect(`${table}:${row.n}`).toBe(`${table}:0`);
      }
    });

    it("leaves other tracks and their content untouched", async () => {
      const doomed = await facade.createCertification(CERTIFICATION_INPUT);
      const kept = await facade.createCertification({
        ...CERTIFICATION_INPUT,
        name: "Kept Track",
      });
      const keptObjective = await facade.addObjective(
        kept.id,
        objectiveInput({ title: "Kept objective" }),
      );
      await facade.archiveCertification(doomed.id);

      await facade.deleteCertification(doomed.id);

      await expect(facade.findDetailBySlug(kept.slug)).resolves.not.toBeNull();
      const objectives = database
        .prepare(
          `SELECT COUNT(*) AS n FROM certification_objectives WHERE id = ?`,
        )
        .get(keptObjective.id) as { n: number };

      expect(objectives.n).toBe(1);
    });
  });

  describe("adding objectives", () => {
    it("appends root objectives in submission order", async () => {
      const track = await facade.createCertification(CERTIFICATION_INPUT);

      await facade.addObjective(track.id, objectiveInput({ title: "First" }));
      await facade.addObjective(track.id, objectiveInput({ title: "Second" }));

      const view = await facade.findDetailBySlug(track.slug);
      expect(flatten(view?.objectiveTree ?? [])).toEqual(["First", "Second"]);
      expect(
        view?.objectiveTree.map((node) => node.objective.displayOrder),
      ).toEqual([1, 2]);
    });

    it("nests a child under its parent", async () => {
      const track = await facade.createCertification(CERTIFICATION_INPUT);
      const root = await facade.addObjective(
        track.id,
        objectiveInput({ title: "Root" }),
      );

      await facade.addObjective(
        track.id,
        objectiveInput({ title: "Child", parentObjectiveId: root.id }),
      );

      const view = await facade.findDetailBySlug(track.slug);
      expect(flatten(view?.objectiveTree ?? [])).toEqual(["Root", "Child"]);
    });

    it("rejects a parent that does not exist", async () => {
      const track = await facade.createCertification(CERTIFICATION_INPUT);

      await expect(
        facade.addObjective(
          track.id,
          objectiveInput({ parentObjectiveId: "no-such-objective" }),
        ),
      ).rejects.toBeInstanceOf(InvalidParentObjectiveError);
    });

    it("rejects a parent belonging to another certification", async () => {
      const first = await facade.createCertification(CERTIFICATION_INPUT);
      const second = await facade.createCertification({
        ...CERTIFICATION_INPUT,
        name: "Other Track",
      });
      const foreign = await facade.addObjective(first.id, objectiveInput());

      await expect(
        facade.addObjective(
          second.id,
          objectiveInput({ parentObjectiveId: foreign.id }),
        ),
      ).rejects.toBeInstanceOf(InvalidParentObjectiveError);
    });

    it("persists nothing when the parent is rejected", async () => {
      const track = await facade.createCertification(CERTIFICATION_INPUT);

      await expect(
        facade.addObjective(
          track.id,
          objectiveInput({ parentObjectiveId: "absent" }),
        ),
      ).rejects.toBeInstanceOf(InvalidParentObjectiveError);

      const view = await facade.findDetailBySlug(track.slug);
      expect(view?.objectiveTree).toEqual([]);
    });
  });

  describe("editing objectives", () => {
    it("moves an objective under a new parent and appends it there", async () => {
      const track = await facade.createCertification(CERTIFICATION_INPUT);
      const first = await facade.addObjective(
        track.id,
        objectiveInput({ title: "First root" }),
      );
      const second = await facade.addObjective(
        track.id,
        objectiveInput({ title: "Second root" }),
      );
      const third = await facade.addObjective(
        track.id,
        objectiveInput({ title: "Third root" }),
      );

      const moved = await facade.updateObjective(
        second.id,
        objectiveInput({
          title: "Second root",
          parentObjectiveId: first.id,
        }),
      );

      expect(moved.parentObjectiveId).toBe(first.id);
      expect(moved.displayOrder).toBe(1);

      const view = await facade.findDetailBySlug(track.slug);
      expect(flatten(view?.objectiveTree ?? [])).toEqual([
        "First root",
        "Second root",
        "Third root",
      ]);
      // The vacated root group is renumbered contiguously.
      expect(
        view?.objectiveTree.map((node) => [
          node.objective.id,
          node.objective.displayOrder,
        ]),
      ).toEqual([
        [first.id, 1],
        [third.id, 2],
      ]);
    });

    it("rejects moving an objective under itself", async () => {
      const track = await facade.createCertification(CERTIFICATION_INPUT);
      const objective = await facade.addObjective(track.id, objectiveInput());

      await expect(
        facade.updateObjective(
          objective.id,
          objectiveInput({ parentObjectiveId: objective.id }),
        ),
      ).rejects.toBeInstanceOf(CyclicObjectiveParentError);
    });

    it("rejects moving an objective under its own descendant", async () => {
      const track = await facade.createCertification(CERTIFICATION_INPUT);
      const root = await facade.addObjective(
        track.id,
        objectiveInput({ title: "Root" }),
      );
      const child = await facade.addObjective(
        track.id,
        objectiveInput({ title: "Child", parentObjectiveId: root.id }),
      );
      const grandchild = await facade.addObjective(
        track.id,
        objectiveInput({ title: "Grandchild", parentObjectiveId: child.id }),
      );

      await expect(
        facade.updateObjective(
          root.id,
          objectiveInput({
            title: "Root",
            parentObjectiveId: grandchild.id,
          }),
        ),
      ).rejects.toBeInstanceOf(CyclicObjectiveParentError);

      const view = await facade.findDetailBySlug(track.slug);
      expect(flatten(view?.objectiveTree ?? [])).toEqual([
        "Root",
        "Child",
        "Grandchild",
      ]);
    });

    it("edits fields without changing the parent", async () => {
      const track = await facade.createCertification(CERTIFICATION_INPUT);
      const objective = await facade.addObjective(track.id, objectiveInput());
      clock.set("2026-03-01T00:00:00.000Z");

      const updated = await facade.updateObjective(
        objective.id,
        objectiveInput({
          title: "Renamed objective",
          code: "Domain 9",
          weight: 30,
          sourceType: "OFFICIAL",
        }),
      );

      expect(updated).toMatchObject({
        title: "Renamed objective",
        code: "Domain 9",
        weight: 30,
        sourceType: "OFFICIAL",
        displayOrder: 1,
        updatedAt: "2026-03-01T00:00:00.000Z",
      });
    });

    it("rejects editing an objective that does not exist", async () => {
      await expect(
        facade.updateObjective("no-such-objective", objectiveInput()),
      ).rejects.toBeInstanceOf(ObjectiveNotFoundError);
    });
  });

  describe("reordering siblings", () => {
    it("moves an objective up among its siblings", async () => {
      const track = await facade.createCertification(CERTIFICATION_INPUT);
      await facade.addObjective(track.id, objectiveInput({ title: "A" }));
      const b = await facade.addObjective(
        track.id,
        objectiveInput({ title: "B" }),
      );

      await facade.moveObjective(b.id, "UP");

      const view = await facade.findDetailBySlug(track.slug);
      expect(flatten(view?.objectiveTree ?? [])).toEqual(["B", "A"]);
      expect(
        view?.objectiveTree.map((node) => node.objective.displayOrder),
      ).toEqual([1, 2]);
    });

    it("moves an objective down among its siblings", async () => {
      const track = await facade.createCertification(CERTIFICATION_INPUT);
      const a = await facade.addObjective(
        track.id,
        objectiveInput({ title: "A" }),
      );
      await facade.addObjective(track.id, objectiveInput({ title: "B" }));
      await facade.addObjective(track.id, objectiveInput({ title: "C" }));

      await facade.moveObjective(a.id, "DOWN");

      const view = await facade.findDetailBySlug(track.slug);
      expect(flatten(view?.objectiveTree ?? [])).toEqual(["B", "A", "C"]);
    });

    it("leaves the order unchanged at the start of the sibling group", async () => {
      const track = await facade.createCertification(CERTIFICATION_INPUT);
      const a = await facade.addObjective(
        track.id,
        objectiveInput({ title: "A" }),
      );
      await facade.addObjective(track.id, objectiveInput({ title: "B" }));

      await facade.moveObjective(a.id, "UP");

      const view = await facade.findDetailBySlug(track.slug);
      expect(flatten(view?.objectiveTree ?? [])).toEqual(["A", "B"]);
    });

    it("reorders only within one parent group", async () => {
      const track = await facade.createCertification(CERTIFICATION_INPUT);
      const root = await facade.addObjective(
        track.id,
        objectiveInput({ title: "Root" }),
      );
      await facade.addObjective(
        track.id,
        objectiveInput({ title: "Child A", parentObjectiveId: root.id }),
      );
      const childB = await facade.addObjective(
        track.id,
        objectiveInput({ title: "Child B", parentObjectiveId: root.id }),
      );
      await facade.addObjective(
        track.id,
        objectiveInput({ title: "Other root" }),
      );

      await facade.moveObjective(childB.id, "UP");

      const view = await facade.findDetailBySlug(track.slug);
      expect(flatten(view?.objectiveTree ?? [])).toEqual([
        "Root",
        "Child B",
        "Child A",
        "Other root",
      ]);
    });

    it("rejects moving an objective that does not exist", async () => {
      await expect(
        facade.moveObjective("no-such-objective", "UP"),
      ).rejects.toBeInstanceOf(ObjectiveNotFoundError);
    });
  });

  describe("archiving objectives", () => {
    it("keeps an archived objective in the tree, labelled", async () => {
      const track = await facade.createCertification(CERTIFICATION_INPUT);
      const objective = await facade.addObjective(track.id, objectiveInput());

      await facade.archiveObjective(objective.id);

      const view = await facade.findDetailBySlug(track.slug);
      expect(view?.activeObjectiveCount).toBe(0);
      expect(view?.archivedObjectiveCount).toBe(1);
      expect(view?.objectiveTree[0]?.objective.status).toBe("ARCHIVED");
    });

    it("restores an archived objective", async () => {
      const track = await facade.createCertification(CERTIFICATION_INPUT);
      const objective = await facade.addObjective(track.id, objectiveInput());
      await facade.archiveObjective(objective.id);

      await facade.restoreObjective(objective.id);

      const view = await facade.findDetailBySlug(track.slug);
      expect(view?.activeObjectiveCount).toBe(1);
      expect(view?.archivedObjectiveCount).toBe(0);
    });
  });

  describe("objective form views", () => {
    it("offers only valid parents when editing", async () => {
      const track = await facade.createCertification(CERTIFICATION_INPUT);
      const root = await facade.addObjective(
        track.id,
        objectiveInput({ title: "Root" }),
      );
      await facade.addObjective(
        track.id,
        objectiveInput({ title: "Child", parentObjectiveId: root.id }),
      );
      const other = await facade.addObjective(
        track.id,
        objectiveInput({ title: "Other" }),
      );

      const view = await facade.findObjectiveForm(track.slug, root.id);

      expect(view?.parentCandidates.map((entry) => entry.id)).toEqual([
        other.id,
      ]);
    });

    it("returns null for an objective outside the track", async () => {
      const track = await facade.createCertification(CERTIFICATION_INPUT);

      await expect(
        facade.findObjectiveForm(track.slug, "no-such-objective"),
      ).resolves.toBeNull();
    });

    it("rejects a new-objective form with an invalid parent", async () => {
      const track = await facade.createCertification(CERTIFICATION_INPUT);

      await expect(
        facade.findNewObjectiveForm(track.slug, "no-such-objective"),
      ).rejects.toBeInstanceOf(InvalidParentObjectiveError);
    });

    it("returns null for a new-objective form on an unknown track", async () => {
      await expect(
        facade.findNewObjectiveForm("no-such-track", null),
      ).resolves.toBeNull();
    });
  });
});
