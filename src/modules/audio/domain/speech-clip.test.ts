import { describe, expect, it } from "vitest";
import type { SpeechClipRequest } from "./speech-clip";
import {
  audioSourcePath,
  clipControlName,
  isOfferableClip,
} from "./speech-clip";

function clipRequest(text: string): SpeechClipRequest {
  return { key: "term", label: "Term", text, language: "zh" };
}

describe("isOfferableClip", () => {
  it.each(["学习", "Which service stores objects?", "。"])(
    "offers a control for %s",
    (text) => {
      expect(isOfferableClip(clipRequest(text))).toBe(true);
    },
  );

  it.each([
    ["an empty string", ""],
    ["spaces", "   "],
    ["a newline", "\n"],
    ["a tab", "\t"],
  ])("offers no control for %s", (_label, text) => {
    expect(isOfferableClip(clipRequest(text))).toBe(false);
  });
});

describe("audioSourcePath", () => {
  it("addresses an asset by id under the playback route", () => {
    expect(audioSourcePath("asset-1")).toBe("/api/audio/asset-1");
  });

  it("encodes an id, so a stored id can never alter the path", () => {
    // Ids are generated, so this should not arise. But this function builds a URL from
    // a stored value, and a `/` or a `?` reaching the browser unencoded would address a
    // different route than the one intended.
    expect(audioSourcePath("a/b?c=d")).toBe("/api/audio/a%2Fb%3Fc%3Dd");
  });

  it("encodes a traversal attempt rather than resolving it", () => {
    expect(audioSourcePath("../../etc/passwd")).toBe(
      "/api/audio/..%2F..%2Fetc%2Fpasswd",
    );
  });
});

describe("clipControlName", () => {
  function named(overrides: Partial<SpeechClipRequest>): string {
    return clipControlName({
      key: "term",
      label: "Term",
      text: "学习",
      language: "zh",
      ...overrides,
    });
  }

  it("quotes a term, which is the most identifying name a control can have", () => {
    expect(named({ text: "学习" })).toBe("学习");
  });

  it("names the part it belongs to for a question stem", () => {
    // A screen reader would otherwise read the whole stem before saying what the button
    // does.
    expect(
      named({
        key: "stem",
        label: "Question",
        text: "Which service stores objects?",
      }),
    ).toBe("the question");
  });

  it("goes by the clip's key, not the length of its text", () => {
    // Eight characters, and a sentence: exactly the case a character count cannot
    // separate from a term, which is why the rule asks the key instead. Any future
    // non-term clip gets the same treatment for free.
    expect(
      named({ key: "sentence", label: "Sentence", text: "我每天学习汉语。" }),
    ).toBe("the sentence");
  });

  it("keeps several clips on one surface distinguishable", () => {
    // Two controls sharing one accessible name would be worse than useless.
    expect(named({ key: "stem", label: "Question 1", text: "A?" })).not.toBe(
      named({ key: "stem", label: "Question 2", text: "B?" }),
    );
  });

  it("falls back for a multi-line term however short", () => {
    expect(named({ label: "Term", text: "A\nB" })).toBe("the term");
  });

  it("falls back for a term long enough to be a sentence", () => {
    // The bank permits any text in the term field, and a control named by a paragraph is
    // not a control anyone can use.
    expect(
      named({ text: "The Simple Storage Service, in full and at length" }),
    ).toBe("the term");
  });

  it("falls back rather than quoting nothing", () => {
    // `isOfferableClip` already excludes these, so this is belt and braces: a control
    // whose accessible name was the empty string would be unusable.
    expect(named({ label: "Term", text: "   " })).toBe("the term");
  });

  it("never says how the audio is made", () => {
    for (const text of ["学习", "Which service stores objects, exactly?"]) {
      expect(named({ text })).not.toMatch(/generat|synthes|cache|provider/i);
    }
  });
});
