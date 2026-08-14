import type { SpeechEngine, SpeechLanguage } from "./speech-request";

/**
 * Which voice speaks which language, as plain data.
 *
 * A domain type rather than a field on the infrastructure config, because the facade
 * needs it and application code never imports `infrastructure/`
 * (`spec/ARCHITECTURE.md` section 5). The composition root reads the environment,
 * builds this, and passes it down; nothing below composition knows a variable name.
 */
export interface VoiceSettings {
  readonly voiceIdZh: string;
  readonly voiceIdEn: string;
  readonly engine: SpeechEngine;
}

/**
 * The voice for one language.
 *
 * Exhaustive over `SpeechLanguage`, so a third language cannot be added without
 * deciding which voice reads it — the same rule `speechLanguageForStudyType` follows,
 * and the reason neither is a lookup in a partial record.
 */
export function voiceIdFor(
  settings: VoiceSettings,
  language: SpeechLanguage,
): string {
  switch (language) {
    case "zh":
      return settings.voiceIdZh;
    case "en":
      return settings.voiceIdEn;
  }
}
