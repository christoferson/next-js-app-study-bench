"use client";

import type { ReactNode } from "react";
import { useActionState, useState } from "react";
import { FieldErrors } from "@/shared/ui/field-errors";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE, formLevelErrors } from "@/shared/ui/form-state";
import type { FlashcardRevision } from "@/modules/flashcards/domain/flashcard";
import {
  RECALL_RATINGS,
  describeRating,
  describeRatingHint,
} from "@/modules/flashcards/domain/review-scheduling";
import { CardFace } from "@/modules/flashcards/ui/card-face";
import { CardTypeBadge } from "@/modules/flashcards/ui/flashcard-badges";

interface SessionCardItemProps {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly sessionId: string;
  readonly itemId: string;
  /** The revision the session froze, which is the text being read. */
  readonly revision: FlashcardRevision;
  /**
   * Pronunciation controls for this card, rendered by the page.
   *
   * Passed as a node for the same reason as on the review screen: the controls are a
   * server component built from a cache lookup, and this is a Client Component. Shown
   * only once the answer is revealed, so hearing the term cannot pre-empt recalling it.
   */
  readonly audio?: ReactNode;
}

/**
 * One flashcard item inside a session: prompt, reveal, rate.
 *
 * Reuses `CardFace` from the flashcard module rather than reimplementing the faces,
 * so a card looks and prompts identically whether it is met on the review screen or
 * inside a session, and a change to how a reversed or cloze card is prompted lands in
 * both places at once.
 *
 * The rating is the pressed submit button, as on the review screen, so rating a card
 * needs no client handler. The facade writes the review, the schedule, and the item
 * completion in one transaction using the same scheduler the review screen uses, so
 * rating a card here is not a second, weaker kind of review.
 */
export function SessionCardItem({
  action,
  sessionId,
  itemId,
  revision,
  audio,
}: SessionCardItemProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const [revealed, setRevealed] = useState(false);
  const formErrors = formLevelErrors(state);

  return (
    <div className="review">
      <div className="card-heading">
        <CardTypeBadge type={revision.cardType} />
        <span className="badge">Flashcard</span>
      </div>

      {formErrors.length > 0 ? (
        <FieldErrors id="session-card-errors" messages={formErrors} />
      ) : null}

      <CardFace content={revision.content} revealAnswer={revealed} />

      {revealed ? audio : null}

      {revealed ? (
        <form action={formAction} className="review-ratings">
          <input type="hidden" name="sessionId" value={sessionId} readOnly />
          <input type="hidden" name="itemId" value={itemId} readOnly />

          <p className="field-hint" id="session-rating-hint">
            How well did you recall it? Your answer sets when this card comes
            back.
          </p>

          <div className="review-rating-buttons">
            {RECALL_RATINGS.map((rating) => (
              <button
                key={rating}
                type="submit"
                name="rating"
                value={rating}
                className="button-quiet review-rating"
                disabled={isPending}
                aria-describedby="session-rating-hint"
              >
                <span className="review-rating-word">
                  {describeRating(rating)}
                </span>
                <span className="review-rating-hint">
                  {describeRatingHint(rating)}
                </span>
              </button>
            ))}
          </div>
        </form>
      ) : (
        <div className="review-actions">
          <button
            type="button"
            className="button review-reveal"
            onClick={() => setRevealed(true)}
          >
            Show answer
          </button>
        </div>
      )}

      {revision.notes !== null ? (
        <details className="disclosure">
          <summary>Your note on this card</summary>
          <p className="card-text">{revision.notes}</p>
        </details>
      ) : null}
    </div>
  );
}
