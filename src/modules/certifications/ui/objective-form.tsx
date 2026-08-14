"use client";

import { useActionState } from "react";
import Link from "next/link";
import type {
  Objective,
  ObjectiveId,
} from "@/modules/certifications/domain/objective";
import {
  SELECTABLE_OBJECTIVE_SOURCE_TYPES,
  describeObjectiveOption,
  describeObjectiveSourceType,
  listObjectiveOptions,
} from "@/modules/certifications/domain/objective";
import { FieldErrors } from "./field-errors";
import type { FormState } from "./form-state";
import { IDLE_FORM_STATE, fieldErrors, formLevelErrors } from "./form-state";

type ObjectiveFormAction = (
  state: FormState,
  form: FormData,
) => Promise<FormState>;

interface ObjectiveFormProps {
  readonly action: ObjectiveFormAction;
  readonly submitLabel: string;
  readonly cancelHref: string;
  readonly slug: string;
  readonly certificationId: string;
  /** Legal parents: self and descendants are already excluded by the facade. */
  readonly parentCandidates: readonly Objective[];
  readonly parentObjectiveId: ObjectiveId | null;
  /** Present when editing an existing objective. */
  readonly objective?: Objective;
}

/**
 * Create and edit form for one objective, including its parent selection.
 *
 * Reparenting uses a plain select of valid parents rather than drag-and-drop:
 * it is keyboard accessible and usable at a narrow viewport.
 */
export function ObjectiveForm({
  action,
  submitLabel,
  cancelHref,
  slug,
  certificationId,
  parentCandidates,
  parentObjectiveId,
  objective,
}: ObjectiveFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );

  const initial = (field: string, fallback: string): string =>
    state.values[field] ?? fallback;

  const formErrors = formLevelErrors(state);
  const parentErrors = fieldErrors(state, "parentObjectiveId");

  return (
    <form action={formAction} className="form" noValidate>
      <input type="hidden" name="slug" value={slug} readOnly />
      <input
        type="hidden"
        name="certificationId"
        value={certificationId}
        readOnly
      />
      {objective !== undefined ? (
        <input type="hidden" name="objectiveId" value={objective.id} readOnly />
      ) : null}

      {formErrors.length > 0 ? (
        <FieldErrors id="objective-form-errors" messages={formErrors} />
      ) : null}

      <div className="field">
        <label htmlFor="title">
          Title
          <span className="field-required"> (required)</span>
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          aria-describedby={
            fieldErrors(state, "title") !== undefined
              ? "title-error"
              : undefined
          }
          aria-invalid={fieldErrors(state, "title") !== undefined}
          defaultValue={initial("title", objective?.title ?? "")}
        />
        <FieldErrors id="title-error" messages={fieldErrors(state, "title")} />
      </div>

      <div className="field">
        <label htmlFor="code">Code</label>
        <p className="field-hint" id="code-hint">
          Optional reference such as &quot;Domain 1&quot; or &quot;Unit 2&quot;.
        </p>
        <input
          id="code"
          name="code"
          type="text"
          aria-describedby={
            fieldErrors(state, "code") !== undefined
              ? "code-hint code-error"
              : "code-hint"
          }
          aria-invalid={fieldErrors(state, "code") !== undefined}
          defaultValue={initial("code", objective?.code ?? "")}
        />
        <FieldErrors id="code-error" messages={fieldErrors(state, "code")} />
      </div>

      <div className="field">
        <label htmlFor="description">Description</label>
        <p className="field-hint" id="description-hint">
          Optional. What this objective covers.
        </p>
        <textarea
          id="description"
          name="description"
          rows={3}
          aria-describedby={
            fieldErrors(state, "description") !== undefined
              ? "description-hint description-error"
              : "description-hint"
          }
          aria-invalid={fieldErrors(state, "description") !== undefined}
          defaultValue={initial("description", objective?.description ?? "")}
        />
        <FieldErrors
          id="description-error"
          messages={fieldErrors(state, "description")}
        />
      </div>

      <div className="field">
        <label htmlFor="parentObjectiveId">Parent objective</label>
        <p className="field-hint" id="parentObjectiveId-hint">
          Choose a parent to nest this objective, or keep it at the top level.
        </p>
        <select
          id="parentObjectiveId"
          name="parentObjectiveId"
          defaultValue={initial(
            "parentObjectiveId",
            objective?.parentObjectiveId ?? parentObjectiveId ?? "",
          )}
          aria-describedby={
            parentErrors !== undefined
              ? "parentObjectiveId-hint parentObjectiveId-error"
              : "parentObjectiveId-hint"
          }
          aria-invalid={parentErrors !== undefined}
        >
          <option value="">No parent — top level</option>
          {listObjectiveOptions(parentCandidates).map((option) => (
            <option key={option.objective.id} value={option.objective.id}>
              {describeObjectiveOption(option)}
            </option>
          ))}
        </select>
        <FieldErrors id="parentObjectiveId-error" messages={parentErrors} />
      </div>

      <div className="form-row">
        <div className="field">
          <label htmlFor="weight">Weight</label>
          <p className="field-hint" id="weight-hint">
            Optional percentage share, 0 to 100.
          </p>
          <input
            id="weight"
            name="weight"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="0.1"
            className="input-narrow"
            aria-describedby={
              fieldErrors(state, "weight") !== undefined
                ? "weight-hint weight-error"
                : "weight-hint"
            }
            aria-invalid={fieldErrors(state, "weight") !== undefined}
            defaultValue={initial(
              "weight",
              objective?.weight === null || objective?.weight === undefined
                ? ""
                : String(objective.weight),
            )}
          />
          <FieldErrors
            id="weight-error"
            messages={fieldErrors(state, "weight")}
          />
        </div>

        <div className="field">
          <label htmlFor="sourceType">Source</label>
          <p className="field-hint" id="sourceType-hint">
            Mark whether this objective map is official or your own.
          </p>
          <select
            id="sourceType"
            name="sourceType"
            defaultValue={initial(
              "sourceType",
              objective?.sourceType ?? "USER_DEFINED",
            )}
            aria-describedby={
              fieldErrors(state, "sourceType") !== undefined
                ? "sourceType-hint sourceType-error"
                : "sourceType-hint"
            }
            aria-invalid={fieldErrors(state, "sourceType") !== undefined}
          >
            {SELECTABLE_OBJECTIVE_SOURCE_TYPES.map((sourceType) => (
              <option key={sourceType} value={sourceType}>
                {describeObjectiveSourceType(sourceType)}
              </option>
            ))}
          </select>
          <FieldErrors
            id="sourceType-error"
            messages={fieldErrors(state, "sourceType")}
          />
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" className="button" disabled={isPending}>
          {isPending ? "Saving…" : submitLabel}
        </button>
        <Link className="button-quiet" href={cancelHref}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
