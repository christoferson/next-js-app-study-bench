import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { MediaAsset } from "@/modules/audio/domain/media-asset";
import type { MediaAssetRepository } from "@/modules/audio/ports/media-asset-repository";
import type { MediaAssetRow } from "./rows";
import { toMediaAsset } from "./rows";

const ASSET_COLUMNS = `id, cache_key, object_key, content_type, byte_size,
  duration_seconds, voice_id, engine, language, speech_rate, created_at`;

/**
 * SQLite-backed audio-asset persistence.
 *
 * Insert, read, and delete. There is no update, because an asset's identity is a
 * hash of its own content: changing what was said produces a different row rather
 * than a modified one.
 */
export class SqliteMediaAssetRepository implements MediaAssetRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async findById(id: string): Promise<MediaAsset | null> {
    const row = this.database
      .prepare(`SELECT ${ASSET_COLUMNS} FROM media_assets WHERE id = ?`)
      .get(id) as MediaAssetRow | undefined;

    return row === undefined ? null : toMediaAsset(row);
  }

  async findByCacheKey(cacheKey: string): Promise<MediaAsset | null> {
    const row = this.database
      .prepare(`SELECT ${ASSET_COLUMNS} FROM media_assets WHERE cache_key = ?`)
      .get(cacheKey) as MediaAssetRow | undefined;

    return row === undefined ? null : toMediaAsset(row);
  }

  /** Newest first, with the identifier breaking ties so paging is stable. */
  async list(limit: number): Promise<MediaAsset[]> {
    const rows = this.database
      .prepare(
        `SELECT ${ASSET_COLUMNS} FROM media_assets
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(limit) as MediaAssetRow[];

    return rows.map(toMediaAsset);
  }

  async count(): Promise<number> {
    const row = this.database
      .prepare(`SELECT COUNT(*) AS total FROM media_assets`)
      .get() as { readonly total: number };

    return row.total;
  }

  async totalByteSize(): Promise<number> {
    const row = this.database
      .prepare(`SELECT SUM(byte_size) AS total FROM media_assets`)
      .get() as { readonly total: number | null };

    // `SUM` over no rows is NULL in SQLite, which is zero bytes.
    return row.total ?? 0;
  }

  /**
   * Inserts unless the cache key is already taken.
   *
   * `ON CONFLICT DO NOTHING` plus a read-back, rather than a check-then-insert: two
   * requests for the same word can interleave between the check and the insert, and
   * the unique index is the only thing that actually decides which one wins. The
   * loser reads the winner's row and gets a playable asset, which is better than the
   * constraint error a bare insert would raise.
   */
  async insertIfAbsent(asset: MediaAsset): Promise<MediaAsset> {
    this.database
      .prepare(
        `INSERT INTO media_assets (id, cache_key, object_key, content_type,
           byte_size, duration_seconds, voice_id, engine, language, speech_rate,
           created_at)
         VALUES (@id, @cacheKey, @objectKey, @contentType, @byteSize,
           @durationSeconds, @voiceId, @engine, @language, @speechRate,
           @createdAt)
         ON CONFLICT (cache_key) DO NOTHING`,
      )
      .run({
        id: asset.id,
        cacheKey: asset.cacheKey,
        objectKey: asset.objectKey,
        contentType: asset.contentType,
        byteSize: asset.byteSize,
        durationSeconds: asset.durationSeconds,
        voiceId: asset.voiceId,
        engine: asset.engine,
        language: asset.language,
        speechRate: asset.speechRate,
        createdAt: asset.createdAt,
      });

    const stored = await this.findByCacheKey(asset.cacheKey);

    if (stored === null) {
      // Unreachable: the row was either inserted or already present. Throwing
      // rather than returning the unsaved input, because handing back an asset the
      // playback route cannot find would be a broken player with no explanation.
      throw new Error("An audio asset vanished immediately after insertion.");
    }

    return stored;
  }

  async delete(id: string): Promise<void> {
    // No row count check: the caller asked for the asset to be gone, and it is.
    this.database.prepare(`DELETE FROM media_assets WHERE id = ?`).run(id);
  }
}
