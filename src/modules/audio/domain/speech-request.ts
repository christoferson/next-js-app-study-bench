/**
 * What one synthesis request is, and when two of them are the same request.
 *
 * Pure and framework-free: no SDK, no filesystem, no environment. The rule about
 * cache identity lives here, where it can be tested without Polly and without a
 * database, and the platform does the hashing (`src/platform/hash.ts`), exactly as
 * the generation fingerprint is split.
 */

/**
 * The language of the text being spoken, as a BCP-47-style tag.
 *
 * A closed union rather than a free string: the voice for a language is chosen by
 * an exhaustive switch, so adding a third language must decide on a voice rather
 * than silently falling back to an English one.
 */
export type SpeechLanguage = "zh" | "en";

export const SPEECH_LANGUAGES: readonly SpeechLanguage[] = ["zh", "en"];

/**
 * Polly's engine choice, as the application names it.
 *
 * `neural` and `standard` only. Polly also offers `long-form` and `generative`;
 * neither is used by this milestone, both cost more per character, and offering a
 * value no feature sets would be an unused option in owner-facing configuration.
 */
export type SpeechEngine = "neural" | "standard";

export const SPEECH_ENGINES: readonly SpeechEngine[] = ["neural", "standard"];

/**
 * Speaking rate, as the SSML `prosody` rate words.
 *
 * Words rather than percentages: the set is closed, so it is part of the cache key
 * without normalisation questions ("100%" versus "1.0" versus "medium" would be
 * three keys for one rate), and a learner listening to a new word wants "slow",
 * not "88%".
 */
export type SpeechRate = "x-slow" | "slow" | "medium";

export const SPEECH_RATES: readonly SpeechRate[] = ["x-slow", "slow", "medium"];

/** The default rate. Natural pace; the slow rates are for a term being learned. */
export const DEFAULT_SPEECH_RATE: SpeechRate = "medium";

/** One thing to say, fully specified. */
export interface SpeechRequest {
  /** The text to speak, as the owner's content holds it. */
  readonly text: string;
  readonly language: SpeechLanguage;
  readonly voiceId: string;
  readonly engine: SpeechEngine;
  readonly rate: SpeechRate;
}

/**
 * The audio format every asset uses.
 *
 * MP3 rather than Ogg or PCM: it is the format `<audio>` plays in every browser
 * this application targets, including iOS Safari, and it is what Polly returns as
 * `audio/mpeg`.
 */
export const AUDIO_CONTENT_TYPE = "audio/mpeg";

/** How long a single synthesis request may be. */
export const MAX_SPEECH_TEXT_LENGTH = 1500;

/**
 * The text as the cache key sees it.
 *
 * Whitespace only: a trailing newline, a wrapped line, and a run of spaces are the
 * same utterance, and treating them as different requests would pay Polly twice for
 * one sound. Nothing else is touched — case, punctuation, and characters are all
 * things a speech engine reads, so folding them would make two genuinely different
 * utterances collide and serve the wrong audio.
 *
 * The same rule as `normalizeNotes` in the generation fingerprint, for the same
 * reason.
 */
export function normalizeSpeechText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Canonical text of a synthesis request (`SPEC.md` section 12.3).
 *
 * Every field the specification names is present and labelled, in a fixed order:
 * normalized text, language, voice, engine, speech rate, and the remaining speech
 * configuration. Labels rather than bare concatenation, so a voice named `neural`
 * cannot produce the same string as an engine named `neural` with an empty voice.
 *
 * `configuration` is the specification's "additionalConfiguration" slot. It carries
 * the output format and **which provider spoke the words**.
 *
 * The provider is in the key because the same text at the same settings is different
 * audio from a different provider, and one of this application's providers is a
 * placeholder tone. Without it, a clip generated while `SPEECH_PROVIDER=fake` would
 * be a permanent cache hit after switching to `polly`: the owner would press play on
 * a word they are trying to learn and hear a beep, with no way out but deleting every
 * clip by hand. The reverse matters less but is the same bug — a test run against a
 * real clip would silently pass on Polly audio.
 *
 * It is the `configuration` slot rather than a seventh field so the key still matches
 * the specification's shape: `SPEC.md` section 12.3 lists six components, and this is
 * the sixth doing what it is for. Adding a lexicon or a sample rate later is a value
 * change in the same slot.
 */
export function canonicalSpeechRequest(
  request: SpeechRequest,
  provider: string,
): string {
  return [
    `text=${normalizeSpeechText(request.text)}`,
    `language=${request.language}`,
    `voice=${request.voiceId}`,
    `engine=${request.engine}`,
    `rate=${request.rate}`,
    `configuration=format:mp3;provider:${provider}`,
  ].join("\n");
}

/** Whether a request has text worth sending to a provider. */
export function hasSpeakableText(text: string): boolean {
  const normalized = normalizeSpeechText(text);

  return normalized.length > 0 && normalized.length <= MAX_SPEECH_TEXT_LENGTH;
}
