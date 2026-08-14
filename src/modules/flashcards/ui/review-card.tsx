"use client";

import type { ReactNode } from "react";
import { useActionState, useState } from "react";
import { FieldErrors } from "@/shared/ui/field-errors";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE, formLevelErrors } from "@/shared/ui/form-state";
import type {
  Flashcard,
  FlashcardRevision,
} from "@/modules/flashcards/domain/flashcard";
import type { ReviewSchedule } from "@/modules/flashcards/domain/review-scheduling";
import {
  RECALL_RATINGS,
  describeInterval,
  describeRating,
  describeRatingHint,
} from "@/modules/flashcards/domain/review-scheduling";
import { CardFace } from "./card-face";
import { CardTypeBadge } from "./flashcard-badges";

interface ReviewCardProps {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly slug: string;
  readonly flashcard: Flashcard;
  readonly revision: FlashcardRevision;
  /** `null` for a card that has never been reviewed. */
  readonly schedule: ReviewSchedule | null;
  readonly remainingCount: number;
  /**
   * Pronunciation controls for this card, rendered by the page.
   *
   * A node rather than data because the controls are a server component: they wire
   * Server Actions and were built from a cache lookup the page already did. This
   * component is a Client Component, so it can hold the audio in its tree but must not
   * be what constructs it (`spec/ARCHITECTURE.md` section 6.3).
   *
   * Shown only after the answer is revealed. Hearing the term is a strong hint on a
   * card that prompts with the meaning, and a control sitting under the prompt would be
   * an answer one tap away from a screen meant to test recall.
   */
  readonly audio?: ReactNode;
}

/**
 * One card under review: prompt, reveal, rate.
 *
 * The answer starts hidden and is revealed by the owner, because a card whose
 * answer is already on screen tests nothing. Whether the answer is revealed is the
 * only client state; the rating itself is a form submission, so rating a card works
 * the same way with or without hydration having finished.
 *
 * The four ratings are one form with four submit buttons, so the button that was
 * pressed supplies the rating and no client handler is needed. Each button names
 * what it means as well as its word, since "Hard" alone does not say what will
 * happen.
 *
 * The revision on screen is submitted with the rating, so the recorded review names
 * the exact text that was read even if the card was edited in another tab
 * (`spec/DOMAIN-RULES.md` section 1.4).
 */
export function ReviewCard({
  action,
  slug,
  flashcard,
  revision,
  schedule,
  remainingCount,
  audio,
}: ReviewCardProps) {
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
        <span className="badge">
          {remainingCount} card{remainingCount === 1 ? "" : "s"} due
        </span>
        {schedule === null ? (
          <span className="badge">First review</span>
        ) : (
          <span className="badge">
            Review {schedule.reviewCount + 1} · last interval{" "}
            {describeInterval(schedule.intervalMinutes)}
          </span>
        )}
      </div>

      {formErrors.length > 0 ? (
        <FieldErrors id="review-errors" messages={formErrors} />
      ) : null}

      <CardFace content={revision.content} revealAnswer={revealed} />

      {revealed ? audio : null}

      {revealed ? (
        <form action={formAction} className="review-ratings">
          <input type="hidden" name="slug" value={slug} readOnly />
          <input
            type="hidden"
            name="flashcardId"
            value={flashcard.id}
            readOnly
          />
          <input
            type="hidden"
            name="flashcardRevisionId"
            value={revision.id}
            readOnly
          />

          <p className="field-hint" id="review-rating-hint">
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
                aria-describedby="review-rating-hint"
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
        // Owner notes are never part of a face, so they stay behind a disclosure
        // even after the answer is revealed.
        <details className="disclosure">
          <summary>Your note on this card</summary>
          <p className="card-text">{revision.notes}</p>
        </details>
      ) : null}
    </div>
  );
}
