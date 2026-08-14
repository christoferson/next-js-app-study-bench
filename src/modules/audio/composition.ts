import "server-only";
import { systemClock } from "@/platform/clock";
import { cryptoIdGenerator } from "@/platform/id-generator";
import { getDatabaseContainer } from "@/platform/database/composition";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import { resolveAudioStorageRoot } from "@/platform/storage/config";
import { LocalFileObjectStorage } from "@/platform/storage/local-file-object-storage";
import type { ObjectStorage } from "@/platform/storage/object-storage";
import { AudioFacade } from "@/modules/audio/application/audio-facade";
import type { SpeechSynthesisGateway } from "@/modules/audio/ports/speech-synthesis-gateway";
import type { SpeechConfig } from "@/modules/audio/infrastructure/config";
import {
  isSpeechConfigured,
  resolveSpeechConfig,
  toVoiceSettings,
} from "@/modules/audio/infrastructure/config";
import { FakeSpeechSynthesisGateway } from "@/modules/audio/infrastructure/fake-speech-synthesis-gateway";
import { PollySpeechSynthesisGateway } from "@/modules/audio/infrastructure/polly-speech-synthesis-gateway";
import { SqliteMediaAssetRepository } from "@/modules/audio/infrastructure/sqlite-media-asset-repository";

/**
 * Server-only composition root for audio.
 *
 * This is the one place that decides which speech provider the application talks to
 * and where the bytes are kept, and it is the only reason `resolveSpeechConfig` is
 * called: the facade, the domain, the routes, and the components never read
 * `process.env` (`spec/ARCHITECTURE.md` section 4).
 *
 * Both choices are wiring decisions, which is what makes the whole audio flow
 * runnable with no AWS account: `SPEECH_PROVIDER=fake` swaps one constructor here,
 * and the storage adapter becomes `S3ObjectStorage` in D13 by swapping the other.
 *
 * **Failing loudly in production.** `resolveSpeechConfig` throws when
 * `APP_ENV=production` and the provider is anything but `polly`, and this function
 * calls it before it builds anything. A production container configured to serve
 * placeholder beeps as pronunciation therefore fails at composition rather than
 * teaching the owner nothing while looking like a working feature
 * (`SPEC.md` section 17).
 *
 * There is no transaction runner here. Every write this module makes is a single
 * statement — one asset row inserted or deleted — and the file it points at lives
 * outside the database, so a transaction could not have made the pair atomic anyway.
 * The facade's write ordering is what handles a partial failure.
 */
export function createAudioFacade(
  database: SqliteDatabase,
  /**
   * Overrides the configured gateway.
   *
   * Used by tests that want the fake gateway regardless of the environment.
   * Production callers omit it.
   */
  gateway?: SpeechSynthesisGateway,
  /** Overrides the storage adapter, for the same reason. */
  storage?: ObjectStorage,
): AudioFacade {
  const config = resolveSpeechConfig();

  return new AudioFacade({
    assets: new SqliteMediaAssetRepository(database),
    storage: storage ?? new LocalFileObjectStorage(resolveAudioStorageRoot()),
    gateway: gateway ?? createSpeechSynthesisGateway(config),
    voices: toVoiceSettings(config),
    clock: systemClock,
    ids: cryptoIdGenerator,
  });
}

/**
 * The gateway the environment asks for.
 *
 * Exhaustive over the provider names, so adding a provider must decide here rather
 * than falling through to a default that would silently be the fake one.
 */
export function createSpeechSynthesisGateway(
  config: SpeechConfig = resolveSpeechConfig(),
): SpeechSynthesisGateway {
  switch (config.provider) {
    case "polly":
      return new PollySpeechSynthesisGateway({ region: config.region });
    case "fake":
      return new FakeSpeechSynthesisGateway();
  }
}

let facade: AudioFacade | null = null;

export function getAudioFacade(): AudioFacade {
  if (facade === null) {
    facade = createAudioFacade(getDatabaseContainer().database);
  }

  return facade;
}

/**
 * Whether a study screen should offer pronunciation.
 *
 * Read here rather than in a page, because the environment belongs to composition
 * (`spec/ARCHITECTURE.md` section 4). A page passes the boolean down; no component ever
 * learns which provider is installed, so no study surface can name one.
 *
 * `false` means the play control is not rendered at all — see `isSpeechConfigured` for
 * why that is better than a control that plays silence.
 */
export function isAudioEnabled(): boolean {
  return isSpeechConfigured();
}
