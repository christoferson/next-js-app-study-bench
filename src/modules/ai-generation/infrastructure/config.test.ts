import { describe, expect, it } from "vitest";
import { GenerationNotConfiguredError } from "@/modules/ai-generation/domain/errors";
import { DEFAULT_BEDROCK_MODEL_ID, resolveLanguageModelConfig } from "./config";

/**
 * Configuration resolution (`SPEC.md` section 17).
 *
 * The environment is passed in rather than mutated, so these tests never touch
 * `process.env` and cannot leak a value into another test file.
 *
 * The property that matters most is the last one: a production deployment configured
 * to fabricate content must fail loudly rather than fill the owner's bank with demo
 * items.
 */

describe("resolveLanguageModelConfig", () => {
  it("defaults to the provider that cannot spend money", () => {
    const config = resolveLanguageModelConfig({});

    expect(config.provider).toBe("fake");
    expect(config.modelId).toBe(DEFAULT_BEDROCK_MODEL_ID);
    expect(config.reviewModelId).toBe(DEFAULT_BEDROCK_MODEL_ID);
    expect(config.region).toBeNull();
  });

  it("defaults to a cross-region inference profile identifier", () => {
    // A bare model id fails validation in most regions, so the default is the form
    // that works without further configuration.
    expect(DEFAULT_BEDROCK_MODEL_ID).toMatch(/^[a-z]{2}\./);
  });

  it("selects Bedrock when asked", () => {
    expect(
      resolveLanguageModelConfig({ LANGUAGE_MODEL_PROVIDER: "bedrock" })
        .provider,
    ).toBe("bedrock");
  });

  it("treats a blank value as unset", () => {
    expect(
      resolveLanguageModelConfig({
        LANGUAGE_MODEL_PROVIDER: "   ",
        BEDROCK_MODEL_ID: "",
        AWS_REGION: " ",
      }),
    ).toEqual({
      provider: "fake",
      modelId: DEFAULT_BEDROCK_MODEL_ID,
      reviewModelId: DEFAULT_BEDROCK_MODEL_ID,
      region: null,
    });
  });

  it("takes the model and region the owner configured", () => {
    const config = resolveLanguageModelConfig({
      LANGUAGE_MODEL_PROVIDER: "bedrock",
      BEDROCK_MODEL_ID: " demo.model-id:0 ",
      AWS_REGION: " ap-northeast-1 ",
    });

    expect(config.modelId).toBe("demo.model-id:0");
    expect(config.region).toBe("ap-northeast-1");
  });

  describe("the model each purpose calls", () => {
    /**
     * Writing and judging are configured separately, and the precedence is stated
     * once: the purpose-specific variable, then `BEDROCK_MODEL_ID`, then the default.
     *
     * The property that matters is that no combination leaves a purpose unset. A
     * review with no model would be a run that either cannot record what it asked or
     * records `null`, and provenance must always name the model that was called.
     */
    it("uses one model for both purposes when only the shared variable is set", () => {
      const config = resolveLanguageModelConfig({
        BEDROCK_MODEL_ID: "demo.shared:0",
      });

      expect(config.modelId).toBe("demo.shared:0");
      expect(config.reviewModelId).toBe("demo.shared:0");
    });

    it("gives each purpose its own model when both are set", () => {
      const config = resolveLanguageModelConfig({
        BEDROCK_MODEL_ID: "demo.shared:0",
        BEDROCK_GENERATION_MODEL_ID: " demo.writer:0 ",
        BEDROCK_REVIEW_MODEL_ID: " demo.judge:0 ",
      });

      expect(config.modelId).toBe("demo.writer:0");
      expect(config.reviewModelId).toBe("demo.judge:0");
    });

    it("moves only the purpose that was configured", () => {
      // The case the split exists for: a stronger model for scrutiny, the shared one
      // for everything that writes.
      const config = resolveLanguageModelConfig({
        BEDROCK_MODEL_ID: "demo.shared:0",
        BEDROCK_REVIEW_MODEL_ID: "demo.judge:0",
      });

      expect(config.modelId).toBe("demo.shared:0");
      expect(config.reviewModelId).toBe("demo.judge:0");
    });

    it("falls back to the default for a purpose with nothing set anywhere", () => {
      const config = resolveLanguageModelConfig({
        BEDROCK_GENERATION_MODEL_ID: "demo.writer:0",
      });

      expect(config.modelId).toBe("demo.writer:0");
      expect(config.reviewModelId).toBe(DEFAULT_BEDROCK_MODEL_ID);
    });

    it("treats a blank purpose variable as unset rather than as an empty model id", () => {
      const config = resolveLanguageModelConfig({
        BEDROCK_MODEL_ID: "demo.shared:0",
        BEDROCK_GENERATION_MODEL_ID: "  ",
        BEDROCK_REVIEW_MODEL_ID: "",
      });

      expect(config.modelId).toBe("demo.shared:0");
      expect(config.reviewModelId).toBe("demo.shared:0");
    });
  });

  it("leaves the region to the AWS default chain when it is not set", () => {
    // The owner's profile is what resolves it, and this application must not read
    // that profile itself.
    expect(resolveLanguageModelConfig({}).region).toBeNull();
  });

  it("refuses an unrecognised provider and names the variable to fix", () => {
    const failure = (() => {
      try {
        resolveLanguageModelConfig({ LANGUAGE_MODEL_PROVIDER: "openai" });

        return null;
      } catch (error: unknown) {
        return error;
      }
    })();

    expect(failure).toBeInstanceOf(GenerationNotConfiguredError);

    if (!(failure instanceof GenerationNotConfiguredError)) {
      return;
    }

    expect(failure.message).toContain("LANGUAGE_MODEL_PROVIDER");
    expect(failure.message).toContain("bedrock");
  });

  it("refuses to run in production with the fake provider", () => {
    expect(() =>
      resolveLanguageModelConfig({
        APP_ENV: "production",
        LANGUAGE_MODEL_PROVIDER: "fake",
      }),
    ).toThrow(GenerationNotConfiguredError);
  });

  it("refuses to run in production with no provider configured at all", () => {
    // The default is safe locally and wrong in production, so the absence of the
    // variable must fail there rather than fall back.
    expect(() => resolveLanguageModelConfig({ APP_ENV: "production" })).toThrow(
      /not set/,
    );
  });

  it("allows production with Bedrock configured", () => {
    expect(
      resolveLanguageModelConfig({
        APP_ENV: "production",
        LANGUAGE_MODEL_PROVIDER: "bedrock",
      }).provider,
    ).toBe("bedrock");
  });

  it("never reports a credential in its error text", () => {
    const failure = (() => {
      try {
        resolveLanguageModelConfig({
          APP_ENV: "production",
          LANGUAGE_MODEL_PROVIDER: "fake",
          AWS_ACCESS_KEY_ID: "AKIAEXAMPLENOTREAL",
          AWS_SECRET_ACCESS_KEY: "not-a-real-secret",
        });

        return null;
      } catch (error: unknown) {
        return error instanceof Error ? error.message : "";
      }
    })();

    expect(failure).not.toBeNull();
    expect(failure).not.toContain("AKIAEXAMPLENOTREAL");
    expect(failure).not.toContain("not-a-real-secret");
  });
});
