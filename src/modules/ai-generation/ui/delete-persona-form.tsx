"use client";

import { useActionState } from "react";
import { FieldErrors } from "@/shared/ui/field-errors";
import { IDLE_FORM_STATE, formLevelErrors } from "@/shared/ui/form-state";
import { deletePersonaAction } from "./persona-actions";

interface DeletePersonaFormProps {
  readonly personaId: string;
  /** The persona's name, for the accessible label on a list of identical buttons. */
  readonly label: string;
}

/**
 * Removes one persona.
 *
 * A client form rather than a plain server-action form because deletion can fail for a
 * reason the owner needs to read: another tab may already have removed it, and the
 * facade refuses. `useActionState` puts that message next to the button.
 *
 * No confirmation step in this slice, because nothing references a persona yet — no
 * track selects one, no run records one — so deleting loses the text and nothing else.
 * Once a track can be assigned a persona, that stops being true and this control needs
 * to say what else it would affect.
 */
export function DeletePersonaForm({
  personaId,
  label,
}: DeletePersonaFormProps) {
  const [state, formAction, isPending] = useActionState(
    deletePersonaAction,
    IDLE_FORM_STATE,
  );
  const errors = formLevelErrors(state);
  const errorsId = `delete-persona-${personaId}-errors`;

  return (
    <form action={formAction} className="inline-form">
      <input type="hidden" name="personaId" value={personaId} readOnly />
      <button
        type="submit"
        className="button-danger"
        disabled={isPending}
        aria-label={`Delete ${label}`}
        aria-describedby={errors.length > 0 ? errorsId : undefined}
      >
        {isPending ? "Deleting…" : "Delete"}
      </button>
      <FieldErrors
        id={errorsId}
        messages={errors.length > 0 ? errors : undefined}
      />
    </form>
  );
}
