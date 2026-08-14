import { describe, expect, it } from "vitest";
import { createMigratedDatabase } from "@/modules/certifications/infrastructure/test-support";
import { describeMediaAssetRepositoryContract } from "@/modules/audio/ports/repository-contract";
import { SqliteMediaAssetRepository } from "./sqlite-media-asset-repository";
import { mediaAssetFixture } from "./test-support";

describeMediaAssetRepositoryContract("SQLite", () => {
  const database = createMigratedDatabase();

  return {
    assets: new SqliteMediaAssetRepository(database),
    dispose: () => database.close(),
  };
});

describe("SQLite media asset schema", () => {
  it("uses a strict table", () => {
    const database = createMigratedDatabase();

    try {
      // A STRICT table refuses a value it cannot store in the declared type; a
      // non-strict table would coerce this byte size to 0.
      expect(() =>
        database.exec(
          `INSERT INTO media_assets (id, cache_key, object_key, content_type,
             byte_size, voice_id, engine, language, speech_rate, created_at)
           VALUES ('a', 'k', 'audio/aa/bb.mp3', 'audio/mpeg', 'a lot', 'Zhiyu',
             'neural', 'zh', 'medium', '2026-01-01T00:00:00.000Z')`,
        ),
      ).toThrow(/cannot store TEXT value in INTEGER column/i);
    } finally {
      database.close();
    }
  });

  it("refuses two rows with the same cache key", () => {
    // The unique index is what makes "identical requests reuse cached audio" a
    // property of the schema rather than of whichever code path happened to check
    // first.
    const database = createMigratedDatabase();

    try {
      const insert = (id: string): void => {
        database
          .prepare(
            `INSERT INTO media_assets (id, cache_key, object_key, content_type,
               byte_size, voice_id, engine, language, speech_rate, created_at)
             VALUES (?, 'same-key', 'audio/aa/bb.mp3', 'audio/mpeg', 10,
               'Zhiyu', 'neural', 'zh', 'medium', '2026-01-01T00:00:00.000Z')`,
          )
          .run(id);
      };

      insert("asset-1");

      expect(() => insert("asset-2")).toThrow(/UNIQUE constraint failed/i);
    } finally {
      database.close();
    }
  });

  it("refuses a zero or negative byte size", () => {
    // An empty asset would be a player that plays nothing, cached forever.
    const database = createMigratedDatabase();

    try {
      expect(() =>
        database.exec(
          `INSERT INTO media_assets (id, cache_key, object_key, content_type,
             byte_size, voice_id, engine, language, speech_rate, created_at)
           VALUES ('a', 'k', 'audio/aa/bb.mp3', 'audio/mpeg', 0, 'Zhiyu',
             'neural', 'zh', 'medium', '2026-01-01T00:00:00.000Z')`,
        ),
      ).toThrow(/CHECK constraint failed/i);
    } finally {
      database.close();
    }
  });

  it("allows a null duration but not a zero one", () => {
    // Null means "not measured", which is every asset today. Zero would be a claim
    // that the clip has no length.
    const database = createMigratedDatabase();

    try {
      expect(() =>
        database.exec(
          `INSERT INTO media_assets (id, cache_key, object_key, content_type,
             byte_size, duration_seconds, voice_id, engine, language,
             speech_rate, created_at)
           VALUES ('a', 'k1', 'audio/aa/bb.mp3', 'audio/mpeg', 10, NULL,
             'Zhiyu', 'neural', 'zh', 'medium', '2026-01-01T00:00:00.000Z')`,
        ),
      ).not.toThrow();

      expect(() =>
        database.exec(
          `INSERT INTO media_assets (id, cache_key, object_key, content_type,
             byte_size, duration_seconds, voice_id, engine, language,
             speech_rate, created_at)
           VALUES ('b', 'k2', 'audio/aa/cc.mp3', 'audio/mpeg', 10, 0,
             'Zhiyu', 'neural', 'zh', 'medium', '2026-01-01T00:00:00.000Z')`,
        ),
      ).toThrow(/CHECK constraint failed/i);
    } finally {
      database.close();
    }
  });

  it("refuses a stored engine, language, or rate the domain cannot read", async () => {
    // The row mapper validates on the way out, so a hand-edited database fails
    // loudly instead of feeding an unknown engine name into a provider request.
    const database = createMigratedDatabase();

    try {
      const repository = new SqliteMediaAssetRepository(database);

      database
        .prepare(
          `INSERT INTO media_assets (id, cache_key, object_key, content_type,
             byte_size, voice_id, engine, language, speech_rate, created_at)
           VALUES ('a', 'k', 'audio/aa/bb.mp3', 'audio/mpeg', 10, 'Zhiyu',
             'generative', 'zh', 'medium', '2026-01-01T00:00:00.000Z')`,
        )
        .run();

      await expect(repository.findById("a")).rejects.toThrow(
        /unsupported engine: generative/,
      );
    } finally {
      database.close();
    }
  });

  it("does not delete an asset when a flashcard is deleted", async () => {
    // An asset is keyed by what was spoken, not by the card that said it, so there
    // is no foreign key to cascade. This is the trade-off the delete control exists
    // for, and it is asserted so that adding a reference later is a deliberate
    // decision rather than an accident.
    const database = createMigratedDatabase();

    try {
      const repository = new SqliteMediaAssetRepository(database);
      const asset = mediaAssetFixture();

      await repository.insertIfAbsent(asset);

      const columns = database
        .prepare(`PRAGMA foreign_key_list(media_assets)`)
        .all();

      expect(columns).toEqual([]);
      await expect(repository.findById(asset.id)).resolves.toEqual(asset);
    } finally {
      database.close();
    }
  });
});
