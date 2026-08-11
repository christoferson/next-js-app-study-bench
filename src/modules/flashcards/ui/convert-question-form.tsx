"use client";

import { useActionState } from "react";
import { FieldErrors } from "@/shared/ui/field-errors";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE, formLevelErrors } from "@/shared/ui/form-state";

interface ConvertQuestionFormProps {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly slug: string;
  readonly questionId: string;
}

/**
 * Turns one question into a draft flashcard.
 *
 * Rendered only for an active question, because only an active question converts.
 * The facade re-checks that, so a page left open on a question that has since been
 * retired reports the refusal here rather than creating a card from withdrawn
 * content.
 *
 * The result is a draft: conversion copies wording and objective mappings, and the
 * owner decides whether the card reads well before activating it.
 */
export function ConvertQuestionForm({
  action,
  slug,
  questionId,
}: ConvertQuestionFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const formErrors = formLevelErrors(state);

  return (
    <form action={formAction}>
      <input type="hidden" name="slug" value={slug} readOnly />
      <input type="hidden" name="questionId" value={questionId} readOnly />

      {formErrors.length > 0 ? (
        <FieldErrors id="convert-errors" messages={formErrors} />
      ) : null}

      <button type="submit" className="button-quiet" disabled={isPending}>
        {isPending ? "Making a card…" : "Make a flashcard from this question"}
      </button>
    </form>
  );
}
