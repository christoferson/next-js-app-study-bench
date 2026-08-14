import type { GeneratedItemKind } from "./generation-run";

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

/** The cap for one request, by what the request is for. */
export function maxItemsFor(kind: GeneratedItemKind): number {
  switch (kind) {
    case "QUESTION":
    case "FLASHCARD":
      return MAX_BATCH_ITEMS;
    case "ENRICH_VOCABULARY":
      return MAX_ENRICHMENT_ITEMS;
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
  const perItem = tokensPerItem(kind);

  return 1_000 + perItem * Math.max(MIN_BATCH_ITEMS, itemCount);
}

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
  }
}
