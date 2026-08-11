import { InvalidFlashcardLifecycleTransitionError } from "./errors";
import type { Flashcard, FlashcardLifecycleStatus } from "./flashcard";

/**
 * Lifecycle transition rules for a flashcard.
 *
 * The same moves as a question (`spec/DOMAIN-RULES.md` section 1.2), minus the
 * quality dimension a card does not have.
 *
 * Editing is not a transition. A new revision may be appended in any lifecycle
 * state, including `RETIRED`, and leaves the status untouched: fixing a retired
 * card is how it becomes worth restoring, and existing revisions are never
 * rewritten, so the reviews that name them stay honest either way.
 */

const ALLOWED_TRANSITIONS: Readonly<
  Record<FlashcardLifecycleStatus, readonly FlashcardLifecycleStatus[]>
> = {
  // Activate a draft once both faces are worth studying.
  DRAFT: ["ACTIVE"],
  // Retire an active card that is wrong or no longer useful.
  ACTIVE: ["RETIRED"],
  // Restore a retired card to the review pool.
  RETIRED: ["ACTIVE"],
  // `ARCHIVED` is terminal in the model and unreachable in D4, exactly as it is
  // for questions: retirement already withdraws a card from review.
  ARCHIVED: [],
};

export function canTransitionLifecycle(
  from: FlashcardLifecycleStatus,
  to: FlashcardLifecycleStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertLifecycleTransition(
  from: FlashcardLifecycleStatus,
  to: FlashcardLifecycleStatus,
): void {
  if (!canTransitionLifecycle(from, to)) {
    throw new InvalidFlashcardLifecycleTransitionError(from, to);
  }
}

/**
 * Whether a card belongs in the review pool.
 *
 * Only `ACTIVE` cards are reviewable: a draft is unfinished, and a retired or
 * archived card was deliberately withdrawn (`SPEC.md` section 22.3, "retired
 * cards are excluded"). The due-card query applies the same rule in SQL, and the
 * facade re-checks it before recording a rating, so a stale page cannot
 * reschedule a card that has left the pool.
 */
export function isReviewEligible(flashcard: Flashcard): boolean {
  return flashcard.lifecycleStatus === "ACTIVE";
}
