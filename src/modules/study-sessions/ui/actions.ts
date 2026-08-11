"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDomainError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { toInvalidFormState } from "@/shared/ui/form-state";
import { getStudyFacade } from "@/modules/study-sessions/composition";
import {
  finishSessionSchema,
  rateSessionCardSchema,
  sessionItemSchema,
  startSessionSchema,
  submitAnswerSchema,
} from "@/modules/study-sessions/application/schemas";

/**
 * Server Actions for study sessions.
 *
 * Each action reads the form, parses it with the authoritative schema, calls the
 * facade, and maps a domain error back to field messages. Composition, grading,
 * scheduling, and transactionality belong to the domain and the facade; nothing here
 * decides them.
 *
 * Every write redirects rather than returning the next screen's data, so the study
 * screen is always a fresh read of committed state. That is what makes pausing free:
 * leaving mid-session loses nothing, because the page never held the progress.
 */

const PROGRESS_PATH = "/progress";
const START_PATH = "/study/new";

function sessionPath(sessionId: string): string {
  return `/study/sessions/${sessionId}`;
}

function summaryPath(sessionId: string): string {
  return `/study/sessions/${sessionId}/summary`;
}

/**
 * The study screen showing the feedback for one recorded attempt.
 *
 * The attempt identifier is in the URL rather than in client state, so reloading
 * after an answer shows the same feedback instead of advancing past it.
 */
function feedbackPath(sessionId: string, attemptId: string): string {
  return `${sessionPath(sessionId)}?feedback=${encodeURIComponent(attemptId)}`;
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
 * Collects the fields the answered question type needs.
 *
 * Only that type's answer fields are read, so a page that once rendered another type
 * cannot smuggle a stale answer into the parsed input.
 */
function readAnswerInput(form: FormData): unknown {
  const type = readString(form, "type");
  const common = {
    type,
    sessionId: readString(form, "sessionId"),
    itemId: readString(form, "itemId"),
    confidence: readString(form, "confidence"),
    durationSeconds: readString(form, "durationSeconds"),
  };

  switch (type) {
    case "MULTIPLE_RESPONSE":
      return { ...common, choiceIds: readStrings(form, "choiceIds") };
    case "SHORT_ANSWER":
      return {
        ...common,
        text: readString(form, "text"),
        selfAssessment: readString(form, "selfAssessment"),
      };
    default:
      // `SINGLE_CHOICE` and anything unrecognised: the schema rejects an unknown
      // discriminator, so the single-choice field is the right thing to read.
      return { ...common, choiceId: readString(form, "choiceId") };
  }
}

/**
 * Composes a session and opens it.
 *
 * The facade abandons any session still running, so the owner is never left with two
 * sessions and an ambiguous "resume".
 */
export async function startSessionAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  let sessionId: string;

  try {
    const input = parseInput(startSessionSchema, {
      mode: readString(form, "mode"),
      certificationIds: readStrings(form, "certificationIds"),
      targetMinutes: readString(form, "targetMinutes"),
    });
    const session = await getStudyFacade().startSession(input);

    sessionId = session.id;
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  // The home page and the dashboard both show whether a session is running.
  revalidatePath("/");
  revalidatePath(PROGRESS_PATH);
  revalidatePath(START_PATH);
  redirect(sessionPath(sessionId));
}

/**
 * Records one graded answer and shows its feedback.
 *
 * The attempt and the item completion commit together in the facade, so a submission
 * either counts and advances or does neither.
 */
export async function submitAnswerAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const sessionId = readString(form, "sessionId");
  let attemptId: string;

  try {
    const input = parseInput(submitAnswerSchema, readAnswerInput(form));
    const outcome = await getStudyFacade().submitAnswer(input);

    attemptId = outcome.attempt.id;
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  // The question detail page gains an attempt-history row, and the dashboard's
  // accuracy changes with every answer.
  revalidatePath(sessionPath(sessionId));
  revalidatePath(PROGRESS_PATH);
  redirect(feedbackPath(sessionId, attemptId));
}

/**
 * Records a recall rating for a card that appeared in the session.
 *
 * The rating writes the review, the new schedule, and the item completion in one
 * transaction, using the same scheduler the review screen uses.
 */
export async function rateSessionCardAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const sessionId = readString(form, "sessionId");

  try {
    const input = parseInput(rateSessionCardSchema, {
      sessionId,
      itemId: readString(form, "itemId"),
      rating: readString(form, "rating"),
    });

    await getStudyFacade().rateSessionCard(input);
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidatePath(sessionPath(sessionId));
  revalidatePath(PROGRESS_PATH);
  redirect(sessionPath(sessionId));
}

/**
 * Passes over an item without answering it.
 *
 * A skip records no attempt, which is what keeps a skipped diagnostic objective
 * unseen rather than scored zero.
 */
export async function skipSessionItemAction(form: FormData): Promise<void> {
  const input = parseInput(sessionItemSchema, {
    sessionId: readString(form, "sessionId"),
    itemId: readString(form, "itemId"),
  });

  await getStudyFacade().skipItem(input.sessionId, input.itemId);

  revalidatePath(sessionPath(input.sessionId));
  // Back to the session without the feedback query parameter, so the next item is
  // shown rather than the previous answer's feedback.
  redirect(sessionPath(input.sessionId));
}

/** Ends the session, whether or not every item was reached. */
export async function finishSessionAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const sessionId = readString(form, "sessionId");

  try {
    const input = parseInput(finishSessionSchema, { sessionId });

    await getStudyFacade().finishSession(input.sessionId);
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidatePath("/");
  revalidatePath(PROGRESS_PATH);
  revalidatePath(START_PATH);
  revalidatePath(sessionPath(sessionId));
  redirect(summaryPath(sessionId));
}
