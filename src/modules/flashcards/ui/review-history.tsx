import type { FlashcardRevision } from "@/modules/flashcards/domain/flashcard";
import type { ReviewSchedule } from "@/modules/flashcards/domain/review-scheduling";
import { describeInterval } from "@/modules/flashcards/domain/review-scheduling";
import type { FlashcardReviewRecord } from "@/modules/flashcards/ports/flashcard-repository";
import { RatingBadge } from "./flashcard-badges";

interface ReviewHistoryProps {
  readonly reviews: readonly FlashcardReviewRecord[];
  readonly schedule: ReviewSchedule | null;
  /** Every revision of the card, so a review can name the one it rated. */
  readonly revisions: readonly FlashcardRevision[];
}

/**
 * What this card's review history says, newest first.
 *
 * Each row shows the rating, the interval that rating produced, and the revision
 * that was on screen. The interval is read from the review record rather than
 * recomputed, so the history keeps explaining itself after the scheduling strategy
 * is replaced.
 */
export function ReviewHistory({
  reviews,
  schedule,
  revisions,
}: ReviewHistoryProps) {
  const revisionNumbers = new Map(
    revisions.map((revision) => [revision.id, revision.revisionNumber]),
  );

  return (
    <>
      {schedule === null ? (
        <p className="empty-state">
          This card has not been reviewed yet. It comes up as soon as it is
          active.
        </p>
      ) : (
        <dl className="meta">
          <div className="meta-item">
            <dt>Next due</dt>
            <dd>{schedule.dueAt.slice(0, 10)}</dd>
          </div>
          <div className="meta-item">
            <dt>Current interval</dt>
            <dd>{describeInterval(schedule.intervalMinutes)}</dd>
          </div>
          <div className="meta-item">
            <dt>Reviews</dt>
            <dd>{schedule.reviewCount}</dd>
          </div>
          <div className="meta-item">
            <dt>Lapses</dt>
            <dd>{schedule.lapseCount}</dd>
          </div>
        </dl>
      )}

      {reviews.length === 0 ? null : (
        <ol className="revision-list">
          {reviews.map((review) => (
            <li className="revision-row" key={review.id}>
              <div className="card-heading">
                <RatingBadge rating={review.rating} />
                <span className="badge">
                  Next in {describeInterval(review.intervalMinutes)}
                </span>
              </div>
              <p className="question-row-meta">
                Reviewed {review.reviewedAt.slice(0, 10)} · revision{" "}
                {revisionNumbers.get(review.flashcardRevisionId) ?? "unknown"} ·
                due {review.dueAt.slice(0, 10)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
