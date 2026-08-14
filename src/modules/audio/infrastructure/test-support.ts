import type { MediaAsset } from "@/modules/audio/domain/media-asset";
import type {
  ObjectKey,
  ObjectStorage,
} from "@/platform/storage/object-storage";
import { assertValidObjectKey } from "@/platform/storage/object-storage";

/**
 * Deterministic fixtures and doubles for the audio module's tests.
 *
 * Nothing here touches AWS, the filesystem, or `./data`.
 */

export function mediaAssetFixture(
  overrides: Partial<MediaAsset> = {},
): MediaAsset {
  return {
    id: "asset-1",
    // A realistic sha256 shape, so the object key derived from it looks like a real
    // one in assertions.
    cacheKey: "a".repeat(64),
    objectKey: `audio/aa/${"a".repeat(62)}.mp3`,
    contentType: "audio/mpeg",
    byteSize: 768,
    durationSeconds: null,
    voiceId: "Zhiyu",
    engine: "neural",
    language: "zh",
    speechRate: "medium",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * In-memory object storage.
 *
 * Used by facade tests, which care about "were the bytes stored" rather than about
 * the filesystem. It validates keys exactly as the real adapters do, so a test cannot
 * pass with a key that `LocalFileObjectStorage` would reject.
 */
export class InMemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, Uint8Array>();

  /** Every `put`, in order, so a test can assert what was written and when. */
  readonly writes: ObjectKey[] = [];

  /** Every `delete`, in order. */
  readonly deletes: ObjectKey[] = [];

  async put(key: ObjectKey, bytes: Uint8Array): Promise<void> {
    assertValidObjectKey(key);
    this.writes.push(key);
    this.objects.set(key, bytes);
  }

  async get(key: ObjectKey): Promise<Uint8Array | null> {
    assertValidObjectKey(key);

    return this.objects.get(key) ?? null;
  }

  async delete(key: ObjectKey): Promise<void> {
    assertValidObjectKey(key);
    this.deletes.push(key);
    this.objects.delete(key);
  }

  async exists(key: ObjectKey): Promise<boolean> {
    assertValidObjectKey(key);

    return this.objects.has(key);
  }

  /** How many objects are stored. For "the bytes were not written twice". */
  get size(): number {
    return this.objects.size;
  }

  /** Removes an object without recording a delete, to simulate a lost file. */
  forget(key: ObjectKey): void {
    this.objects.delete(key);
  }
}
