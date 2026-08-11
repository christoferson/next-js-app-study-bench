import type {
  CardType,
  FlashcardLifecycleStatus,
} from "@/modules/flashcards/domain/flashcard";
import {
  describeCardType,
  describeFlashcardLifecycleStatus,
} from "@/modules/flashcards/domain/flashcard";
import type { RecallRating } from "@/modules/flashcards/domain/review-scheduling";
import { describeRating } from "@/modules/flashcards/domain/review-scheduling";

/**
 * Status badges for a flashcard.
 *
 * Each badge carries its own word, so a state is never communicated by colour
 * alone (`spec/UI-GUIDELINES.md` section 1.3). A card has one status dimension
 * rather than the question bank's two: `SPEC.md` section 6.4 gives flashcards no
 * review state.
 */

export function FlashcardLifecycleBadge({
  status,
}: {
  readonly status: FlashcardLifecycleStatus;
}) {
  return (
    <span className="badge">
      Status: {describeFlashcardLifecycleStatus(status)}
    </span>
  );
}

export function CardTypeBadge({ type }: { readonly type: CardType }) {
  return <span className="badge">{describeCardType(type)}</span>;
}

export function RatingBadge({ rating }: { readonly rating: RecallRating }) {
  return <span className="badge">{describeRating(rating)}</span>;
}

/** Marks a card that came from a question, so provenance is visible. */
export function ConvertedBadge() {
  return <span className="badge">From a question</span>;
}
