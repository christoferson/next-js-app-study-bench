"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDomainError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { toInvalidFormState } from "@/shared/ui/form-state";
import { getGenerationFacade } from "@/modules/ai-generation/composition";
import { isDuplicateBatchNotice } from "@/modules/ai-generation/application/generation-facade";
import {
  generationRequestSchema,
  rejectDraftSchema,
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
 * Rejects one still-draft generated item.
 *
 * The facade re-checks that the item is still a draft of this run, so a stale review
 * page cannot delete something the owner has since activated.
 */
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
