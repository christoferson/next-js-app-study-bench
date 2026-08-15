import type { QuestionQualityStatus } from "@/modules/question-bank/domain/question";

/**
 * What an AI review of one question revision says
 * (`SPEC.md` section 25.2, `spec/AI-GUIDELINES.md` section 1.10).
 *
 * The shape is deliberately a *judgement*, not a correction. There is nowhere in it to
 * put replacement text: no rewritten stem, no replacement choice, no corrected answer
 * key. A reviewer that wanted to fix the question can only describe what is wrong, and
 * the owner decides what to do about it. That is the whole of section 1.10 expressed as
 * a type — a hidden rewrite is not something the code has to remember not to do,
 * because there is no field to carry one.
 *
 * Domain code is framework-free: no React, Next.js, database driver, AWS SDK, or
 * environment access.
 */

/**
 * The reviewer's overall answer.
 *
 * Three values rather than a numeric score, because the owner's decision is
 * three-valued: leave it, look at it, or stop using it. A score would invite a
 * threshold, and a threshold is a rule about somebody else's question bank.
 */
export type ReviewVerdict = "SOUND" | "MINOR_ISSUES" | "MAJOR_ISSUES";

export const REVIEW_VERDICTS: readonly ReviewVerdict[] = [
  "SOUND",
  "MINOR_ISSUES",
  "MAJOR_ISSUES",
];

/**
 * How much one finding matters.
 *
 * Separate from the verdict because a review can hold several findings of different
 * weights, and collapsing them would lose the distinction between "one fatal problem"
 * and "four cosmetic ones".
 */
export type FindingSeverity = "INFO" | "MINOR" | "MAJOR";

export const FINDING_SEVERITIES: readonly FindingSeverity[] = [
  "INFO",
  "MINOR",
  "MAJOR",
];

/**
 * What kind of problem a finding is about.
 *
 * A closed list rather than free text, so the same problem is named the same way
 * across reviews and the interface can badge it. `AMBIGUOUS` is named explicitly
 * because ambiguity detection is its own scope item (`SPEC.md` section 25.2) and
 * because `spec/AI-GUIDELINES.md` section 2.2 forbids presenting an ambiguous
 * multiple-choice question as having one certain answer — a question that has two
 * defensible answers is the failure this category exists to surface.
 *
 * `OTHER` is present and deliberately last: a reviewer with a real objection that fits
 * none of the categories should be able to state it rather than being pushed into the
 * nearest wrong box, which is how a category list quietly becomes a lie.
 */
export type FindingCategory =
  | "WRONG_ANSWER"
  | "AMBIGUOUS"
  | "WEAK_DISTRACTOR"
  | "STEM_UNCLEAR"
  | "EXPLANATION_WRONG"
  | "OTHER";

export const FINDING_CATEGORIES: readonly FindingCategory[] = [
  "WRONG_ANSWER",
  "AMBIGUOUS",
  "WEAK_DISTRACTOR",
  "STEM_UNCLEAR",
  "EXPLANATION_WRONG",
  "OTHER",
];

/**
 * What the reviewer recommends the owner do.
 *
 * A recommendation, never an action. `DISPUTE` becomes a prefilled button on the
 * question's page; nothing in this module marks a question disputed on the model's
 * word (`spec/AI-GUIDELINES.md` section 1.10, "an owner-controlled action").
 */
export type ReviewAction = "APPROVE" | "REVISE" | "DISPUTE";

export const REVIEW_ACTIONS: readonly ReviewAction[] = [
  "APPROVE",
  "REVISE",
  "DISPUTE",
];

/** One thing the reviewer says is wrong, or worth knowing. */
export interface ReviewFinding {
  readonly severity: FindingSeverity;
  readonly category: FindingCategory;
  /** What the problem is, in the owner's terms. Never replacement content. */
  readonly detail: string;
}

/** One complete review of one revision. */
export interface QuestionReview {
  readonly verdict: ReviewVerdict;
  /**
   * Whether the answer the revision marks as correct is actually correct.
   *
   * Its own boolean rather than an inference from the findings, because it is the one
   * question the owner most wants answered and a list of prose findings is a bad place
   * to look for it. It is also what gates the `AI_REVIEWED` quality state.
   */
  readonly answerCorrect: boolean;
  readonly findings: readonly ReviewFinding[];
  readonly suggestedAction: ReviewAction;
  /** One or two sentences. Doubles as the prefilled dispute reason. */
  readonly summary: string;
}

/** Bounds on one review, so a runaway answer cannot fill a column. */
export const MAX_REVIEW_FINDINGS = 12;
export const REVIEW_DETAIL_LIMIT = 1000;
export const REVIEW_SUMMARY_LIMIT = 1000;

/**
 * How many "items" one review asks for: one question.
 *
 * The run schema requires `requested_item_count >= 1`, and one revision is the honest
 * number. How many *findings* come back is a property of the answer, capped by
 * `MAX_REVIEW_FINDINGS`, and the run's `successful_item_count` records how many were
 * actually recorded.
 */
export const QUESTION_REVIEW_ITEM_COUNT = 1;

/**
 * Consistency rules between the verdict, the answer flag, and the findings.
 *
 * These are the deterministic checks for a review, and they exist for the same reason
 * every other deterministic check does: the generator is never the authority on its own
 * output (`spec/AI-GUIDELINES.md` sections 1.5 and 1.8). A model that writes a
 * paragraph about a wrong answer and then labels the verdict `SOUND` has produced an
 * answer that reads as reassurance, and reassurance is exactly the failure mode a
 * review must not have. Rejecting it spends the one repair attempt asking for a verdict
 * that matches the findings.
 *
 * Four rules, each in one direction so a failure names the thing to fix:
 *
 * 1. `MAJOR_ISSUES` requires at least one `MAJOR` finding. Otherwise the verdict is
 *    louder than anything the reviewer was willing to write down.
 * 2. `SOUND` requires `answerCorrect` and no `MAJOR` or `MINOR` finding. `INFO`
 *    findings are allowed: "this is fine, and here is a remark" is a real answer.
 * 3. `answerCorrect: false` cannot be `SOUND`, and must carry a finding that says so —
 *    a `WRONG_ANSWER` or `AMBIGUOUS` finding at `MINOR` or above. A wrong answer with
 *    no finding is unactionable.
 * 4. A `MAJOR` finding cannot sit under a `SOUND` verdict (implied by rule 2) and a
 *    `MINOR_ISSUES` verdict cannot carry a `MAJOR` finding: the verdict must be at
 *    least as serious as its worst finding.
 *
 * The messages are safe to send back to the provider as repair feedback: they name
 * fields and expectations and contain none of the owner's text
 * (`spec/AI-GUIDELINES.md` section 1.7).
 */
export function checkReviewConsistency(
  review: QuestionReview,
): readonly string[] {
  const problems: string[] = [];
  const majors = review.findings.filter(
    (finding) => finding.severity === "MAJOR",
  ).length;
  const minors = review.findings.filter(
    (finding) => finding.severity === "MINOR",
  ).length;

  if (review.verdict === "MAJOR_ISSUES" && majors === 0) {
    problems.push(
      'verdict: MAJOR_ISSUES requires at least one finding with severity "MAJOR"',
    );
  }

  if (review.verdict === "MINOR_ISSUES" && majors > 0) {
    problems.push(
      "verdict: a finding with severity MAJOR means the verdict must be MAJOR_ISSUES",
    );
  }

  if (review.verdict === "SOUND") {
    if (!review.answerCorrect) {
      problems.push(
        "verdict: SOUND is not available when answerCorrect is false",
      );
    }

    if (majors > 0 || minors > 0) {
      problems.push(
        "verdict: SOUND allows only findings with severity INFO; use MINOR_ISSUES or MAJOR_ISSUES otherwise",
      );
    }
  }

  if (
    !review.answerCorrect &&
    !review.findings.some(
      (finding) =>
        finding.severity !== "INFO" &&
        (finding.category === "WRONG_ANSWER" ||
          finding.category === "AMBIGUOUS"),
    )
  ) {
    problems.push(
      "findings: answerCorrect false requires a WRONG_ANSWER or AMBIGUOUS finding of severity MINOR or MAJOR saying what is wrong with the stated answer",
    );
  }

  return problems;
}

/**
 * The quality state a completed review leaves the question in.
 *
 * The single rule, and the reason it is a pure function in the domain rather than an
 * `if` in the facade: **a review may only ever promote a question to `AI_REVIEWED`, and
 * only when it found nothing wrong at all.** Everything else returns `null`, meaning
 * "leave the question exactly as it is and let the owner decide".
 *
 * Three consequences are deliberate.
 *
 * - A bad review never downgrades anything. `DISPUTED` is an owner action with an
 *   owner's reason attached (`spec/AI-GUIDELINES.md` section 1.10), and a model that
 *   could set it would be able to pull a question out of study on its own say-so
 *   (`spec/DOMAIN-RULES.md` section 2.2). The review offers a prefilled dispute button
 *   instead: one click, the owner's click.
 * - A review never overwrites a state the owner reached themselves. `USER_APPROVED`
 *   and `SOURCE_CHECKED` are stronger claims than `AI_REVIEWED` — a person, or a
 *   source, stood behind them — so a passing review leaves them alone rather than
 *   quietly demoting them. `DISPUTED` and `OUTDATED` are likewise left: they carry
 *   information the review does not have.
 * - Re-reviewing is therefore idempotent and safe. The owner can review the same
 *   question repeatedly; each run is recorded, and at most the first one moves the
 *   quality state.
 */
export function qualityStatusAfterReview(
  review: QuestionReview,
  current: QuestionQualityStatus,
): QuestionQualityStatus | null {
  if (review.verdict !== "SOUND" || !review.answerCorrect) {
    return null;
  }

  switch (current) {
    case "UNREVIEWED":
      return "AI_REVIEWED";
    // Already recorded as AI-reviewed: a second passing review says nothing new, and
    // writing the same value would touch `updated_at` for no reason.
    case "AI_REVIEWED":
    case "SOURCE_CHECKED":
    case "USER_APPROVED":
    case "DISPUTED":
    case "OUTDATED":
      return null;
  }
}

/** Whether a review recommends the owner raise a dispute. */
export function recommendsDispute(review: QuestionReview): boolean {
  return review.suggestedAction === "DISPUTE";
}

/** Owner-facing label for a verdict. */
export function describeVerdict(verdict: ReviewVerdict): string {
  switch (verdict) {
    case "SOUND":
      return "Sound";
    case "MINOR_ISSUES":
      return "Minor issues";
    case "MAJOR_ISSUES":
      return "Major issues";
  }
}

export function describeSeverity(severity: FindingSeverity): string {
  switch (severity) {
    case "INFO":
      return "Note";
    case "MINOR":
      return "Minor";
    case "MAJOR":
      return "Major";
  }
}

export function describeFindingCategory(category: FindingCategory): string {
  switch (category) {
    case "WRONG_ANSWER":
      return "Stated answer is wrong";
    case "AMBIGUOUS":
      return "More than one defensible answer";
    case "WEAK_DISTRACTOR":
      return "Weak distractor";
    case "STEM_UNCLEAR":
      return "Unclear stem";
    case "EXPLANATION_WRONG":
      return "Explanation is wrong";
    case "OTHER":
      return "Other";
  }
}

/** Owner-facing label for what the reviewer recommends. */
export function describeReviewAction(action: ReviewAction): string {
  switch (action) {
    case "APPROVE":
      return "Approve this question";
    case "REVISE":
      return "Revise this question";
    case "DISPUTE":
      return "Dispute this question";
  }
}
