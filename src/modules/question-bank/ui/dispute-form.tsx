"use client";

import { useActionState } from "react";
import { FieldErrors } from "@/shared/ui/field-errors";
import type { FormState } from "@/shared/ui/form-state";
import {
  IDLE_FORM_STATE,
  fieldErrors,
  formLevelErrors,
} from "@/shared/ui/form-state";

interface DisputeFormProps {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly slug: string;
  readonly questionId: string;
}

/**
 * Records a dispute with its reason.
 *
 * The reason is required, so a dispute is always explicable later: a question
 * marked disputed with no note is indistinguishable from a mistake.
 */
export function DisputeForm({ action, slug, questionId }: DisputeFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const formErrors = formLevelErrors(state);

  return (
    <form action={formAction} className="stacked-form" noValidate>
      <input type="hidden" name="slug" value={slug} readOnly />
      <input type="hidden" name="questionId" value={questionId} readOnly />

      {formErrors.length > 0 ? (
        <FieldErrors id="dispute-form-errors" messages={formErrors} />
      ) : null}

      <div className="field">
        <label htmlFor="reason">
          Reason for disputing
          <span className="field-required"> (required)</span>
        </label>
        <textarea
          id="reason"
          name="reason"
          rows={2}
          required
          aria-describedby={
            fieldErrors(state, "reason") !== undefined
              ? "reason-error"
              : undefined
          }
          aria-invalid={fieldErrors(state, "reason") !== undefined}
        />
        <FieldErrors
          id="reason-error"
          messages={fieldErrors(state, "reason")}
        />
      </div>

      <button type="submit" className="button-quiet" disabled={isPending}>
        {isPending ? "Saving…" : "Dispute this question"}
      </button>
    </form>
  );
}
