import { z } from "zod";
import {
  EXCERPT_RELEVANCES,
  SOURCE_VERIFICATION_VERDICTS,
  VERIFICATION_NOTE_LIMIT,
  VERIFICATION_SUMMARY_LIMIT,
} from "@/modules/ai-generation/domain/source-verification";
import type { SourceVerification } from "@/modules/ai-generation/domain/source-verification";
import type {
  JsonSchema,
  StructuredValidation,
} from "@/modules/ai-generation/ports/language-model-gateway";
import { enumOf } from "@/shared/schema-fields";

/**
 * Application-owned schema for one source verification, used in both directions.
 *
 * The same one-schema-two-directions design `question-review-schema.ts` documents: what
 * the validator accepts is exactly what goes into `generation_runs.proposed_payload`, so
 * the verification panel cannot render a verdict that would not have been accepted, and a
 * hand-edited row fails the same way a bad answer would (`spec/CODING-STANDARDS.md`
 * section 2).
 *
 * What is absent matters as much as what is here. There is no field that can carry
 * replacement question text and no field that can carry an excerpt: the verifier cites the
 * passages it was shown *by number*, and the excerpt text on screen is read back from the
 * chunk rows rather than from the model's answer. So a model cannot quote a document
 * inaccurately into the owner's evidence panel, and it cannot rewrite the question
 * (`spec/AI-GUIDELINES.md` section 1.10).
 */

/** Non-empty text the model must supply, bounded and trimmed. */
const requiredModelText = (limit: number) =>
  z
    .string({ message: "must be a string" })
    .max(limit, { message: `use ${limit} characters or fewer` })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: "must not be empty" });

const optionalModelText = (limit: number) =>
  z
    .string({ message: "must be a string" })
    .max(limit, { message: `use ${limit} characters or fewer` })
    .nullish()
    .transform((value) => {
      const trimmed = (value ?? "").trim();

      return trimmed.length === 0 ? null : trimmed;
    });

const excerptSchema = z.object({
  excerptIndex: z
    .number({ message: "must be a number" })
    .int({ message: "must be a whole number" })
    .min(1, { message: "must be 1 or greater" }),
  relevance: enumOf(
    EXCERPT_RELEVANCES,
    `must be one of ${EXCERPT_RELEVANCES.join(", ")}`,
  ),
  note: optionalModelText(VERIFICATION_NOTE_LIMIT),
});

/**
 * How many per-excerpt assessments one answer may carry.
 *
 * The grounding cap, because there is no point accepting assessments of more excerpts than
 * a request can ever send.
 */
const MAX_ASSESSMENTS = 10;

/**
 * The verification as the provider returns it.
 *
 * `excerpts` is optional and defaults to empty for the reason a review's `findings` is:
 * "none of these passages is about this question" is a real answer, and a model that omits
 * the key has said it. The verdict and the summary are required — a verification with no
 * conclusion is not one, and there is no local repair for a missing judgement.
 */
const responseSchema = z.object({
  verdict: enumOf(
    SOURCE_VERIFICATION_VERDICTS,
    `must be one of ${SOURCE_VERIFICATION_VERDICTS.join(", ")}`,
  ),
  summary: requiredModelText(VERIFICATION_SUMMARY_LIMIT),
  excerpts: z
    .array(excerptSchema)
    .max(MAX_ASSESSMENTS, {
      message: `assess ${MAX_ASSESSMENTS} excerpts or fewer`,
    })
    .nullish()
    .transform((values) => values ?? []),
});

/**
 * The validator the gateway calls.
 *
 * `excerptCount` is the request's own fact, so it is checked here rather than in the
 * schema: an assessment of excerpt 7 in a request that sent four is *dropped*, not a
 * rejection of the whole answer. That is the opposite of how a generated question's
 * out-of-range citation is treated, and deliberately so — a question with phantom evidence
 * is unusable, while a verdict with one unreadable footnote is still the verdict, and
 * discarding it would cost the owner a model call over a numbering slip.
 */
export function sourceVerificationValidator(
  excerptCount: number,
): (payload: unknown) => StructuredValidation<SourceVerification> {
  return (payload) => {
    const result = responseSchema.safeParse(payload);

    if (!result.success) {
      return { ok: false, errors: describeIssues(result.error) };
    }

    const seen = new Set<number>();

    return {
      ok: true,
      value: {
        verdict: result.data.verdict,
        summary: result.data.summary,
        excerpts: result.data.excerpts.filter((excerpt) => {
          if (
            excerpt.excerptIndex > excerptCount ||
            seen.has(excerpt.excerptIndex)
          ) {
            return false;
          }

          seen.add(excerpt.excerptIndex);

          return true;
        }),
      },
    };
  };
}

/** The verification as stored on the run row: the accepted value, unchanged. */
export function serializeSourceVerification(
  verification: SourceVerification,
): string {
  return JSON.stringify(verification);
}

/**
 * A stored verification, re-validated.
 *
 * `null` for unreadable JSON and for a payload that no longer validates, so the question
 * page says the check can no longer be read instead of returning a 500 for a row somebody
 * edited by hand. The excerpt count is not re-checked on read: the indexes were narrowed
 * when the answer was accepted, and the panel resolves each one against the excerpts the
 * run recorded — an index with no excerpt renders as a number without a quote rather than
 * as an error.
 */
export function readSourceVerification(
  payload: string | null,
): SourceVerification | null {
  if (payload === null) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  // A stored payload is read back with no upper bound on the indexes, because the bound is
  // a property of the request that produced it and was already applied then.
  const result = sourceVerificationValidator(Number.MAX_SAFE_INTEGER)(parsed);

  return result.ok ? result.value : null;
}

/**
 * Zod issues as repair feedback.
 *
 * Paths and expectations only, never the value that failed: a validation message travels
 * back to the provider, and the value here can contain the model's quotation of the
 * owner's own question or of their source (`spec/AI-GUIDELINES.md` section 1.7).
 */
function describeIssues(error: z.ZodError): readonly string[] {
  return error.issues.slice(0, 10).map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join(".");

    return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
  });
}

/** Name of the tool the provider is asked to fill in. */
export const SOURCE_VERIFICATION_SCHEMA_NAME = "source_verification";

export const SOURCE_VERIFICATION_SCHEMA_DESCRIPTION =
  "Whether the numbered excerpts from the owner's own sources support the answer this practice question marks as correct.";

/**
 * The answer shape sent to the provider.
 *
 * The descriptions are prompt, not documentation. The one that matters most is on
 * `NOT_SUPPORTED`: a model asked "do these support it?" will reach for a negative verdict
 * when the passages are simply about something else, and the difference between "my exam
 * guide is silent" and "my exam guide disagrees" is the difference between a note and a
 * dispute. It is stated at the field, where the model is most likely to still be reading.
 */
export function sourceVerificationJsonSchema(excerptCount: number): JsonSchema {
  return {
    type: "object",
    description: SOURCE_VERIFICATION_SCHEMA_DESCRIPTION,
    required: ["verdict", "summary"],
    additionalProperties: false,
    properties: {
      verdict: {
        type: "string",
        description:
          "SUPPORTED when the excerpts state or clearly imply the marked answer. PARTIALLY_SUPPORTED when they support part of it, or support it only by inference. NOT_SUPPORTED when the excerpts simply do not address it — silence, not disagreement. CONTRADICTED only when an excerpt states something incompatible with the marked answer.",
        enum: [...SOURCE_VERIFICATION_VERDICTS],
      },
      summary: {
        type: "string",
        description:
          "Your reasoning, for the owner to read. Say what the excerpts do and do not establish. If you contradict the question, say which excerpt and what it says instead. Do not rewrite the question or propose replacement wording.",
      },
      excerpts: {
        type: "array",
        description:
          "One entry per excerpt you have something to say about. Omit excerpts that are not about this question rather than padding the list.",
        maxItems: MAX_ASSESSMENTS,
        items: {
          type: "object",
          required: ["excerptIndex", "relevance"],
          additionalProperties: false,
          properties: {
            excerptIndex: {
              type: "integer",
              description: `The excerpt's number as it was given, from 1 to ${excerptCount}.`,
              minimum: 1,
              maximum: Math.max(excerptCount, 1),
            },
            relevance: {
              type: "string",
              description:
                "SUPPORTS when this excerpt backs the marked answer, CONTRADICTS when it says something incompatible with it, UNRELATED when it is about something else.",
              enum: [...EXCERPT_RELEVANCES],
            },
            note: {
              type: "string",
              description:
                "One or two sentences on what this excerpt establishes. Omit for an unrelated excerpt.",
              nullable: true,
            },
          },
        },
      },
    },
  };
}
