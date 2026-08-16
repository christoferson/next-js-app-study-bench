import { ANSWER_EVALUATION_ITEM_COUNT } from "./answer-evaluation";
import type { GeneratedItemKind } from "./generation-run";
import { QUESTION_CHALLENGE_ITEM_COUNT } from "./question-challenge";
import { QUESTION_REVIEW_ITEM_COUNT } from "./question-review";
import { SOURCE_VERIFICATION_ITEM_COUNT } from "./source-verification";
import { TUTOR_ITEM_COUNT } from "./tutor-exchange";

/**
 * Cost limits for one generation request (`SPEC.md` section 11.6).
 *
 * Generation in D6 is synchronous: the owner waits for the request on the page
 * that started it, and there is no background worker
 * (`SPEC.md` section 11.6, "do not build a background-worker system before a
 * milestone requires it"). That makes the batch limit a usability rule as much as a
 * cost rule — a request that cannot finish inside a page load is the wrong size.
 *
 * The limits live in the domain so the schema, the facade, the form, and the tests
 * all read the same numbers. Enforcement happens twice on purpose: the schema stops
 * a hostile form post, and the facade stops a caller that bypassed the schema.
 */

export const MIN_BATCH_ITEMS = 1;

/** The most items one request may ask for. */
export const MAX_BATCH_ITEMS = 10;

/**
 * The most cards one enrichment run may rewrite.
 *
 * Higher than `MAX_BATCH_ITEMS` and its own constant rather than a bigger shared
 * one, because enrichment is a different kind of request and the number is
 * justified differently. Writing ten questions is ten pieces of composition;
 * enriching a word the model already knows is a lookup, so twenty fit in one
 * synchronous request comfortably. Raising the shared limit to twenty would also
 * raise it for questions, where the cost per item is more than twice as high.
 *
 * Twenty is also what makes the bank tractable by hand: the owner's HSK track
 * holds 1600 vocabulary cards, so a run is a visible dent the owner can inspect
 * in one sitting rather than a batch they have to trust.
 */
export const MAX_ENRICHMENT_ITEMS = 20;

/**
 * How many "items" one objective import asks for: one document.
 *
 * The run schema requires `requested_item_count >= 1`, and for an import the honest
 * number is one — the owner uploaded one syllabus. How many *objectives* come back is
 * not something the request asks for; that is capped by `MAX_IMPORT_NODES`, which is a
 * property of the answer rather than of the request, and the run's
 * `successful_item_count` records how many were actually proposed.
 */
export const OBJECTIVE_IMPORT_ITEM_COUNT = 1;

/** The cap for one request, by what the request is for. */
export function maxItemsFor(kind: GeneratedItemKind): number {
  switch (kind) {
    case "QUESTION":
    case "FLASHCARD":
      return MAX_BATCH_ITEMS;
    case "ENRICH_VOCABULARY":
      return MAX_ENRICHMENT_ITEMS;
    case "OBJECTIVE_IMPORT":
      return OBJECTIVE_IMPORT_ITEM_COUNT;
    // A review is one question by construction: the owner presses the button on a
    // question's own page, so there is no batch to cap. Batch review would be a new
    // request shape rather than a bigger number here.
    case "QUESTION_REVIEW":
      return QUESTION_REVIEW_ITEM_COUNT;
    // One ask, one answer, for the same reason: the owner presses a button on a
    // question's own page. Asking the tutor five things is five runs, each recorded on
    // its own.
    case "TUTOR_EXPLANATION":
      return TUTOR_ITEM_COUNT;
    // One written answer, graded once. The button is on the feedback screen for a single
    // attempt, so there is nothing to batch.
    case "ANSWER_EVALUATION":
      return ANSWER_EVALUATION_ITEM_COUNT;
    // One objection, adjudicated once. Two objections to the same question are two
    // challenges, each recorded with the reason it was about.
    case "QUESTION_CHALLENGE":
      return QUESTION_CHALLENGE_ITEM_COUNT;
    // One question, checked against sources once. Verifying a whole bank would be a
    // different request shape — and a bill the owner should see before they agree to it —
    // rather than a bigger number here.
    case "SOURCE_VERIFICATION":
      return SOURCE_VERIFICATION_ITEM_COUNT;
  }
}

/**
 * Above this, the form asks the owner to confirm before spending the call
 * (`SPEC.md` section 11.6, "visible confirmation for large generation requests").
 */
export const LARGE_BATCH_THRESHOLD = 5;

export function isLargeBatch(itemCount: number): boolean {
  return itemCount > LARGE_BATCH_THRESHOLD;
}

/**
 * A hard ceiling on generated tokens for one request.
 *
 * Scaled by the batch size with a floor, so a one-item request cannot be billed
 * for a ten-item budget and a ten-item request is not truncated halfway. A
 * question carries choices and an explanation, so it is allowed more room than a
 * card. Exhaustive over the item kind, so a third kind must decide.
 */
export function maxOutputTokensFor(
  kind: GeneratedItemKind,
  itemCount: number,
): number {
  if (kind === "OBJECTIVE_IMPORT") {
    // Not per item: the request is one document, and what the answer costs depends on
    // how many objectives the *document* lists, which nobody knows before reading it.
    // A flat ceiling sized for the node cap — roughly 150 objectives with a code, a
    // title, and a short description each — so a full outline is not truncated halfway
    // through and a runaway answer is still bounded.
    return OBJECTIVE_IMPORT_OUTPUT_TOKENS;
  }

  const perItem = tokensPerItem(kind);

  return 1_000 + perItem * Math.max(MIN_BATCH_ITEMS, itemCount);
}

/** The ceiling for one extracted outline. See `maxOutputTokensFor`. */
export const OBJECTIVE_IMPORT_OUTPUT_TOKENS = 16_000;

function tokensPerItem(kind: GeneratedItemKind): number {
  switch (kind) {
    case "QUESTION":
      return 900;
    case "FLASHCARD":
      return 400;
    // An enriched word carries several senses, two example sentences with a
    // reading and a translation each, and a usage note, so it is the longest of
    // the three answers per item even though it is the cheapest to think of.
    case "ENRICH_VOCABULARY":
      return 700;
    case "OBJECTIVE_IMPORT":
      // Unreachable: `maxOutputTokensFor` answers for this kind before it asks. Stated
      // so the switch stays exhaustive and a fifth kind must still decide.
      return OBJECTIVE_IMPORT_OUTPUT_TOKENS;
    // A review is prose about one question: a verdict, a summary, and up to a dozen
    // findings of a sentence or two each. Generous enough that a reviewer with a lot to
    // say is not cut off mid-finding, which would fail validation and spend the repair
    // attempt on truncation rather than on substance.
    case "QUESTION_REVIEW":
      return 2_500;
    // A tutor answer is prose for a person to read: a few paragraphs, or a short question
    // with its answer and an explanation. Generous enough that a full worked example is
    // not cut off mid-sentence, because a truncated explanation still validates — it is
    // non-empty — so the cost of being mean here is an answer that stops halfway rather
    // than one that fails loudly.
    case "TUTOR_EXPLANATION":
      return 2_000;
    // A grading is two short lists of concepts copied back plus a paragraph of feedback,
    // so it is the cheapest of the prose kinds.
    case "ANSWER_EVALUATION":
      return 1_500;
    // A challenge has to argue both readings before deciding, which is two arguments plus
    // a conclusion, so it needs about what a review needs.
    case "QUESTION_CHALLENGE":
      return 2_500;
    // A verification is a verdict, a paragraph of reasoning, and a short note per excerpt.
    // Roughly a review's budget, because the reasoning has to say what each passage does
    // and does not establish, which is the part the owner actually reads.
    case "SOURCE_VERIFICATION":
      return 2_500;
  }
}
