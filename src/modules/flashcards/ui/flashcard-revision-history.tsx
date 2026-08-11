import Link from "next/link";
import type {
  FlashcardRevision,
  FlashcardRevisionId,
} from "@/modules/flashcards/domain/flashcard";
import { textExcerpt } from "@/modules/flashcards/domain/flashcard";
import { cardSummary } from "@/modules/flashcards/domain/flashcard-content";
import { CardTypeBadge } from "./flashcard-badges";

interface FlashcardRevisionHistoryProps {
  readonly slug: string;
  readonly flashcardId: string;
  readonly revisions: readonly FlashcardRevision[];
  readonly currentRevisionId: FlashcardRevisionId;
}

/**
 * Revision list, newest first.
 *
 * Every revision links to a read-only view of itself, which is what makes the
 * append-only history useful: after an edit the owner can still read exactly what
 * the card said, and a recorded review names the revision it was answered against
 * (`spec/DOMAIN-RULES.md` sections 1.1 and 1.4).
 */
export function FlashcardRevisionHistory({
  slug,
  flashcardId,
  revisions,
  currentRevisionId,
}: FlashcardRevisionHistoryProps) {
  return (
    <ol className="revision-list">
      {revisions.map((revision) => (
        <li className="revision-row" key={revision.id}>
          <div className="card-heading">
            <span className="badge">Revision {revision.revisionNumber}</span>
            <CardTypeBadge type={revision.cardType} />
            {revision.id === currentRevisionId ? (
              <span className="badge">Current</span>
            ) : null}
          </div>
          <p className="question-row-meta">
            Written {revision.createdAt.slice(0, 10)}
          </p>
          <p className="card-text">
            {textExcerpt(cardSummary(revision.content), 90)}
          </p>
          <Link
            className="button-quiet"
            href={`/study-tracks/${slug}/flashcards/${flashcardId}/revisions/${revision.revisionNumber}`}
          >
            Read revision {revision.revisionNumber}
          </Link>
        </li>
      ))}
    </ol>
  );
}
