"use client";

import { useActionState } from "react";
import { FieldErrors } from "@/shared/ui/field-errors";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE, formLevelErrors } from "@/shared/ui/form-state";

interface SessionControlsProps {
  readonly skipAction: (form: FormData) => Promise<void>;
  readonly finishAction: (
    state: FormState,
    form: FormData,
  ) => Promise<FormState>;
  readonly sessionId: string;
  /** `null` when nothing is left to skip, so only finishing is offered. */
  readonly itemId: string | null;
}

/**
 * Leaving the current item, and leaving the session.
 *
 * Both are always offered while a session runs. Finishing early is a supported way to
 * end a session, not an escape hatch (`SPEC.md` section 6.6): a ten-minute session the
 * owner can only leave by answering everything is a session they will abandon in the
 * browser instead.
 *
 * Pausing needs no control at all. Every answer is already committed, so closing the
 * tab is a pause, and the resume link on the home page comes back to this item.
 */
export function SessionControls({
  skipAction,
  finishAction,
  sessionId,
  itemId,
}: SessionControlsProps) {
  const [state, formAction, isPending] = useActionState(
    finishAction,
    IDLE_FORM_STATE,
  );
  const formErrors = formLevelErrors(state);

  return (
    <div className="study-controls">
      {formErrors.length > 0 ? (
        <FieldErrors id="session-control-errors" messages={formErrors} />
      ) : null}

      <div className="section-actions">
        {itemId === null ? null : (
          <form action={skipAction}>
            <input type="hidden" name="sessionId" value={sessionId} readOnly />
            <input type="hidden" name="itemId" value={itemId} readOnly />
            <button type="submit" className="button-quiet">
              Skip this one
            </button>
          </form>
        )}

        <form action={formAction}>
          <input type="hidden" name="sessionId" value={sessionId} readOnly />
          <button type="submit" className="button-quiet" disabled={isPending}>
            Finish session
          </button>
        </form>
      </div>

      <p className="field-hint">
        Skipping records no answer, so it leaves your progress measurements
        untouched.
      </p>
    </div>
  );
}
