"use client";

import { useActionState, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { FieldErrors } from "@/shared/ui/field-errors";
import type { FormState } from "@/shared/ui/form-state";
import {
  IDLE_FORM_STATE,
  fieldErrors,
  formLevelErrors,
} from "@/shared/ui/form-state";
import type { TextSize } from "@/modules/appearance/domain/text-size";
import {
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  TEXT_SIZE_STEP,
  clampTextSize,
  describeTextSizeHint,
  stepTextSize,
} from "@/modules/appearance/domain/text-size";

interface TextSizeFormProps {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  /** The size this request rendered at, read from the cookie by the page. */
  readonly current: TextSize;
}

/**
 * Chooses how large the interface renders, on the settings page.
 *
 * The same decision as the header stepper, with two differences that justify a second
 * control rather than one. It **saves explicitly**, so the owner can type 19, see it in the
 * field, and commit it — the header applies each press immediately, which is right beside a
 * paragraph being read and wrong on a settings page where a half-typed number would be
 * saved a digit at a time. And it **has somewhere to put a refusal**: a rejected submission
 * renders a message beside the field, which a header has no room for.
 *
 * A number input plus a stepper, not one or the other. The buttons are how a size is found
 * by feel; the field is how a size already known is entered, and it is what makes the
 * control operable by anyone who reaches it expecting to type. Both write the same state,
 * and the field is what submits.
 *
 * A client component because the value is controlled: the owner's typing has to survive the
 * save being in flight, and a rejected save has to re-render with the message beside the
 * field rather than as an unhandled error.
 *
 * **No preview panel.** Saving reloads the whole layout at the new size, so the entire page
 * — this form included — visibly changes. A sample paragraph would be a smaller, less
 * honest version of feedback the owner is already getting.
 */
export function TextSizeForm({ action, current }: TextSizeFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  // A string, not a number: it is what a text field holds, and mid-typing "1" is a state the
  // owner passes through on the way to "19". Coercing every keystroke to a number would
  // rewrite "1" to 12 under the cursor.
  const [value, setValue] = useState<string>(String(current));
  const formErrors = formLevelErrors(state);
  const sizeErrors = fieldErrors(state, "textSize");
  const parsed = Number(value);
  // What the stepper buttons step from, and what the hint describes. A field holding "" or
  // "1" has no size in it yet, so the buttons fall back to the size in force rather than
  // jumping to a bound.
  const size =
    value.trim().length > 0 && Number.isFinite(parsed)
      ? clampTextSize(parsed)
      : current;

  return (
    <form action={formAction} className="form" noValidate>
      {formErrors.length > 0 ? (
        <FieldErrors id="text-size-form-errors" messages={formErrors} />
      ) : null}

      <div className="field">
        <label htmlFor="textSize">Text size in pixels</label>
        <p className="field-hint" id="text-size-hint">
          {describeTextSizeHint(size)} Anything between {MIN_TEXT_SIZE} and{" "}
          {MAX_TEXT_SIZE}.
        </p>

        <div className="text-size-field">
          <button
            type="button"
            className="button-quiet text-size-field-button"
            onClick={() => setValue(String(stepTextSize(size, -1)))}
            disabled={size <= MIN_TEXT_SIZE}
            aria-label="Smaller text"
          >
            <Minus aria-hidden="true" className="icon" />
          </button>

          <input
            className="input-narrow"
            id="textSize"
            name="textSize"
            type="number"
            inputMode="numeric"
            min={MIN_TEXT_SIZE}
            max={MAX_TEXT_SIZE}
            step={TEXT_SIZE_STEP}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-describedby="text-size-hint"
            aria-invalid={sizeErrors === undefined ? undefined : true}
          />

          <button
            type="button"
            className="button-quiet text-size-field-button"
            onClick={() => setValue(String(stepTextSize(size, 1)))}
            disabled={size >= MAX_TEXT_SIZE}
            aria-label="Larger text"
          >
            <Plus aria-hidden="true" className="icon" />
          </button>
        </div>

        <FieldErrors id="text-size-errors" messages={sizeErrors} />
      </div>

      <div className="form-actions">
        <button type="submit" className="button" disabled={isPending}>
          {isPending ? "Saving…" : "Save text size"}
        </button>
      </div>
    </form>
  );
}
