import {
  EngineNotSupportedException,
  InvalidSampleRateException,
  InvalidSsmlException,
  LanguageNotSupportedException,
  LexiconNotFoundException,
  ServiceFailureException,
  ServiceQuotaExceededException,
  TextLengthExceededException,
  ThrottlingException,
  ValidationException,
} from "@aws-sdk/client-polly";
import type {
  SynthesizeSpeechCommand,
  SynthesizeSpeechCommandOutput,
} from "@aws-sdk/client-polly";
import { describe, expect, it } from "vitest";
import { SpeechFailedError } from "@/modules/audio/domain/errors";
import type { SpeechFailureCategory } from "@/modules/audio/domain/errors";
import { describeSpeechFailure } from "@/modules/audio/domain/errors";
import type { SpeechRequest } from "@/modules/audio/domain/speech-request";
import type { PollySynthesizeClient } from "./polly-speech-synthesis-gateway";
import {
  categorize,
  PollySpeechSynthesisGateway,
  toSsml,
} from "./polly-speech-synthesis-gateway";

/**
 * The Polly adapter.
 *
 * Request mapping and error mapping against a stub client. **No test here reaches
 * AWS**: nothing constructs a `PollyClient`, so there is no network call, no
 * credential lookup, and no charge (`spec/TESTING.md` section 5). The live smoke
 * check lives in `tests/live/` behind an opt-in variable.
 */

const REQUEST: SpeechRequest = {
  text: "学习",
  language: "zh",
  voiceId: "Zhiyu",
  engine: "neural",
  rate: "medium",
};

const AUDIO = new Uint8Array([0xff, 0xf3, 0x44, 0xc4, 0x00]);

/** A stub client that records commands and replays scripted answers. */
class StubPollyClient implements PollySynthesizeClient {
  readonly commands: SynthesizeSpeechCommand[] = [];

  constructor(
    private readonly answers: readonly (
      SynthesizeSpeechCommandOutput | Error
    )[],
  ) {}

  async send(
    command: SynthesizeSpeechCommand,
  ): Promise<SynthesizeSpeechCommandOutput> {
    this.commands.push(command);

    const answer = this.answers[this.commands.length - 1];

    if (answer === undefined) {
      throw new Error("The stub Polly client ran out of scripted answers.");
    }

    if (answer instanceof Error) {
      throw answer;
    }

    return answer;
  }
}

/**
 * Overrides for a scripted response.
 *
 * Each field is explicitly `| undefined` rather than merely optional, because
 * `exactOptionalPropertyTypes` distinguishes "absent" from "present and undefined" and
 * some cases below need the second: a response that *carries* `AudioStream: undefined`
 * is exactly the malformed answer worth asserting about. The SDK's own output type
 * forbids that shape, which is why the assembled object is cast once, here — the
 * adapter has to survive a response the types say cannot happen, since the types
 * describe an API contract rather than what a wire actually delivers.
 */
type ResponseOverrides = {
  [Field in "AudioStream" | "ContentType" | "RequestCharacters"]?:
    SynthesizeSpeechCommandOutput[Field] | undefined;
};

/** A response whose audio stream exposes the SDK's byte-array helper. */
function audioResponse(
  overrides: ResponseOverrides = {},
): SynthesizeSpeechCommandOutput {
  return {
    $metadata: {},
    ContentType: "audio/mpeg",
    RequestCharacters: 2,
    AudioStream: {
      transformToByteArray: async (): Promise<Uint8Array> => AUDIO,
    } as never,
    ...overrides,
  } as SynthesizeSpeechCommandOutput;
}

function gatewayWith(
  answers: readonly (SynthesizeSpeechCommandOutput | Error)[],
): {
  readonly gateway: PollySpeechSynthesisGateway;
  readonly client: StubPollyClient;
} {
  const client = new StubPollyClient(answers);

  return { gateway: new PollySpeechSynthesisGateway({ client }), client };
}

/** The input of the one command that was sent. */
function sentInput(client: StubPollyClient): Record<string, unknown> {
  const command = client.commands[0];

  if (command === undefined) {
    throw new Error("No command was sent.");
  }

  return command.input as unknown as Record<string, unknown>;
}

describe("PollySpeechSynthesisGateway", () => {
  it("identifies itself as the polly provider", () => {
    const { gateway } = gatewayWith([audioResponse()]);

    expect(gateway.provider).toBe("polly");
  });

  describe("request mapping", () => {
    it("asks for MP3 in the configured voice and engine", async () => {
      const { gateway, client } = gatewayWith([audioResponse()]);

      await gateway.synthesize(REQUEST);

      expect(sentInput(client)).toMatchObject({
        OutputFormat: "mp3",
        VoiceId: "Zhiyu",
        Engine: "neural",
        Text: "学习",
        TextType: "text",
      });
    });

    it("sends plain text at the normal rate", async () => {
      // Plain text has no markup for a `<` or an `&` in the owner's content to
      // collide with, so the common path does not depend on escaping at all.
      const { gateway, client } = gatewayWith([audioResponse()]);

      await gateway.synthesize({ ...REQUEST, text: "A < B && C" });

      expect(sentInput(client)).toMatchObject({
        Text: "A < B && C",
        TextType: "text",
      });
    });

    it("normalizes the text it sends", async () => {
      // Polly bills per character, so trailing whitespace is billable and pointless.
      const { gateway, client } = gatewayWith([audioResponse()]);

      await gateway.synthesize({ ...REQUEST, text: "  学习\n\n习  " });

      expect(sentInput(client)).toMatchObject({ Text: "学习 习" });
    });

    it("sends SSML for a slow rate", async () => {
      const { gateway, client } = gatewayWith([audioResponse()]);

      await gateway.synthesize({ ...REQUEST, rate: "slow" });

      expect(sentInput(client)).toMatchObject({
        Text: '<speak><prosody rate="slow">学习</prosody></speak>',
        TextType: "ssml",
      });
    });

    it("sends no language code", async () => {
      // The voice already determines the language, and a code derived from the
      // application's own two-letter tag would reject `POLLY_VOICE_ID_EN=Amy`, which
      // is en-GB.
      const { gateway, client } = gatewayWith([audioResponse()]);

      await gateway.synthesize(REQUEST);

      expect(sentInput(client).LanguageCode).toBeUndefined();
    });

    it("sends no sample rate, so the engine default applies", async () => {
      const { gateway, client } = gatewayWith([audioResponse()]);

      await gateway.synthesize(REQUEST);

      expect(sentInput(client).SampleRate).toBeUndefined();
    });

    it("sends no lexicons and asks for no speech marks", async () => {
      // Neither has a caller in this milestone; sending either would be paying for
      // or depending on a feature nothing uses.
      const { gateway, client } = gatewayWith([audioResponse()]);

      await gateway.synthesize(REQUEST);

      expect(sentInput(client).LexiconNames).toBeUndefined();
      expect(sentInput(client).SpeechMarkTypes).toBeUndefined();
    });

    it("passes an English voice through unchanged", async () => {
      const { gateway, client } = gatewayWith([audioResponse()]);

      await gateway.synthesize({
        ...REQUEST,
        language: "en",
        voiceId: "Joanna",
        text: "Which service stores objects?",
      });

      expect(sentInput(client)).toMatchObject({ VoiceId: "Joanna" });
    });

    it("passes a voice the installed SDK has never heard of", async () => {
      // Polly is the authority on which voices exist, not the version of the
      // package that happens to be installed.
      const { gateway, client } = gatewayWith([audioResponse()]);

      await gateway.synthesize({ ...REQUEST, voiceId: "Voice-From-Next-Year" });

      expect(sentInput(client)).toMatchObject({
        VoiceId: "Voice-From-Next-Year",
      });
    });

    it("sends the standard engine when it is configured", async () => {
      const { gateway, client } = gatewayWith([audioResponse()]);

      await gateway.synthesize({ ...REQUEST, engine: "standard" });

      expect(sentInput(client)).toMatchObject({ Engine: "standard" });
    });

    it("makes exactly one call per request", async () => {
      // No retry loop: a retried synthesis is a second charge.
      const { gateway, client } = gatewayWith([audioResponse()]);

      await gateway.synthesize(REQUEST);

      expect(client.commands).toHaveLength(1);
    });
  });

  describe("response mapping", () => {
    it("returns the audio bytes, content type, and billed characters", async () => {
      const { gateway } = gatewayWith([audioResponse()]);

      await expect(gateway.synthesize(REQUEST)).resolves.toEqual({
        bytes: AUDIO,
        contentType: "audio/mpeg",
        billedCharacters: 2,
      });
    });

    it("collects an audio stream that is only async-iterable", async () => {
      // The fallback path, for a runtime or a stub without the SDK's stream mixin.
      const { gateway } = gatewayWith([
        audioResponse({
          AudioStream: {
            async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
              yield new Uint8Array([1, 2]);
              yield new Uint8Array([3]);
            },
          } as never,
        }),
      ]);

      const speech = await gateway.synthesize(REQUEST);

      expect(speech.bytes).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("assumes MP3 when the service reports no content type", async () => {
      const { gateway } = gatewayWith([
        audioResponse({ ContentType: undefined }),
      ]);

      await expect(gateway.synthesize(REQUEST)).resolves.toMatchObject({
        contentType: "audio/mpeg",
      });
    });

    it("reports no billed characters when the service reports none", async () => {
      const { gateway } = gatewayWith([
        audioResponse({ RequestCharacters: undefined }),
      ]);

      await expect(gateway.synthesize(REQUEST)).resolves.toMatchObject({
        billedCharacters: null,
      });
    });

    it.each([
      ["a missing stream", { AudioStream: undefined }],
      [
        "an empty stream",
        {
          AudioStream: {
            transformToByteArray: async (): Promise<Uint8Array> =>
              new Uint8Array(),
          } as never,
        },
      ],
    ])("refuses %s rather than caching silence", async (_label, overrides) => {
      // A zero-length asset would be cached as a success and would play nothing
      // forever, with no path by which anything would retry it.
      const { gateway } = gatewayWith([audioResponse(overrides)]);

      await expect(gateway.synthesize(REQUEST)).rejects.toBeInstanceOf(
        SpeechFailedError,
      );
    });
  });

  describe("failures", () => {
    it("reduces a provider error to a category with safe advice", async () => {
      const { gateway } = gatewayWith([
        new ThrottlingException({
          message:
            "Rate exceeded for arn:aws:polly:us-east-1:123456789012:voice/Zhiyu",
          $metadata: { requestId: "req-1" },
        }),
      ]);

      const failure = await gateway
        .synthesize(REQUEST)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(SpeechFailedError);
      expect((failure as SpeechFailedError).category).toBe(
        "PROVIDER_THROTTLED",
      );
      // Neither the provider's own message nor its identifiers survive.
      expect((failure as Error).message).not.toMatch(/arn:aws/);
      expect((failure as Error).message).not.toMatch(/123456789012/);
      expect((failure as Error).message).not.toMatch(/req-1/);
    });

    it("does not retry a failed synthesis", async () => {
      const { gateway, client } = gatewayWith([
        new ServiceFailureException({ message: "down", $metadata: {} }),
      ]);

      await gateway.synthesize(REQUEST).catch(() => undefined);

      expect(client.commands).toHaveLength(1);
    });
  });
});

describe("categorize", () => {
  it.each<[string, Error, SpeechFailureCategory]>([
    [
      "an unsupported engine",
      new EngineNotSupportedException({ message: "no", $metadata: {} }),
      "ENGINE_UNSUPPORTED",
    ],
    [
      "an unsupported language",
      new LanguageNotSupportedException({ message: "no", $metadata: {} }),
      "VOICE_UNAVAILABLE",
    ],
    [
      "text past the limit",
      new TextLengthExceededException({ message: "no", $metadata: {} }),
      "TEXT_TOO_LONG",
    ],
    [
      "throttling",
      new ThrottlingException({ message: "no", $metadata: {} }),
      "PROVIDER_THROTTLED",
    ],
    [
      "an exceeded quota",
      // `quotaCode` and `serviceCode` are required by the SDK's constructor; their
      // values are irrelevant here, because categorisation reads the class, never a
      // field.
      new ServiceQuotaExceededException({
        message: "no",
        $metadata: {},
        quotaCode: undefined,
        serviceCode: undefined,
      }),
      "PROVIDER_THROTTLED",
    ],
    [
      "a rejected request",
      new ValidationException({
        message: "no",
        $metadata: {},
        reason: undefined,
      }),
      "PROVIDER_REJECTED_REQUEST",
    ],
    [
      "invalid SSML",
      new InvalidSsmlException({ message: "no", $metadata: {} }),
      "PROVIDER_REJECTED_REQUEST",
    ],
    [
      "an invalid sample rate",
      new InvalidSampleRateException({ message: "no", $metadata: {} }),
      "PROVIDER_REJECTED_REQUEST",
    ],
    [
      "a missing lexicon",
      new LexiconNotFoundException({ message: "no", $metadata: {} }),
      "PROVIDER_REJECTED_REQUEST",
    ],
    [
      "a service failure",
      new ServiceFailureException({ message: "no", $metadata: {} }),
      "PROVIDER_UNAVAILABLE",
    ],
  ])("maps %s", (_label, error, expected) => {
    expect(categorize(error)).toBe(expected);
  });

  it.each([
    "AccessDenied",
    "AccessDeniedException",
    "UnrecognizedClientException",
    "InvalidSignatureException",
    "ExpiredTokenException",
    "CredentialsProviderError",
  ])("maps a %s error to NOT_AUTHORIZED", (name) => {
    // Polly's model declares no access-denied exception, so a permission problem
    // arrives as a named service error.
    const error = Object.assign(new Error("nope"), { name });

    expect(categorize(error)).toBe("NOT_AUTHORIZED");
  });

  it.each([401, 403])("maps an HTTP %d to NOT_AUTHORIZED", (httpStatusCode) => {
    const error = Object.assign(new Error("nope"), {
      $metadata: { httpStatusCode },
    });

    expect(categorize(error)).toBe("NOT_AUTHORIZED");
  });

  it.each([
    "ENOTFOUND",
    "ECONNREFUSED",
    "ECONNRESET",
    "EAI_AGAIN",
    "ETIMEDOUT",
    "EPIPE",
  ])("maps the transport error %s to PROVIDER_UNAVAILABLE", (code) => {
    const error = Object.assign(new Error("socket"), { code });

    expect(categorize(error)).toBe("PROVIDER_UNAVAILABLE");
  });

  it.each(["TimeoutError", "AbortError"])(
    "maps a %s to PROVIDER_UNAVAILABLE",
    (name) => {
      const error = Object.assign(new Error("gone"), { name });

      expect(categorize(error)).toBe("PROVIDER_UNAVAILABLE");
    },
  );

  it.each([
    ["an unrecognised error", new Error("something else")],
    ["a thrown string", "not an error"],
    ["null", null],
    ["undefined", undefined],
  ])("maps %s to UNEXPECTED", (_label, error) => {
    expect(categorize(error)).toBe("UNEXPECTED");
  });

  it("gives every category advice that names something to do", () => {
    const categories: readonly SpeechFailureCategory[] = [
      "NOT_AUTHORIZED",
      "VOICE_UNAVAILABLE",
      "ENGINE_UNSUPPORTED",
      "TEXT_TOO_LONG",
      "PROVIDER_THROTTLED",
      "PROVIDER_REJECTED_REQUEST",
      "PROVIDER_UNAVAILABLE",
      "UNEXPECTED",
    ];

    for (const category of categories) {
      const advice = describeSpeechFailure(category);

      expect(advice.length).toBeGreaterThan(20);
      expect(advice).toMatch(/\.$/);
    }
  });
});

describe("toSsml", () => {
  it("wraps the text in a prosody rate", () => {
    expect(toSsml("学习", "slow")).toBe(
      '<speak><prosody rate="slow">学习</prosody></speak>',
    );
  });

  it("escapes markup characters in owner content", () => {
    // Without this, stored content could alter the markup around it.
    expect(toSsml("a < b & c > d", "slow")).toBe(
      '<speak><prosody rate="slow">a &lt; b &amp; c &gt; d</prosody></speak>',
    );
  });

  it("cannot be escaped by content that looks like a closing tag", () => {
    const ssml = toSsml("</prosody></speak><prosody rate='x-fast'>", "slow");

    // Exactly one prosody element and one speak element, both the adapter's own.
    expect(ssml.match(/<prosody/g)).toHaveLength(1);
    expect(ssml.match(/<speak>/g)).toHaveLength(1);
    expect(ssml.match(/<\/speak>/g)).toHaveLength(1);
  });

  it("does not double-escape an ampersand it introduced", () => {
    expect(toSsml("&lt;", "slow")).toContain("&amp;lt;");
  });
});
