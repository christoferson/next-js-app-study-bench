"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDomainError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { toInvalidFormState } from "@/shared/ui/form-state";
import { getQuestionBankFacade } from "@/modules/question-bank/composition";
import {
  disputeInputSchema,
  disputeResolutionSchema,
  objectiveLinkSchema,
  questionInputSchema,
} from "@/modules/question-bank/application/schemas";

/**
 * Server Actions for the manual question bank.
 *
 * Each action reads the form, parses it with the authoritative schema, calls the
 * facade, and maps a domain error back to field messages. Revision numbering,
 * transition rules, answerability rules, and deletion eligibility belong to the
 * domain and the facade; nothing here decides them.
 */

function trackPath(slug: string): string {
  return `/study-tracks/${slug}`;
}

function bankPath(slug: string): string {
  return `/study-tracks/${slug}/questions`;
}

function questionPath(slug: string, questionId: string): string {
  return `/study-tracks/${slug}/questions/${questionId}`;
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
 * Collects the question fields.
 *
 * Choice rows arrive as parallel repeated fields: every row submits its text
 * (blank rows included) while only marked rows submit their index, so an index
 * still identifies the row the owner marked.
 */
function readQuestionInput(form: FormData): unknown {
  const questionType = readString(form, "questionType");
  const common = {
    questionType,
    stem: readString(form, "stem"),
    instructions: readString(form, "instructions"),
    explanation: readString(form, "explanation"),
    difficulty: readString(form, "difficulty"),
    tags: readString(form, "tags"),
    language: readString(form, "language"),
  };

  if (questionType === "SHORT_ANSWER") {
    return {
      ...common,
      expectedConcepts: readString(form, "expectedConcepts"),
    };
  }

  return {
    ...common,
    choiceTexts: readStrings(form, "choiceText"),
    correctChoiceIndexes: readStrings(form, "correctChoiceIndex"),
  };
}

export async function createQuestionAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const slug = readString(form, "slug");
  let questionId: string;

  try {
    const input = parseInput(questionInputSchema, readQuestionInput(form));
    const created = await getQuestionBankFacade().createQuestion(
      readString(form, "certificationId"),
      input,
    );

    questionId = created.id;
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  // The track page shows the bank counts, so it is revalidated as well.
  revalidatePath(trackPath(slug));
  revalidatePath(bankPath(slug));
  redirect(questionPath(slug, questionId));
}

export async function reviseQuestionAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const slug = readString(form, "slug");
  const questionId = readString(form, "questionId");

  try {
    const input = parseInput(questionInputSchema, readQuestionInput(form));

    await getQuestionBankFacade().reviseQuestion(questionId, input);
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidatePath(bankPath(slug));
  revalidatePath(questionPath(slug, questionId));
  redirect(questionPath(slug, questionId));
}

export async function activateQuestionAction(form: FormData): Promise<void> {
  await getQuestionBankFacade().activateQuestion(
    readString(form, "questionId"),
  );

  revalidateQuestion(form);
}

export async function retireQuestionAction(form: FormData): Promise<void> {
  await getQuestionBankFacade().retireQuestion(readString(form, "questionId"));

  revalidateQuestion(form);
}

export async function restoreQuestionAction(form: FormData): Promise<void> {
  await getQuestionBankFacade().restoreQuestion(readString(form, "questionId"));

  revalidateQuestion(form);
}

export async function approveQuestionAction(form: FormData): Promise<void> {
  await getQuestionBankFacade().approveQuestion(readString(form, "questionId"));

  revalidateQuestion(form);
}

export async function disputeQuestionAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const questionId = readString(form, "questionId");

  try {
    const input = parseInput(disputeInputSchema, {
      reason: readString(form, "reason"),
    });

    await getQuestionBankFacade().disputeQuestion(questionId, input.reason);
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidateQuestion(form);

  return { status: "idle", fieldErrors: {}, values: {} };
}

export async function resolveDisputeAction(form: FormData): Promise<void> {
  const resolution = parseInput(
    disputeResolutionSchema,
    readString(form, "resolution"),
  );

  await getQuestionBankFacade().resolveDispute(
    readString(form, "questionId"),
    resolution,
  );

  revalidateQuestion(form);
}

export async function linkObjectiveAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    const input = parseInput(objectiveLinkSchema, {
      objectiveId: readString(form, "objectiveId"),
    });

    await getQuestionBankFacade().linkObjective(
      readString(form, "questionId"),
      input.objectiveId,
    );
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidateQuestion(form);

  return { status: "idle", fieldErrors: {}, values: {} };
}

export async function unlinkObjectiveAction(form: FormData): Promise<void> {
  await getQuestionBankFacade().unlinkObjective(
    readString(form, "questionId"),
    readString(form, "objectiveId"),
  );

  revalidateQuestion(form);
}

/**
 * Deletes a question and returns to the bank.
 *
 * The facade re-checks deletion eligibility, so a stale page that still shows the
 * control cannot delete something that has since acquired dependents.
 */
export async function deleteQuestionAction(form: FormData): Promise<void> {
  const slug = readString(form, "slug");

  await getQuestionBankFacade().deleteQuestion(readString(form, "questionId"));

  revalidatePath(trackPath(slug));
  revalidatePath(bankPath(slug));
  redirect(bankPath(slug));
}

function revalidateQuestion(form: FormData): void {
  const slug = readString(form, "slug");

  revalidatePath(trackPath(slug));
  revalidatePath(bankPath(slug));
  revalidatePath(questionPath(slug, readString(form, "questionId")));
}
