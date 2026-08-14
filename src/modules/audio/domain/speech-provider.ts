/**
 * Which speech provider spoke, as a plain value.
 *
 * The name lives in the domain — not in the adapter that reports it — for the same
 * reason `FAKE_MODEL_PROVIDER` does in ai-generation: it is part of the cache key, it
 * is stored on nothing but read back by the settings view, and an interface has to be
 * able to ask "was this the placeholder provider" without importing an adapter.
 *
 * It answers the question that made the audio feature fail in practice. The fake
 * provider returns valid but silent MP3 frames, which is exactly right for a test and
 * exactly wrong for a study surface: a card that offered a play button and then played
 * nothing looked like broken audio rather than like unconfigured audio. So the fake
 * provider is now something the interface can detect and refuse to build controls for.
 */

/** Recorded as the provider on assets the placeholder gateway produces. */
export const FAKE_SPEECH_PROVIDER = "fake";

/**
 * Whether a provider name is the placeholder one.
 *
 * A string comparison rather than a type check, because the value also arrives from a
 * stored asset row and from a composed gateway, neither of which is typed as the
 * provider union.
 */
export function isFakeSpeechProvider(provider: string): boolean {
  return provider === FAKE_SPEECH_PROVIDER;
}
