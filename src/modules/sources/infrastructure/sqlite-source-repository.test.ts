import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import {
  certificationFixture,
  createMigratedDatabase,
  objectiveFixture,
} from "@/modules/certifications/infrastructure/test-support";
import { SqliteSourceRepository } from "./sqlite-source-repository";
import { chunkFixture, snapshotFixture, sourceFixture } from "./test-support";

/**
 * Repository contract for the source library, against the real migrated schema.
 *
 * Two properties are what these cases exist for, because the rest of the module is built
 * on them:
 *
 * 1. **Snapshots and chunks are append-only.** There is no update method to test, so the
 *    tests assert the absence — both structurally, on the class, and behaviourally, by
 *    showing that a second snapshot of identical content is refused by the unique index
 *    rather than silently replacing the first.
 * 2. **A track sees only its own sources.** Every list method is keyed by an owner, and a
 *    second track is seeded in every case so "returns one row" cannot pass by accident.
 *
 * Foreign keys are on (`openSqliteDatabase` sets the pragma), so the certification and
 * objective parents are inserted through their own repositories rather than raw SQL.
 */

const TRACK = certificationFixture();
const OTHER_TRACK = certificationFixture({
  id: "certification-2",
  slug: "second-demo-track",
  name: "Second Demo Track",
  examCode: "DEMO-002",
});

const OBJECTIVE = objectiveFixture({
  id: "objective-1",
  certificationId: TRACK.id,
  displayOrder: 1,
});
const SECOND_OBJECTIVE = objectiveFixture({
  id: "objective-2",
  certificationId: TRACK.id,
  code: "Demo domain 2",
  displayOrder: 2,
});
const OTHER_TRACK_OBJECTIVE = objectiveFixture({
  id: "objective-9",
  certificationId: OTHER_TRACK.id,
  code: "Other domain 1",
  displayOrder: 1,
});

/** A 64-character sha256-shaped hash, distinct per label. */
function hashOf(label: string): string {
  return label.repeat(64).slice(0, 64);
}

describe("SqliteSourceRepository", () => {
  let database: SqliteDatabase;
  let repository: SqliteSourceRepository;

  beforeEach(async () => {
    database = createMigratedDatabase();
    repository = new SqliteSourceRepository(database);

    const certifications = new SqliteCertificationRepository(database);
    const objectives = new SqliteObjectiveRepository(database);

    await certifications.save(TRACK);
    await certifications.save(OTHER_TRACK);
    await objectives.save(OBJECTIVE);
    await objectives.save(SECOND_OBJECTIVE);
    await objectives.save(OTHER_TRACK_OBJECTIVE);
  });

  afterEach(() => {
    database.close();
  });

  describe("round-tripping a source", () => {
    it("stores and reads back every field of a pasted source", async () => {
      // `originalLocation` is null here, which is the whole reason a paste cannot be
      // refreshed: there is nowhere to read it again.
      const source = sourceFixture({
        id: "source-1",
        certificationId: TRACK.id,
        title: "Fictional exam guide",
        sourceType: "PASTED_TEXT",
        authority: "OFFICIAL",
        originalLocation: null,
      });

      await repository.saveSource(source);

      await expect(repository.findById(source.id)).resolves.toEqual(source);
    });

    it("stores and reads back a web source's address", async () => {
      const source = sourceFixture({
        id: "source-web",
        certificationId: TRACK.id,
        sourceType: "WEB_URL",
        authority: "GENERAL_WEB",
        originalLocation: "https://demo.example/guide",
      });

      await repository.saveSource(source);

      await expect(repository.findById(source.id)).resolves.toEqual(source);
    });

    it.each(["ACTIVE", "ARCHIVED"] as const)(
      "round-trips a %s source",
      async (status) => {
        const source = sourceFixture({
          id: `source-${status}`,
          certificationId: TRACK.id,
          status,
        });

        await repository.saveSource(source);

        await expect(repository.findById(source.id)).resolves.toMatchObject({
          status,
        });
      },
    );

    it("has no source for an unknown identifier", async () => {
      await expect(repository.findById("nope")).resolves.toBeNull();
    });
  });

  describe("listByCertification", () => {
    it("returns the track's sources newest first, whatever their status", async () => {
      await repository.saveSource(
        sourceFixture({
          id: "source-old",
          certificationId: TRACK.id,
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      );
      await repository.saveSource(
        sourceFixture({
          id: "source-new",
          certificationId: TRACK.id,
          createdAt: "2026-03-01T00:00:00.000Z",
        }),
      );
      await repository.saveSource(
        sourceFixture({
          id: "source-archived",
          certificationId: TRACK.id,
          createdAt: "2026-02-01T00:00:00.000Z",
          status: "ARCHIVED",
        }),
      );

      const sources = await repository.listByCertification(TRACK.id);

      // Archived rows are included: the library page shows them in a separate group, and
      // filtering here would make that impossible without a second method.
      expect(sources.map((source) => source.id)).toEqual([
        "source-new",
        "source-archived",
        "source-old",
      ]);
    });

    it("does not return another track's sources", async () => {
      await repository.saveSource(
        sourceFixture({ id: "source-mine", certificationId: TRACK.id }),
      );
      await repository.saveSource(
        sourceFixture({ id: "source-theirs", certificationId: OTHER_TRACK.id }),
      );

      await expect(
        repository.listByCertification(TRACK.id),
      ).resolves.toHaveLength(1);
      expect(
        (await repository.listByCertification(OTHER_TRACK.id)).map(
          (source) => source.id,
        ),
      ).toEqual(["source-theirs"]);
    });

    it("returns nothing for a track with no sources", async () => {
      await expect(
        repository.listByCertification(OTHER_TRACK.id),
      ).resolves.toEqual([]);
    });
  });

  describe("saveSource as an update", () => {
    it("changes the owner's own metadata without touching the snapshots", async () => {
      // The point of the port's split: a title and an authority are the owner's
      // judgement about the document, and editing them is not rewriting what it said.
      const source = sourceFixture({
        id: "source-1",
        certificationId: TRACK.id,
        title: "First guess at a title",
        authority: "UNKNOWN",
      });

      await repository.saveSource(source);
      await repository.insertSnapshot(
        snapshotFixture({
          id: "snapshot-1",
          sourceId: source.id,
          contentHash: hashOf("a"),
        }),
      );

      await repository.saveSource({
        ...source,
        title: "Fictional exam guide, 2026 edition",
        authority: "OFFICIAL",
        status: "ARCHIVED",
        updatedAt: "2026-04-01T00:00:00.000Z",
      });

      await expect(repository.findById(source.id)).resolves.toMatchObject({
        title: "Fictional exam guide, 2026 edition",
        authority: "OFFICIAL",
        status: "ARCHIVED",
        createdAt: source.createdAt,
        updatedAt: "2026-04-01T00:00:00.000Z",
      });
      await expect(repository.listSnapshots(source.id)).resolves.toMatchObject([
        { id: "snapshot-1", contentHash: hashOf("a") },
      ]);
    });

    it("does not create a second row for the same identifier", async () => {
      const source = sourceFixture({
        id: "source-1",
        certificationId: TRACK.id,
      });

      await repository.saveSource(source);
      await repository.saveSource({ ...source, title: "Renamed" });

      await expect(
        repository.listByCertification(TRACK.id),
      ).resolves.toHaveLength(1);
    });

    it("refuses a source whose track does not exist", async () => {
      // The foreign key, not a check in this class. A source of a deleted track would
      // be unreachable content the owner could never see or archive.
      await expect(
        repository.saveSource(
          sourceFixture({
            id: "source-1",
            certificationId: "certification-nope",
          }),
        ),
      ).rejects.toThrow(/FOREIGN KEY constraint failed/i);
    });
  });

  describe("archive and restore", () => {
    beforeEach(async () => {
      await repository.saveSource(
        sourceFixture({
          id: "source-1",
          certificationId: TRACK.id,
          status: "ACTIVE",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      );
    });

    it("sets the status and records when it happened", async () => {
      await repository.archive("source-1", "2026-05-01T09:00:00.000Z");

      await expect(repository.findById("source-1")).resolves.toMatchObject({
        status: "ARCHIVED",
        updatedAt: "2026-05-01T09:00:00.000Z",
      });
    });

    it("brings an archived source back into use", async () => {
      await repository.archive("source-1", "2026-05-01T09:00:00.000Z");
      await repository.restore("source-1", "2026-05-02T09:00:00.000Z");

      await expect(repository.findById("source-1")).resolves.toMatchObject({
        status: "ACTIVE",
        updatedAt: "2026-05-02T09:00:00.000Z",
      });
    });

    it("leaves the content alone", async () => {
      // Archiving is "out of use", not "gone": a question generated from this source
      // still has to be able to cite it.
      await repository.insertSnapshot(
        snapshotFixture({
          id: "snapshot-1",
          sourceId: "source-1",
          contentHash: hashOf("a"),
        }),
      );

      await repository.archive("source-1", "2026-05-01T09:00:00.000Z");

      await expect(
        repository.findLatestSnapshot("source-1"),
      ).resolves.toMatchObject({ id: "snapshot-1" });
    });

    it("changes nothing for an unknown source", async () => {
      await repository.archive("nope", "2026-05-01T09:00:00.000Z");

      await expect(repository.findById("source-1")).resolves.toMatchObject({
        status: "ACTIVE",
      });
    });
  });

  describe("snapshots", () => {
    beforeEach(async () => {
      await repository.saveSource(
        sourceFixture({ id: "source-1", certificationId: TRACK.id }),
      );
      await repository.saveSource(
        sourceFixture({ id: "source-2", certificationId: TRACK.id }),
      );
    });

    it("stores and reads back every field", async () => {
      const snapshot = snapshotFixture({
        id: "snapshot-1",
        sourceId: "source-1",
        contentHash: hashOf("a"),
        byteSize: 4096,
        charCount: 4000,
        retrievedAt: "2026-02-01T10:00:00.000Z",
      });

      await repository.insertSnapshot(snapshot);

      await expect(repository.findSnapshotById(snapshot.id)).resolves.toEqual(
        snapshot,
      );
    });

    it("lists a source's snapshots newest first", async () => {
      await repository.insertSnapshot(
        snapshotFixture({
          id: "snapshot-first",
          sourceId: "source-1",
          contentHash: hashOf("a"),
          retrievedAt: "2026-02-01T10:00:00.000Z",
        }),
      );
      await repository.insertSnapshot(
        snapshotFixture({
          id: "snapshot-second",
          sourceId: "source-1",
          contentHash: hashOf("b"),
          retrievedAt: "2026-03-01T10:00:00.000Z",
        }),
      );

      const snapshots = await repository.listSnapshots("source-1");

      expect(snapshots.map((snapshot) => snapshot.id)).toEqual([
        "snapshot-second",
        "snapshot-first",
      ]);
    });

    it("lists only the named source's snapshots", async () => {
      await repository.insertSnapshot(
        snapshotFixture({
          id: "snapshot-mine",
          sourceId: "source-1",
          contentHash: hashOf("a"),
        }),
      );
      await repository.insertSnapshot(
        snapshotFixture({
          id: "snapshot-theirs",
          sourceId: "source-2",
          contentHash: hashOf("a"),
        }),
      );

      expect(
        (await repository.listSnapshots("source-1")).map(
          (snapshot) => snapshot.id,
        ),
      ).toEqual(["snapshot-mine"]);
    });

    it("finds the newest snapshot as the source's current content", async () => {
      await repository.insertSnapshot(
        snapshotFixture({
          id: "snapshot-first",
          sourceId: "source-1",
          contentHash: hashOf("a"),
          retrievedAt: "2026-02-01T10:00:00.000Z",
        }),
      );
      await repository.insertSnapshot(
        snapshotFixture({
          id: "snapshot-second",
          sourceId: "source-1",
          contentHash: hashOf("b"),
          retrievedAt: "2026-03-01T10:00:00.000Z",
        }),
      );

      await expect(
        repository.findLatestSnapshot("source-1"),
      ).resolves.toMatchObject({ id: "snapshot-second" });
    });

    it("has no latest snapshot for a source whose import wrote none", async () => {
      await expect(
        repository.findLatestSnapshot("source-1"),
      ).resolves.toBeNull();
    });

    it("has no snapshot for an unknown identifier", async () => {
      await expect(repository.findSnapshotById("nope")).resolves.toBeNull();
    });

    describe("findSnapshotByHash", () => {
      beforeEach(async () => {
        await repository.insertSnapshot(
          snapshotFixture({
            id: "snapshot-1",
            sourceId: "source-1",
            contentHash: hashOf("a"),
          }),
        );
      });

      it("finds the snapshot holding that content", async () => {
        // This is what makes a refresh able to say "unchanged" rather than failing on
        // the unique index.
        await expect(
          repository.findSnapshotByHash("source-1", hashOf("a")),
        ).resolves.toMatchObject({ id: "snapshot-1" });
      });

      it("reports nothing for content this source has never held", async () => {
        await expect(
          repository.findSnapshotByHash("source-1", hashOf("b")),
        ).resolves.toBeNull();
      });

      it("does not match another source's identical content", async () => {
        // The index is per source, so two sources may legitimately hold the same text
        // and each keeps its own history of it.
        await expect(
          repository.findSnapshotByHash("source-2", hashOf("a")),
        ).resolves.toBeNull();
      });
    });

    describe("the append-only rule", () => {
      it("refuses a second snapshot of identical content for one source", async () => {
        // A bare insert rather than an upsert, so a caller that reaches here with
        // content it has already stored fails loudly instead of producing a
        // "refreshed" source with no new snapshot.
        await repository.insertSnapshot(
          snapshotFixture({
            id: "snapshot-1",
            sourceId: "source-1",
            contentHash: hashOf("a"),
          }),
        );

        await expect(
          repository.insertSnapshot(
            snapshotFixture({
              id: "snapshot-2",
              sourceId: "source-1",
              contentHash: hashOf("a"),
            }),
          ),
        ).rejects.toThrow(/UNIQUE constraint failed/i);

        await expect(
          repository.listSnapshots("source-1"),
        ).resolves.toHaveLength(1);
      });

      it("allows the same content under a different source", async () => {
        await repository.insertSnapshot(
          snapshotFixture({
            id: "snapshot-1",
            sourceId: "source-1",
            contentHash: hashOf("a"),
          }),
        );

        await expect(
          repository.insertSnapshot(
            snapshotFixture({
              id: "snapshot-2",
              sourceId: "source-2",
              contentHash: hashOf("a"),
            }),
          ),
        ).resolves.toBeUndefined();
      });

      it("exposes no way to update a stored snapshot or chunk", () => {
        // The mechanism `source-repository.ts` documents: replacing history is not
        // forbidden by convention, it is impossible to express. Adding one of these
        // names has to be a deliberate decision, and this assertion is what makes it
        // visible.
        const methods = Object.getOwnPropertyNames(
          SqliteSourceRepository.prototype,
        );

        expect(methods).toEqual(
          expect.arrayContaining([
            "insertSnapshot",
            "insertChunks",
            "saveSource",
          ]),
        );
        expect(
          methods.filter((name) => /^(update|replace|delete)/.test(name)),
        ).toEqual([]);
        expect(methods).not.toContain("updateSnapshot");
        expect(methods).not.toContain("updateChunks");
      });

      it("refuses a snapshot of a source that does not exist", async () => {
        await expect(
          repository.insertSnapshot(
            snapshotFixture({ id: "snapshot-1", sourceId: "source-nope" }),
          ),
        ).rejects.toThrow(/FOREIGN KEY constraint failed/i);
      });
    });
  });

  describe("chunks", () => {
    beforeEach(async () => {
      await repository.saveSource(
        sourceFixture({ id: "source-1", certificationId: TRACK.id }),
      );
      await repository.insertSnapshot(
        snapshotFixture({
          id: "snapshot-1",
          sourceId: "source-1",
          contentHash: hashOf("a"),
        }),
      );
      await repository.insertSnapshot(
        snapshotFixture({
          id: "snapshot-2",
          sourceId: "source-1",
          contentHash: hashOf("b"),
        }),
      );
    });

    it("stores the passages in index order with their offsets intact", async () => {
      // The offsets are the whole reason chunks exist: a citation has to be locatable
      // in the document it came from, so a reordering read would break slice 2's
      // evidence display.
      await repository.insertChunks([
        chunkFixture({
          id: "chunk-c",
          snapshotId: "snapshot-1",
          chunkIndex: 2,
          text: "The third passage.",
          charStart: 40,
          charEnd: 58,
        }),
        chunkFixture({
          id: "chunk-a",
          snapshotId: "snapshot-1",
          chunkIndex: 0,
          text: "The first passage.",
          charStart: 0,
          charEnd: 18,
        }),
        chunkFixture({
          id: "chunk-b",
          snapshotId: "snapshot-1",
          chunkIndex: 1,
          text: "The second passage.",
          charStart: 20,
          charEnd: 39,
        }),
      ]);

      const chunks = await repository.listChunks("snapshot-1");

      expect(chunks).toEqual([
        {
          id: "chunk-a",
          snapshotId: "snapshot-1",
          chunkIndex: 0,
          text: "The first passage.",
          charStart: 0,
          charEnd: 18,
        },
        {
          id: "chunk-b",
          snapshotId: "snapshot-1",
          chunkIndex: 1,
          text: "The second passage.",
          charStart: 20,
          charEnd: 39,
        },
        {
          id: "chunk-c",
          snapshotId: "snapshot-1",
          chunkIndex: 2,
          text: "The third passage.",
          charStart: 40,
          charEnd: 58,
        },
      ]);
    });

    it("keeps each snapshot's chunks separate", async () => {
      await repository.insertChunks([
        chunkFixture({
          id: "chunk-1",
          snapshotId: "snapshot-1",
          chunkIndex: 0,
        }),
        chunkFixture({
          id: "chunk-2",
          snapshotId: "snapshot-2",
          chunkIndex: 0,
        }),
      ]);

      expect(
        (await repository.listChunks("snapshot-1")).map((chunk) => chunk.id),
      ).toEqual(["chunk-1"]);
      expect(
        (await repository.listChunks("snapshot-2")).map((chunk) => chunk.id),
      ).toEqual(["chunk-2"]);
    });

    it("writes nothing for an empty batch", async () => {
      await repository.insertChunks([]);

      await expect(repository.listChunks("snapshot-1")).resolves.toEqual([]);
    });

    it("counts a snapshot's chunks without reading them", async () => {
      await repository.insertChunks([
        chunkFixture({
          id: "chunk-1",
          snapshotId: "snapshot-1",
          chunkIndex: 0,
        }),
        chunkFixture({
          id: "chunk-2",
          snapshotId: "snapshot-1",
          chunkIndex: 1,
        }),
        chunkFixture({
          id: "chunk-3",
          snapshotId: "snapshot-2",
          chunkIndex: 0,
        }),
      ]);

      await expect(repository.countChunks("snapshot-1")).resolves.toBe(2);
      await expect(repository.countChunks("snapshot-2")).resolves.toBe(1);
    });

    it("counts nothing for a snapshot with no chunks, or none at all", async () => {
      await expect(repository.countChunks("snapshot-1")).resolves.toBe(0);
      await expect(repository.countChunks("nope")).resolves.toBe(0);
    });

    it("refuses two chunks at the same position in one snapshot", async () => {
      await expect(
        repository.insertChunks([
          chunkFixture({
            id: "chunk-1",
            snapshotId: "snapshot-1",
            chunkIndex: 0,
          }),
          chunkFixture({
            id: "chunk-2",
            snapshotId: "snapshot-1",
            chunkIndex: 0,
          }),
        ]),
      ).rejects.toThrow(/UNIQUE constraint failed/i);
    });

    it("refuses a chunk of a snapshot that does not exist", async () => {
      await expect(
        repository.insertChunks([
          chunkFixture({ id: "chunk-1", snapshotId: "snapshot-nope" }),
        ]),
      ).rejects.toThrow(/FOREIGN KEY constraint failed/i);
    });
  });

  describe("objective links", () => {
    beforeEach(async () => {
      await repository.saveSource(
        sourceFixture({ id: "source-1", certificationId: TRACK.id }),
      );
      await repository.saveSource(
        sourceFixture({ id: "source-2", certificationId: TRACK.id }),
      );
    });

    it("has no links for a source nobody has mapped", async () => {
      await expect(repository.listObjectiveLinks("source-1")).resolves.toEqual(
        [],
      );
    });

    it("lists the objectives a source was mapped to, oldest first", async () => {
      await repository.linkObjective(
        "source-1",
        SECOND_OBJECTIVE.id,
        "2026-05-01T09:00:00.000Z",
      );
      await repository.linkObjective(
        "source-1",
        OBJECTIVE.id,
        "2026-05-02T09:00:00.000Z",
      );

      await expect(repository.listObjectiveLinks("source-1")).resolves.toEqual([
        SECOND_OBJECTIVE.id,
        OBJECTIVE.id,
      ]);
    });

    it("does not report another source's links", async () => {
      await repository.linkObjective(
        "source-2",
        OBJECTIVE.id,
        "2026-05-01T09:00:00.000Z",
      );

      await expect(repository.listObjectiveLinks("source-1")).resolves.toEqual(
        [],
      );
    });

    it("refuses the identical link twice rather than ignoring it", async () => {
      // The primary key decides, and the insert is bare: the facade reports a duplicate
      // as a domain error before reaching here, so a bare insert means a race raises
      // instead of quietly reporting success for a link it did not write.
      await repository.linkObjective(
        "source-1",
        OBJECTIVE.id,
        "2026-05-01T09:00:00.000Z",
      );

      await expect(
        repository.linkObjective(
          "source-1",
          OBJECTIVE.id,
          "2026-05-02T09:00:00.000Z",
        ),
      ).rejects.toThrow(/UNIQUE constraint failed/i);

      await expect(
        repository.listObjectiveLinks("source-1"),
      ).resolves.toHaveLength(1);
    });

    it("removes one link and leaves the others", async () => {
      await repository.linkObjective(
        "source-1",
        OBJECTIVE.id,
        "2026-05-01T09:00:00.000Z",
      );
      await repository.linkObjective(
        "source-1",
        SECOND_OBJECTIVE.id,
        "2026-05-01T09:00:00.000Z",
      );

      await repository.unlinkObjective("source-1", OBJECTIVE.id);

      await expect(repository.listObjectiveLinks("source-1")).resolves.toEqual([
        SECOND_OBJECTIVE.id,
      ]);
    });

    it("is silent about unlinking something that was never linked", async () => {
      await expect(
        repository.unlinkObjective("source-1", OBJECTIVE.id),
      ).resolves.toBeUndefined();
    });

    it("lets the same link be made again after it is removed", async () => {
      await repository.linkObjective(
        "source-1",
        OBJECTIVE.id,
        "2026-05-01T09:00:00.000Z",
      );
      await repository.unlinkObjective("source-1", OBJECTIVE.id);
      await repository.linkObjective(
        "source-1",
        OBJECTIVE.id,
        "2026-05-03T09:00:00.000Z",
      );

      await expect(repository.listObjectiveLinks("source-1")).resolves.toEqual([
        OBJECTIVE.id,
      ]);
    });

    it("refuses a link to an objective that does not exist", async () => {
      // The repository does not judge which track an objective belongs to — the facade
      // does that inside the transaction — but a non-existent objective is the foreign
      // key's business.
      await expect(
        repository.linkObjective(
          "source-1",
          "objective-nope",
          "2026-05-01T09:00:00.000Z",
        ),
      ).rejects.toThrow(/FOREIGN KEY constraint failed/i);
    });
  });

  describe("deleting a track", () => {
    it("takes its sources, snapshots, chunks, and links with it", async () => {
      // The cascade is the schema's, and it is asserted so that "archive rather than
      // delete" stays a product decision rather than an accident of the rows surviving.
      await repository.saveSource(
        sourceFixture({ id: "source-1", certificationId: TRACK.id }),
      );
      await repository.insertSnapshot(
        snapshotFixture({
          id: "snapshot-1",
          sourceId: "source-1",
          contentHash: hashOf("a"),
        }),
      );
      await repository.insertChunks([
        chunkFixture({ id: "chunk-1", snapshotId: "snapshot-1" }),
      ]);
      await repository.linkObjective(
        "source-1",
        OBJECTIVE.id,
        "2026-05-01T09:00:00.000Z",
      );

      database.prepare(`DELETE FROM certifications WHERE id = ?`).run(TRACK.id);

      await expect(repository.findById("source-1")).resolves.toBeNull();
      await expect(
        repository.findSnapshotById("snapshot-1"),
      ).resolves.toBeNull();
      await expect(repository.listChunks("snapshot-1")).resolves.toEqual([]);
      await expect(repository.listObjectiveLinks("source-1")).resolves.toEqual(
        [],
      );
    });
  });
});
