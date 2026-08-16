import type { QuestionQualityStatus } from "@/modules/question-bank/domain/question";

/**
 * What checking one stored question against the owner's own sources says
 * (`SPEC.md` section 26.2, "source-based verification").
 *
 * The shape is a *verdict about support*, and that is the whole distinction from
 * `QuestionReview`. A review asks whether a question is well made and answers from the
 * model's own knowledge. A verification asks a narrower and more useful question — do
 * these passages, from documents the owner chose to trust, support the answer this
 * question marks correct? — and its answer is only ever as strong as the excerpts it was
 * shown. `NOT_SUPPORTED` therefore means "these excerpts do not say", never "this is
 * wrong", and the wording throughout keeps that difference visible: an exam guide that
 * omits a topic is silent about it, not opposed to it.
 *
 * As with every other judging kind, there is nowhere in this shape to put replacement
 * question content (`spec/AI-GUIDELINES.md` section 1.10). A verifier that disagrees with
 * a question can describe the disagreement and point at the passage; the owner decides
 * whether that becomes a dispute, an edit, or nothing.
 *
 * Domain code is framework-free: no React, Next.js, database driver, AWS SDK, or
 * environment access.
 */

/**
 * How the sources stand relative to the stored answer.
 *
 * Four values, and the fourth is the one the feature exists for. Three would collapse
 * `NOT_SUPPORTED` and `CONTRADICTED` into "not supported", which are opposite situations
 * for the owner: the first means their sources are silent and the question may still be
 * fine, the second means their own exam guide says otherwise and the question needs
 * attention now.
 */
export type SourceVerificationVerdict =
  "SUPPORTED" | "PARTIALLY_SUPPORTED" | "NOT_SUPPORTED" | "CONTRADICTED";

export const SOURCE_VERIFICATION_VERDICTS: readonly SourceVerificationVerdict[] =
  ["SUPPORTED", "PARTIALLY_SUPPORTED", "NOT_SUPPORTED", "CONTRADICTED"];

/** How one excerpt bears on the question. */
export type ExcerptRelevance = "SUPPORTS" | "CONTRADICTS" | "UNRELATED";

export const EXCERPT_RELEVANCES: readonly ExcerptRelevance[] = [
  "SUPPORTS",
  "CONTRADICTS",
  "UNRELATED",
];

/** How much text the verifier may write per field. */
export const VERIFICATION_SUMMARY_LIMIT = 1200;

export const VERIFICATION_NOTE_LIMIT = 600;

/** One run checks one question, so the run's requested item count is always this. */
export const SOURCE_VERIFICATION_ITEM_COUNT = 1;

/** What the verifier said about one of the excerpts it was shown. */
export interface ExcerptAssessment {
  /**
   * The excerpt this is about, as the 1-based index it was sent with.
   *
   * Validated against the excerpts actually sent, so an assessment of excerpt 7 in a
   * request that sent four is dropped rather than rendered against the wrong passage.
   */
  readonly excerptIndex: number;
  readonly relevance: ExcerptRelevance;
  /** Why, in one or two sentences. `null` when the excerpt is simply unrelated. */
  readonly note: string | null;
}

export interface SourceVerification {
  readonly verdict: SourceVerificationVerdict;
  /** The reasoning the owner reads, in the verifier's own words. */
  readonly summary: string;
  readonly excerpts: readonly ExcerptAssessment[];
}

export function describeVerificationVerdict(
  verdict: SourceVerificationVerdict,
): string {
  switch (verdict) {
    case "SUPPORTED":
      return "Supported by your sources";
    case "PARTIALLY_SUPPORTED":
      return "Partly supported";
    case "NOT_SUPPORTED":
      return "Your sources do not say";
    case "CONTRADICTED":
      return "Contradicted by your sources";
  }
}

export function describeExcerptRelevance(relevance: ExcerptRelevance): string {
  switch (relevance) {
    case "SUPPORTS":
      return "Supports the answer";
    case "CONTRADICTS":
      return "Contradicts the answer";
    case "UNRELATED":
      return "Not about this question";
  }
}

/**
 * Whether this verdict is worth offering a dispute for.
 *
 * A contradiction, and nothing weaker. `NOT_SUPPORTED` is deliberately excluded: the
 * owner's sources being silent about a topic is the normal condition of a partial source
 * library, and offering a dispute button for it would turn every unverifiable question
 * into a suspect one — which would make the whole feature something to switch off.
 */
export function recommendsDispute(verification: SourceVerification): boolean {
  return verification.verdict === "CONTRADICTED";
}

/**
 * The quality status a verification supports promoting to, or `null` for none.
 *
 * `SOURCE_CHECKED` only, only from a fully supported verdict, and only for a question the
 * owner has not already made a stronger judgement about. The promotion is *offered*, never
 * applied: this function says what an accept would do, and the accept is the owner's own
 * click (`SPEC.md` section 26; `spec/AI-GUIDELINES.md` section 1.9 — AI output is never
 * silently promoted into trusted content).
 *
 * Exhaustive over the quality union so that a new status has to decide rather than falling
 * into either answer.
 *
 * `PARTIALLY_SUPPORTED` returns `null` on purpose. "Source-checked" is a claim that the
 * question was checked against a source and held up; a partial check is a partial claim,
 * and there is no status for that. The owner reads the summary instead.
 */
export function qualityStatusAfterVerification(
  verification: SourceVerification,
  current: QuestionQualityStatus,
): QuestionQualityStatus | null {
  if (verification.verdict !== "SUPPORTED") {
    return null;
  }

  switch (current) {
    // Both are weaker claims than "checked against a source", so both may be promoted.
    case "UNREVIEWED":
    case "AI_REVIEWED":
      return "SOURCE_CHECKED";
    // Already this, or already a judgement the owner made themselves, or a state a
    // verification has no business changing: a disputed question stays disputed until the
    // owner resolves the dispute, and an outdated one stays outdated until they say
    // otherwise.
    case "SOURCE_CHECKED":
    case "USER_APPROVED":
    case "DISPUTED":
    case "OUTDATED":
      return null;
  }
}

/**
 * A dispute reason prefilled from a contradicting verification.
 *
 * The verifier's own summary, prefixed so the recorded reason says where it came from. The
 * owner edits it before submitting — it is a starting point for their objection, not a
 * dispute filed by a model.
 */
export function disputeReasonFromVerification(
  verification: SourceVerification,
): string {
  return `Contradicted by my sources (AI check): ${verification.summary}`;
}
