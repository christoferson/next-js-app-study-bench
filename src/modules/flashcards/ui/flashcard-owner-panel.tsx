import type { Flashcard } from "@/modules/flashcards/domain/flashcard";
import {
  activateFlashcardAction,
  restoreFlashcardAction,
  retireFlashcardAction,
} from "./actions";

interface FlashcardOwnerPanelProps {
  readonly slug: string;
  readonly flashcard: Flashcard;
}

/**
 * Owner actions for one card.
 *
 * Only the actions the card's current state allows are rendered: a draft offers
 * activation, an active card offers retirement, a retired one offers restoration.
 * The facade re-checks every transition, so a stale page cannot apply an illegal
 * one.
 *
 * There is no delete control. D4 has no card deletion — a card carries review
 * history, and withdrawing one from study is what retirement is for.
 */
export function FlashcardOwnerPanel({
  slug,
  flashcard,
}: FlashcardOwnerPanelProps) {
  return (
    <div className="owner-panel">
      <div className="owner-group">
        <h3>Availability</h3>
        <p className="field-hint">
          {flashcard.lifecycleStatus === "ACTIVE"
            ? "This card is in the review queue."
            : "Only active cards come up for review."}
        </p>
        <div className="section-actions">
          {flashcard.lifecycleStatus === "DRAFT" ? (
            <ActionButton
              action={activateFlashcardAction}
              slug={slug}
              flashcardId={flashcard.id}
              label="Activate"
            />
          ) : null}
          {flashcard.lifecycleStatus === "ACTIVE" ? (
            <ActionButton
              action={retireFlashcardAction}
              slug={slug}
              flashcardId={flashcard.id}
              label="Retire"
            />
          ) : null}
          {flashcard.lifecycleStatus === "RETIRED" ? (
            <ActionButton
              action={restoreFlashcardAction}
              slug={slug}
              flashcardId={flashcard.id}
              label="Restore to active"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface ActionButtonProps {
  readonly action: (form: FormData) => Promise<void>;
  readonly slug: string;
  readonly flashcardId: string;
  readonly label: string;
}

function ActionButton({ action, slug, flashcardId, label }: ActionButtonProps) {
  return (
    <form action={action}>
      <input type="hidden" name="slug" value={slug} readOnly />
      <input type="hidden" name="flashcardId" value={flashcardId} readOnly />
      <button type="submit" className="button-quiet">
        {label}
      </button>
    </form>
  );
}
