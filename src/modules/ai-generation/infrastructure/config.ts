/**
 * Language-model configuration (`SPEC.md` section 17).
 *
 * Read from the environment, resolved once at composition, and never from domain,
 * application, or component code. Only three values are configurable, and none of
 * them is a secret:
 *
 * - `LANGUAGE_MODEL_PROVIDER` — `fake` or `bedrock`. Defaults to `fake`, so a fresh
 *   clone runs the whole generation flow with no AWS account and no spend.
 * - `BEDROCK_MODEL_ID` — the model the Bedrock adapter calls, for every purpose that
 *   has no more specific variable set.
 * - `BEDROCK_GENERATION_MODEL_ID` — optional. The model that *writes* content:
 *   questions, flashcards, vocabulary enrichment, objective import.
 * - `BEDROCK_REVIEW_MODEL_ID` — optional. The model that *judges* content: the
 *   question review, and the tutor and grading paths when they arrive.
 * - `AWS_REGION` — passed to the SDK when set; otherwise the SDK's own default
 *   chain resolves it, which is what already reads the owner's profile.
 *
 * **Precedence, per purpose:** the purpose-specific variable, then
 * `BEDROCK_MODEL_ID`, then `DEFAULT_BEDROCK_MODEL_ID`. So an owner who sets nothing
 * gets one sensible model everywhere, an owner who sets `BEDROCK_MODEL_ID` moves
 * every purpose at once, and an owner who sets a purpose-specific variable moves only
 * that purpose. Writing and judging are genuinely different jobs: reviewing a
 * question is one short call whose whole value is scrutiny, so it may be worth a
 * stronger model than the one that writes batches — or a cheaper one, when the point
 * is to sweep a large bank. Splitting them is a configuration change rather than a
 * code change.
 *
 * **Credentials are never configured here.** The Bedrock client resolves them
 * through the AWS default provider chain — environment, shared profile, or task
 * role — so no key, token, or profile secret is read, stored, logged, or rendered by
 * this application (`spec/SECURITY.md`). A missing credential surfaces as a
 * `NOT_AUTHORIZED` run failure, not as a printed value.
 *
 * The production guard is deliberately here rather than in the gateway: a
 * deployment that would silently serve fabricated demo content is a configuration
 * mistake, and it must fail when the container starts, not when the owner presses a
 * button (`SPEC.md` section 17).
 */

import { GenerationNotConfiguredError } from "@/modules/ai-generation/domain/errors";

export type LanguageModelProviderName = "fake" | "bedrock";

export const LANGUAGE_MODEL_PROVIDER_NAMES: readonly LanguageModelProviderName[] =
  ["fake", "bedrock"];

/**
 * The default provider.
 *
 * `fake` rather than `bedrock`: the safe default is the one that cannot spend the
 * owner's money or leak a request to a third party by accident.
 */
export const DEFAULT_LANGUAGE_MODEL_PROVIDER: LanguageModelProviderName =
  "fake";

/**
 * Default Bedrock model.
 *
 * A cross-region inference profile identifier rather than a bare model id: Claude
 * models on Bedrock are served through inference profiles in most regions, and a
 * bare id fails with a validation error there. Sonnet rather than the largest
 * model available, because generating a handful of study items is not a
 * frontier-reasoning task and this default is what an unconfigured install will be
 * billed for. Configurable, because model availability differs per account and
 * region.
 */
export const DEFAULT_BEDROCK_MODEL_ID =
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

/**
 * The environment as this module reads it.
 *
 * A plain string map rather than `NodeJS.ProcessEnv`: Next augments that type with
 * required members such as `NODE_ENV`, which would force every test to supply
 * variables this function never looks at. `process.env` is assignable to it.
 */
export type EnvironmentReader = Readonly<Record<string, string | undefined>>;

export interface LanguageModelConfig {
  readonly provider: LanguageModelProviderName;
  /**
   * The model that writes content: questions, flashcards, enrichment, objective
   * import.
   *
   * Named `modelId` rather than `generationModelId` because it is the one every
   * existing caller means, and renaming it would churn the form views, the live smoke
   * test, and the run provenance for no behavioural gain.
   */
  readonly modelId: string;
  /**
   * The model that judges content: the question review, and later the tutor and
   * grading paths.
   *
   * Always populated — it falls back to `modelId` — so no caller has to decide what a
   * missing review model means, and a run recording it can never record `null`.
   */
  readonly reviewModelId: string;
  /** `null` means "let the AWS SDK resolve the region itself". */
  readonly region: string | null;
}

/**
 * Reads and validates the configuration.
 *
 * Throws `GenerationNotConfiguredError` rather than returning a partial value: a
 * misconfigured provider has no safe interpretation, and the error carries a
 * sentence naming the variable to fix.
 */
export function resolveLanguageModelConfig(
  environment: EnvironmentReader = process.env,
): LanguageModelConfig {
  const configured = read(environment.LANGUAGE_MODEL_PROVIDER);
  const provider =
    configured === null
      ? DEFAULT_LANGUAGE_MODEL_PROVIDER
      : toProviderName(configured);
  const isProduction = read(environment.APP_ENV) === "production";

  if (isProduction && provider !== "bedrock") {
    // Loud on purpose. A production deployment serving fake content would put
    // fabricated demo items in the owner's bank labelled as generated, which is
    // worse than refusing to start.
    throw new GenerationNotConfiguredError(
      `APP_ENV is production, so LANGUAGE_MODEL_PROVIDER must be "bedrock". It is ${
        configured === null ? "not set" : `"${configured}"`
      }.`,
    );
  }

  // One shared fallback resolved once, so the two purposes cannot disagree about what
  // "not configured" means.
  const shared = read(environment.BEDROCK_MODEL_ID) ?? DEFAULT_BEDROCK_MODEL_ID;

  return {
    provider,
    modelId: read(environment.BEDROCK_GENERATION_MODEL_ID) ?? shared,
    reviewModelId: read(environment.BEDROCK_REVIEW_MODEL_ID) ?? shared,
    region: read(environment.AWS_REGION),
  };
}

function toProviderName(value: string): LanguageModelProviderName {
  const provider = LANGUAGE_MODEL_PROVIDER_NAMES.find(
    (candidate) => candidate === value,
  );

  if (provider === undefined) {
    throw new GenerationNotConfiguredError(
      `LANGUAGE_MODEL_PROVIDER must be one of ${LANGUAGE_MODEL_PROVIDER_NAMES.join(
        ", ",
      )}. It is "${value}".`,
    );
  }

  return provider;
}

function read(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();

  return trimmed.length === 0 ? null : trimmed;
}
