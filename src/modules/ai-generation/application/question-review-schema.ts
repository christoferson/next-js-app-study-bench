import { z } from "zod";
import {
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
  MAX_REVIEW_FINDINGS,
  REVIEW_ACTIONS,
  REVIEW_DETAIL_LIMIT,
  REVIEW_SUMMARY_LIMIT,
  REVIEW_VERDICTS,
  checkReviewConsistency,
} from "@/modules/ai-generation/domain/question-review";
import type { QuestionReview } from "@/modules/ai-generation/domain/question-review";
import type {
  JsonSchema,
  StructuredValidation,
} from "@/modules/ai-generation/ports/language-model-gateway";
import { enumOf } from "@/shared/schema-fields";

/**
 * Application-owned schema for one AI review, and the same schema used to read a stored
 * review back out of the run row.
 *
 * Two directions, one schema, for the reason `objective-import-schema.ts` gives: a
 * model's answer and a database row are both untrusted input
 * (`spec/CODING-STANDARDS.md` section 2), and here they are literally the same value —
 * what goes into `generation_runs.proposed_payload` is exactly what the validator
 * accepted. So the findings panel cannot render a review that would not have been
 * accepted, and a hand-edited row fails where a bad answer would.
 *
 * The permissive-schema-plus-strict-validator split is the same too. The JSON Schema sent
 * to the provider describes the shape and carries the descriptions that tell the model
 * what each field means; this zod schema is the authority, and it additionally runs
 * `checkReviewConsistency`, which is the part a JSON Schema cannot express: the verdict
 * has to agree with the findings.
 *
 * One thing is worth stating about what is *absent*. There is no field anywhere in this
 * schema that can carry replacement question content — no corrected stem, no suggested
 * choice, no `correctedAnswer`. That is `spec/AI-GUIDELINES.md` section 1.10 enforced by
 * construction: a model that returns a rewrite has it dropped as an unknown key rather
 * than having it reach a page where the owner might mistake it for the question.
 */

const VERDICT_KEY = "verdict";
const FINDINGS_KEY = "findings";

/** Non-empty text the model must supply, bounded and trimmed. */
const requiredModelText = (limit: number) =>
  z
    .string({ message: "must be a string" })
    .max(limit, { message: `use ${limit} characters or fewer` })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: "must not be empty" });

const findingSchema = z.object({
  severity: enumOf(
    FINDING_SEVERITIES,
    `must be one of ${FINDING_SEVERITIES.join(", ")}`,
  ),
  category: enumOf(
    FINDING_CATEGORIES,
    `must be one of ${FINDING_CATEGORIES.join(", ")}`,
  ),
  detail: requiredModelText(REVIEW_DETAIL_LIMIT),
});

/**
 * The review as the provider returns it.
 *
 * `findings` is optional and defaults to empty, because "nothing wrong with it" is a
 * real answer and a model that omits the key rather than sending `[]` has said the same
 * thing. Everything else is required: a review with no verdict, no answer judgement, or
 * no summary is not a review, and there is no local repair for a missing conclusion.
 */
const responseSchema = z.object({
  [VERDICT_KEY]: enumOf(
    REVIEW_VERDICTS,
    `must be one of ${REVIEW_VERDICTS.join(", ")}`,
  ),
  answerCorrect: z.boolean({ message: "must be true or false" }),
  [FINDINGS_KEY]: z
    .array(findingSchema)
    .max(MAX_REVIEW_FINDINGS, {
      message: `report ${MAX_REVIEW_FINDINGS} findings or fewer`,
    })
    .nullish()
    .transform((values) => values ?? []),
  suggestedAction: enumOf(
    REVIEW_ACTIONS,
    `must be one of ${REVIEW_ACTIONS.join(", ")}`,
  ),
  summary: requiredModelText(REVIEW_SUMMARY_LIMIT),
});

/**
 * The validator the gateway calls, and the reader the findings panel calls.
 *
 * Shape first, then the domain's consistency rules, because the rules assume a review of
 * the right shape. Both kinds of message are the same kind of thing — a field and an
 * expectation, with none of the owner's text in it — so both are safe to send back to the
 * provider as repair feedback (`spec/AI-GUIDELINES.md` section 1.7).
 */
export function validateQuestionReview(
  payload: unknown,
): StructuredValidation<QuestionReview> {
  const result = responseSchema.safeParse(payload);

  if (!result.success) {
    return { ok: false, errors: describeIssues(result.error) };
  }

  const review: QuestionReview = result.data;
  const problems = checkReviewConsistency(review);

  if (problems.length > 0) {
    return { ok: false, errors: problems };
  }

  return { ok: true, value: review };
}

/** The review as stored on the run row: the accepted value, unchanged. */
export function serializeQuestionReview(review: QuestionReview): string {
  return JSON.stringify(review);
}

/**
 * A stored review, re-validated.
 *
 * Returns `null` rather than throwing for unreadable JSON and for a payload that no
 * longer validates, so the question page can say the review can no longer be read
 * instead of returning a 500 for a row somebody edited by hand.
 */
export function readQuestionReview(
  payload: string | null,
): QuestionReview | null {
  if (payload === null) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  const result = validateQuestionReview(parsed);

  return result.ok ? result.value : null;
}

/** Name of the tool the provider is asked to fill in. */
export const QUESTION_REVIEW_SCHEMA_NAME = "question_review";

export const QUESTION_REVIEW_SCHEMA_DESCRIPTION =
  "Your review of one practice question: whether its stated answer is correct, what is wrong with it, and what the owner should do about it.";

/**
 * The answer shape sent to the provider.
 *
 * The descriptions are part of the prompt, not documentation. They are where the model is
 * told that a finding describes a problem rather than fixing it, that `answerCorrect` is
 * about the marked answer alone, and that the summary may become the reason the question
 * is pulled out of study — each stated at the field it constrains, where a model is most
 * likely to still be reading it.
 */
export function questionReviewJsonSchema(): JsonSchema {
  return {
    type: "object",
    description: QUESTION_REVIEW_SCHEMA_DESCRIPTION,
    required: [VERDICT_KEY, "answerCorrect", "suggestedAction", "summary"],
    additionalProperties: false,
    properties: {
      [VERDICT_KEY]: {
        type: "string",
        description:
          "SOUND when you found nothing wrong; MINOR_ISSUES when the question is usable but the problems are worth knowing; MAJOR_ISSUES when it should not be studied as it stands. The verdict must be at least as serious as your worst finding.",
        enum: [...REVIEW_VERDICTS],
      },
      answerCorrect: {
        type: "boolean",
        description:
          "Whether the answer this question marks as correct is actually correct. Your judgement of the marked answer alone, independent of anything else you found.",
      },
      [FINDINGS_KEY]: {
        type: "array",
        description:
          "One entry per problem you found. Omit or leave empty when you found none; never pad it.",
        maxItems: MAX_REVIEW_FINDINGS,
        items: {
          type: "object",
          required: ["severity", "category", "detail"],
          additionalProperties: false,
          properties: {
            severity: {
              type: "string",
              description:
                "MAJOR when this alone makes the question unfit to study, MINOR when it is worth fixing, INFO for a remark that is not a defect.",
              enum: [...FINDING_SEVERITIES],
            },
            category: {
              type: "string",
              description:
                "WRONG_ANSWER when the marked answer is not correct; AMBIGUOUS when more than one answer is defensible; WEAK_DISTRACTOR when a wrong choice is implausible; STEM_UNCLEAR when the question cannot be answered as written; EXPLANATION_WRONG when the explanation is incorrect; OTHER for anything else.",
              enum: [...FINDING_CATEGORIES],
            },
            detail: {
              type: "string",
              // The length bound is stated in words rather than as `maxLength`, because
              // the port's `JsonSchema` has no such keyword and the zod validator is the
              // authority on it either way.
              description: `What is wrong, in enough detail for the owner to act on, naming the choice it concerns where it concerns one, in ${REVIEW_DETAIL_LIMIT} characters or fewer. Describe the problem only: do not supply corrected text, a replacement choice, or the answer you think it should have.`,
            },
          },
        },
      },
      suggestedAction: {
        type: "string",
        description:
          "APPROVE when the question is sound, REVISE when it needs work, DISPUTE when it should be taken out of study until it is fixed. A recommendation to the owner, who decides.",
        enum: [...REVIEW_ACTIONS],
      },
      summary: {
        type: "string",
        description: `One or two sentences stating your conclusion, in ${REVIEW_SUMMARY_LIMIT} characters or fewer. It is shown on its own and may be used as the recorded reason the question is disputed, so it must stand without the findings beside it.`,
      },
    },
  };
}

/**
 * Zod issues as repair feedback.
 *
 * Paths and expectations only, never the value that failed: a validation message travels
 * back to the provider, and the value here can contain the model's quotation of the
 * owner's own question (`spec/AI-GUIDELINES.md` section 1.7).
 */
function describeIssues(error: z.ZodError): readonly string[] {
  return error.issues.slice(0, 10).map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join(".");

    return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
  });
}
