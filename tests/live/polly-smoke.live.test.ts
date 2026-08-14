import { describe, expect, it } from "vitest";
import type { SpeechRequest } from "@/modules/audio/domain/speech-request";
import { DEFAULT_SPEECH_RATE } from "@/modules/audio/domain/speech-request";
import { voiceIdFor } from "@/modules/audio/domain/voice-settings";
import { PollySpeechSynthesisGateway } from "@/modules/audio/infrastructure/polly-speech-synthesis-gateway";
import {
  resolveSpeechConfig,
  toVoiceSettings,
} from "@/modules/audio/infrastructure/config";

/**
 * Opt-in live Amazon Polly smoke test.
 *
 * **This test spends money**, though very little: Polly bills per character and this
 * synthesizes two short phrases. It is excluded from `npm test` in the same two
 * independent ways the Bedrock smoke test is (`spec/TESTING.md` section 5):
 *
 * 1. It lives outside `src/`, and `vitest.config.mts` includes `src/` only.
 * 2. Even under `npm run test:live`, every case skips unless
 *    `STUDYBENCH_LIVE_AI_TESTS=1` is set.
 *
 * It writes nothing to `./data`: the gateway is exercised directly, so no asset is
 * cached and no file is stored. That keeps the test from depending on — or polluting
 * — the owner's own audio library.
 *
 * It is not a milestone gate. Its purpose is the one question no stubbed test can
 * answer: does the request this adapter builds actually produce audio from the real
 * service, with real credentials, for the configured voices.
 *
 * Credentials come from the AWS default provider chain and nothing here reads,
 * prints, or asserts one (`spec/SECURITY.md`). The only details reported are the
 * voice, the engine, the region, the byte count, and the characters Polly billed.
 *
 * Run it with:
 *
 * ```
 * STUDYBENCH_LIVE_AI_TESTS=1 SPEECH_PROVIDER=polly npm run test:live
 * ```
 */

const ENABLED = process.env.STUDYBENCH_LIVE_AI_TESTS === "1";

/** The MP3 frame sync every MPEG audio frame starts with. */
function looksLikeMp3(bytes: Uint8Array): boolean {
  // An ID3 tag is also a valid start, and Polly may emit one.
  const isId3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  const isFrame = bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0;

  return isId3 || isFrame;
}

describe.skipIf(!ENABLED)("Amazon Polly, live", () => {
  it.each([
    // One Mandarin term — the case the whole feature exists for — and one short
    // English stem. Two phrases, not a batch: nothing here loops over content.
    ["a Mandarin vocabulary term", "学习", "zh" as const],
    [
      "an English question stem",
      "Which service stores objects?",
      "en" as const,
    ],
  ])("speaks %s", async (_label, text, language) => {
    const config = resolveSpeechConfig();
    const gateway = new PollySpeechSynthesisGateway({ region: config.region });
    const voices = toVoiceSettings(config);
    const request: SpeechRequest = {
      text,
      language,
      voiceId: voiceIdFor(voices, language),
      engine: voices.engine,
      rate: DEFAULT_SPEECH_RATE,
    };

    const speech = await gateway.synthesize(request);

    expect(speech.bytes.length).toBeGreaterThan(0);
    expect(speech.contentType).toBe("audio/mpeg");
    expect(looksLikeMp3(speech.bytes)).toBe(true);

    // Reported so the run can be described without quoting the audio: none of these
    // is a secret, and the billed characters are what the cost note in `README.md`
    // is measured in.
    console.log(
      [
        `language: ${language}`,
        `voice: ${request.voiceId}`,
        `engine: ${request.engine}`,
        `region: ${config.region ?? "resolved by the AWS default chain"}`,
        `bytes: ${speech.bytes.length}`,
        `billedCharacters: ${speech.billedCharacters ?? "not reported"}`,
      ].join(" | "),
    );
  });
});
