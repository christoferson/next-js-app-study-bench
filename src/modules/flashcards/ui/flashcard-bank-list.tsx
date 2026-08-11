import Link from "next/link";
import type { FlashcardWithRevision } from "@/modules/flashcards/domain/flashcard";
import { textExcerpt } from "@/modules/flashcards/domain/flashcard";
import { cardSummary } from "@/modules/flashcards/domain/flashcard-content";
import {
  CardTypeBadge,
  ConvertedBadge,
  FlashcardLifecycleBadge,
} from "./flashcard-badges";

interface FlashcardBankListProps {
  readonly slug: string;
  readonly items: readonly FlashcardWithRevision[];
}

/**
 * Bank rows, one per card.
 *
 * A row shows the prompt side only, excerpted, so scanning the bank does not spoil
 * answers and a long card does not push the rest off the screen. The row links to
 * the detail page for everything else.
 */
export function FlashcardBankList({ slug, items }: FlashcardBankListProps) {
  return (
    <ul className="card-list">
      {items.map(({ flashcard, revision }) => (
        <li className="card" key={flashcard.id}>
          <div className="card-heading">
            <CardTypeBadge type={revision.cardType} />
            <FlashcardLifecycleBadge status={flashcard.lifecycleStatus} />
            {flashcard.sourceQuestionId === null ? null : <ConvertedBadge />}
          </div>

          <h3 className="card-title">
            <Link href={`/study-tracks/${slug}/flashcards/${flashcard.id}`}>
              {textExcerpt(cardSummary(revision.content))}
            </Link>
          </h3>

          <p className="question-row-meta">
            Revision {revision.revisionNumber} · updated{" "}
            {flashcard.updatedAt.slice(0, 10)}
          </p>
        </li>
      ))}
    </ul>
  );
}
