"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDomainError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { toInvalidFormState } from "@/shared/ui/form-state";
import { getGenerationFacade } from "@/modules/ai-generation/composition";
import {
  isDuplicateBatchNotice,
  isEnrichmentDuplicateNotice,
  isNothingToEnrichNotice,
} from "@/modules/ai-generation/application/generation-facade";
import {
  enrichmentRequestSchema,
  generationRequestSchema,
  rejectDraftSchema,
  reviewQuestionSchema,
} from "@/modules/ai-generation/application/schemas";

/**
 * Server Actions for AI generation.
 *
 * Each action reads the form, parses it with the authoritative schema, calls the
 * facade, and maps a domain error back to field messages. Prompts, personas,
 * validation, and the batch limit belong to the domain and the facade; nothing here
 * decides them, and nothing here talks to a provider.
 *
 * A *provider* failure is not an error state for these actions. The facade records
 * it as a failed run and returns that run, so the redirect goes to the run review
 * page either way: the owner reads what happened on the same screen they would read
 * a successful batch on, rather than being sent back to the form with a message that
 * has nowhere to point.
 */

function trackPath(slug: string): string {
  return `/study-tracks/${slug}`;
}

function generatePath(slug: string): string {
  return `/study-tracks/${slug}/generate`;
}

function enrichPath(slug: string): string {
  return `/study-tracks/${slug}/enrich`;
}

function runsPath(slug: string): string {
  return `/study-tracks/${slug}/generation-runs`;
}

function runPath(slug: string, runId: string): string {
  return `${runsPath(slug)}/${runId}`;
}

function readString(form: FormData, field: string): string {
  const value = form.get(field);

  return typeof value === "string" ? value : "";
}

function readStrings(form: FormData, field: string): string[] {
  return form
    .getAll(field)
    .filter((value): value is string => typeof value === "string");
}

/**
 * Runs one generation request and opens the run it produced.
 *
 * Synchronous: the owner waits here, which is why the batch limit exists
 * (`SPEC.md` section 11.6). The pending state comes from `useActionState` in the
 * form, so the wait is visible.
 *
 * When an equivalent batch already exists the facade returns a notice instead of
 * generating, and this action redirects to the *earlier* run with a query flag. The
 * duplicate is therefore shown as the thing it is — a batch the owner already has —
 * with the option to generate anyway, rather than as a validation error on a form
 * field that is not wrong.
 */
export async function requestGenerationAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const slug = readString(form, "slug");
  let destination: string;

  try {
    const input = parseInput(generationRequestSchema, {
      itemKind: readString(form, "itemKind"),
      itemCount: readString(form, "itemCount"),
      difficulty: readString(form, "difficulty"),
      objectiveIds: readStrings(form, "objectiveIds"),
      additionalInstructions: readString(form, "additionalInstructions"),
      questionTypes: readStrings(form, "questionTypes"),
      cardTypes: readStrings(form, "cardTypes"),
      personaId: readString(form, "personaId"),
      generateAnyway: readString(form, "generateAnyway"),
    });
    const facade = getGenerationFacade();
    const result =
      input.itemKind === "QUESTION"
        ? await facade.requestQuestionGeneration(slug, input)
        : await facade.requestFlashcardGeneration(slug, input);

    if (isDuplicateBatchNotice(result)) {
      destination = `${generatePath(slug)}?duplicateOf=${encodeURIComponent(
        result.duplicateOf.id,
      )}`;
    } else {
      destination = runPath(slug, result.run.id);
    }
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  // The track page and both bank pages show counts that a batch has just changed.
  revalidatePath(trackPath(slug));
  revalidatePath(`${trackPath(slug)}/questions`);
  revalidatePath(`${trackPath(slug)}/flashcards`);
  revalidatePath(runsPath(slug));
  redirect(destination);
}

/**
 * Enriches the next unenriched vocabulary cards and opens the run.
 *
 * Three destinations rather than one, because there are three outcomes and only one
 * of them is a run: a finished run opens its review page, a duplicate request returns
 * to the form with the earlier run named, and a track with nothing left to enrich
 * returns to the form with a flag saying so. The last case is deliberately not an
 * error — being finished is a good outcome, not a failed submission.
 */
export async function requestEnrichmentAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const slug = readString(form, "slug");
  let destination: string;

  try {
    const input = parseInput(enrichmentRequestSchema, {
      count: readString(form, "count"),
      additionalInstructions: readString(form, "additionalInstructions"),
      generateAnyway: readString(form, "generateAnyway"),
    });
    const result = await getGenerationFacade().requestVocabularyEnrichment(
      slug,
      input,
    );

    if (isNothingToEnrichNotice(result)) {
      destination = `${enrichPath(slug)}?nothingToEnrich=1`;
    } else if (isEnrichmentDuplicateNotice(result)) {
      destination = `${enrichPath(slug)}?duplicateOf=${encodeURIComponent(
        result.duplicateOf.id,
      )}`;
    } else {
      destination = runPath(slug, result.run.id);
    }
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  // The cards themselves changed, so every page that renders card text is stale.
  revalidatePath(trackPath(slug));
  revalidatePath(`${trackPath(slug)}/flashcards`);
  revalidatePath(enrichPath(slug));
  revalidatePath(runsPath(slug));
  redirect(destination);
}

/**
 * Rejects one still-draft generated item.
 *
 * The facade re-checks that the item is still a draft of this run, so a stale review
 * page cannot delete something the owner has since activated.
 */
/**
 * Reviews one question and stays on its page.
 *
 * No redirect, unlike the generation actions: a review does not produce a run worth its own
 * screen, it produces findings that belong beside the question they are about. So the
 * question's path is revalidated and the findings panel renders the new run in place.
 *
 * A provider failure is not an error state here either. The facade records a failed run and
 * returns it, and the panel keeps showing whatever the last successful review said — with
 * the failure readable in the run history, which is where a spent call belongs. The one
 * thing that does become a form error is a question that cannot be reviewed at all
 * (`QuestionNotReviewableError`), because that is a fact about the request rather than
 * about the provider.
 */
export async function reviewQuestionAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const slug = readString(form, "slug");

  try {
    const input = parseInput(reviewQuestionSchema, {
      questionId: readString(form, "questionId"),
    });

    await getGenerationFacade().reviewQuestion(slug, input.questionId);

    revalidatePath(`${trackPath(slug)}/questions/${input.questionId}`);
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  // The run history gains a row whatever the outcome was, including a failure.
  revalidatePath(runsPath(slug));

  return { status: "idle", fieldErrors: {}, values: {} };
}

/** The owner accepts a clean review: the explicit UNREVIEWED → AI_REVIEWED click. */
export async function acceptQuestionReviewAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const slug = readString(form, "slug");

  try {
    const input = parseInput(reviewQuestionSchema, {
      questionId: readString(form, "questionId"),
    });

    await getGenerationFacade().acceptQuestionReview(slug, input.questionId);

    revalidatePath(`${trackPath(slug)}/questions/${input.questionId}`);
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  return { status: "idle", fieldErrors: {}, values: {} };
}

export async function rejectDraftAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const slug = readString(form, "slug");
  const runId = readString(form, "runId");

  try {
    const input = parseInput(rejectDraftSchema, {
      runId,
      itemId: readString(form, "itemId"),
    });

    await getGenerationFacade().rejectDraft(input.runId, input.itemId);
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidatePath(trackPath(slug));
  revalidatePath(`${trackPath(slug)}/questions`);
  revalidatePath(`${trackPath(slug)}/flashcards`);
  revalidatePath(runPath(slug, runId));

  return { status: "idle", fieldErrors: {}, values: {} };
}
