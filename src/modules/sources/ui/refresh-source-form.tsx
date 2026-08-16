"use client";

import { useActionState } from "react";
import { FieldErrors } from "@/shared/ui/field-errors";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE, formLevelErrors } from "@/shared/ui/form-state";

interface RefreshSourceFormProps {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly slug: string;
  readonly sourceId: string;
}

/**
 * Reads a web source again.
 *
 * A client form rather than a plain `<form action={…}>` for one reason: fetching a page can
 * take fifteen seconds, and a button that gives no sign of having been pressed invites a
 * second press — which would be a second fetch. `isPending` is the whole justification for
 * the extra component.
 *
 * The *outcome* is not shown here. Whether the page had changed belongs on the source's page
 * beside its snapshot list, and the action redirects there with it, so a reload does not
 * lose the answer. What this form renders is only the failures that stop a refresh from
 * happening at all — a refused address, an unreachable host — because those have nowhere
 * else to appear.
 */
export function RefreshSourceForm({
  action,
  slug,
  sourceId,
}: RefreshSourceFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const errors = formLevelErrors(state);

  return (
    <form action={formAction}>
      <input type="hidden" name="slug" value={slug} readOnly />
      <input type="hidden" name="sourceId" value={sourceId} readOnly />

      <button type="submit" className="button" disabled={isPending}>
        {isPending ? "Reading the page…" : "Refresh"}
      </button>

      <FieldErrors
        id="refresh-errors"
        messages={errors.length > 0 ? errors : undefined}
      />
    </form>
  );
}
