import type { MediaAsset } from "@/modules/audio/domain/media-asset";
import type {
  SpeechEngine,
  SpeechLanguage,
  SpeechRate,
} from "@/modules/audio/domain/speech-request";
import {
  SPEECH_ENGINES,
  SPEECH_LANGUAGES,
  SPEECH_RATES,
} from "@/modules/audio/domain/speech-request";

/**
 * Row mapping for the `media_assets` table.
 *
 * The database is an external boundary, so stored values are validated on the way
 * out rather than cast (`spec/CODING-STANDARDS.md` section 2). No column holds JSON
 * here; the three that hold closed unions are checked against their lists, so a
 * hand-edited local database fails loudly instead of feeding an unknown engine name
 * into a provider request.
 */

export interface MediaAssetRow {
  readonly id: string;
  readonly cache_key: string;
  readonly object_key: string;
  readonly content_type: string;
  readonly byte_size: number;
  readonly duration_seconds: number | null;
  readonly voice_id: string;
  readonly engine: string;
  readonly language: string;
  readonly speech_rate: string;
  readonly created_at: string;
}

export function toMediaAsset(row: MediaAssetRow): MediaAsset {
  return {
    id: row.id,
    cacheKey: row.cache_key,
    objectKey: row.object_key,
    contentType: row.content_type,
    byteSize: row.byte_size,
    durationSeconds: row.duration_seconds,
    voiceId: row.voice_id,
    engine: toEngine(row.id, row.engine),
    language: toLanguage(row.id, row.language),
    speechRate: toRate(row.id, row.speech_rate),
    createdAt: row.created_at,
  };
}

function toEngine(assetId: string, value: string): SpeechEngine {
  const engine = SPEECH_ENGINES.find((candidate) => candidate === value);

  if (engine === undefined) {
    throw new Error(
      `Stored audio asset ${assetId} has an unsupported engine: ${value}`,
    );
  }

  return engine;
}

function toLanguage(assetId: string, value: string): SpeechLanguage {
  const language = SPEECH_LANGUAGES.find((candidate) => candidate === value);

  if (language === undefined) {
    throw new Error(
      `Stored audio asset ${assetId} has an unsupported language: ${value}`,
    );
  }

  return language;
}

function toRate(assetId: string, value: string): SpeechRate {
  const rate = SPEECH_RATES.find((candidate) => candidate === value);

  if (rate === undefined) {
    throw new Error(
      `Stored audio asset ${assetId} has an unsupported speech rate: ${value}`,
    );
  }

  return rate;
}
