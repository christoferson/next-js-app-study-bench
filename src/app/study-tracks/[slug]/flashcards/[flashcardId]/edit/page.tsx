import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, TRACKS_CRUMB, trackCrumb } from "@/shared/ui/breadcrumbs";
import {
  CARD_TYPES,
  describeCardShape,
  describeCardType,
} from "@/modules/flashcards/domain/flashcard";
import type { CardType } from "@/modules/flashcards/domain/flashcard";
import { getFlashcardFacade } from "@/modules/flashcards/composition";
import { reviseFlashcardAction } from "@/modules/flashcards/ui/actions";
import { FlashcardForm } from "@/modules/flashcards/ui/flashcard-form";

interface EditFlashcardPageProps {
  readonly params: Promise<{
    readonly slug: string;
    readonly flashcardId: string;
  }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Edits a card by writing its next revision.
 *
 * The form is prefilled from the current revision, and saving appends revision
 * `n + 1` rather than overwriting revision `n`, so the wording being replaced stays
 * readable in the history and every recorded review still names the text it was
 * answered against.
 *
 * The type can be changed here, which a question's type cannot be: a card's type is
 * about how the same material is prompted, and a converted card in particular
 * usually wants retyping. Switching type is a link rather than a control inside the
 * form, for the same reason the create flow asks for the type first. The current
 * type's fields prefill; another type's start empty, since a front is not a term.
 */
export default async function EditFlashcardPage({
  params,
  searchParams,
}: EditFlashcardPageProps) {
  const { slug, flashcardId } = await params;
  const query = await searchParams;
  const view = await getFlashcardFacade().findEditForm(slug, flashcardId);

  if (view === null) {
    notFound();
  }

  const cardPath = `/study-tracks/${view.certification.slug}/flashcards/${view.flashcard.id}`;
  const editPath = `${cardPath}/edit`;
  const nextRevision = view.revision.revisionNumber + 1;
  const cardType = readCardType(query.type) ?? view.revision.cardType;
  const isRetyped = cardType !== view.revision.cardType;

  return (
    <main className="page">
      <Breadcrumbs
        trail={[
          TRACKS_CRUMB,
          trackCrumb(view.certification),
          { label: "Flashcard", href: cardPath },
        ]}
        current="Edit"
      />

      <header className="page-header">
        <p className="eyebrow">Edit flashcard</p>
        <h1>
          Write revision {nextRevision} of this{" "}
          {describeCardType(cardType).toLowerCase()} card
        </h1>
        <p className="lede">
          Saving keeps revision {view.revision.revisionNumber} exactly as it is
          and makes revision {nextRevision} the one that will be studied. The
          card stays{" "}
          {view.flashcard.lifecycleStatus === "ACTIVE" ? "active" : "as it is"},
          and its review history and due date do not change.
        </p>
        {isRetyped ? (
          <p className="lede">
            You are changing this card from a{" "}
            {describeCardType(view.revision.cardType).toLowerCase()} card to a{" "}
            {describeCardType(cardType).toLowerCase()} one, so the fields start
            empty.
          </p>
        ) : null}
      </header>

      <FlashcardForm
        action={reviseFlashcardAction}
        submitLabel={`Save revision ${nextRevision}`}
        cancelHref={cardPath}
        slug={view.certification.slug}
        cardType={cardType}
        flashcardId={view.flashcard.id}
        revision={view.revision}
      />

      <section aria-labelledby="retype-heading" className="section">
        <div className="section-heading">
          <h2 id="retype-heading">Change the card type</h2>
          <p className="section-note">
            The new revision becomes a card of the type you choose. The fields
            you have typed here are not carried over.
          </p>
        </div>
        <div className="section-actions">
          {CARD_TYPES.filter((candidate) => candidate !== cardType).map(
            (candidate) => (
              <Link
                className="button-quiet"
                href={`${editPath}?type=${candidate}`}
                key={candidate}
              >
                Make it a {describeCardType(candidate).toLowerCase()} card (
                {describeCardShape(candidate)})
              </Link>
            ),
          )}
        </div>
      </section>
    </main>
  );
}

/** An unknown `?type=` value falls back to the card's current type. */
function readCardType(value: string | string[] | undefined): CardType | null {
  const candidate = Array.isArray(value) ? value[0] : value;

  return CARD_TYPES.find((cardType) => cardType === candidate) ?? null;
}
