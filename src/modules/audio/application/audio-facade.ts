import type { Clock } from "@/platform/clock";
import { sha256Hex } from "@/platform/hash";
import type { IdGenerator } from "@/platform/id-generator";
import type { ObjectStorage } from "@/platform/storage/object-storage";
import type { StudyType } from "@/modules/certifications/domain/certification";
import type { FlashcardContent } from "@/modules/flashcards/domain/flashcard";
import type { QuestionRevision } from "@/modules/question-bank/domain/question";
import {
  flashcardClipRequests,
  questionClipRequests,
} from "@/modules/audio/domain/content-clips";
import {
  AudioAssetNotFoundError,
  SpeechTextNotSpeakableError,
} from "@/modules/audio/domain/errors";
import type { MediaAsset } from "@/modules/audio/domain/media-asset";
import { objectKeyForCacheKey } from "@/modules/audio/domain/media-asset";
import type {
  SpeechClip,
  SpeechClipRequest,
} from "@/modules/audio/domain/speech-clip";
import type {
  SpeechLanguage,
  SpeechRate,
  SpeechRequest,
} from "@/modules/audio/domain/speech-request";
import {
  AUDIO_CONTENT_TYPE,
  canonicalSpeechRequest,
  DEFAULT_SPEECH_RATE,
  hasSpeakableText,
  MAX_SPEECH_TEXT_LENGTH,
  normalizeSpeechText,
} from "@/modules/audio/domain/speech-request";
import { speechLanguageFor } from "@/modules/audio/domain/voice-selection";
import type { VoiceSettings } from "@/modules/audio/domain/voice-settings";
import { voiceIdFor } from "@/modules/audio/domain/voice-settings";
import type { MediaAssetRepository } from "@/modules/audio/ports/media-asset-repository";
import type { SpeechSynthesisGateway } from "@/modules/audio/ports/speech-synthesis-gateway";

/**
 * Audio capability facade.
 *
 * Owns the one decision that matters about cost: *whether to call the provider at
 * all*. Every caller asks for "audio for this text in this language", and this facade
 * answers from the cache when it can (`SPEC.md` section 12.3). Server Actions, route
 * handlers, and pages call this; none of them builds a cache key, touches storage, or
 * knows which provider is installed.
 *
 * The write path is ordered so that a crash cannot leave a broken player behind:
 * bytes are stored *before* the row is inserted. A file with no row is invisible
 * garbage that the next identical request overwrites; a row with no file would be a
 * player that 404s, and nothing would ever retry it because the cache would report a
 * hit. The same reasoning runs backwards on delete: the row goes first.
 */

/** How many assets the owner's audio list shows. */
export const AUDIO_LIST_LIMIT = 200;

/** What a caller wants spoken. */
export interface SpeechRequestInput {
  readonly text: string;
  readonly language: SpeechLanguage;
  /** Defaults to the normal rate. */
  readonly rate?: SpeechRate;
}

/** An asset plus whether producing it cost anything. */
export interface SynthesisOutcome {
  readonly asset: MediaAsset;
  /**
   * `true` when the asset already existed.
   *
   * Returned rather than logged, so the interface can tell the owner that pressing
   * the button again was free, and so a test can assert the cache worked without
   * inspecting the gateway.
   */
  readonly cached: boolean;
}

/** The owner's stored audio, for the settings view. */
export interface AudioLibraryView {
  readonly assets: readonly MediaAsset[];
  readonly totalCount: number;
  readonly totalByteSize: number;
  /** Which provider would be used for a new clip, and with what settings. */
  readonly provider: string;
  readonly voiceIdZh: string;
  readonly voiceIdEn: string;
  readonly engine: string;
}

export interface AudioFacadeDependencies {
  readonly assets: MediaAssetRepository;
  readonly storage: ObjectStorage;
  readonly gateway: SpeechSynthesisGateway;
  readonly voices: VoiceSettings;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export class AudioFacade {
  constructor(private readonly deps: AudioFacadeDependencies) {}

  /** Which provider and voices a new clip would use. */
  get provider(): string {
    return this.deps.gateway.provider;
  }

  /**
   * The cached asset for one request, without synthesizing anything.
   *
   * What a page calls while rendering: a card whose audio already exists shows a
   * player immediately, and a card whose audio does not shows the generate button.
   * Separate from `synthesize` on purpose — a server-rendered read must never be able
   * to spend money, however many times a page is refreshed.
   */
  async findCached(input: SpeechRequestInput): Promise<MediaAsset | null> {
    if (!hasSpeakableText(input.text)) {
      return null;
    }

    return await this.deps.assets.findByCacheKey(this.cacheKeyFor(input));
  }

  /**
   * Several clip requests resolved against the cache in one pass.
   *
   * What a page calls: it hands over whatever `content-clips.ts` says the content
   * offers — one clip each today — and gets back which of them already have audio. Like
   * `findCached` it never synthesizes, so rendering a card costs nothing however often
   * it is refreshed.
   *
   * Batched and de-duplicated regardless, because the shape of a surface is not this
   * method's business: repeated text within one call is looked up once and every control
   * points at the same asset, which is the same thing the cache key guarantees across
   * pages.
   */
  async findClips(
    requests: readonly SpeechClipRequest[],
  ): Promise<readonly SpeechClip[]> {
    const found = new Map<string, string | null>();

    for (const request of requests) {
      const cacheKey = this.cacheKeyFor(request);

      if (found.has(cacheKey)) {
        continue;
      }

      const asset = hasSpeakableText(request.text)
        ? await this.deps.assets.findByCacheKey(cacheKey)
        : null;

      found.set(cacheKey, asset?.id ?? null);
    }

    return requests.map((request) => ({
      ...request,
      assetId: found.get(this.cacheKeyFor(request)) ?? null,
    }));
  }

  /**
   * The listenable parts of one flashcard, resolved against the cache.
   *
   * The voice's language comes from the revision's recorded language, falling back to
   * the track's study type — never from a track name or a provider string
   * (`speechLanguageFor`). So a Chinese term is read by the Mandarin voice because the
   * content says it is Chinese, and an English gloss card inside the same track is
   * read in English.
   */
  async findFlashcardClips(input: {
    readonly content: FlashcardContent;
    readonly contentLanguage: string | null;
    readonly studyType: StudyType;
  }): Promise<readonly SpeechClip[]> {
    return await this.findClips(
      flashcardClipRequests(
        input.content,
        speechLanguageFor({
          contentLanguage: input.contentLanguage,
          studyType: input.studyType,
        }),
      ),
    );
  }

  /**
   * The listenable parts of many flashcards at once, keyed by card id.
   *
   * For list surfaces — the bank page shows a page of cards and the owner wants to
   * play terms without opening each card. One call, one de-duplicated cache pass
   * (`findClips` already batches), never a synthesis. Cards whose content offers no
   * clip (every non-vocabulary type today) simply have no entry.
   */
  async findFlashcardClipsByCard(
    cards: readonly {
      readonly id: string;
      readonly content: FlashcardContent;
      readonly contentLanguage: string | null;
      readonly studyType: StudyType;
    }[],
  ): Promise<ReadonlyMap<string, readonly SpeechClip[]>> {
    const requestsByCard = cards.map((card) => ({
      id: card.id,
      requests: flashcardClipRequests(
        card.content,
        speechLanguageFor({
          contentLanguage: card.contentLanguage,
          studyType: card.studyType,
        }),
      ),
    }));
    const resolved = await this.findClips(
      requestsByCard.flatMap((entry) => entry.requests),
    );
    const clipsByCard = new Map<string, readonly SpeechClip[]>();
    let cursor = 0;

    for (const entry of requestsByCard) {
      const clips = resolved.slice(cursor, cursor + entry.requests.length);

      cursor += entry.requests.length;

      if (clips.length > 0) {
        clipsByCard.set(entry.id, clips);
      }
    }

    return clipsByCard;
  }

  /** The listenable parts of one question revision, resolved against the cache. */
  async findQuestionClips(input: {
    readonly revision: Pick<QuestionRevision, "stem" | "language">;
    readonly studyType: StudyType;
  }): Promise<readonly SpeechClip[]> {
    return await this.findClips(
      questionClipRequests(
        input.revision,
        speechLanguageFor({
          contentLanguage: input.revision.language,
          studyType: input.studyType,
        }),
      ),
    );
  }

  /**
   * The asset for one request, synthesizing it only if it is not already cached.
   *
   * The acceptance criterion for this milestone: two identical requests make one
   * provider call.
   */
  async synthesize(input: SpeechRequestInput): Promise<SynthesisOutcome> {
    const normalized = normalizeSpeechText(input.text);

    if (normalized.length === 0) {
      throw new SpeechTextNotSpeakableError("There is nothing here to read.");
    }

    if (normalized.length > MAX_SPEECH_TEXT_LENGTH) {
      throw new SpeechTextNotSpeakableError(
        `That text is ${normalized.length} characters. One clip may be up to ${MAX_SPEECH_TEXT_LENGTH}.`,
      );
    }

    const request = this.speechRequestFor(input);
    const cacheKey = this.cacheKeyFor(input);
    const cached = await this.deps.assets.findByCacheKey(cacheKey);

    if (cached !== null) {
      // The whole point. No provider call, no upload, no new row.
      return { asset: cached, cached: true };
    }

    const speech = await this.deps.gateway.synthesize(request);
    const objectKey = objectKeyForCacheKey(cacheKey);

    // Bytes first: see the note on this class. A file whose row never lands is
    // overwritten by the next attempt at the same key.
    await this.deps.storage.put(objectKey, speech.bytes);

    const stored = await this.deps.assets.insertIfAbsent({
      id: this.deps.ids.nextId(),
      cacheKey,
      objectKey,
      contentType: speech.contentType,
      byteSize: speech.bytes.length,
      // Not measured; see `MediaAsset.durationSeconds`.
      durationSeconds: null,
      voiceId: request.voiceId,
      engine: request.engine,
      language: request.language,
      speechRate: request.rate,
      createdAt: this.deps.clock.now(),
    });

    // `insertIfAbsent` returns the existing row when a concurrent request won the
    // race. Both wrote identical bytes to the same key, so there is nothing to clean
    // up — but the call was still billed, so it is not reported as a cache hit.
    return { asset: stored, cached: false };
  }

  async findById(assetId: string): Promise<MediaAsset | null> {
    return await this.deps.assets.findById(assetId);
  }

  /**
   * The bytes of one asset, for the playback route.
   *
   * The key comes from the row, never from the request, which is what keeps the
   * route from being a file-reading primitive. A row whose file is missing returns
   * `null` rather than throwing, so a hand-deleted file is a 404 rather than a
   * server error.
   */
  async readBytes(assetId: string): Promise<{
    readonly asset: MediaAsset;
    readonly bytes: Uint8Array;
  } | null> {
    const asset = await this.deps.assets.findById(assetId);

    if (asset === null) {
      return null;
    }

    const bytes = await this.deps.storage.get(asset.objectKey);

    return bytes === null ? null : { asset, bytes };
  }

  /**
   * Removes one asset and its file.
   *
   * Row first, then the file: a row with no file is a broken player, whereas a file
   * with no row is unreferenced bytes that the next identical request replaces. If
   * the file delete fails, the owner still sees the clip gone and re-generating it
   * works.
   */
  async delete(assetId: string): Promise<void> {
    const asset = await this.deps.assets.findById(assetId);

    if (asset === null) {
      throw new AudioAssetNotFoundError(assetId);
    }

    await this.deps.assets.delete(assetId);
    await this.deps.storage.delete(asset.objectKey);
  }

  /** Everything stored, for the audio settings view. */
  async findLibrary(): Promise<AudioLibraryView> {
    const [assets, totalCount, totalByteSize] = await Promise.all([
      this.deps.assets.list(AUDIO_LIST_LIMIT),
      this.deps.assets.count(),
      this.deps.assets.totalByteSize(),
    ]);

    return {
      assets,
      totalCount,
      totalByteSize,
      provider: this.deps.gateway.provider,
      voiceIdZh: this.deps.voices.voiceIdZh,
      voiceIdEn: this.deps.voices.voiceIdEn,
      engine: this.deps.voices.engine,
    };
  }

  /** The full request one input becomes, with configuration applied. */
  private speechRequestFor(input: SpeechRequestInput): SpeechRequest {
    return {
      text: input.text,
      language: input.language,
      voiceId: voiceIdFor(this.deps.voices, input.language),
      engine: this.deps.voices.engine,
      rate: input.rate ?? DEFAULT_SPEECH_RATE,
    };
  }

  /**
   * The cache key for one input.
   *
   * The gateway's provider name is part of it, so a clip the fake provider made is
   * never served as if Polly had spoken it. See `canonicalSpeechRequest`.
   */
  private cacheKeyFor(input: SpeechRequestInput): string {
    return sha256Hex(
      canonicalSpeechRequest(
        this.speechRequestFor(input),
        this.deps.gateway.provider,
      ),
    );
  }
}

/** Re-exported so callers do not reach into the domain for the content type. */
export { AUDIO_CONTENT_TYPE };
