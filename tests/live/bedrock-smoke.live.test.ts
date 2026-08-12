import { describe, expect, it } from "vitest";
import { personaForStudyType } from "@/modules/ai-generation/domain/personas";
import { renderPrompt } from "@/modules/ai-generation/domain/prompt-templates";
import { maxOutputTokensFor } from "@/modules/ai-generation/domain/generation-limits";
import {
  QUESTION_SCHEMA_NAME,
  questionOutputJsonSchema,
  validateQuestionOutput,
} from "@/modules/ai-generation/application/output-schemas";
import { checkQuestionDrafts } from "@/modules/ai-generation/domain/deterministic-checks";
import { BedrockLanguageModelGateway } from "@/modules/ai-generation/infrastructure/bedrock-language-model-gateway";
import { resolveLanguageModelConfig } from "@/modules/ai-generation/infrastructure/config";

/**
 * Opt-in live Bedrock smoke test.
 *
 * **This test spends money.** It is excluded from `npm test` in two independent
 * ways, because one would be a single mistake away from a surprise bill
 * (`spec/TESTING.md` section 5):
 *
 * 1. It lives outside `src/`, and `vitest.config.mts` includes `src/` only. The
 *    default suite cannot see this file at all.
 * 2. Even under `npm run test:live`, every case skips unless
 *    `STUDYBENCH_LIVE_AI_TESTS=1` is set.
 *
 * It is not a milestone gate. Its purpose is to answer one question no stubbed test
 * can: does the request this adapter builds actually work against a real model, with
 * real credentials, in the configured region.
 *
 * Credentials come from the AWS default provider chain — the owner's profile, an
 * environment variable, or a task role — and nothing here reads, prints, or asserts
 * one (`spec/SECURITY.md`). The only provider detail reported is the model
 * identifier, the region, and token counts.
 *
 * Run it with:
 *
 * ```
 * STUDYBENCH_LIVE_AI_TESTS=1 LANGUAGE_MODEL_PROVIDER=bedrock npm run test:live
 * ```
 */

const ENABLED = process.env.STUDYBENCH_LIVE_AI_TESTS === "1";

/** One question: the smallest batch that proves the path end to end. */
const ITEM_COUNT = 1;

describe.skipIf(!ENABLED)("Bedrock, live", () => {
  it("writes one usable question that survives the deterministic checks", async () => {
    const config = resolveLanguageModelConfig();
    const gateway = new BedrockLanguageModelGateway({
      modelId: config.modelId,
      region: config.region,
    });
    const persona = personaForStudyType("TECHNICAL_CERTIFICATION");
    const objectives = [
      {
        id: "objective-live-1",
        code: "Demo domain 1",
        title: "Object storage fundamentals",
      },
    ];
    const prompt = renderPrompt("QUESTION", {
      persona,
      trackName: "Live Smoke Demo Track",
      examCode: null,
      objectives,
      spec: {
        itemCount: ITEM_COUNT,
        objectiveIds: [],
        difficulty: 2,
        additionalInstructions: null,
        questionTypes: ["SINGLE_CHOICE"],
        cardTypes: [],
      },
    });

    const result = await gateway.generateStructured({
      system: prompt.system,
      user: prompt.user,
      schemaName: QUESTION_SCHEMA_NAME,
      schemaDescription:
        "Records the practice questions written for this request.",
      schema: questionOutputJsonSchema(["SINGLE_CHOICE"]),
      validate: (value) =>
        validateQuestionOutput(value, {
          contentLanguage: persona.contentLanguage,
        }),
      maxOutputTokens: maxOutputTokensFor("QUESTION", ITEM_COUNT),
    });

    expect(result.value).toHaveLength(ITEM_COUNT);

    // The same checks the facade runs before anything is persisted, so a live answer
    // is held to exactly the standard a fake one is.
    const checked = checkQuestionDrafts(result.value, {
      objectiveIds: objectives.map((objective) => objective.id),
    });

    expect(checked.rejected).toEqual([]);
    expect(checked.accepted).toHaveLength(ITEM_COUNT);

    // Reported so the run can be described without quoting model output: the token
    // counts are what `SPEC.md` section 10.3 records, and nothing here is a secret.
    console.log(
      [
        `model: ${gateway.modelId}`,
        `region: ${config.region ?? "resolved by the AWS default chain"}`,
        `repairAttempted: ${result.repairAttempted}`,
        `usage: ${
          result.usage === null
            ? "not reported"
            : `${result.usage.inputTokens} in, ${result.usage.outputTokens} out, ${result.usage.totalTokens} total`
        }`,
      ].join(" | "),
    );
  });
});
