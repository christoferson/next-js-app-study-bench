/**
 * What an AI grader says about one written answer to one short-answer question
 * (`SPEC.md` sections 6.16 and 25.2, `spec/AI-GUIDELINES.md` section 1.10).
 *
 * The shape here carries the design decision of this slice, so it is worth stating
 * plainly. **AI grading is advice; the owner's own verdict stays the record.** A short
 * answer is recorded with `evaluationMode: "SELF_ASSESSED"` because the owner marked it,
 * and asking a model afterwards does not change that: the run records what the model
 * thought, the attempt keeps what the owner decided, and nothing here writes to an
 * attempt at all.
 *
 * Three reasons that is the right reading of "grade a short answer".
 *
 * - `spec/DOMAIN-RULES.md` keeps the attempt's evaluation mode a statement about *who*
 *   judged. A model's opinion recorded as the attempt's verdict would make
 *   `SELF_ASSESSED` a lie and would need a third mode, a migration of
 *   `question_attempts`, and a rule for what happens when the two disagree.
 * - The owner is the only one who knows what they meant. A grader marking a terse answer
 *   against a concept list cannot tell "did not know it" from "did not write it down",
 *   and a wrong machine verdict would poison the calibration report that every
 *   confidence rating feeds.
 * - It keeps the model out of the owner's own record, which is the same rule that keeps a
 *   review out of the question's content (`spec/AI-GUIDELINES.md` section 1.10).
 *
 * What is deliberately absent is any field that could carry replacement question
 * content: no corrected expected concept, no better answer, no rewritten stem. A grader
 * that wanted to fix the question can only talk about the answer.
 *
 * Domain code is framework-free: no React, Next.js, database driver, AWS SDK, or
 * environment access.
 */

/**
 * The grader's verdict on one written answer.
 *
 * Three values rather than a score, for the reason the review verdict has three: what the
 * owner does with it is three-valued — it was right, it was partly right, it was not
 * right — and a percentage would invite a pass mark, which is a rule about somebody
 * else's studying.
 */
export type AnswerVerdict = "CORRECT" | "PARTIALLY_CORRECT" | "INCORRECT";

export const ANSWER_VERDICTS: readonly AnswerVerdict[] = [
  "CORRECT",
  "PARTIALLY_CORRECT",
  "INCORRECT",
];

/**
 * One grading of one written answer.
 *
 * The two concept lists are the substance rather than the verdict: "you covered the
 * retention window but not the encryption requirement" is what the owner can study from,
 * and a bare verdict is not. They are echoed from the question's own
 * `expectedConcepts`, which is checked below, so the two lists name concepts the owner
 * actually recorded rather than ones the grader invented on the spot.
 */
export interface AnswerEvaluation {
  readonly verdict: AnswerVerdict;
  /** Expected concepts the answer did mention, echoed from the question. */
  readonly conceptsCovered: readonly string[];
  /** Expected concepts the answer did not mention, echoed from the question. */
  readonly conceptsMissed: readonly string[];
  /** Prose for the owner to read. Never replacement question content. */
  readonly feedback: string;
}

/** Bounds on one grading, so a runaway answer cannot fill a column. */
export const EVALUATION_FEEDBACK_LIMIT = 2000;
export const EVALUATION_CONCEPT_LIMIT = 300;
export const MAX_EVALUATED_CONCEPTS = 30;

/**
 * How much of the owner's own answer is sent to be graded.
 *
 * Bounded because it travels into the prompt as untrusted owner text, and because the
 * session's textarea has no limit of its own worth relying on here.
 */
export const GRADED_ANSWER_LIMIT = 4000;

/**
 * How many "items" one grading asks for: one answer.
 *
 * The run schema requires `requested_item_count >= 1`, and one answer is the honest
 * number.
 */
export const ANSWER_EVALUATION_ITEM_COUNT = 1;

/**
 * Whether a grading is internally consistent, and about the concepts it was given.
 *
 * The deterministic check for a grading, and it exists for the reason every other one
 * does: the model is never the authority on its own output
 * (`spec/AI-GUIDELINES.md` sections 1.5 and 1.8). Four rules:
 *
 * 1. `CORRECT` cannot leave a concept missed. A grader that lists what the answer failed
 *    to say and then marks it fully correct has written a reassurance, which is the
 *    failure mode grading has.
 * 2. `INCORRECT` cannot have covered every expected concept and missed none. That is a
 *    correct answer described as a wrong one.
 * 3. No concept may appear in both lists. It was either mentioned or it was not.
 * 4. Every concept named must be one of the question's own expected concepts. Compared
 *    case-insensitively on trimmed text — deliberately lenient about capitalisation and
 *    surrounding space, and deliberately strict about everything else, because the point
 *    of the echo is that the owner can line the two lists up against the list they wrote.
 *    A grader that paraphrases gets one repair attempt with a message telling it to copy
 *    the concept exactly.
 *
 * When the question records no expected concepts at all, rule 4 has nothing to check and
 * the grader is expected to name none: it is grading against the stem alone, which the
 * template says out loud.
 *
 * Messages name a field and an expectation and carry none of the owner's text, so they
 * are safe to send back to the provider as repair feedback
 * (`spec/AI-GUIDELINES.md` section 1.7).
 */
export function checkAnswerEvaluation(
  evaluation: AnswerEvaluation,
  expectedConcepts: readonly string[],
): readonly string[] {
  const problems: string[] = [];
  const normalize = (value: string) => value.trim().toLowerCase();
  const expected = new Set(expectedConcepts.map(normalize));
  const covered = evaluation.conceptsCovered.map(normalize);
  const missed = evaluation.conceptsMissed.map(normalize);

  if (evaluation.verdict === "CORRECT" && missed.length > 0) {
    problems.push(
      "verdict: CORRECT is not available when conceptsMissed names anything; use PARTIALLY_CORRECT",
    );
  }

  if (
    evaluation.verdict === "INCORRECT" &&
    missed.length === 0 &&
    covered.length > 0 &&
    covered.length >= expected.size
  ) {
    problems.push(
      "verdict: INCORRECT is not available when every expected concept is listed in conceptsCovered and none is missed",
    );
  }

  if (covered.some((concept) => missed.includes(concept))) {
    problems.push(
      "conceptsCovered: a concept must appear in conceptsCovered or in conceptsMissed, never both",
    );
  }

  if (
    [...covered, ...missed].some((concept) => !expected.has(concept)) ||
    (expected.size === 0 && covered.length + missed.length > 0)
  ) {
    problems.push(
      "conceptsCovered: every concept named in conceptsCovered and conceptsMissed must be copied exactly from the expected concepts given with the question",
    );
  }

  return problems;
}

/**
 * The self-grade this verdict argues for, or `null` when it argues for neither.
 *
 * A recommendation, never an action: the owner's own verdict is what the attempt records,
 * and this is what the panel uses to say which way the grader leaned. `PARTIALLY_CORRECT`
 * returns `null` on purpose — "some of it" is exactly the case where a two-button record
 * cannot be derived, and guessing would be putting words in the owner's mouth.
 */
export function recommendedSelfGrade(
  verdict: AnswerVerdict,
): "CORRECT" | "INCORRECT" | null {
  switch (verdict) {
    case "CORRECT":
      return "CORRECT";
    case "INCORRECT":
      return "INCORRECT";
    case "PARTIALLY_CORRECT":
      return null;
  }
}

/**
 * Whether the grader agrees with the verdict the owner already recorded.
 *
 * `null` when the grader's verdict does not map onto the owner's two options, so the
 * panel can say "partly" rather than forcing it into agreement or disagreement. Used only
 * to label the panel; nothing changes the attempt on the strength of it.
 */
export function agreesWithSelfGrade(
  verdict: AnswerVerdict,
  recordedCorrect: boolean,
): boolean | null {
  const recommended = recommendedSelfGrade(verdict);

  return recommended === null
    ? null
    : recommended === (recordedCorrect ? "CORRECT" : "INCORRECT");
}

/** Owner-facing label for a verdict. */
export function describeAnswerVerdict(verdict: AnswerVerdict): string {
  switch (verdict) {
    case "CORRECT":
      return "Covers the expected concepts";
    case "PARTIALLY_CORRECT":
      return "Covers some of it";
    case "INCORRECT":
      return "Does not cover it";
  }
}
