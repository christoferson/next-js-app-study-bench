"use client";

import { useActionState } from "react";
import Link from "next/link";
import type {
  Certification,
  StudyType,
} from "@/modules/certifications/domain/certification";
import {
  DEFAULT_PRIORITY,
  DEFAULT_SESSION_MINUTES,
  MAX_PRIORITY,
  MAX_SESSION_MINUTES,
  MIN_PRIORITY,
  MIN_SESSION_MINUTES,
  STUDY_TYPES,
  describePriority,
  describeStudyType,
} from "@/modules/certifications/domain/certification";
import { FieldErrors } from "./field-errors";
import type { FormState } from "./form-state";
import { IDLE_FORM_STATE, fieldErrors, formLevelErrors } from "./form-state";

type CertificationFormAction = (
  state: FormState,
  form: FormData,
) => Promise<FormState>;

interface CertificationFormProps {
  readonly action: CertificationFormAction;
  readonly submitLabel: string;
  readonly cancelHref: string;
  /** Present when editing; absent when creating. */
  readonly certification?: Certification;
}

const PRIORITIES = Array.from(
  { length: MAX_PRIORITY - MIN_PRIORITY + 1 },
  (_unused, index) => MIN_PRIORITY + index,
);

/**
 * Create and edit form for a study track.
 *
 * A Client Component only because `useActionState` renders server-side
 * validation messages next to their fields after a rejected submission. The
 * schema on the server remains authoritative; the HTML constraints here are
 * conveniences.
 */
export function CertificationForm({
  action,
  submitLabel,
  cancelHref,
  certification,
}: CertificationFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );

  const initial = (field: string, fallback: string): string =>
    state.values[field] ?? fallback;

  const formErrors = formLevelErrors(state);

  return (
    <form action={formAction} className="form" noValidate>
      {certification !== undefined ? (
        <input
          type="hidden"
          name="certificationId"
          value={certification.id}
          readOnly
        />
      ) : null}

      {formErrors.length > 0 ? (
        <FieldErrors id="certification-form-errors" messages={formErrors} />
      ) : null}

      <TextField
        name="name"
        label="Name"
        required
        value={initial("name", certification?.name ?? "")}
        hint="Shown on the dashboard, for example the full certification title."
        state={state}
      />

      <TextField
        name="provider"
        label="Provider"
        required
        value={initial("provider", certification?.provider ?? "")}
        hint="Certifying body or examination family, for example AWS or HSK."
        state={state}
      />

      <div className="form-row">
        <TextField
          name="examCode"
          label="Exam code"
          value={initial("examCode", certification?.examCode ?? "")}
          hint="Optional."
          state={state}
        />
        <TextField
          name="version"
          label="Version"
          value={initial("version", certification?.version ?? "")}
          hint="Optional."
          state={state}
        />
      </div>

      <SelectField
        name="studyType"
        label="Study type"
        value={initial(
          "studyType",
          certification?.studyType ??
            ("TECHNICAL_CERTIFICATION" satisfies StudyType),
        )}
        options={STUDY_TYPES.map((studyType) => ({
          value: studyType,
          label: describeStudyType(studyType),
        }))}
        state={state}
      />

      <div className="field">
        <label htmlFor="description">Description</label>
        <p className="field-hint" id="description-hint">
          Optional. What you intend to cover in this track.
        </p>
        <textarea
          id="description"
          name="description"
          rows={4}
          aria-describedby={describedBy(state, "description", [
            "description-hint",
          ])}
          aria-invalid={fieldErrors(state, "description") !== undefined}
          defaultValue={initial(
            "description",
            certification?.description ?? "",
          )}
        />
        <FieldErrors
          id="description-error"
          messages={fieldErrors(state, "description")}
        />
      </div>

      <div className="form-row">
        <TextField
          name="targetDate"
          label="Target date"
          type="date"
          value={initial("targetDate", certification?.targetDate ?? "")}
          hint="Optional. The date you intend to sit the examination."
          state={state}
        />
        <SelectField
          name="priority"
          label="Priority"
          value={initial(
            "priority",
            String(certification?.priority ?? DEFAULT_PRIORITY),
          )}
          options={PRIORITIES.map((priority) => ({
            value: String(priority),
            label: describePriority(priority),
          }))}
          state={state}
        />
      </div>

      <div className="field">
        <label htmlFor="defaultSessionMinutes">Default session length</label>
        <p className="field-hint" id="defaultSessionMinutes-hint">
          Minutes, between {MIN_SESSION_MINUTES} and {MAX_SESSION_MINUTES}.
        </p>
        <input
          id="defaultSessionMinutes"
          name="defaultSessionMinutes"
          type="number"
          inputMode="numeric"
          min={MIN_SESSION_MINUTES}
          max={MAX_SESSION_MINUTES}
          className="input-narrow"
          aria-describedby={describedBy(state, "defaultSessionMinutes", [
            "defaultSessionMinutes-hint",
          ])}
          aria-invalid={
            fieldErrors(state, "defaultSessionMinutes") !== undefined
          }
          defaultValue={initial(
            "defaultSessionMinutes",
            String(
              certification?.defaultSessionMinutes ?? DEFAULT_SESSION_MINUTES,
            ),
          )}
        />
        <FieldErrors
          id="defaultSessionMinutes-error"
          messages={fieldErrors(state, "defaultSessionMinutes")}
        />
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

interface TextFieldProps {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly state: FormState;
  readonly hint?: string;
  readonly required?: boolean;
  readonly type?: "text" | "date";
}

function TextField({
  name,
  label,
  value,
  state,
  hint,
  required = false,
  type = "text",
}: TextFieldProps) {
  const hintId = hint === undefined ? undefined : `${name}-hint`;

  return (
    <div className="field">
      <label htmlFor={name}>
        {label}
        {required ? <span className="field-required"> (required)</span> : null}
      </label>
      {hint !== undefined ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        aria-describedby={describedBy(
          state,
          name,
          hintId === undefined ? [] : [hintId],
        )}
        aria-invalid={fieldErrors(state, name) !== undefined}
        defaultValue={value}
      />
      <FieldErrors id={`${name}-error`} messages={fieldErrors(state, name)} />
    </div>
  );
}

interface SelectOption {
  readonly value: string;
  readonly label: string;
}

interface SelectFieldProps {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly state: FormState;
}

function SelectField({ name, label, value, options, state }: SelectFieldProps) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <select
        id={name}
        name={name}
        defaultValue={value}
        aria-describedby={describedBy(state, name, [])}
        aria-invalid={fieldErrors(state, name) !== undefined}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldErrors id={`${name}-error`} messages={fieldErrors(state, name)} />
    </div>
  );
}

/** Associates a field with its hint and, when present, its error list. */
function describedBy(
  state: FormState,
  name: string,
  baseIds: readonly string[],
): string | undefined {
  const ids = [...baseIds];

  if (fieldErrors(state, name) !== undefined) {
    ids.push(`${name}-error`);
  }

  return ids.length > 0 ? ids.join(" ") : undefined;
}
