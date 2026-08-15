import { notFound } from "next/navigation";
import { Breadcrumbs, TRACKS_CRUMB, trackCrumb } from "@/shared/ui/breadcrumbs";
import { getFlashcardFacade } from "@/modules/flashcards/composition";
import { CardFace } from "@/modules/flashcards/ui/card-face";
import { CardTypeBadge } from "@/modules/flashcards/ui/flashcard-badges";

interface FlashcardRevisionPageProps {
  readonly params: Promise<{
    readonly slug: string;
    readonly flashcardId: string;
    readonly revisionNumber: string;
  }>;
}

/**
 * One historical revision of a card, read-only.
 *
 * There is no edit control here: a revision is immutable, and editing means
 * appending a new one from the current revision. Both faces are shown, because
 * reading exactly what the card said — including the answer that was rated — is the
 * whole point of keeping history.
 */
export default async function FlashcardRevisionPage({
  params,
}: FlashcardRevisionPageProps) {
  const { slug, flashcardId, revisionNumber } = await params;
  const parsed = Number(revisionNumber);

  if (!Number.isInteger(parsed) || parsed < 1) {
    notFound();
  }

  const view = await getFlashcardFacade().findRevisionView(
    slug,
    flashcardId,
    parsed,
  );

  if (view === null) {
    notFound();
  }

  const cardPath = `/study-tracks/${view.certification.slug}/flashcards/${view.flashcard.id}`;

  return (
    <main className="page">
      <Breadcrumbs
        trail={[
          TRACKS_CRUMB,
          trackCrumb(view.certification),
          { label: "Flashcard", href: cardPath },
        ]}
        current={`Revision ${view.revision.revisionNumber}`}
      />

      <header className="page-header">
        <p className="eyebrow">{view.certification.name}</p>
        <div className="card-heading">
          <h1>Revision {view.revision.revisionNumber}</h1>
          {view.isCurrent ? (
            <span className="badge">Current</span>
          ) : (
            <span className="badge">Superseded</span>
          )}
          <CardTypeBadge type={view.revision.cardType} />
        </div>
        <p className="lede">
          Written {view.revision.createdAt.slice(0, 10)}. Revisions are never
          changed after they are written.
        </p>
        {view.revision.tags.length > 0 ? (
          <dl className="meta">
            <div className="meta-item">
              <dt>Tags</dt>
              <dd>{view.revision.tags.join(", ")}</dd>
            </div>
          </dl>
        ) : null}
      </header>

      <section aria-labelledby="revision-heading" className="section">
        <div className="section-heading">
          <h2 id="revision-heading">Content as written</h2>
        </div>
        <CardFace content={view.revision.content} revealAnswer />
      </section>

      {view.revision.notes !== null ? (
        <section aria-labelledby="notes-heading" className="section">
          <div className="section-heading">
            <h2 id="notes-heading">Your note on this revision</h2>
          </div>
          <p className="card-text">{view.revision.notes}</p>
        </section>
      ) : null}
    </main>
  );
}
