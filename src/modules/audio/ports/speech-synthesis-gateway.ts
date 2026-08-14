import type { SpeechRequest } from "@/modules/audio/domain/speech-request";

/**
 * Application-defined speech-synthesis gateway
 * (`spec/AI-GUIDELINES.md` section 3.1).
 *
 * Application and domain code never import the Polly SDK. Everything they need from
 * a speech provider is expressed here in plain data: what to say, in which voice,
 * and the bytes that came back.
 *
 * The port is deliberately one method. Polly also lists voices, manages lexicons,
 * and returns speech marks; none of those has a caller in D10, and a method with no
 * caller is an unused abstraction (`spec/ARCHITECTURE.md` section 3). Listing voices
 * is what a future "choose a voice" setting would need, and speech marks are what
 * word-level highlighting would need — both belong to the milestone that adds the
 * feature.
 *
 * Caching is *not* part of this port. An implementation is asked to speak and it
 * speaks; whether the application should have asked at all is the facade's decision,
 * made against the database before it gets here. Putting the cache behind the port
 * would make "did this cost money?" an implementation detail of whichever adapter
 * happened to be installed.
 */

export interface SynthesizedSpeech {
  /** The audio bytes, in the format the request asked for. */
  readonly bytes: Uint8Array;
  /** As reported by the provider, for example `audio/mpeg`. */
  readonly contentType: string;
  /**
   * Characters the provider billed for, when it reports them.
   *
   * Recorded nowhere yet; it is here because it is the one cost signal Polly
   * returns, and a live synthesis reports it in the milestone's verification.
   */
  readonly billedCharacters: number | null;
}

export interface SpeechSynthesisGateway {
  /** Identifies the provider, for example `polly`. */
  readonly provider: string;

  /**
   * Speaks `request`, or throws `SpeechFailedError`.
   *
   * Implementations must never return empty bytes: a zero-length MP3 would be
   * cached as a successful asset and would then play silence forever.
   */
  synthesize(request: SpeechRequest): Promise<SynthesizedSpeech>;
}
