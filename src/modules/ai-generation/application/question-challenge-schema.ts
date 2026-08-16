import { z } from "zod";
import {
  CHALLENGE_NOTE_LIMIT,
  CHALLENGE_REASONING_LIMIT,
  CHALLENGE_RECOMMENDATIONS,
  CHALLENGE_VERDICTS,
  checkChallengeConsistency,
} from "@/modules/ai-generation/domain/question-challenge";
import type { QuestionChallenge } from "@/modules/ai-generation/domain/question-challenge";
import type {
  JsonSchema,
  StructuredValidation,
} from "@/modules/ai-generation/ports/language-model-gateway";
import { enumOf } from "@/shared/schema-fields";

/**
 * Application-owned schema for one challenge outcome, and the same schema used to read a
 * stored outcome back out of the run row.
 *
 * Two directions, one schema, for the reason `question-review-schema.ts` gives: a model's
 * answer and a database row are both untrusted input
 * (`spec/CODING-STANDARDS.md` section 2), and here they are literally the same value —
 * what goes into `generation_runs.proposed_payload` is exactly what the validator
 * accepted. So the challenge panel cannot render an outcome that would not have been
 * accepted, and a hand-edited row fails where a bad answer would.
 *
 * The one field worth stating plainly is `suggestedRevisionNote`, because it is the field
 * most likely to be misread as an exception to `spec/AI-GUIDELINES.md` section 1.10. It is
 * **a note about what a revision would change**, not the revision. Its bound is short on
 * purpose — a field long enough to hold a replacement stem with its choices is a field a
 * model will fill with one — and its description says so at the field itself. The owner
 * reads the note beside the edit form they already have and writes revision N+1
 * themselves, which is what makes this an owner-controlled revision proposal.
 */

const VERDICT_KEY = "verdict";
const REASONING_KEY = "reasoning";
const RECOMMENDATION_KEY = "recommendation";
const NOTE_KEY = "suggestedRevisionNote";

/** Non-empty text the model must supply, bounded and trimmed. */
const requiredModelText = (limit: number) =>
  z
    .string({ message: "must be a string" })
    .max(limit, { message: `use ${limit} characters or fewer` })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: "must not be empty" });

/**
 * The outcome as the provider returns it.
 *
 * `suggestedRevisionNote` is the only optional field, and a blank one is normalised to
 * `null` rather than kept as `""`: a model that sends an empty string means "no note", and
 * carrying two spellings of the same absence into the consistency check would make its
 * `REVISE`-needs-a-note rule depend on which one arrived.
 */
const responseSchema = z.object({
  [VERDICT_KEY]: enumOf(
    CHALLENGE_VERDICTS,
    `must be one of ${CHALLENGE_VERDICTS.join(", ")}`,
  ),
  [REASONING_KEY]: requiredModelText(CHALLENGE_REASONING_LIMIT),
  [RECOMMENDATION_KEY]: enumOf(
    CHALLENGE_RECOMMENDATIONS,
    `must be one of ${CHALLENGE_RECOMMENDATIONS.join(", ")}`,
  ),
  [NOTE_KEY]: z
    .string({ message: "must be a string" })
    .max(CHALLENGE_NOTE_LIMIT, {
      message: `use ${CHALLENGE_NOTE_LIMIT} characters or fewer`,
    })
    .nullish()
    .transform((value) => {
      const trimmed = (value ?? "").trim();

      return trimmed.length === 0 ? null : trimmed;
    }),
});

/**
 * The validator the gateway calls, and the reader the challenge panel calls.
 *
 * Shape first, then the domain's consistency rules, because the rules assume an outcome of
 * the right shape. Both kinds of message name a field and an expectation and carry none of
 * the owner's text — neither their question nor their objection — so both are safe to send
 * back to the provider as repair feedback (`spec/AI-GUIDELINES.md` section 1.7).
 */
export function validateQuestionChallenge(
  payload: unknown,
): StructuredValidation<QuestionChallenge> {
  const result = responseSchema.safeParse(payload);

  if (!result.success) {
    return { ok: false, errors: describeIssues(result.error) };
  }

  const challenge: QuestionChallenge = result.data;
  const problems = checkChallengeConsistency(challenge);

  return problems.length > 0
    ? { ok: false, errors: problems }
    : { ok: true, value: challenge };
}

/** The outcome as stored on the run row: the accepted value, unchanged. */
export function serializeQuestionChallenge(
  challenge: QuestionChallenge,
): string {
  return JSON.stringify(challenge);
}

/**
 * A stored outcome, re-validated.
 *
 * Returns `null` rather than throwing for unreadable JSON and for a payload that no longer
 * validates, so the question page can say the challenge can no longer be read instead of
 * returning a 500 for a row somebody edited by hand. Re-validating in full is safe here,
 * unlike a grading: every rule a challenge has is about the outcome itself rather than
 * about the question as it stands today, so an edited question cannot invalidate a
 * recorded challenge.
 */
export function readQuestionChallenge(
  payload: string | null,
): QuestionChallenge | null {
  if (payload === null) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  const result = validateQuestionChallenge(parsed);

  return result.ok ? result.value : null;
}

/** Name of the tool the provider is asked to fill in. */
export const QUESTION_CHALLENGE_SCHEMA_NAME = "question_challenge";

export const QUESTION_CHALLENGE_SCHEMA_DESCRIPTION =
  "Your judgement of the objection the person raised against the answer their practice question marks as correct.";

/**
 * The answer shape sent to the provider.
 *
 * The descriptions are part of the prompt, not documentation. Two of them carry the rules
 * that matter most: `reasoning` says both readings must be argued before either is
 * decided, and `suggestedRevisionNote` says in as many words that it is a note about what
 * to change and not the replacement text.
 */
export function questionChallengeJsonSchema(): JsonSchema {
  return {
    type: "object",
    description: QUESTION_CHALLENGE_SCHEMA_DESCRIPTION,
    required: [VERDICT_KEY, REASONING_KEY, RECOMMENDATION_KEY],
    additionalProperties: false,
    properties: {
      [VERDICT_KEY]: {
        type: "string",
        description:
          "STORED_ANSWER_STANDS when the marked answer is right and the objection does not hold; OWNER_HAS_A_POINT when the marked answer is defensible but so is the objection, which makes the question ambiguous; STORED_ANSWER_WRONG when the marked answer is actually incorrect.",
        enum: [...CHALLENGE_VERDICTS],
      },
      [REASONING_KEY]: {
        type: "string",
        // The length bound is stated in words rather than as `maxLength`, because the
        // port's `JsonSchema` has no such keyword and the zod validator is the authority
        // on it either way.
        description: `Your argument, as prose the person can read on a phone: short paragraphs, no headings, no lists, no markdown. In ${CHALLENGE_REASONING_LIMIT} characters or fewer. Put the strongest case for their objection first, then the strongest case for the answer as stored, then say which one wins and why. Cite nothing: nothing was looked up for this, so any reference would be invented.`,
      },
      [RECOMMENDATION_KEY]: {
        type: "string",
        description:
          "KEEP when the question should be left exactly as it is — available only when the verdict is STORED_ANSWER_STANDS; DISPUTE when it should come out of study until the person fixes it; REVISE when it should be reworded or its answer key changed. A recommendation to the person, who decides.",
        enum: [...CHALLENGE_RECOMMENDATIONS],
      },
      [NOTE_KEY]: {
        type: "string",
        description: `Required when you recommend REVISE, and left out otherwise. Say what a new version would have to change and why, in ${CHALLENGE_NOTE_LIMIT} characters or fewer — for example "the stem has to say which region the bucket is in, otherwise b is also defensible". This is a note for the person to act on, not the new question: do not write a replacement stem, a replacement choice, a new answer key, or a rewritten explanation. They write the new version themselves.`,
      },
    },
  };
}

/**
 * Zod issues as repair feedback.
 *
 * Paths and expectations only, never the value that failed: a validation message travels
 * back to the provider, and the value here can contain the model's quotation of the
 * owner's own question or objection (`spec/AI-GUIDELINES.md` section 1.7).
 */
function describeIssues(error: z.ZodError): readonly string[] {
  return error.issues.slice(0, 10).map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join(".");

    return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
  });
}
