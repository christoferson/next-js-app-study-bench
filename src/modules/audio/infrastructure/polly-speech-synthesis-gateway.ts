import {
  EngineNotSupportedException,
  InvalidSampleRateException,
  InvalidSsmlException,
  LanguageNotSupportedException,
  LexiconNotFoundException,
  PollyClient,
  ServiceFailureException,
  ServiceQuotaExceededException,
  SynthesizeSpeechCommand,
  TextLengthExceededException,
  ThrottlingException,
  ValidationException,
} from "@aws-sdk/client-polly";
import type {
  SynthesizeSpeechCommandInput,
  SynthesizeSpeechCommandOutput,
  VoiceId,
} from "@aws-sdk/client-polly";
import { SpeechFailedError } from "@/modules/audio/domain/errors";
import type { SpeechFailureCategory } from "@/modules/audio/domain/errors";
import type { SpeechRequest } from "@/modules/audio/domain/speech-request";
import { normalizeSpeechText } from "@/modules/audio/domain/speech-request";
import type {
  SpeechSynthesisGateway,
  SynthesizedSpeech,
} from "@/modules/audio/ports/speech-synthesis-gateway";

/**
 * Amazon Polly speech-synthesis gateway (`spec/AI-GUIDELINES.md` section 3.1).
 *
 * The only file in the application that imports the Polly SDK. Everything above it
 * sees plain data through `SpeechSynthesisGateway`, and
 * `module-boundaries.test.ts` asserts that this file and its own test are the only
 * importers.
 *
 * **Plain text by default, SSML only for a slow rate.** A request at the normal rate
 * is sent as plain text, because plain text has no markup for a `<` or an `&` in the
 * owner's content to collide with. A slow rate needs `prosody`, which needs SSML, so
 * those requests are wrapped and the text is escaped on the way in. Sending SSML
 * unconditionally would mean every clip depended on the escaping being right; this
 * way the common path does not depend on it at all.
 *
 * **`LanguageCode` is deliberately not sent.** Polly needs it only for bilingual
 * voices, and the voice already determines the language. Sending a language code
 * derived from the application's own two-letter tag would break the moment the owner
 * configures a voice from another locale — `POLLY_VOICE_ID_EN=Amy` is `en-GB`, and
 * pairing it with `en-US` is a request that can be rejected for no good reason.
 *
 * **`SampleRate` is deliberately not sent** either, so each engine's default applies
 * (24 kHz for neural, 22.05 kHz for standard). It is not part of the cache key for
 * the same reason: the application never varies it.
 *
 * **Safety.** Nothing from the provider's own error text is ever kept: every
 * exception is reduced to a `SpeechFailureCategory` before it leaves this file,
 * because a Polly error message can carry an account identifier or a request id
 * (`spec/SECURITY.md`). Nothing is logged here, so no owner text and no credential
 * can reach a log through this path.
 */

/**
 * The slice of the Polly client this adapter uses.
 *
 * Narrowed to `send` so the request and response mapping is testable against a stub,
 * with no network and no credentials (`spec/TESTING.md` section 5).
 */
export interface PollySynthesizeClient {
  send(
    command: SynthesizeSpeechCommand,
  ): Promise<SynthesizeSpeechCommandOutput>;
}

export interface PollySpeechSynthesisGatewayOptions {
  /** `null` leaves region resolution to the AWS SDK's default chain. */
  readonly region?: string | null;
  /** Injected in tests; production builds one from the region. */
  readonly client?: PollySynthesizeClient;
}

/** Recorded as the provider on assets this gateway produces. */
export const POLLY_PROVIDER = "polly";

export class PollySpeechSynthesisGateway implements SpeechSynthesisGateway {
  readonly provider = POLLY_PROVIDER;

  private readonly client: PollySynthesizeClient;

  constructor(options: PollySpeechSynthesisGatewayOptions = {}) {
    this.client =
      options.client ??
      new PollyClient(
        options.region === undefined || options.region === null
          ? {}
          : { region: options.region },
      );
  }

  async synthesize(request: SpeechRequest): Promise<SynthesizedSpeech> {
    const spoken = normalizeSpeechText(request.text);
    const useSsml = request.rate !== "medium";
    const input: SynthesizeSpeechCommandInput = {
      OutputFormat: "mp3",
      Text: useSsml ? toSsml(spoken, request.rate) : spoken,
      TextType: useSsml ? "ssml" : "text",
      // A configured voice is passed through as the owner set it. The SDK types
      // this as a closed union, but that union is a snapshot of the voices that
      // existed when the package was published, and Polly is the authority on which
      // voices exist now. Refusing a voice the service would accept would make a
      // newly released voice unusable until a dependency bump; an unknown one comes
      // back as `VOICE_UNAVAILABLE`, which names the variable to fix.
      VoiceId: request.voiceId as VoiceId,
      Engine: request.engine,
    };

    const response = await this.send(input);
    const bytes = await collect(response.AudioStream);

    if (bytes === null || bytes.length === 0) {
      // A successful response with no audio would otherwise be cached as an asset
      // that plays silence forever.
      throw new SpeechFailedError("UNEXPECTED");
    }

    return {
      bytes,
      contentType: response.ContentType ?? "audio/mpeg",
      billedCharacters: response.RequestCharacters ?? null,
    };
  }

  /**
   * Sends the command, translating every provider error into a category.
   *
   * The caught error is never re-thrown and never inspected for text: only its class
   * decides the category, so no provider message can escape this method.
   */
  private async send(
    input: SynthesizeSpeechCommandInput,
  ): Promise<SynthesizeSpeechCommandOutput> {
    try {
      return await this.client.send(new SynthesizeSpeechCommand(input));
    } catch (error) {
      if (error instanceof SpeechFailedError) {
        throw error;
      }

      throw new SpeechFailedError(categorize(error));
    }
  }
}

/**
 * Which failure category a provider error is.
 *
 * Exported for the adapter's mapping test, which asserts every class this
 * application can encounter maps to a category the owner is given advice for.
 */
export function categorize(error: unknown): SpeechFailureCategory {
  if (error instanceof EngineNotSupportedException) {
    return "ENGINE_UNSUPPORTED";
  }

  if (error instanceof LanguageNotSupportedException) {
    return "VOICE_UNAVAILABLE";
  }

  if (error instanceof TextLengthExceededException) {
    return "TEXT_TOO_LONG";
  }

  if (
    error instanceof ThrottlingException ||
    error instanceof ServiceQuotaExceededException
  ) {
    return "PROVIDER_THROTTLED";
  }

  if (
    error instanceof ValidationException ||
    error instanceof InvalidSsmlException ||
    error instanceof InvalidSampleRateException ||
    error instanceof LexiconNotFoundException
  ) {
    return "PROVIDER_REJECTED_REQUEST";
  }

  if (error instanceof ServiceFailureException) {
    return "PROVIDER_UNAVAILABLE";
  }

  // Credentials are not configured by this application, so a permission problem
  // arrives as a service error rather than a typed Polly exception: Polly's own
  // model has no `AccessDeniedException`. It is matched on the error name, which the
  // SDK sets from the service's error code, and never on the message.
  if (isAccessDenied(error)) {
    return "NOT_AUTHORIZED";
  }

  // A network error, a DNS failure, or an aborted request arrives as a plain
  // `Error`. "The call did not reach Polly" is the honest reading, and its advice —
  // check the network and retry — is right for all of them.
  if (isNetworkError(error)) {
    return "PROVIDER_UNAVAILABLE";
  }

  return "UNEXPECTED";
}

/**
 * Whether an error is a credential or permission refusal.
 *
 * Matched on the error name and the HTTP status the SDK attaches, both of which are
 * stable machine-readable fields, rather than on the message, which is the one part
 * of an error that can carry an ARN or an account number.
 */
function isAccessDenied(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const name = (error as { readonly name?: unknown }).name;
  const status = (
    error as {
      readonly $metadata?: { readonly httpStatusCode?: unknown };
    }
  ).$metadata?.httpStatusCode;

  return (
    (typeof name === "string" &&
      [
        "AccessDenied",
        "AccessDeniedException",
        "UnrecognizedClientException",
        "InvalidSignatureException",
        "ExpiredTokenException",
        "CredentialsProviderError",
      ].includes(name)) ||
    status === 401 ||
    status === 403
  );
}

/**
 * Whether an error is a transport failure rather than a service response.
 *
 * Matched on the Node error `code` rather than on the message, for the reason above.
 */
function isNetworkError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = (error as { readonly code?: unknown }).code;
  const name = (error as { readonly name?: unknown }).name;

  return (
    (typeof code === "string" &&
      [
        "ENOTFOUND",
        "ECONNREFUSED",
        "ECONNRESET",
        "EAI_AGAIN",
        "ETIMEDOUT",
        "EPIPE",
      ].includes(code)) ||
    name === "TimeoutError" ||
    name === "AbortError"
  );
}

/**
 * The text wrapped in the SSML a slow rate needs.
 *
 * Exported for the adapter's test, which asserts that owner content cannot break out
 * of the markup.
 */
export function toSsml(text: string, rate: string): string {
  return `<speak><prosody rate="${rate}">${escapeSsml(text)}</prosody></speak>`;
}

/**
 * Owner text as SSML character data.
 *
 * `&` first, then `<` and `>`: escaping `&` after the others would double-escape the
 * ampersands they introduced. Quotes are not escaped because the text never lands in
 * an attribute — every attribute value in `toSsml` is an application constant.
 *
 * Without this, a card whose content contains `<` would produce an
 * `InvalidSsmlException` at best, and at worst would let stored content alter the
 * markup around it.
 */
function escapeSsml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * The audio stream as bytes.
 *
 * `transformToByteArray` is the method the SDK's stream mixin provides in every
 * runtime it supports, so it is preferred; the async-iterable path is the fallback
 * for a stub or a runtime where the mixin is absent. A plain `Uint8Array` comes back
 * either way, because object storage and the route handler are typed on that rather
 * than on a Node `Buffer`.
 */
async function collect(stream: unknown): Promise<Uint8Array | null> {
  if (stream === null || stream === undefined) {
    return null;
  }

  const candidate = stream as {
    readonly transformToByteArray?: () => Promise<Uint8Array>;
    readonly [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array>;
  };

  if (typeof candidate.transformToByteArray === "function") {
    return await candidate.transformToByteArray();
  }

  if (typeof candidate[Symbol.asyncIterator] === "function") {
    const chunks: Uint8Array[] = [];
    let total = 0;

    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
      total += chunk.length;
    }

    const bytes = new Uint8Array(total);
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }

    return bytes;
  }

  return null;
}
