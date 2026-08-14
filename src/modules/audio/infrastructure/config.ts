/**
 * Speech configuration (`SPEC.md` section 17).
 *
 * Read from the environment, resolved once at composition, and never from domain,
 * application, or component code — the same shape as
 * `resolveLanguageModelConfig`, deliberately, so there is one pattern for "which
 * provider am I talking to" rather than two:
 *
 * - `SPEECH_PROVIDER` — `fake` or `polly`. Defaults to `fake`, so a fresh clone
 *   plays a placeholder clip with no AWS account and no spend.
 * - `POLLY_VOICE_ID_ZH` — the Mandarin voice. Defaults to Zhiyu.
 * - `POLLY_VOICE_ID_EN` — the English voice. Defaults to Joanna.
 * - `POLLY_ENGINE` — `neural` or `standard`. Defaults to `neural`.
 * - `AWS_REGION` — passed to the SDK when set; otherwise the SDK's own default
 *   chain resolves it, which is what already reads the owner's profile. The same
 *   variable the Bedrock adapter reads, because one account is one region here.
 *
 * **Credentials are never configured here.** The Polly client resolves them through
 * the AWS default provider chain, so no key, token, or profile secret is read,
 * stored, logged, or rendered (`spec/SECURITY.md`). A missing credential surfaces as
 * a `NOT_AUTHORIZED` speech failure, not as a printed value.
 *
 * The production guard is here rather than in the gateway for the same reason it is
 * in the generation config: a deployment that would serve placeholder beeps as
 * pronunciation is a configuration mistake, and it must fail when the container
 * starts rather than when the owner presses play on a word they are trying to learn.
 */

import { SpeechNotConfiguredError } from "@/modules/audio/domain/errors";
import { isFakeSpeechProvider } from "@/modules/audio/domain/speech-provider";
import type { SpeechEngine } from "@/modules/audio/domain/speech-request";
import { SPEECH_ENGINES } from "@/modules/audio/domain/speech-request";
import type { VoiceSettings } from "@/modules/audio/domain/voice-settings";

export type SpeechProviderName = "fake" | "polly";

export const SPEECH_PROVIDER_NAMES: readonly SpeechProviderName[] = [
  "fake",
  "polly",
];

/**
 * The default provider.
 *
 * `fake` rather than `polly`: the safe default is the one that cannot spend the
 * owner's money or send their content to a third party by accident.
 */
export const DEFAULT_SPEECH_PROVIDER: SpeechProviderName = "fake";

/**
 * Default Mandarin voice.
 *
 * Zhiyu is the only Chinese Mandarin voice Polly offers with a neural version, so it
 * is both the sensible default and the one that satisfies the default engine.
 */
export const DEFAULT_VOICE_ID_ZH = "Zhiyu";

/**
 * Default English voice.
 *
 * Joanna: a US English neural voice, long-standing and unlikely to be withdrawn.
 * Configurable because accent preference is a matter of taste, and an owner
 * preparing for an exam with British material may want Amy instead.
 */
export const DEFAULT_VOICE_ID_EN = "Joanna";

/**
 * Default engine.
 *
 * `neural` rather than `standard`: pronunciation is the entire point of this
 * feature, and neural voices are noticeably clearer on exactly the case that matters
 * — a single word with no sentence around it. Neural costs about four times as much
 * per character, which for a personal bank of a few thousand short terms is still
 * cents, and every clip is cached so it is paid for once.
 *
 * **There is no automatic fallback to `standard`.** If the configured voice does not
 * support neural, Polly raises `EngineNotSupportedException`, which becomes an
 * `ENGINE_UNSUPPORTED` failure whose message names the two variables to change.
 * Silently downgrading would be worse: the owner would get a quieter, less accurate
 * clip, cached permanently under a key that claims it is neural, with nothing on
 * screen to say why it sounds different from the others.
 */
export const DEFAULT_SPEECH_ENGINE: SpeechEngine = "neural";

/**
 * The environment as this module reads it.
 *
 * A plain string map rather than `NodeJS.ProcessEnv`, for the reason the generation
 * config gives: Next augments that type with required members, which would force
 * every test to supply variables this function never looks at.
 */
export type EnvironmentReader = Readonly<Record<string, string | undefined>>;

export interface SpeechConfig {
  readonly provider: SpeechProviderName;
  readonly voiceIdZh: string;
  readonly voiceIdEn: string;
  readonly engine: SpeechEngine;
  /** `null` means "let the AWS SDK resolve the region itself". */
  readonly region: string | null;
}

/**
 * Reads and validates the configuration.
 *
 * Throws `SpeechNotConfiguredError` rather than returning a partial value: a
 * misconfigured provider has no safe interpretation, and the error carries a
 * sentence naming the variable to fix.
 */
export function resolveSpeechConfig(
  environment: EnvironmentReader = process.env,
): SpeechConfig {
  const configured = read(environment.SPEECH_PROVIDER);
  const provider =
    configured === null ? DEFAULT_SPEECH_PROVIDER : toProviderName(configured);
  const isProduction = read(environment.APP_ENV) === "production";

  if (isProduction && provider !== "polly") {
    // Loud on purpose. A production deployment serving placeholder audio would
    // teach the owner nothing while looking exactly like a working feature.
    throw new SpeechNotConfiguredError(
      `APP_ENV is production, so SPEECH_PROVIDER must be "polly". It is ${
        configured === null ? "not set" : `"${configured}"`
      }.`,
    );
  }

  return {
    provider,
    voiceIdZh: read(environment.POLLY_VOICE_ID_ZH) ?? DEFAULT_VOICE_ID_ZH,
    voiceIdEn: read(environment.POLLY_VOICE_ID_EN) ?? DEFAULT_VOICE_ID_EN,
    engine: toEngine(read(environment.POLLY_ENGINE)),
    region: read(environment.AWS_REGION),
  };
}

function toProviderName(value: string): SpeechProviderName {
  const provider = SPEECH_PROVIDER_NAMES.find(
    (candidate) => candidate === value,
  );

  if (provider === undefined) {
    throw new SpeechNotConfiguredError(
      `SPEECH_PROVIDER must be one of ${SPEECH_PROVIDER_NAMES.join(
        ", ",
      )}. It is "${value}".`,
    );
  }

  return provider;
}

function toEngine(value: string | null): SpeechEngine {
  if (value === null) {
    return DEFAULT_SPEECH_ENGINE;
  }

  const engine = SPEECH_ENGINES.find((candidate) => candidate === value);

  if (engine === undefined) {
    throw new SpeechNotConfiguredError(
      `POLLY_ENGINE must be one of ${SPEECH_ENGINES.join(
        ", ",
      )}. It is "${value}".`,
    );
  }

  return engine;
}

function read(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();

  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Whether the study surfaces should offer audio at all.
 *
 * The answer to the failure that made this feature useless on first contact: with
 * `SPEECH_PROVIDER` unset the placeholder provider synthesized silent MP3s, and a card
 * offering pronunciation that plays nothing is worse than a card offering none — the
 * owner cannot tell a missing variable from a broken player.
 *
 * So a play control is a *configured* feature. Unconfigured, the study screens render
 * no control whatsoever: no dead button, no silent clip, nothing to explain. What is
 * missing is explained in one place, `/settings/audio`, which is a management surface
 * and may name a variable.
 *
 * `APP_ENV=test` is the exception, and it is narrow: the component tests drive the
 * whole play path against the fake gateway, and they must keep doing so with no AWS
 * account. Those tests pass the flag explicitly rather than relying on this function —
 * this branch exists so that a manual run under `APP_ENV=test` behaves like the suite.
 */
export function isSpeechConfigured(
  environment: EnvironmentReader = process.env,
): boolean {
  if (read(environment.APP_ENV) === "test") {
    return true;
  }

  return !isFakeSpeechProvider(resolveSpeechConfig(environment).provider);
}

/**
 * The configuration reduced to what the facade needs.
 *
 * The provider name and the region stay here: they choose which adapter to build,
 * which is composition's business, not the facade's.
 */
export function toVoiceSettings(config: SpeechConfig): VoiceSettings {
  return {
    voiceIdZh: config.voiceIdZh,
    voiceIdEn: config.voiceIdEn,
    engine: config.engine,
  };
}
