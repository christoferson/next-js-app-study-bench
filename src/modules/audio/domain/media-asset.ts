import type {
  SpeechEngine,
  SpeechLanguage,
  SpeechRate,
} from "./speech-request";

/**
 * One cached clip of synthesized audio (`SPEC.md` section 10, `media_assets`).
 *
 * The row is metadata and a key; the bytes live in object storage
 * (`spec/ARCHITECTURE.md` section 7.7). The two are separate because MP3 blobs in
 * relational columns make every query that touches the table expensive and make the
 * move to S3 in D13 a data migration rather than a configuration change.
 *
 * **An asset belongs to what was said, not to the card that said it.** The identity
 * of an asset is its `cacheKey`, which is a hash of the text and the voice
 * settings — so the same term on two cards is one asset, one Polly call, and one
 * file. The cost of that choice is that deleting a card does not delete its audio,
 * which is why the owner has an explicit delete control.
 */
export interface MediaAsset {
  readonly id: string;
  /** sha256 of the canonical request (`SPEC.md` section 12.3). Unique. */
  readonly cacheKey: string;
  /** Where the bytes are, relative to the storage root. Never browser input. */
  readonly objectKey: string;
  readonly contentType: string;
  readonly byteSize: number;
  /**
   * Playing time, when it is known.
   *
   * Always `null` today, and the column is nullable for that reason:
   * `SynthesizeSpeech` does not report a duration. Learning it would mean decoding
   * the MP3 or making a second, separately billed speech-marks call, and neither is
   * worth it for a control whose duration the `<audio>` element reads from the file
   * itself. The field exists because `SPEC.md` section 12.1 names it and because a
   * future study-pack estimate ("about 12 minutes of audio") is the feature that
   * would justify measuring it.
   */
  readonly durationSeconds: number | null;
  readonly voiceId: string;
  readonly engine: SpeechEngine;
  readonly language: SpeechLanguage;
  readonly speechRate: SpeechRate;
  readonly createdAt: string;
}

/** Total bytes of a set of assets, for the owner's audio list. */
export function totalByteSize(assets: readonly MediaAsset[]): number {
  return assets.reduce((total, asset) => total + asset.byteSize, 0);
}

/**
 * Bytes as a short human string.
 *
 * Whole kilobytes below a megabyte and one decimal above it: the owner is deciding
 * whether a set of clips is worth keeping, and "384 KB" answers that better than
 * "393,216 bytes" or "0.4 MB".
 */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kilobytes = bytes / 1024;

  if (kilobytes < 1024) {
    return `${Math.round(kilobytes)} KB`;
  }

  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

/**
 * The storage key for one asset.
 *
 * `audio/<first two characters of the cache key>/<rest>.mp3`. The two-character
 * prefix is a fan-out directory: a personal bank of 1,600 vocabulary cards plus
 * examples can reach several thousand files, and a single flat directory of that
 * size is slow to list and unpleasant to inspect by hand. The name is derived
 * entirely from the hash, so it contains no owner text — a filename is the one place
 * content tends to leak into a shell history or a backup listing.
 */
export function objectKeyForCacheKey(cacheKey: string): string {
  return `audio/${cacheKey.slice(0, 2)}/${cacheKey.slice(2)}.mp3`;
}
