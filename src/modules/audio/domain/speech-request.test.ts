import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/platform/hash";
import type { SpeechRequest } from "./speech-request";
import {
  canonicalSpeechRequest,
  hasSpeakableText,
  MAX_SPEECH_TEXT_LENGTH,
  normalizeSpeechText,
} from "./speech-request";

/**
 * Cache identity.
 *
 * These cases are the cost control for the whole feature. A key that is too
 * forgiving serves the wrong sound for a word; a key that is too strict pays Polly
 * again for a sound that is already on disk.
 */

const REQUEST: SpeechRequest = {
  text: "学习",
  language: "zh",
  voiceId: "Zhiyu",
  engine: "neural",
  rate: "medium",
};

/** The key as the facade computes it, so the tests exercise the real thing. */
function keyOf(request: SpeechRequest, provider = "polly"): string {
  return sha256Hex(canonicalSpeechRequest(request, provider));
}

describe("normalizeSpeechText", () => {
  it("collapses every run of whitespace to one space", () => {
    expect(normalizeSpeechText("the  quick\t\tbrown\n\nfox")).toBe(
      "the quick brown fox",
    );
  });

  it("trims the ends", () => {
    expect(normalizeSpeechText("  \n学习 \t")).toBe("学习");
  });

  it("leaves case, punctuation, and characters alone", () => {
    // A speech engine reads all three, so folding any of them would make two
    // genuinely different utterances collide.
    expect(normalizeSpeechText("S3 vs. EC2 — really?")).toBe(
      "S3 vs. EC2 — really?",
    );
  });

  it("is idempotent", () => {
    const once = normalizeSpeechText(" a  b ");

    expect(normalizeSpeechText(once)).toBe(once);
  });
});

describe("canonicalSpeechRequest", () => {
  it("names every field the specification lists", () => {
    // `SPEC.md` section 12.3: normalized text, language, voice, engine, speech
    // rate, and the remaining configuration.
    expect(canonicalSpeechRequest(REQUEST, "polly")).toBe(
      [
        "text=学习",
        "language=zh",
        "voice=Zhiyu",
        "engine=neural",
        "rate=medium",
        "configuration=format:mp3;provider:polly",
      ].join("\n"),
    );
  });

  it("labels each field, so two fields cannot be confused for one", () => {
    // Without labels, a voice named "neural" with an empty engine would produce the
    // same string as an empty voice with the neural engine.
    const voiceNamedLikeAnEngine = keyOf({
      ...REQUEST,
      voiceId: "neural",
      engine: "standard",
    });
    const other = keyOf({ ...REQUEST, voiceId: "", engine: "neural" });

    expect(voiceNamedLikeAnEngine).not.toBe(other);
  });
});

describe("the cache key", () => {
  it("is the same for text that differs only in whitespace", () => {
    expect(keyOf({ ...REQUEST, text: "  学习\n" })).toBe(keyOf(REQUEST));
  });

  it("is stable across calls", () => {
    expect(keyOf(REQUEST)).toBe(keyOf({ ...REQUEST }));
  });

  it.each([
    ["different text", { text: "学生" }],
    ["different case", { text: "Study" }],
    ["different language", { language: "en" as const }],
    ["a different voice", { voiceId: "Joanna" }],
    ["a different engine", { engine: "standard" as const }],
    ["a different rate", { rate: "slow" as const }],
  ])("differs for %s", (_label, change) => {
    expect(keyOf({ ...REQUEST, ...change })).not.toBe(keyOf(REQUEST));
  });

  it("differs for a different provider", () => {
    // The case that matters in practice: a clip generated while the fake provider
    // was configured must not be served after switching to Polly. It would be a
    // permanent cache hit on a placeholder tone, on exactly the word the owner is
    // trying to learn, with no way out but deleting every clip by hand.
    expect(keyOf(REQUEST, "fake")).not.toBe(keyOf(REQUEST, "polly"));
  });

  it("is a hex sha256, so it is safe as a filename", () => {
    expect(keyOf(REQUEST)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hasSpeakableText", () => {
  it.each(["", " ", "\n\t "])("rejects %j as having nothing to say", (text) => {
    expect(hasSpeakableText(text)).toBe(false);
  });

  it("accepts a single character", () => {
    expect(hasSpeakableText("好")).toBe(true);
  });

  it("accepts text at the limit and refuses text past it", () => {
    expect(hasSpeakableText("a".repeat(MAX_SPEECH_TEXT_LENGTH))).toBe(true);
    expect(hasSpeakableText("a".repeat(MAX_SPEECH_TEXT_LENGTH + 1))).toBe(
      false,
    );
  });

  it("measures the normalized text, not the raw text", () => {
    // Padding is not content, so whitespace must not push text over the limit.
    const padded = `  ${"a".repeat(MAX_SPEECH_TEXT_LENGTH)}  `;

    expect(hasSpeakableText(padded)).toBe(true);
  });
});
