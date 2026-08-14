import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CARD_TYPES,
  describeCardPrompting,
  describeCardType,
  describeCardTypeChoice,
} from "@/modules/flashcards/domain/flashcard";
import type { CardType } from "@/modules/flashcards/domain/flashcard";
import { getFlashcardFacade } from "@/modules/flashcards/composition";
import { createFlashcardAction } from "@/modules/flashcards/ui/actions";
import { FlashcardForm } from "@/modules/flashcards/ui/flashcard-form";

interface NewFlashcardPageProps {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Writes a new flashcard.
 *
 * The type is chosen first, as a step in the URL rather than a control inside the
 * form: the type decides which fields exist, so a mid-form switch would either
 * discard typed content or need client state to preserve it. Each choice is a plain
 * link, so the chosen type is bookmarkable and the form renders one shape only.
 */
export default async function NewFlashcardPage({
  params,
  searchParams,
}: NewFlashcardPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const certification = await getFlashcardFacade().findNewCardForm(slug);

  if (certification === null) {
    notFound();
  }

  const bankPath = `/study-tracks/${certification.slug}/flashcards`;
  const cardType = readCardType(query.type);

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href={bankPath}>Back to the flashcards</Link>
      </nav>

      <header className="page-header">
        <p className="eyebrow">New flashcard</p>
        <h1>
          {cardType === null
            ? "Choose a card type"
            : `Write a ${describeCardType(cardType).toLowerCase()} card`}
        </h1>
        <p className="lede">
          {cardType === null
            ? "The type decides how the card is prompted. You can change it later by editing the card."
            : "New cards start as drafts. Activate it when it is ready to study."}
        </p>
      </header>

      {cardType === null ? (
        <ul className="card-list">
          {CARD_TYPES.map((candidate) => (
            <li className="card" key={candidate}>
              <h2 className="card-title">
                <Link href={`${bankPath}/new?type=${candidate}`}>
                  {describeCardTypeChoice(candidate)}
                </Link>
              </h2>
              <p className="card-text">{describeCardPrompting(candidate)}</p>
            </li>
          ))}
        </ul>
      ) : (
        <FlashcardForm
          action={createFlashcardAction}
          submitLabel="Save as draft"
          cancelHref={bankPath}
          slug={certification.slug}
          certificationId={certification.id}
          cardType={cardType}
        />
      )}
    </main>
  );
}

/** An unknown `?type=` value falls back to the chooser rather than erroring. */
function readCardType(value: string | string[] | undefined): CardType | null {
  const candidate = Array.isArray(value) ? value[0] : value;

  return CARD_TYPES.find((cardType) => cardType === candidate) ?? null;
}
