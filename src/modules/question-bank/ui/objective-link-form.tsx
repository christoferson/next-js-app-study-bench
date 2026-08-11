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

interface ObjectiveLinkFormProps {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly slug: string;
  readonly questionId: string;
  /** Active objectives of this track that are not mapped yet. */
  readonly candidates: readonly Objective[];
}

/**
 * Maps one more objective to this question.
 *
 * The select only offers objectives of this track, and the facade rejects
 * anything else, so a mapping can never cross study tracks. Already-mapped
 * objectives are absent rather than disabled, because remapping one is a no-op.
 */
export function ObjectiveLinkForm({
  action,
  slug,
  questionId,
  candidates,
}: ObjectiveLinkFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const formErrors = formLevelErrors(state);
  const objectiveErrors = fieldErrors(state, "objectiveId");

  return (
    <form action={formAction} className="stacked-form" noValidate>
      <input type="hidden" name="slug" value={slug} readOnly />
      <input type="hidden" name="questionId" value={questionId} readOnly />

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
          {candidates.map((objective) => (
            <option key={objective.id} value={objective.id}>
              {objectiveLabel(objective)}
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

function objectiveLabel(objective: Objective): string {
  const prefix = objective.code === null ? "" : `${objective.code} — `;

  return `${prefix}${objective.title}`;
}
