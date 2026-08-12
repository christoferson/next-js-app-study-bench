"use client";

import { useActionState } from "react";
import { FieldErrors } from "@/shared/ui/field-errors";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE, formLevelErrors } from "@/shared/ui/form-state";

interface RejectDraftFormProps {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly slug: string;
  readonly runId: string;
  readonly itemId: string;
  /** Names what is being rejected, for a screen reader reading buttons out of context. */
  readonly label: string;
}

/**
 * Rejects one generated draft.
 *
 * A client form rather than a plain server-action form because rejection can fail for
 * a reason the owner needs to read: another tab may have activated or already deleted
 * the item, and the facade refuses in both cases. `useActionState` puts that message
 * next to the button that produced it.
 *
 * There is no confirmation step. Rejecting a draft the model wrote seconds ago is the
 * expected outcome of reviewing a batch, not a destructive act on the owner's own
 * work, and a dialog on every unwanted item would make review tedious.
 */
export function RejectDraftForm({
  action,
  slug,
  runId,
  itemId,
  label,
}: RejectDraftFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const errors = formLevelErrors(state);

  return (
    <form action={formAction}>
      <input type="hidden" name="slug" value={slug} readOnly />
      <input type="hidden" name="runId" value={runId} readOnly />
      <input type="hidden" name="itemId" value={itemId} readOnly />
      <button
        type="submit"
        className="button-quiet"
        disabled={isPending}
        aria-label={`Reject ${label}`}
      >
        {isPending ? "Rejecting…" : "Reject"}
      </button>
      <FieldErrors
        id={`reject-${itemId}-errors`}
        messages={errors.length > 0 ? errors : undefined}
      />
    </form>
  );
}
