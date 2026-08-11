import type { IsoTimestamp } from "@/platform/clock";
import type {
  QuestionId,
  QuestionRevisionId,
} from "@/modules/question-bank/domain/question";
import type { StudySessionId } from "./study-session";

/**
 * Question attempt: the record of one answer to one exact revision
 * (`SPEC.md` sections 6.7 and 10.1).
 *
 * An attempt is a historical fact. It is never updated and never deleted: the
 * repository port offers only an insert, and the questions and revisions it
 * names are protected by `ON DELETE RESTRICT`
 * (`spec/DOMAIN-RULES.md` section 1.3).
 */

export type QuestionAttemptId = string;

/** Confidence values from `SPEC.md` section 6.7, least to most confident. */
export type AnswerConfidence =
  "GUESS" | "UNCERTAIN" | "FAIRLY_SURE" | "CONFIDENT";

export const ANSWER_CONFIDENCES: readonly AnswerConfidence[] = [
  "GUESS",
  "UNCERTAIN",
  "FAIRLY_SURE",
  "CONFIDENT",
];

/**
 * How an answer was judged.
 *
 * `DETERMINISTIC` covers the choice-based types, where correctness follows from
 * the stored correct answers with no judgement at all. `SHORT_ANSWER` has no
 * machine-checkable answer in D5 — matching free text against expected concepts
 * by substring would report confident nonsense — so the owner marks their own
 * answer and the attempt records `SELF_ASSESSED`. That distinction is why the
 * field exists rather than being implied by the question type: D7 adds
 * AI-assisted grading, and the same question type will then produce attempts
 * judged a third way.
 */
export type EvaluationMode = "DETERMINISTIC" | "SELF_ASSESSED";

export const EVALUATION_MODES: readonly EvaluationMode[] = [
  "DETERMINISTIC",
  "SELF_ASSESSED",
];

/**
 * What the owner submitted, discriminated by the answered question type.
 *
 * Stored as validated JSON and re-validated on read, like question content. A
 * union rather than a free-form string, so an answer to a multiple-response
 * question can never be read back as if it were a single choice.
 */
export type SubmittedAnswer =
  | { readonly type: "SINGLE_CHOICE"; readonly choiceId: string }
  | {
      readonly type: "MULTIPLE_RESPONSE";
      readonly choiceIds: readonly string[];
    }
  | { readonly type: "SHORT_ANSWER"; readonly text: string };

export interface QuestionAttempt {
  readonly id: QuestionAttemptId;
  readonly sessionId: StudySessionId;
  readonly questionId: QuestionId;
  /** The exact revision that was on screen (`SPEC.md` section 10.1). */
  readonly questionRevisionId: QuestionRevisionId;
  readonly submittedAnswer: SubmittedAnswer;
  readonly isCorrect: boolean;
  readonly confidence: AnswerConfidence;
  /**
   * How long the answer took, when the page could measure it.
   *
   * Nullable rather than defaulted to zero: the study screen measures from the
   * moment the item rendered, and a page restored from browser history or
   * submitted without client timing has no honest number to report. A stored
   * zero would be a false measurement, and `SPEC.md` section 6.8 requires
   * evidence-based reporting.
   */
  readonly durationSeconds: number | null;
  readonly attemptedAt: IsoTimestamp;
  readonly evaluationMode: EvaluationMode;
  /**
   * The feedback the owner was shown, when it is not derivable later.
   *
   * Always `null` in D5: feedback is rendered from the frozen revision the
   * attempt already names, so snapshotting it would duplicate data that cannot
   * drift. It becomes meaningful in D7, when an AI explanation is generated for
   * one attempt and no longer exists anywhere else.
   */
  readonly feedbackSnapshot: string | null;
}

export function describeConfidence(confidence: AnswerConfidence): string {
  switch (confidence) {
    case "GUESS":
      return "Guessed";
    case "UNCERTAIN":
      return "Unsure";
    case "FAIRLY_SURE":
      return "Fairly sure";
    case "CONFIDENT":
      return "Confident";
  }
}

/** What each confidence level claims, shown next to the control. */
export function describeConfidenceHint(confidence: AnswerConfidence): string {
  switch (confidence) {
    case "GUESS":
      return "I picked something";
    case "UNCERTAIN":
      return "I had doubts";
    case "FAIRLY_SURE":
      return "I think I know this";
    case "CONFIDENT":
      return "I know this";
  }
}

export function describeEvaluationMode(mode: EvaluationMode): string {
  switch (mode) {
    case "DETERMINISTIC":
      return "Checked against the recorded answer";
    case "SELF_ASSESSED":
      return "Graded by you";
  }
}

/**
 * Whether this confidence counts as confident for review priority.
 *
 * `SPEC.md` section 6.7 requires that "an incorrect confident answer should
 * receive higher review priority than an incorrect uncertain answer", and
 * `spec/DOMAIN-RULES.md` section 2.2 makes confident-but-incorrect its own
 * priority band. The line is drawn at `FAIRLY_SURE`: both upper levels are
 * claims of knowledge, so being wrong at either is the misconception worth
 * revisiting first, while `GUESS` and `UNCERTAIN` already told the truth.
 */
export function isConfident(confidence: AnswerConfidence): boolean {
  switch (confidence) {
    case "GUESS":
    case "UNCERTAIN":
      return false;
    case "FAIRLY_SURE":
    case "CONFIDENT":
      return true;
  }
}

/**
 * The four combinations `SPEC.md` section 6.7 asks the application to
 * distinguish, used by the confidence-calibration table.
 */
export type CalibrationBand =
  | "CORRECT_CONFIDENT"
  | "CORRECT_UNCERTAIN"
  | "INCORRECT_UNCERTAIN"
  | "INCORRECT_CONFIDENT";

export const CALIBRATION_BANDS: readonly CalibrationBand[] = [
  "CORRECT_CONFIDENT",
  "CORRECT_UNCERTAIN",
  "INCORRECT_CONFIDENT",
  "INCORRECT_UNCERTAIN",
];

export function calibrationBand(
  isCorrect: boolean,
  confidence: AnswerConfidence,
): CalibrationBand {
  if (isCorrect) {
    return isConfident(confidence) ? "CORRECT_CONFIDENT" : "CORRECT_UNCERTAIN";
  }

  return isConfident(confidence)
    ? "INCORRECT_CONFIDENT"
    : "INCORRECT_UNCERTAIN";
}

export function describeCalibrationBand(band: CalibrationBand): string {
  switch (band) {
    case "CORRECT_CONFIDENT":
      return "Correct and confident";
    case "CORRECT_UNCERTAIN":
      return "Correct but unsure";
    case "INCORRECT_CONFIDENT":
      return "Incorrect but confident";
    case "INCORRECT_UNCERTAIN":
      return "Incorrect and unsure";
  }
}

/** What each band tells the owner about their own judgement. */
export function describeCalibrationMeaning(band: CalibrationBand): string {
  switch (band) {
    case "CORRECT_CONFIDENT":
      return "Well-calibrated knowledge.";
    case "CORRECT_UNCERTAIN":
      return "You know more than you think.";
    case "INCORRECT_CONFIDENT":
      return "Misconceptions worth reviewing first.";
    case "INCORRECT_UNCERTAIN":
      return "Material you already know you have not learned.";
  }
}
