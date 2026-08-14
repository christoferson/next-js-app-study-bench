import { describe, expect, it } from "vitest";
import {
  basicContent,
  clozeContent,
  enrichedVocabularyContent,
  reversedContent,
  scenarioContent,
  vocabularyContent,
} from "@/modules/flashcards/infrastructure/test-support";
import type { VocabularyContent } from "@/modules/flashcards/domain/flashcard-content";
import { flashcardClipRequests, questionClipRequests } from "./content-clips";

/**
 * What can be listened to, and — more importantly — what cannot.
 *
 * The negative assertions are the point of this file. The owner's reason for wanting
 * audio is hearing a Chinese term pronounced correctly, and the ways to get that wrong
 * are speaking a romanisation with a Mandarin voice, speaking the answer, and burying
 * the term among controls for text that is read rather than learned. Each is asserted
 * here rather than being left to a reading of the switch.
 */

function texts(clips: readonly { readonly text: string }[]): readonly string[] {
  return clips.map((clip) => clip.text);
}

describe("flashcardClipRequests", () => {
  it("offers the term of a vocabulary card", () => {
    const clips = flashcardClipRequests(vocabularyContent(), "zh");

    expect(texts(clips)).toEqual(["学习"]);
    expect(clips.map((clip) => clip.key)).toEqual(["term"]);
    expect(clips.map((clip) => clip.label)).toEqual(["Term"]);
  });

  it("never offers the reading, which is a romanisation for the eye", () => {
    // `xuéxí` read by a Mandarin voice is between nonsense and a mispronunciation, and
    // this is the one card type the whole feature exists for.
    const clips = flashcardClipRequests(vocabularyContent(), "zh");

    expect(texts(clips)).not.toContain("xuéxí");
  });

  it("never offers the meaning, which is the answer and in the wrong language", () => {
    const clips = flashcardClipRequests(vocabularyContent(), "zh");

    expect(texts(clips)).not.toContain("to study; to learn");
  });

  it("never offers the example sentence", () => {
    // The owner's call after using it: a vocabulary card is for one word, and a column
    // of buttons down the answer face invites pressing all of them. An example is also
    // where the characters cost most, for the part of the card that is read.
    const clips = flashcardClipRequests(vocabularyContent(), "zh");

    expect(texts(clips)).not.toContain("我每天学习汉语。");
  });

  it("offers the term only, however many examples the card carries", () => {
    // An enriched card has three examples, so this is where a per-example control would
    // have shown up as four buttons.
    const clips = flashcardClipRequests(enrichedVocabularyContent(), "zh");

    expect(texts(clips)).toEqual(["学习"]);
  });

  it("never offers an example's sentence, reading, or translation", () => {
    const spoken = texts(
      flashcardClipRequests(enrichedVocabularyContent(), "zh"),
    ).join(" ");

    expect(spoken).not.toContain("他在学习开车。");
    expect(spoken).not.toContain("tā zài xuéxí kāichē");
    expect(spoken).not.toContain("He is learning to drive");
  });

  it("carries the language it was given onto every clip", () => {
    const clips = flashcardClipRequests(enrichedVocabularyContent(), "zh");

    expect(clips.every((clip) => clip.language === "zh")).toBe(true);
  });

  it("asks for the normal rate, by leaving the rate out", () => {
    // An omitted rate rather than an explicit `medium`, so the default lives in one
    // place and a clip generated from a card matches one generated anywhere else.
    const clips = flashcardClipRequests(vocabularyContent(), "zh");

    expect(clips.every((clip) => clip.rate === undefined)).toBe(true);
  });

  it("offers a card with no example only its term", () => {
    const content: VocabularyContent = {
      type: "VOCABULARY",
      term: "学习",
      reading: null,
      meaning: "to study",
      exampleSentence: null,
    };

    expect(texts(flashcardClipRequests(content, "zh"))).toEqual(["学习"]);
  });

  it("offers nothing for a term of only whitespace", () => {
    // Stored content is validated, so this should not exist — but a dead control that
    // fails on being pressed is worse than no control.
    const content: VocabularyContent = {
      type: "VOCABULARY",
      term: "   ",
      reading: null,
      meaning: "to study",
      exampleSentence: null,
    };

    expect(flashcardClipRequests(content, "zh")).toEqual([]);
  });

  it.each([
    ["a basic card", basicContent()],
    ["a reversed card", reversedContent()],
    ["a cloze card", clozeContent()],
    ["a scenario card", scenarioContent()],
  ])("offers nothing for %s", (_label, content) => {
    // A scope decision, not an oversight: on these types the text is what the owner
    // reads, and a cloze prompt spoken aloud would say "open bracket ellipsis".
    expect(flashcardClipRequests(content, "en")).toEqual([]);
  });
});

describe("questionClipRequests", () => {
  it("offers the stem", () => {
    const clips = questionClipRequests(
      { stem: "Which service stores objects?" },
      "en",
    );

    expect(clips).toEqual([
      {
        key: "stem",
        label: "Question",
        text: "Which service stores objects?",
        language: "en",
      },
    ]);
  });

  it("offers nothing for a blank stem", () => {
    expect(questionClipRequests({ stem: "  " }, "en")).toEqual([]);
  });
});
