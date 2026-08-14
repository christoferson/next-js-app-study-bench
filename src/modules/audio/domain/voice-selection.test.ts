import { describe, expect, it } from "vitest";
import type { StudyType } from "@/modules/certifications/domain/certification";
import { STUDY_TYPES } from "@/modules/certifications/domain/certification";
import {
  speechLanguageFor,
  speechLanguageForStudyType,
  toSpeechLanguage,
} from "./voice-selection";

/**
 * Voice selection.
 *
 * The rule that decides whether a word is read by a Mandarin or an English voice.
 * Getting it wrong does not merely sound odd — it teaches the wrong pronunciation,
 * which is what the feature exists to prevent.
 */

describe("speechLanguageFor", () => {
  it("prefers the revision's recorded language", () => {
    // Per-item, so an English gloss inside a Chinese track is read in English.
    expect(
      speechLanguageFor({
        contentLanguage: "en",
        studyType: "LANGUAGE_PROFICIENCY",
      }),
    ).toBe("en");
  });

  it("reads a Chinese revision in a Chinese voice", () => {
    expect(
      speechLanguageFor({
        contentLanguage: "zh",
        studyType: "LANGUAGE_PROFICIENCY",
      }),
    ).toBe("zh");
  });

  it.each([null, "", "   "])(
    "falls back to the study type when the column holds %j",
    (contentLanguage) => {
      // Revisions created before the column was populated must still be read in the
      // right voice, and for a language track that is not English.
      expect(
        speechLanguageFor({
          contentLanguage,
          studyType: "LANGUAGE_PROFICIENCY",
        }),
      ).toBe("zh");
    },
  );

  it("falls back when the recorded language has no configured voice", () => {
    // A stored `ja` would otherwise be passed to a provider as a language it was
    // never configured for.
    expect(
      speechLanguageFor({
        contentLanguage: "ja",
        studyType: "LANGUAGE_PROFICIENCY",
      }),
    ).toBe("zh");
  });

  it("never inspects a track name or a provider string", () => {
    // The regression this guards: choosing a voice by searching a name for "HSK".
    // A Chinese track named in English still gets the Chinese voice, and an English
    // track whose name contains "HSK" still gets the English one.
    expect(
      speechLanguageFor({
        contentLanguage: null,
        studyType: "LANGUAGE_PROFICIENCY",
      }),
    ).toBe("zh");
    expect(
      speechLanguageFor({
        contentLanguage: null,
        studyType: "TECHNICAL_CERTIFICATION",
      }),
    ).toBe("en");
  });
});

describe("speechLanguageForStudyType", () => {
  it("decides for every study type", () => {
    // Exhaustive: a new study type must choose a voice rather than default to one.
    for (const studyType of STUDY_TYPES) {
      expect(["zh", "en"]).toContain(
        speechLanguageForStudyType(studyType as StudyType),
      );
    }
  });

  it("reads a language-proficiency track in Chinese", () => {
    expect(speechLanguageForStudyType("LANGUAGE_PROFICIENCY")).toBe("zh");
  });

  it.each<StudyType>(["TECHNICAL_CERTIFICATION", "GENERAL"])(
    "reads a %s track in English",
    (studyType) => {
      expect(speechLanguageForStudyType(studyType)).toBe("en");
    },
  );
});

describe("toSpeechLanguage", () => {
  it.each([
    ["zh", "zh"],
    ["ZH", "zh"],
    ["zh-CN", "zh"],
    ["zh_TW", "zh"],
    [" en ", "en"],
    ["en-GB", "en"],
  ])("reads %j as %j", (value, expected) => {
    expect(toSpeechLanguage(value)).toBe(expected);
  });

  it.each([null, "", "ja", "cmn", "xx-YY"])(
    "reports %j as unspeakable",
    (value) => {
      expect(toSpeechLanguage(value)).toBeNull();
    },
  );
});
