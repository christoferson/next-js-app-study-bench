import { DomainError } from "@/shared/domain-error";

/**
 * Domain errors for the audio module.
 *
 * Expected failures are explicit error types with stable codes, each mapping its
 * message to the form field that caused it (`spec/ARCHITECTURE.md` section 6.5).
 *
 * As in ai-generation, none of these carries a provider message, request
 * identifier, or stack trace: a speech failure is reduced to a category before it
 * reaches this file, so nothing that could hold account or credential detail can be
 * rendered or logged (`spec/SECURITY.md`).
 */

export type AudioDomainErrorCode =
  | "AUDIO_ASSET_NOT_FOUND"
  | "SPEECH_NOT_CONFIGURED"
  | "SPEECH_TEXT_NOT_SPEAKABLE"
  | "SPEECH_FAILED";

export class AudioAssetNotFoundError extends DomainError {
  readonly code = "AUDIO_ASSET_NOT_FOUND";

  constructor(readonly assetId: string) {
    super(`No audio asset matches "${assetId}".`);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": ["That audio clip no longer exists."] };
  }
}

/**
 * There was nothing to say.
 *
 * Reachable when a card's term is empty or whitespace, or when a body of text is
 * longer than one request may be. Both are worth refusing before a provider call
 * rather than after: an empty request is billed as a rejection, and a very long one
 * is billed in full.
 */
export class SpeechTextNotSpeakableError extends DomainError {
  readonly code = "SPEECH_TEXT_NOT_SPEAKABLE";

  constructor(readonly detail: string) {
    super(detail);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": [this.detail] };
  }
}

/**
 * Speech was attempted without usable configuration.
 *
 * Raised at composition in production, and surfaced on the page so the owner sees a
 * configuration problem rather than a silently missing player.
 */
export class SpeechNotConfiguredError extends DomainError {
  readonly code = "SPEECH_NOT_CONFIGURED";

  constructor(readonly detail: string) {
    super(detail);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": [this.detail] };
  }
}

/**
 * What went wrong when a provider refused to speak.
 *
 * The same shape as `GenerationFailureCategory`, and for the same reason: the class
 * of the SDK exception is kept and its text is thrown away, because a Polly error
 * message can carry an account identifier or a request id.
 */
export type SpeechFailureCategory =
  | "NOT_AUTHORIZED"
  | "VOICE_UNAVAILABLE"
  | "ENGINE_UNSUPPORTED"
  | "TEXT_TOO_LONG"
  | "PROVIDER_THROTTLED"
  | "PROVIDER_REJECTED_REQUEST"
  | "PROVIDER_UNAVAILABLE"
  | "UNEXPECTED";

/**
 * Owner-facing advice for a category.
 *
 * Every category gets a sentence that names something the owner can actually do.
 * "Something went wrong" is not one of them.
 */
export function describeSpeechFailure(category: SpeechFailureCategory): string {
  switch (category) {
    case "NOT_AUTHORIZED":
      return "The AWS credentials in use are not allowed to synthesize speech. Check that the profile has polly:SynthesizeSpeech.";
    case "VOICE_UNAVAILABLE":
      return "Amazon Polly does not offer that voice for this language. Check POLLY_VOICE_ID_ZH and POLLY_VOICE_ID_EN.";
    case "ENGINE_UNSUPPORTED":
      return "That voice does not support the configured engine. Set POLLY_ENGINE to standard, or choose a voice that supports neural.";
    case "TEXT_TOO_LONG":
      return "That text is too long for one clip. Read it in smaller pieces.";
    case "PROVIDER_THROTTLED":
      return "Amazon Polly is rate-limiting requests. Wait a moment and try again.";
    case "PROVIDER_REJECTED_REQUEST":
      return "Amazon Polly rejected the request. Check the configured voice, engine, and language.";
    case "PROVIDER_UNAVAILABLE":
      return "Amazon Polly could not be reached. Check the network connection and try again.";
    case "UNEXPECTED":
      return "Speech synthesis failed for an unrecognised reason. Try again; if it persists the configuration is likely wrong.";
  }
}

/**
 * A speech failure reduced to a category.
 *
 * A `DomainError` here, unlike ai-generation's `ProviderFailure`: there is no run
 * record to write the outcome onto, so the owner-facing surface for a failed
 * synthesis is the page they pressed the button on, which means it has to render as
 * a field message.
 */
export class SpeechFailedError extends DomainError {
  readonly code = "SPEECH_FAILED";

  constructor(readonly category: SpeechFailureCategory) {
    super(describeSpeechFailure(category));
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": [describeSpeechFailure(this.category)] };
  }
}
