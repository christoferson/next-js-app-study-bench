"use client";

import { useActionState } from "react";
import { FieldErrors } from "@/shared/ui/field-errors";
import type { FormState } from "@/shared/ui/form-state";
import {
  IDLE_FORM_STATE,
  fieldErrors,
  formLevelErrors,
} from "@/shared/ui/form-state";
import type { Objective } from "@/modules/certifications/domain/objective";
import {
  describeObjectiveOption,
  listObjectiveOptions,
} from "@/modules/certifications/domain/objective";

interface FlashcardObjectiveLinkFormProps {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly slug: string;
  readonly flashcardId: string;
  /** Active objectives of this track that are not mapped yet. */
  readonly candidates: readonly Objective[];
}

/**
 * Maps one more objective to this card.
 *
 * The select only offers objectives of this track, and the facade rejects anything
 * else, so a mapping can never cross study tracks.
 */
export function FlashcardObjectiveLinkForm({
  action,
  slug,
  flashcardId,
  candidates,
}: FlashcardObjectiveLinkFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const formErrors = formLevelErrors(state);
  const objectiveErrors = fieldErrors(state, "objectiveId");

  return (
    <form action={formAction} className="stacked-form" noValidate>
      <input type="hidden" name="slug" value={slug} readOnly />
      <input type="hidden" name="flashcardId" value={flashcardId} readOnly />

      {formErrors.length > 0 ? (
        <FieldErrors id="objective-link-errors" messages={formErrors} />
      ) : null}

      <div className="field">
        <label htmlFor="objectiveId">Add an objective</label>
        <select
          id="objectiveId"
          name="objectiveId"
          defaultValue=""
          aria-describedby={
            objectiveErrors !== undefined ? "objectiveId-error" : undefined
          }
          aria-invalid={objectiveErrors !== undefined}
        >
          <option value="">Choose an objective</option>
          {listObjectiveOptions(candidates).map((option) => (
            <option key={option.objective.id} value={option.objective.id}>
              {describeObjectiveOption(option)}
            </option>
          ))}
        </select>
        <FieldErrors id="objectiveId-error" messages={objectiveErrors} />
      </div>

      <button type="submit" className="button-quiet" disabled={isPending}>
        {isPending ? "Saving…" : "Map objective"}
      </button>
    </form>
  );
}
