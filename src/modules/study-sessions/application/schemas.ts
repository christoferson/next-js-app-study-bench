import { z } from "zod";
import { enumOf, requiredText } from "@/shared/schema-fields";
import {
  MAX_SESSION_MINUTES,
  MIN_SESSION_MINUTES,
} from "@/modules/certifications/domain/certification";
import { ANSWER_CONFIDENCES } from "@/modules/study-sessions/domain/question-attempt";
import { RECALL_RATINGS } from "@/modules/flashcards/domain/review-scheduling";
import { SESSION_MODES } from "@/modules/study-sessions/domain/study-session";

/**
 * Authoritative input schemas for study sessions.
 *
 * The schemas cover shape and bounds: they turn form strings into domain values and
 * reject values outside the ranges the schema records. They deliberately do not
 * decide whether an answer is correct or whether a session can be composed — those
 * are domain rules in `answer-grading` and `session-composer`, so they hold for
 * every caller rather than only for submissions arriving through these forms.
 */

const ID_LIMIT = 200;
const ANSWER_TEXT_LIMIT = 4000;

/** How long the owner may claim one answer took, in seconds. */
const MAX_DURATION_SECONDS = 60 * 60;

export const sessionModeSchema = enumOf(
  SESSION_MODES,
  "Choose a kind of session.",
);

export const confidenceSchema = enumOf(
  ANSWER_CONFIDENCES,
  "Say how sure you were.",
);

export const recallRatingSchema = enumOf(
  RECALL_RATINGS,
  "Choose how well you recalled the card.",
);

/**
 * Requested session length.
 *
 * Bounded by the same limits a track's default session length uses, so the two
 * cannot disagree about what a plausible session is. The message names the range
 * because a rejected number needs to say what would be accepted.
 */
export const targetMinutesSchema = z
  .string()
  .transform((value) => value.trim())
  .transform((value, context) => {
    const parsed = Number(value);

    if (
      !Number.isInteger(parsed) ||
      parsed < MIN_SESSION_MINUTES ||
      parsed > MAX_SESSION_MINUTES
    ) {
      context.addIssue({
        code: "custom",
        message: `Choose a length between ${MIN_SESSION_MINUTES} and ${MAX_SESSION_MINUTES} minutes.`,
      });

      return z.NEVER;
    }

    return parsed;
  });

/**
 * Starting a session: which mode, which tracks, how long.
 *
 * Tracks arrive as a list because a mixed-track session selects several. At least
 * one is required: a session with no track has nothing to compose from, and
 * silently defaulting to every track would start a session the owner did not ask
 * for.
 */
export const startSessionSchema = z.object({
  mode: sessionModeSchema,
  certificationIds: z
    .array(requiredText("A study track", ID_LIMIT))
    .refine((value) => value.length > 0, {
      message: "Choose at least one study track.",
    })
    // Duplicates are collapsed rather than rejected: a repeated checkbox value is
    // a form quirk, not a mistake worth blocking a session for.
    .transform((value) => [...new Set(value)]),
  targetMinutes: targetMinutesSchema,
});

export type StartSessionInput = z.output<typeof startSessionSchema>;

/**
 * The answer submitted for one session item.
 *
 * Discriminated by the answered question's type, so the parsed value carries
 * exactly the fields that type needs and the facade's switch over it is exhaustive
 * (`spec/CODING-STANDARDS.md` sections 1.3 and 1.4). The item identifier is
 * submitted with the answer so the server records it against the item that was on
 * screen rather than against whatever is pending now.
 */
const answerFields = {
  sessionId: requiredText("A session", ID_LIMIT),
  itemId: requiredText("An item", ID_LIMIT),
  confidence: confidenceSchema,
  /**
   * How long the item took, measured by the page.
   *
   * Optional and empty-tolerant: a page restored from history has no honest
   * measurement, and the attempt stores null rather than a false zero.
   */
  durationSeconds: z
    .string()
    .optional()
    .transform((value): number | null => {
      const text = (value ?? "").trim();

      // An absent or blank field is "not measured", not zero seconds. `Number("")`
      // is 0, so the emptiness has to be tested before the conversion.
      if (text === "") {
        return null;
      }

      const parsed = Number(text);

      return Number.isInteger(parsed) &&
        parsed >= 0 &&
        parsed <= MAX_DURATION_SECONDS
        ? parsed
        : null;
    }),
};

export const submitAnswerSchema = z.discriminatedUnion("type", [
  z.object({
    ...answerFields,
    type: z.literal("SINGLE_CHOICE"),
    choiceId: requiredText("An answer", ID_LIMIT),
  }),
  z.object({
    ...answerFields,
    type: z.literal("MULTIPLE_RESPONSE"),
    choiceIds: z
      .array(requiredText("An answer", ID_LIMIT))
      .refine((value) => value.length > 0, {
        message: "Choose at least one answer.",
      })
      .transform((value) => [...new Set(value)]),
  }),
  z.object({
    ...answerFields,
    type: z.literal("SHORT_ANSWER"),
    text: requiredText("Your answer", ANSWER_TEXT_LIMIT),
    /**
     * The owner's own verdict on their short answer.
     *
     * Submitted with the answer because D5 has no grader for free text: the study
     * screen shows the expected concepts and the owner marks themselves, and the
     * attempt records `SELF_ASSESSED` (`SPEC.md` section 14.3 forbids reporting a
     * confident verdict the application cannot justify).
     */
    selfAssessment: z.string().transform((value, context) => {
      if (value === "CORRECT") {
        return true;
      }

      if (value === "INCORRECT") {
        return false;
      }

      context.addIssue({
        code: "custom",
        message: "Mark your answer as correct or incorrect.",
      });

      return z.NEVER;
    }),
  }),
]);

export type SubmitAnswerInput = z.output<typeof submitAnswerSchema>;

/** Rating a flashcard that appeared as a session item. */
export const rateSessionCardSchema = z.object({
  sessionId: requiredText("A session", ID_LIMIT),
  itemId: requiredText("An item", ID_LIMIT),
  rating: recallRatingSchema,
});

export type RateSessionCardInput = z.output<typeof rateSessionCardSchema>;

/** Skipping an item, or finishing the session, both name only what they act on. */
export const sessionItemSchema = z.object({
  sessionId: requiredText("A session", ID_LIMIT),
  itemId: requiredText("An item", ID_LIMIT),
});

export type SessionItemInput = z.output<typeof sessionItemSchema>;

export const finishSessionSchema = z.object({
  sessionId: requiredText("A session", ID_LIMIT),
});

export type FinishSessionInput = z.output<typeof finishSessionSchema>;
