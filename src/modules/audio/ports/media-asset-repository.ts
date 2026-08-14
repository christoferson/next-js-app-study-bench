import type { MediaAsset } from "@/modules/audio/domain/media-asset";

/**
 * Persistence port for cached audio assets.
 *
 * The methods describe the access patterns the application needs; no SQL and no
 * database row crosses this boundary (`spec/ARCHITECTURE.md` section 5.1).
 *
 * There is deliberately no `update`. An asset is immutable: its identity is a hash
 * of what was said and how, so changing any of that produces a different asset
 * rather than an edit. The only writes are "remember this new clip" and "forget this
 * one".
 */

export interface MediaAssetRepository {
  findById(id: string): Promise<MediaAsset | null>;
  /**
   * The asset for one canonical request, or `null`.
   *
   * The cache lookup. This is the method that keeps the owner from paying Polly
   * twice for one word (`SPEC.md` section 12.3).
   */
  findByCacheKey(cacheKey: string): Promise<MediaAsset | null>;
  /** Every asset, newest first, bounded. For the owner's audio list. */
  list(limit: number): Promise<MediaAsset[]>;
  count(): Promise<number>;
  /** Total stored bytes, so the owner can see what the cache costs on disk. */
  totalByteSize(): Promise<number>;

  /**
   * Inserts an asset.
   *
   * Returns the stored asset, which is *not* always the one passed in: when another
   * request has already cached the same `cacheKey`, the existing row is returned
   * instead of raising a conflict. That makes the unique index the arbiter of the
   * race rather than a lock, and it means the loser of the race gets a playable
   * asset instead of an error page. The caller is responsible for discarding the
   * bytes it uploaded if the returned asset is not its own.
   */
  insertIfAbsent(asset: MediaAsset): Promise<MediaAsset>;
  /** Removes the row. Succeeds when the identifier matches nothing. */
  delete(id: string): Promise<void>;
}
