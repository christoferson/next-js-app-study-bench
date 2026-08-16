import { z } from "zod";
import {
  ANSWER_VERDICTS,
  EVALUATION_CONCEPT_LIMIT,
  EVALUATION_FEEDBACK_LIMIT,
  MAX_EVALUATED_CONCEPTS,
  checkAnswerEvaluation,
} from "@/modules/ai-generation/domain/answer-evaluation";
import type { AnswerEvaluation } from "@/modules/ai-generation/domain/answer-evaluation";
import type {
  JsonSchema,
  StructuredValidation,
} from "@/modules/ai-generation/ports/language-model-gateway";
import { enumOf } from "@/shared/schema-fields";

/**
 * Application-owned schema for one AI grading of one written answer, and the same schema
 * used to read a stored grading back out of the run row.
 *
 * Two directions, one schema, for the reason `question-review-schema.ts` gives: a model's
 * answer and a database row are both untrusted input
 * (`spec/CODING-STANDARDS.md` section 2), and here they are literally the same value —
 * what goes into `generation_runs.proposed_payload` is exactly what the validator
 * accepted. So the grading panel cannot render a verdict that would not have been
 * accepted, and a hand-edited row fails where a bad answer would.
 *
 * The permissive-schema-plus-strict-validator split is the same too: the JSON Schema sent
 * to the provider describes the shape and carries the descriptions that tell the model
 * what each field means, and this zod schema is the authority. It additionally runs
 * `checkAnswerEvaluation`, which is the part a JSON Schema cannot express — the concept
 * lists have to be about the concepts the *question* recorded, and the verdict has to
 * agree with them.
 *
 * What is absent matters as much as what is here. There is no field that can carry a
 * corrected expected concept, a model answer, or a rewritten question — and there is no
 * field that records a grade against the attempt. The grading is advice; the owner's own
 * verdict is the record (`domain/answer-evaluation.ts`).
 */

const VERDICT_KEY = "verdict";
const COVERED_KEY = "conceptsCovered";
const MISSED_KEY = "conceptsMissed";
const FEEDBACK_KEY = "feedback";

/** Non-empty text the model must supply, bounded and trimmed. */
const requiredModelText = (limit: number) =>
  z
    .string({ message: "must be a string" })
    .max(limit, { message: `use ${limit} characters or fewer` })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: "must not be empty" });

/**
 * One echoed concept, bounded and trimmed.
 *
 * Empty strings are dropped rather than refused by the array: a model that pads a list
 * with `""` has said nothing, and spending the repair attempt on that instead of on the
 * verdict would be a poor trade. Whether the surviving entries are the question's own
 * concepts is `checkAnswerEvaluation`'s judgement, because only it has the question.
 */
const conceptList = z
  .array(
    z
      .string({ message: "must be a string" })
      .max(EVALUATION_CONCEPT_LIMIT, {
        message: `use ${EVALUATION_CONCEPT_LIMIT} characters or fewer per concept`,
      })
      .transform((value) => value.trim()),
  )
  .max(MAX_EVALUATED_CONCEPTS, {
    message: `name ${MAX_EVALUATED_CONCEPTS} concepts or fewer`,
  })
  .nullish()
  .transform((values) =>
    (values ?? []).filter((value): value is string => value.length > 0),
  );

/**
 * The grading as the provider returns it.
 *
 * Both concept lists are optional and default to empty, because "covered nothing" and
 * "missed nothing" are both real answers and a model that omits the key has said the same
 * thing as one that sends `[]`. The verdict and the feedback are required: a grading with
 * no conclusion, or with nothing for the owner to read, is not a grading and there is no
 * local repair for it.
 */
const responseSchema = z.object({
  [VERDICT_KEY]: enumOf(
    ANSWER_VERDICTS,
    `must be one of ${ANSWER_VERDICTS.join(", ")}`,
  ),
  [COVERED_KEY]: conceptList,
  [MISSED_KEY]: conceptList,
  [FEEDBACK_KEY]: requiredModelText(EVALUATION_FEEDBACK_LIMIT),
});

/**
 * The validator the gateway calls, curried over the question's expected concepts.
 *
 * Curried for the reason the tutor's validator is: the port's `validate` is a
 * one-argument function by design, because the gateway knows nothing about the question
 * and should not have to. The facade closes over the concepts when it builds the request.
 *
 * Shape first, then the domain's rules, because the rules assume a grading of the right
 * shape. Every message names a field and an expectation and carries none of the owner's
 * text — including none of their answer — so all of them are safe to send back to the
 * provider as repair feedback (`spec/AI-GUIDELINES.md` section 1.7).
 */
export function answerEvaluationValidator(
  expectedConcepts: readonly string[],
): (payload: unknown) => StructuredValidation<AnswerEvaluation> {
  return (payload) => {
    const result = responseSchema.safeParse(payload);

    if (!result.success) {
      return { ok: false, errors: describeIssues(result.error) };
    }

    const evaluation: AnswerEvaluation = result.data;
    const problems = checkAnswerEvaluation(evaluation, expectedConcepts);

    return problems.length > 0
      ? { ok: false, errors: problems }
      : { ok: true, value: evaluation };
  };
}

/** The grading as stored on the run row: the accepted value, unchanged. */
export function serializeAnswerEvaluation(
  evaluation: AnswerEvaluation,
): string {
  return JSON.stringify(evaluation);
}

/**
 * A stored grading, re-validated for shape only.
 *
 * Shape only, deliberately unlike the review's reader: the consistency rules compare the
 * grading against the question's expected concepts, and a question edited since the
 * grading was made has different ones. Re-checking against today's list would hide a
 * grading that was valid when it was given — so the concept rules are enforced when the
 * answer arrives and the stored payload is read back as what it is.
 *
 * `null` for unreadable JSON and for a payload that no longer parses, so a panel can say
 * the grading cannot be read instead of returning a 500 for a row somebody edited by hand.
 */
export function readAnswerEvaluation(
  payload: string | null,
): AnswerEvaluation | null {
  if (payload === null) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  const result = responseSchema.safeParse(parsed);

  return result.success ? result.data : null;
}

/** Name of the tool the provider is asked to fill in. */
export const ANSWER_EVALUATION_SCHEMA_NAME = "answer_evaluation";

export const ANSWER_EVALUATION_SCHEMA_DESCRIPTION =
  "Your assessment of one written answer against the concepts a correct answer must mention.";

/**
 * The answer shape sent to the provider.
 *
 * The descriptions are part of the prompt, not documentation. Three of them carry rules
 * that matter: both concept lists say the entries must be copied exactly from the list
 * given with the question, and `feedback` says it is addressed to the person who wrote the
 * answer and is not a place to rewrite the question.
 */
export function answerEvaluationJsonSchema(): JsonSchema {
  return {
    type: "object",
    description: ANSWER_EVALUATION_SCHEMA_DESCRIPTION,
    required: [VERDICT_KEY, FEEDBACK_KEY],
    additionalProperties: false,
    properties: {
      [VERDICT_KEY]: {
        type: "string",
        description:
          "CORRECT when the answer covers every expected concept, in whatever words; PARTIALLY_CORRECT when it covers some of them; INCORRECT when it covers none of them or states something wrong. CORRECT is not available if you list anything under conceptsMissed.",
        enum: [...ANSWER_VERDICTS],
      },
      [COVERED_KEY]: {
        type: "array",
        description:
          "The expected concepts the answer does mention, each copied exactly from the list given with the question. Equivalent wording counts as mentioning a concept: judge the meaning, not the phrasing. Omit or leave empty when it mentions none.",
        maxItems: MAX_EVALUATED_CONCEPTS,
        items: { type: "string" },
      },
      [MISSED_KEY]: {
        type: "array",
        description:
          "The expected concepts the answer does not mention, each copied exactly from the list given with the question. Omit or leave empty when it misses none. A concept belongs in one list or the other, never both.",
        maxItems: MAX_EVALUATED_CONCEPTS,
        items: { type: "string" },
      },
      [FEEDBACK_KEY]: {
        type: "string",
        // The length bound is stated in words rather than as `maxLength`, because the
        // port's `JsonSchema` has no such keyword and the zod validator is the authority
        // on it either way.
        description: `What the answer got and what it left out, addressed to the person who wrote it, as prose they can read on a phone: short paragraphs, no headings, no lists, no markdown. In ${EVALUATION_FEEDBACK_LIMIT} characters or fewer. Do not write the answer for them, and do not rewrite the question or its expected concepts.`,
      },
    },
  };
}

/**
 * Zod issues as repair feedback.
 *
 * Paths and expectations only, never the value that failed: a validation message travels
 * back to the provider, and the value here can contain the owner's own written answer
 * (`spec/AI-GUIDELINES.md` section 1.7).
 */
function describeIssues(error: z.ZodError): readonly string[] {
  return error.issues.slice(0, 10).map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join(".");

    return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
  });
}
