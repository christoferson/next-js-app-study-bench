"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDomainError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { toInvalidFormState } from "@/shared/ui/form-state";
import { getFlashcardFacade } from "@/modules/flashcards/composition";
import {
  flashcardInputSchema,
  objectiveLinkSchema,
  reviewInputSchema,
} from "@/modules/flashcards/application/schemas";

/**
 * Server Actions for flashcards and review.
 *
 * Each action reads the form, parses it with the authoritative schema, calls the
 * facade, and maps a domain error back to field messages. Revision numbering,
 * transition rules, content invariants, and the scheduling algorithm belong to the
 * domain and the facade; nothing here decides them.
 */

function trackPath(slug: string): string {
  return `/study-tracks/${slug}`;
}

function bankPath(slug: string): string {
  return `/study-tracks/${slug}/flashcards`;
}

function cardPath(slug: string, flashcardId: string): string {
  return `/study-tracks/${slug}/flashcards/${flashcardId}`;
}

function reviewPath(slug: string): string {
  return `/study-tracks/${slug}/review`;
}

function readString(form: FormData, field: string): string {
  const value = form.get(field);

  return typeof value === "string" ? value : "";
}

/**
 * Collects the fields the submitted card type needs.
 *
 * Only that type's fields are read, so a form that once rendered another type
 * cannot smuggle a stale field into the parsed input.
 */
function readFlashcardInput(form: FormData): unknown {
  const cardType = readString(form, "cardType");
  const common = {
    cardType,
    notes: readString(form, "notes"),
    tags: readString(form, "tags"),
    language: readString(form, "language"),
  };

  switch (cardType) {
    case "CLOZE":
      return { ...common, text: readString(form, "text") };
    case "VOCABULARY":
      return {
        ...common,
        term: readString(form, "term"),
        reading: readString(form, "reading"),
        meaning: readString(form, "meaning"),
        exampleSentence: readString(form, "exampleSentence"),
      };
    case "SCENARIO":
      return {
        ...common,
        scenario: readString(form, "scenario"),
        question: readString(form, "question"),
        answer: readString(form, "answer"),
      };
    default:
      // `BASIC`, `REVERSED`, and anything unrecognised: the schema rejects an
      // unknown discriminator, so the two-face fields are the right thing to read.
      return {
        ...common,
        front: readString(form, "front"),
        back: readString(form, "back"),
      };
  }
}

export async function createFlashcardAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const slug = readString(form, "slug");
  let flashcardId: string;

  try {
    const input = parseInput(flashcardInputSchema, readFlashcardInput(form));
    const created = await getFlashcardFacade().createFlashcard(
      readString(form, "certificationId"),
      input,
    );

    flashcardId = created.id;
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  // The track page shows the card counts, so it is revalidated as well.
  revalidatePath(trackPath(slug));
  revalidatePath(bankPath(slug));
  redirect(cardPath(slug, flashcardId));
}

export async function reviseFlashcardAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const slug = readString(form, "slug");
  const flashcardId = readString(form, "flashcardId");

  try {
    const input = parseInput(flashcardInputSchema, readFlashcardInput(form));

    await getFlashcardFacade().reviseFlashcard(flashcardId, input);
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidatePath(bankPath(slug));
  revalidatePath(cardPath(slug, flashcardId));
  redirect(cardPath(slug, flashcardId));
}

export async function activateFlashcardAction(form: FormData): Promise<void> {
  await getFlashcardFacade().activateFlashcard(readString(form, "flashcardId"));

  revalidateCard(form);
}

export async function retireFlashcardAction(form: FormData): Promise<void> {
  await getFlashcardFacade().retireFlashcard(readString(form, "flashcardId"));

  revalidateCard(form);
}

export async function restoreFlashcardAction(form: FormData): Promise<void> {
  await getFlashcardFacade().restoreFlashcard(readString(form, "flashcardId"));

  revalidateCard(form);
}

export async function linkFlashcardObjectiveAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    const input = parseInput(objectiveLinkSchema, {
      objectiveId: readString(form, "objectiveId"),
    });

    await getFlashcardFacade().linkObjective(
      readString(form, "flashcardId"),
      input.objectiveId,
    );
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidateCard(form);

  return { status: "idle", fieldErrors: {}, values: {} };
}

export async function unlinkFlashcardObjectiveAction(
  form: FormData,
): Promise<void> {
  await getFlashcardFacade().unlinkObjective(
    readString(form, "flashcardId"),
    readString(form, "objectiveId"),
  );

  revalidateCard(form);
}

/**
 * Records a recall rating and returns to the review screen.
 *
 * The rating carries the revision that was on screen, so the review names the text
 * that was actually read. The facade writes the review and the schedule in one
 * transaction and re-checks that the card is still reviewable, so a tab left open
 * on a card that has since been retired fails instead of rescheduling it.
 *
 * The redirect goes back to the review screen, which then loads the next due card
 * from the same deterministic queue. There is no cursor to keep, so closing the tab
 * mid-session loses nothing.
 */
export async function reviewFlashcardAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const slug = readString(form, "slug");

  try {
    const input = parseInput(reviewInputSchema, {
      flashcardId: readString(form, "flashcardId"),
      flashcardRevisionId: readString(form, "flashcardRevisionId"),
      rating: readString(form, "rating"),
    });

    await getFlashcardFacade().reviewCard(
      input.flashcardId,
      input.flashcardRevisionId,
      input.rating,
    );
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidatePath(trackPath(slug));
  revalidatePath(bankPath(slug));
  revalidatePath(cardPath(slug, readString(form, "flashcardId")));
  revalidatePath(reviewPath(slug));
  redirect(reviewPath(slug));
}

/**
 * Turns a question into a draft flashcard and opens the new card.
 *
 * The facade re-checks that the question is still active, so a stale question page
 * cannot convert something that has since been retired.
 */
export async function convertQuestionAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const slug = readString(form, "slug");
  let flashcardId: string;

  try {
    const created = await getFlashcardFacade().convertQuestion(
      readString(form, "questionId"),
    );

    flashcardId = created.id;
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidatePath(trackPath(slug));
  revalidatePath(bankPath(slug));
  redirect(cardPath(slug, flashcardId));
}

function revalidateCard(form: FormData): void {
  const slug = readString(form, "slug");

  revalidatePath(trackPath(slug));
  revalidatePath(bankPath(slug));
  revalidatePath(reviewPath(slug));
  revalidatePath(cardPath(slug, readString(form, "flashcardId")));
}
