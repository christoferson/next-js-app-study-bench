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
  }
}
