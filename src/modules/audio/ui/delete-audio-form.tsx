"use client";

import { useActionState } from "react";
import { FieldErrors } from "@/shared/ui/field-errors";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE, formLevelErrors } from "@/shared/ui/form-state";

interface DeleteAudioFormProps {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly assetId: string;
  readonly revalidatePath: string;
  /**
   * What is being removed, for the accessible name — "the audio for the term".
   *
   * Optional because the settings list needs nothing: one clip per row, and the row
   * already says which. On a card it matters, where four rows each hold a button
   * reading "Remove audio" and a screen reader announcing controls out of context
   * would hear four identical ones.
   */
  readonly label?: string;
}

/**
 * Removes one stored clip.
 *
 * A client form rather than a plain server-action form because deletion can fail for a
 * reason the owner needs to read: another tab may already have removed the clip, and
 * the facade refuses. `useActionState` puts that message next to the button.
 *
 * No confirmation step. Regenerating a clip is one Polly call on a per-character price,
 * so this is not a destructive act on the owner's own work — unlike a card, a clip
 * carries no history and nothing references it.
 */
export function DeleteAudioForm({
  action,
  assetId,
  revalidatePath,
  label,
}: DeleteAudioFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const errors = formLevelErrors(state);
  const errorsId = `delete-audio-${assetId}-errors`;

  return (
    <form action={formAction}>
      <input type="hidden" name="assetId" value={assetId} readOnly />
      <input
        type="hidden"
        name="revalidatePath"
        value={revalidatePath}
        readOnly
      />
      <button
        type="submit"
        className="button-quiet audio-clip-remove"
        disabled={isPending}
        aria-label={label === undefined ? undefined : `Remove ${label}`}
        aria-describedby={errors.length > 0 ? errorsId : undefined}
      >
        {isPending ? "Removing…" : "Remove audio"}
      </button>
      <FieldErrors
        id={errorsId}
        messages={errors.length > 0 ? errors : undefined}
      />
    </form>
  );
}
