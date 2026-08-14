import type { StudyType } from "@/modules/certifications/domain/certification";
import type { SpeechLanguage } from "./speech-request";
import { SPEECH_LANGUAGES } from "./speech-request";

/**
 * Which language a piece of content is spoken in.
 *
 * The rule, and the reason it is a registry-style exhaustive switch rather than a
 * string test: a voice is chosen from the *content's* language, never by searching a
 * track name for "HSK" or comparing a provider string
 * (`spec/AI-GUIDELINES.md` section 2.1, and the same rule `personaIdForStudyType`
 * follows).
 *
 * There are two sources of truth, in order:
 *
 * 1. The revision's `language` column, when it holds a language this application can
 *    speak. It is the most specific answer available: it was recorded from the
 *    persona that produced the content, and it is per-item, so an English gloss card
 *    inside a Chinese track can still be read in English.
 * 2. The track's study type, when the column is absent, blank, or a language with no
 *    configured voice. Older revisions predate the column being populated, and a
 *    `LANGUAGE_PROFICIENCY` track is Chinese in this installation.
 *
 * Falling back to the study type rather than to English matters for the owner's
 * actual bank: a Chinese term read by an English voice is not merely wrong, it
 * teaches the wrong pronunciation, which is the one thing this feature exists to get
 * right.
 */
export function speechLanguageFor(input: {
  /** The revision's recorded content language, when it has one. */
  readonly contentLanguage: string | null;
  readonly studyType: StudyType;
}): SpeechLanguage {
  const recorded = toSpeechLanguage(input.contentLanguage);

  return recorded ?? speechLanguageForStudyType(input.studyType);
}

/**
 * The language a study type's content is in.
 *
 * Exhaustive over `StudyType`, so adding a study type is a decision about which
 * voice reads it rather than a silent default. `GENERAL` is English for the same
 * reason it uses the technical persona: a general track in this installation is
 * written in English.
 */
export function speechLanguageForStudyType(
  studyType: StudyType,
): SpeechLanguage {
  switch (studyType) {
    case "TECHNICAL_CERTIFICATION":
      return "en";
    case "LANGUAGE_PROFICIENCY":
      return "zh";
    case "GENERAL":
      return "en";
  }
}

/**
 * A recorded language string as a language this application can speak.
 *
 * `null` for anything unrecognised, so the caller falls back rather than passing an
 * arbitrary stored string to Polly as a language code. The tag is lower-cased and
 * its region subtag dropped, because `zh-CN` and `zh` are the same voice here.
 */
export function toSpeechLanguage(value: string | null): SpeechLanguage | null {
  const base = (value ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";

  return SPEECH_LANGUAGES.find((language) => language === base) ?? null;
}
