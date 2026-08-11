import Link from "next/link";
import { notFound } from "next/navigation";
import { describeCardPrompting } from "@/modules/flashcards/domain/flashcard";
import { getFlashcardFacade } from "@/modules/flashcards/composition";
import {
  linkFlashcardObjectiveAction,
  unlinkFlashcardObjectiveAction,
} from "@/modules/flashcards/ui/actions";
import {
  CardTypeBadge,
  ConvertedBadge,
  FlashcardLifecycleBadge,
} from "@/modules/flashcards/ui/flashcard-badges";
import { CardFace } from "@/modules/flashcards/ui/card-face";
import { FlashcardObjectiveLinkForm } from "@/modules/flashcards/ui/flashcard-objective-link-form";
import { FlashcardOwnerPanel } from "@/modules/flashcards/ui/flashcard-owner-panel";
import { FlashcardRevisionHistory } from "@/modules/flashcards/ui/flashcard-revision-history";
import { ReviewHistory } from "@/modules/flashcards/ui/review-history";

interface FlashcardDetailPageProps {
  readonly params: Promise<{
    readonly slug: string;
    readonly flashcardId: string;
  }>;
}

/**
 * One flashcard: how it is prompted, plus everything the owner manages.
 *
 * The facade returns `null` both for an unknown id and for a card belonging to
 * another track, so a guessed address is a 404 rather than a cross-track leak.
 *
 * The answer stays behind a disclosure, as on the question page: reading the bank
 * should not spoil a card the owner is still studying.
 */
export default async function FlashcardDetailPage({
  params,
}: FlashcardDetailPageProps) {
  const { slug, flashcardId } = await params;
  const view = await getFlashcardFacade().findDetail(slug, flashcardId);

  if (view === null) {
    notFound();
  }

  const { certification, flashcard, currentRevision } = view;
  const bankPath = `/study-tracks/${certification.slug}/flashcards`;
  const cardPath = `${bankPath}/${flashcard.id}`;

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href={bankPath}>Back to the flashcards</Link>
      </nav>

      <header className="page-header">
        <p className="eyebrow">{certification.name}</p>
        <div className="card-heading">
          <h1>Flashcard</h1>
          <CardTypeBadge type={currentRevision.cardType} />
          <FlashcardLifecycleBadge status={flashcard.lifecycleStatus} />
          {view.sourceQuestionId !== null ? <ConvertedBadge /> : null}
        </div>
        <p className="lede">
          {describeCardPrompting(currentRevision.cardType)}
        </p>
        <dl className="meta">
          <div className="meta-item">
            <dt>Revision</dt>
            <dd>
              {currentRevision.revisionNumber} of {view.revisions.length}
            </dd>
          </div>
          {currentRevision.language !== null ? (
            <div className="meta-item">
              <dt>Language</dt>
              <dd>{currentRevision.language}</dd>
            </div>
          ) : null}
          {currentRevision.tags.length > 0 ? (
            <div className="meta-item">
              <dt>Tags</dt>
              <dd>{currentRevision.tags.join(", ")}</dd>
            </div>
          ) : null}
          <div className="meta-item">
            <dt>Updated</dt>
            <dd>{flashcard.updatedAt.slice(0, 10)}</dd>
          </div>
        </dl>
        <div className="section-actions">
          <Link className="button" href={`${cardPath}/edit`}>
            Edit card
          </Link>
        </div>
      </header>

      <section aria-labelledby="prompt-heading" className="section">
        <div className="section-heading">
          <h2 id="prompt-heading">How it will be studied</h2>
          <p className="section-note">
            The prompt side, as it appears when the card comes up.
          </p>
        </div>
        <CardFace content={currentRevision.content} revealAnswer={false} />
      </section>

      <section aria-labelledby="answer-heading" className="section">
        <div className="section-heading">
          <h2 id="answer-heading">The answer side</h2>
        </div>
        {/* Kept off screen until asked for, so scanning the bank does not spoil a
            card that is still being studied. */}
        <details className="disclosure">
          <summary>Reveal the answer</summary>
          <CardFace content={currentRevision.content} revealAnswer />
        </details>
      </section>

      {currentRevision.notes !== null ? (
        <section aria-labelledby="notes-heading" className="section">
          <div className="section-heading">
            <h2 id="notes-heading">Your note</h2>
            <p className="section-note">
              Owner-only context. It is never shown while reviewing.
            </p>
          </div>
          <p className="card-text">{currentRevision.notes}</p>
        </section>
      ) : null}

      <section aria-labelledby="objectives-heading" className="section">
        <div className="section-heading">
          <h2 id="objectives-heading">Objectives</h2>
          <p className="section-note">
            Mapping a card to objectives places it in this track&apos;s study
            map. Only objectives of {certification.name} can be mapped.
          </p>
        </div>

        {view.linkedObjectives.length === 0 ? (
          <p className="empty-state">
            This card is not mapped to any objective yet.
          </p>
        ) : (
          <ul className="card-list">
            {view.linkedObjectives.map((objective) => (
              <li className="card" key={objective.id}>
                <div className="card-heading">
                  {objective.code !== null ? (
                    <span className="badge">{objective.code}</span>
                  ) : null}
                  <p className="card-title">{objective.title}</p>
                </div>
                <form action={unlinkFlashcardObjectiveAction}>
                  <input
                    type="hidden"
                    name="slug"
                    value={certification.slug}
                    readOnly
                  />
                  <input
                    type="hidden"
                    name="flashcardId"
                    value={flashcard.id}
                    readOnly
                  />
                  <input
                    type="hidden"
                    name="objectiveId"
                    value={objective.id}
                    readOnly
                  />
                  <button
                    type="submit"
                    className="button-quiet"
                    aria-label={`Remove mapping to ${objective.title}`}
                  >
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {view.linkableObjectives.length > 0 ? (
          <FlashcardObjectiveLinkForm
            action={linkFlashcardObjectiveAction}
            slug={certification.slug}
            flashcardId={flashcard.id}
            candidates={view.linkableObjectives}
          />
        ) : (
          <p className="field-hint">
            {view.linkedObjectives.length === 0
              ? "This track has no active objectives to map yet."
              : "Every active objective of this track is already mapped."}
          </p>
        )}
      </section>

      <section aria-labelledby="manage-heading" className="section">
        <div className="section-heading">
          <h2 id="manage-heading">Manage</h2>
        </div>
        <FlashcardOwnerPanel slug={certification.slug} flashcard={flashcard} />
      </section>

      <section aria-labelledby="review-heading" className="section">
        <div className="section-heading">
          <h2 id="review-heading">Review history</h2>
          <p className="section-note">
            Every rating is kept, together with the interval it produced and the
            revision that was on screen.
          </p>
        </div>
        <ReviewHistory
          reviews={view.reviews}
          schedule={view.schedule}
          revisions={view.revisions}
        />
      </section>

      <section aria-labelledby="history-heading" className="section">
        <div className="section-heading">
          <h2 id="history-heading">Revision history</h2>
          <p className="section-note">
            Editing a card adds a revision. Earlier revisions are kept exactly
            as they were written, so a recorded review still names the text it
            was answered against.
          </p>
        </div>
        <FlashcardRevisionHistory
          slug={certification.slug}
          flashcardId={flashcard.id}
          revisions={view.revisions}
          currentRevisionId={flashcard.currentRevisionId}
        />
      </section>

      {view.sourceQuestionId === null ? null : (
        <section aria-labelledby="source-heading" className="section">
          <div className="section-heading">
            <h2 id="source-heading">Where it came from</h2>
            <p className="section-note">
              This card was made from a question. The two are independent now:
              editing either one never changes the other.
            </p>
          </div>
          <Link
            className="button-quiet"
            href={`/study-tracks/${certification.slug}/questions/${view.sourceQuestionId}`}
          >
            Open the source question
          </Link>
        </section>
      )}
    </main>
  );
}
