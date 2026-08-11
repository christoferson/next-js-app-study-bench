import Link from "next/link";
import { notFound } from "next/navigation";
import { getFlashcardFacade } from "@/modules/flashcards/composition";
import { reviewFlashcardAction } from "@/modules/flashcards/ui/actions";
import { ReviewCard } from "@/modules/flashcards/ui/review-card";

interface ReviewPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

/**
 * The review screen for one study track.
 *
 * A plain GET loads the next due card from the deterministically ordered queue, so
 * reloading offers the same card until it is rated and closing the tab loses
 * nothing. Rating posts a Server Action and redirects back here, which loads the
 * next card — there is no session object, and none is needed until D5.
 *
 * An empty queue explains itself rather than showing a bare "nothing to do": whether
 * nothing is due, nothing is active, or the bank is empty are three different
 * situations with three different next steps.
 */
export default async function ReviewPage({ params }: ReviewPageProps) {
  const { slug } = await params;
  const view = await getFlashcardFacade().findReviewSession(slug);

  if (view === null) {
    notFound();
  }

  const trackPath = `/study-tracks/${view.certification.slug}`;
  const bankPath = `${trackPath}/flashcards`;

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href={bankPath}>Back to the flashcards</Link>
      </nav>

      <header className="page-header">
        <p className="eyebrow">Review</p>
        <h1>{view.certification.name}</h1>
      </header>

      {view.card === null ? (
        <section aria-labelledby="nothing-heading" className="section">
          <div className="section-heading">
            <h2 id="nothing-heading">Nothing to review right now</h2>
          </div>
          <p className="empty-state">
            {view.activeCount === 0
              ? "No cards are active in this track yet. Activate a card and it comes up for review straight away."
              : "Every active card in this track has been reviewed and is waiting for its next due date."}
          </p>
          <div className="section-actions">
            <Link className="button" href={bankPath}>
              Open the flashcards
            </Link>
          </div>
        </section>
      ) : (
        <ReviewCard
          action={reviewFlashcardAction}
          slug={view.certification.slug}
          flashcard={view.card.flashcard}
          revision={view.card.revision}
          schedule={view.card.schedule}
          remainingCount={view.remainingCount}
        />
      )}
    </main>
  );
}
