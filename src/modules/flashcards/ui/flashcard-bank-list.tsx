import Link from "next/link";
import type { ReactNode } from "react";
import type { FlashcardWithRevision } from "@/modules/flashcards/domain/flashcard";
import { textExcerpt } from "@/modules/flashcards/domain/flashcard";
import { cardSummary } from "@/modules/flashcards/domain/flashcard-content";
import { ProvenanceBadge } from "@/modules/question-bank/ui/question-badges";
import {
  CardTypeBadge,
  ConvertedBadge,
  FlashcardLifecycleBadge,
} from "./flashcard-badges";

interface FlashcardBankListProps {
  readonly slug: string;
  readonly items: readonly FlashcardWithRevision[];
  /**
   * Per-card audio control, keyed by flashcard id, rendered at the far right of the
   * row's badge line — a consistent home on every card, clear of the title text.
   *
   * An opaque node, same as the review screen and session item: this module renders
   * whatever the page resolved, and never imports the audio module (the dependency
   * direction is `flashcards ← audio`). Absent entries render nothing — the owner
   * scans a mixed bank without gaps where a scenario card offers no pronunciation.
   */
  readonly audioByCard?: ReadonlyMap<string, ReactNode> | undefined;
}

/**
 * Bank rows, one per card.
 *
 * A row shows the prompt side only, excerpted, so scanning the bank does not spoil
 * answers and a long card does not push the rest off the screen. The row links to
 * the detail page for everything else — except pronunciation, which plays right here:
 * the owner asked to play across vocabulary without opening each card.
 */
export function FlashcardBankList({
  slug,
  items,
  audioByCard,
}: FlashcardBankListProps) {
  return (
    <ul className="card-list">
      {items.map(({ flashcard, revision }) => (
        <li className="card" key={flashcard.id}>
          <div className="card-heading">
            <CardTypeBadge type={revision.cardType} />
            <FlashcardLifecycleBadge status={flashcard.lifecycleStatus} />
            {flashcard.sourceQuestionId === null ? null : <ConvertedBadge />}
            <ProvenanceBadge
              generationMode={flashcard.generationMode}
              generationRunId={flashcard.generationRunId}
              slug={slug}
            />
            {audioByCard?.get(flashcard.id) === undefined ? null : (
              <span className="card-heading-audio">
                {audioByCard.get(flashcard.id)}
              </span>
            )}
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
