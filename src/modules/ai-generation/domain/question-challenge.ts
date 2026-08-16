/**
 * What an AI challenge of one question revision says
 * (`SPEC.md` sections 25.2 and 25.3, `spec/AI-GUIDELINES.md` section 1.10).
 *
 * A challenge is the *owner's* objection, argued out. The owner has read a question,
 * disagrees with it — "I think b is also correct, because a NAT gateway would still let
 * the instance reach the endpoint" — and a model is asked to judge that objection against
 * the stored answer. It is the third thing a model may say about a question the owner
 * already has, and it is distinct from both of the others:
 *
 * - a **review** is unprompted: the model decides what to look at;
 * - a **tutor answer** teaches the question as it stands and may not disagree with it;
 * - a **challenge** starts from a specific objection the owner supplies and has to come
 *   down on one side of it.
 *
 * That is why it is its own run kind rather than a review with a note attached: the
 * question it answers is different ("is this person right?" rather than "is this question
 * sound?"), and reading them back months later as the same thing would lose which of the
 * two the model was actually asked.
 *
 * The acceptance criterion this shape carries is that a challenge produces a **structured
 * quality finding** — a verdict, a recommendation, and, at most, a *note* about what a
 * revision would have to change. There is nowhere in it to put replacement question
 * content: no corrected stem, no replacement choice, no new answer key. A challenge the
 * model upholds becomes a prefilled dispute button or a note beside the edit form, and
 * the owner writes the revision themselves. That is
 * `spec/AI-GUIDELINES.md` section 1.10's "owner-controlled revision proposal" expressed
 * as a type: the AI never writes the revision, because there is no field to carry one.
 *
 * Domain code is framework-free: no React, Next.js, database driver, AWS SDK, or
 * environment access.
 */

/**
 * Whose reading the model came down on.
 *
 * Three values, and the middle one is the one that earns its place: an objection can be
 * *reasonable without being right* — the question is defensible as written and the
 * owner's reading is also defensible, which is ambiguity — and collapsing that into
 * either neighbour would lose the finding the owner most needs. `STORED_ANSWER_WRONG` is
 * the strong claim, reserved for the marked answer actually being incorrect.
 */
export type ChallengeVerdict =
  "STORED_ANSWER_STANDS" | "OWNER_HAS_A_POINT" | "STORED_ANSWER_WRONG";

export const CHALLENGE_VERDICTS: readonly ChallengeVerdict[] = [
  "STORED_ANSWER_STANDS",
  "OWNER_HAS_A_POINT",
  "STORED_ANSWER_WRONG",
];

/**
 * What the model recommends the owner do about it.
 *
 * A recommendation, never an action, exactly as `ReviewAction` is: `DISPUTE` becomes a
 * prefilled button and `REVISE` becomes a link to the edit form the owner already has.
 * Nothing in this module changes a question on the strength of this value
 * (`spec/AI-GUIDELINES.md` section 1.10).
 */
export type ChallengeRecommendation = "KEEP" | "DISPUTE" | "REVISE";

export const CHALLENGE_RECOMMENDATIONS: readonly ChallengeRecommendation[] = [
  "KEEP",
  "DISPUTE",
  "REVISE",
];

/** One complete challenge outcome for one revision and one objection. */
export interface QuestionChallenge {
  readonly verdict: ChallengeVerdict;
  /**
   * The argument, both ways.
   *
   * One field rather than a for/against pair, because the model is asked to steelman both
   * readings and then decide, and splitting it invited two paragraphs that never met. The
   * template asks for the shape inside the prose.
   */
  readonly reasoning: string;
  readonly recommendation: ChallengeRecommendation;
  /**
   * What a revision would have to change, as a note to the owner.
   *
   * A *note*, not content: "the stem needs to say the bucket is in the same region,
   * otherwise b is also defensible" rather than a rewritten stem. Bounded shorter than
   * the reasoning for exactly that reason — a field long enough to hold a replacement
   * question is a field a model will fill with one.
   *
   * `null` when nothing needs revising, which is required of a `KEEP` recommendation
   * below.
   */
  readonly suggestedRevisionNote: string | null;
}

/** Bounds on one challenge, so a runaway answer cannot fill a column. */
export const CHALLENGE_REASONING_LIMIT = 3000;
export const CHALLENGE_NOTE_LIMIT = 600;

/**
 * How much of the owner's objection is carried into the prompt.
 *
 * Bounded because it is owner text that travels into a request whose cost the owner is
 * paying, and generous enough to state a real objection with its reasoning.
 */
export const CHALLENGE_REASON_LIMIT = 1500;

/** The shortest objection worth spending a call on. */
export const CHALLENGE_REASON_MIN = 10;

/** How many "items" one challenge asks for: one question. */
export const QUESTION_CHALLENGE_ITEM_COUNT = 1;

/** How many past challenges a question's page shows. */
export const CHALLENGE_HISTORY_LIMIT = 5;

/**
 * Whether the verdict, the recommendation, and the note agree with each other.
 *
 * The deterministic check for a challenge, and the reason it exists is the specific
 * failure mode a challenge has: a model asked to adjudicate tends to soothe. It agrees
 * that the objection is interesting, concludes the stored answer is wrong, and then
 * recommends keeping the question — which reads as agreement and is unactionable. Four
 * rules, each in one direction so a failure names the thing to fix:
 *
 * 1. `STORED_ANSWER_WRONG` cannot recommend `KEEP`. If the marked answer is wrong, the
 *    question either comes out of study or gets revised; leaving it alone is not one of
 *    the options.
 * 2. `OWNER_HAS_A_POINT` cannot recommend `KEEP` either. The whole content of that
 *    verdict is that the question is not as clear as it looks, so a recommendation to
 *    change nothing contradicts it.
 * 3. `KEEP` must carry no revision note. A note is a thing to do; "do nothing, and here
 *    is what to change" is two answers.
 * 4. `REVISE` must carry one. A recommendation to revise with nothing to revise leaves
 *    the owner at an edit form with no idea what the model meant.
 *
 * Deliberately *not* checked: `STORED_ANSWER_STANDS` with a `REVISE` recommendation. That
 * combination is real and useful — the marked answer is right and the stem is still
 * sloppy — and forbidding it would push a genuine finding into a wrong verdict.
 *
 * Messages name a field and an expectation and carry none of the owner's text, so they
 * are safe to send back to the provider as repair feedback
 * (`spec/AI-GUIDELINES.md` section 1.7).
 */
export function checkChallengeConsistency(
  challenge: QuestionChallenge,
): readonly string[] {
  const problems: string[] = [];
  const hasNote =
    challenge.suggestedRevisionNote !== null &&
    challenge.suggestedRevisionNote.length > 0;

  if (
    challenge.recommendation === "KEEP" &&
    challenge.verdict === "STORED_ANSWER_WRONG"
  ) {
    problems.push(
      "recommendation: KEEP is not available when the verdict is STORED_ANSWER_WRONG; recommend DISPUTE or REVISE",
    );
  }

  if (
    challenge.recommendation === "KEEP" &&
    challenge.verdict === "OWNER_HAS_A_POINT"
  ) {
    problems.push(
      "recommendation: KEEP is not available when the verdict is OWNER_HAS_A_POINT; recommend DISPUTE or REVISE",
    );
  }

  if (challenge.recommendation === "KEEP" && hasNote) {
    problems.push(
      "suggestedRevisionNote: leave it out when the recommendation is KEEP, because nothing needs revising",
    );
  }

  if (challenge.recommendation === "REVISE" && !hasNote) {
    problems.push(
      "suggestedRevisionNote: required when the recommendation is REVISE; say what a new revision would have to change, without writing the replacement",
    );
  }

  return problems;
}

/** Whether a challenge argues for taking the question out of study. */
export function recommendsDispute(challenge: QuestionChallenge): boolean {
  return challenge.recommendation === "DISPUTE";
}

/**
 * Whether a challenge argues for a new revision *and* said what it would change.
 *
 * Both conditions, because the panel's revise path shows the note: a `REVISE` with no note
 * would render a heading over nothing. `checkChallengeConsistency` already refuses that
 * combination from the provider, so this is the guard for a payload read back from a row.
 */
export function recommendsRevision(challenge: QuestionChallenge): boolean {
  return (
    challenge.recommendation === "REVISE" &&
    challenge.suggestedRevisionNote !== null
  );
}

/** Owner-facing label for a verdict. */
export function describeChallengeVerdict(verdict: ChallengeVerdict): string {
  switch (verdict) {
    case "STORED_ANSWER_STANDS":
      return "The stored answer stands";
    case "OWNER_HAS_A_POINT":
      return "Your objection has a point";
    case "STORED_ANSWER_WRONG":
      return "The stored answer looks wrong";
  }
}

/** Owner-facing label for what the challenge recommends. */
export function describeChallengeRecommendation(
  recommendation: ChallengeRecommendation,
): string {
  switch (recommendation) {
    case "KEEP":
      return "Keep this question as it is";
    case "DISPUTE":
      return "Take this question out of study";
    case "REVISE":
      return "Write a new revision";
  }
}
