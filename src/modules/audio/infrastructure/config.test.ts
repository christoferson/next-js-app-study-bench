import { describe, expect, it } from "vitest";
import { SpeechNotConfiguredError } from "@/modules/audio/domain/errors";
import {
  DEFAULT_SPEECH_ENGINE,
  DEFAULT_SPEECH_PROVIDER,
  DEFAULT_VOICE_ID_EN,
  DEFAULT_VOICE_ID_ZH,
  isSpeechConfigured,
  resolveSpeechConfig,
  toVoiceSettings,
} from "./config";

/**
 * Speech configuration.
 *
 * Two properties matter most: an unconfigured install cannot spend money, and a
 * production install cannot serve placeholder audio.
 *
 * Every case passes an explicit environment object, so nothing here reads or depends
 * on the machine's real variables.
 */

describe("resolveSpeechConfig", () => {
  it("defaults to the provider that cannot spend money", () => {
    expect(resolveSpeechConfig({}).provider).toBe("fake");
    expect(DEFAULT_SPEECH_PROVIDER).toBe("fake");
  });

  it("defaults the voices and the engine", () => {
    const config = resolveSpeechConfig({});

    expect(config.voiceIdZh).toBe(DEFAULT_VOICE_ID_ZH);
    expect(config.voiceIdEn).toBe(DEFAULT_VOICE_ID_EN);
    expect(config.engine).toBe(DEFAULT_SPEECH_ENGINE);
    expect(config.voiceIdZh).toBe("Zhiyu");
    expect(config.voiceIdEn).toBe("Joanna");
    expect(config.engine).toBe("neural");
  });

  it("leaves the region to the AWS SDK when none is set", () => {
    // `null` rather than a hard-coded region, so the owner's profile decides.
    expect(resolveSpeechConfig({}).region).toBeNull();
  });

  it("reads every configured value", () => {
    expect(
      resolveSpeechConfig({
        SPEECH_PROVIDER: "polly",
        POLLY_VOICE_ID_ZH: "Zhiyu",
        POLLY_VOICE_ID_EN: "Amy",
        POLLY_ENGINE: "standard",
        AWS_REGION: "ap-northeast-1",
      }),
    ).toEqual({
      provider: "polly",
      voiceIdZh: "Zhiyu",
      voiceIdEn: "Amy",
      engine: "standard",
      region: "ap-northeast-1",
    });
  });

  it("trims a configured value", () => {
    expect(resolveSpeechConfig({ SPEECH_PROVIDER: " polly " }).provider).toBe(
      "polly",
    );
  });

  it.each(["", "   "])("treats %j as unset", (value) => {
    // A blank variable in a `.env` file is a variable someone commented out by
    // emptying it, not a request for a blank voice name.
    const config = resolveSpeechConfig({
      SPEECH_PROVIDER: value,
      POLLY_VOICE_ID_EN: value,
      POLLY_ENGINE: value,
      AWS_REGION: value,
    });

    expect(config.provider).toBe("fake");
    expect(config.voiceIdEn).toBe(DEFAULT_VOICE_ID_EN);
    expect(config.engine).toBe(DEFAULT_SPEECH_ENGINE);
    expect(config.region).toBeNull();
  });

  it("refuses an unknown provider by name", () => {
    expect(() => resolveSpeechConfig({ SPEECH_PROVIDER: "azure" })).toThrow(
      SpeechNotConfiguredError,
    );
    // The message must name the variable to fix and the values it accepts.
    expect(() => resolveSpeechConfig({ SPEECH_PROVIDER: "azure" })).toThrow(
      /SPEECH_PROVIDER must be one of fake, polly/,
    );
  });

  it("refuses an unknown engine", () => {
    // `generative` and `long-form` are real Polly engines this milestone does not
    // use; accepting them would be offering an option no feature sets.
    expect(() => resolveSpeechConfig({ POLLY_ENGINE: "generative" })).toThrow(
      SpeechNotConfiguredError,
    );
    expect(() => resolveSpeechConfig({ POLLY_ENGINE: "generative" })).toThrow(
      /POLLY_ENGINE must be one of neural, standard/,
    );
  });

  describe("in production", () => {
    it("refuses to start with the fake provider", () => {
      // Loud on purpose: placeholder beeps served as pronunciation would look
      // exactly like a working feature while teaching nothing.
      expect(() => resolveSpeechConfig({ APP_ENV: "production" })).toThrow(
        SpeechNotConfiguredError,
      );
      expect(() =>
        resolveSpeechConfig({ APP_ENV: "production", SPEECH_PROVIDER: "fake" }),
      ).toThrow(/SPEECH_PROVIDER must be "polly"/);
    });

    it("says whether the variable was unset or wrong", () => {
      expect(() => resolveSpeechConfig({ APP_ENV: "production" })).toThrow(
        /It is not set/,
      );
      expect(() =>
        resolveSpeechConfig({ APP_ENV: "production", SPEECH_PROVIDER: "fake" }),
      ).toThrow(/It is "fake"/);
    });

    it("starts with Polly configured", () => {
      expect(
        resolveSpeechConfig({
          APP_ENV: "production",
          SPEECH_PROVIDER: "polly",
        }).provider,
      ).toBe("polly");
    });
  });

  it("allows the fake provider outside production", () => {
    expect(resolveSpeechConfig({ APP_ENV: "development" }).provider).toBe(
      "fake",
    );
  });
});

/**
 * Whether the study surfaces offer audio.
 *
 * This is the guard against the defect that shipped: an unset `SPEECH_PROVIDER` meant the
 * placeholder gateway, which produces valid but silent MP3s, so a card offered
 * pronunciation and then played nothing.
 */
describe("isSpeechConfigured", () => {
  it("is false when nothing is configured, which is the default", () => {
    // The exact state the owner was in. No control is rendered, so no silent clip can be
    // produced and there is nothing to misread as a broken player.
    expect(isSpeechConfigured({})).toBe(false);
  });

  it("is false when the placeholder provider is asked for by name", () => {
    expect(isSpeechConfigured({ SPEECH_PROVIDER: "fake" })).toBe(false);
  });

  it("is true once a real provider is configured", () => {
    expect(isSpeechConfigured({ SPEECH_PROVIDER: "polly" })).toBe(true);
  });

  it("is true under APP_ENV=test, so the suite drives the whole path with no AWS", () => {
    // The narrow exception. Component tests pass the flag explicitly rather than relying
    // on this, but a manual run under `APP_ENV=test` should behave like the suite.
    expect(isSpeechConfigured({ APP_ENV: "test" })).toBe(true);
  });

  it("refuses an unknown provider rather than guessing whether it is real", () => {
    expect(() => isSpeechConfigured({ SPEECH_PROVIDER: "azure" })).toThrow(
      SpeechNotConfiguredError,
    );
  });
});

describe("toVoiceSettings", () => {
  it("carries the voices and the engine, and nothing else", () => {
    // The provider name and the region are composition's business: passing them to
    // the facade would let application code branch on which provider is installed.
    expect(
      toVoiceSettings(
        resolveSpeechConfig({
          SPEECH_PROVIDER: "polly",
          AWS_REGION: "us-east-1",
        }),
      ),
    ).toEqual({
      voiceIdZh: "Zhiyu",
      voiceIdEn: "Joanna",
      engine: "neural",
    });
  });
});
