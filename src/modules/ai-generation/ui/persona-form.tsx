"use client";

import { useActionState } from "react";
import Link from "next/link";
import { FieldErrors } from "@/shared/ui/field-errors";
import type { FormState } from "@/shared/ui/form-state";
import {
  IDLE_FORM_STATE,
  fieldErrors,
  formLevelErrors,
} from "@/shared/ui/form-state";
import type { QuestionType } from "@/modules/question-bank/domain/question";
import {
  QUESTION_TYPES,
  describeQuestionType,
} from "@/modules/question-bank/domain/question";
import type { CardType } from "@/modules/flashcards/domain/flashcard";
import {
  CARD_TYPES,
  describeCardType,
} from "@/modules/flashcards/domain/flashcard";
import type { PersonaDraft } from "@/modules/ai-generation/domain/stored-persona";
import { describePersonaArchetype } from "@/modules/ai-generation/domain/stored-persona";
import type { PersonaArchetype } from "@/modules/ai-generation/domain/stored-persona";

type PersonaFormAction = (
  state: FormState,
  form: FormData,
) => Promise<FormState>;

interface PersonaFormProps {
  readonly action: PersonaFormAction;
  readonly submitLabel: string;
  readonly cancelHref: string;
  /** The fields to start from: a template's on create, the persona's on edit. */
  readonly draft: PersonaDraft;
  readonly archetype: PersonaArchetype;
  /** Present when creating; the template being copied. */
  readonly templateKey?: string;
  /** Present when editing. */
  readonly personaId?: string;
  /** Present when editing: the version this edit will replace. */
  readonly version?: number;
}

/**
 * Create and edit form for one persona.
 *
 * One component for both, because the fields are identical: creating differs only in
 * carrying a template key and starting from the template's text instead of the
 * persona's. That is also why the create form is prefilled rather than blank — a
 * persona is a page of prose, and a blank page is why a feature like this goes unused.
 *
 * Every field is uncontrolled, so the browser keeps typed text through a rejected
 * submission and the form needs no client state at all
 * (`spec/UI-GUIDELINES.md` section 1.1). The three list fields are textareas holding
 * one entry per line, the same convention the flashcard form uses for a card's
 * meanings and examples.
 *
 * The archetype is shown, not editable: it decides which machinery a persona reaches,
 * so changing it is creating a different persona from a different template rather than
 * editing this one.
 */
export function PersonaForm({
  action,
  submitLabel,
  cancelHref,
  draft,
  archetype,
  templateKey,
  personaId,
  version,
}: PersonaFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const initial = (field: string, fallback: string): string =>
    state.values[field] ?? fallback;
  const formErrors = formLevelErrors(state);

  return (
    <form action={formAction} className="form" noValidate>
      {templateKey !== undefined ? (
        <input type="hidden" name="templateKey" value={templateKey} readOnly />
      ) : null}
      {personaId !== undefined ? (
        <input type="hidden" name="personaId" value={personaId} readOnly />
      ) : null}

      {formErrors.length > 0 ? (
        <FieldErrors id="persona-form-errors" messages={formErrors} />
      ) : null}

      <p className="field-hint">
        {describePersonaArchetype(archetype)} persona.{" "}
        {version === undefined
          ? "Saved as version 1. Every later edit becomes a new version."
          : `Currently version ${version}; saving makes it version ${version + 1}.`}
      </p>

      <PersonaField
        name="label"
        label="Name"
        state={state}
        defaultValue={initial("label", draft.label)}
        hint="What this persona is called in your list."
      />

      <PersonaField
        name="role"
        label="Role"
        state={state}
        rows={4}
        defaultValue={initial("role", draft.role)}
        hint="Who the model is and what it favours. This becomes part of the system instructions."
      />

      <PersonaField
        name="guidance"
        label="Question guidance"
        state={state}
        rows={8}
        defaultValue={initial("guidance", draft.guidance.join("\n"))}
        hint="What a good question looks like for this subject. One guideline per line."
      />

      <PersonaField
        name="cardGuidance"
        label="Flashcard guidance"
        state={state}
        rows={8}
        defaultValue={initial("cardGuidance", draft.cardGuidance.join("\n"))}
        hint="What a good card looks like — a card prompts recall of one thing, so this is a separate list, not a reworded copy. One guideline per line."
      />

      <PersonaField
        name="prohibitions"
        label="Prohibitions"
        state={state}
        rows={6}
        defaultValue={initial("prohibitions", draft.prohibitions.join("\n"))}
        hint="What this persona must refuse to do. One per line."
      />

      <TypeChoices
        name="defaultQuestionTypes"
        legend="Default question types"
        hint="Used when you ask for questions without naming a type."
        state={state}
        values={QUESTION_TYPES}
        describe={describeQuestionType}
        selected={draft.defaultQuestionTypes}
      />

      <TypeChoices
        name="defaultCardTypes"
        legend="Default card types"
        hint="Used when you ask for flashcards without naming a type."
        state={state}
        values={CARD_TYPES}
        describe={describeCardType}
        selected={draft.defaultCardTypes}
      />

      <PersonaField
        name="languageInstruction"
        label="Language instruction"
        state={state}
        rows={3}
        defaultValue={initial("languageInstruction", draft.languageInstruction)}
        hint="Which language the content is written in, as an instruction rather than a code."
      />

      <PersonaField
        name="contentLanguage"
        label="Content language"
        state={state}
        defaultValue={initial("contentLanguage", draft.contentLanguage ?? "")}
        hint="Optional short code recorded on generated content, so the bank can be filtered by language — for example en, zh, ja."
      />

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

interface PersonaFieldProps {
  readonly name: string;
  readonly label: string;
  readonly state: FormState;
  readonly defaultValue: string;
  readonly hint: string;
  /** Renders a textarea with this many rows; omit for a single-line input. */
  readonly rows?: number;
}

/**
 * One labelled field with its hint and its validation messages.
 *
 * A persona is nine fields differing only in label, hint, and size, so one component
 * renders them all and every field is wired to its errors the same way
 * (`spec/UI-GUIDELINES.md` section 1.3).
 */
function PersonaField({
  name,
  label,
  state,
  defaultValue,
  hint,
  rows,
}: PersonaFieldProps) {
  const errors = fieldErrors(state, name);
  const hintId = `${name}-hint`;
  const errorId = `${name}-error`;
  const describedBy = [hintId, ...(errors === undefined ? [] : [errorId])].join(
    " ",
  );

  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <p className="field-hint" id={hintId}>
        {hint}
      </p>
      {rows === undefined ? (
        <input
          id={name}
          name={name}
          type="text"
          aria-describedby={describedBy}
          aria-invalid={errors !== undefined}
          defaultValue={defaultValue}
        />
      ) : (
        <textarea
          id={name}
          name={name}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={errors !== undefined}
          defaultValue={defaultValue}
        />
      )}
      <FieldErrors id={errorId} messages={errors} />
    </div>
  );
}

interface TypeChoicesProps<Value extends string> {
  readonly name: string;
  readonly legend: string;
  readonly hint: string;
  readonly state: FormState;
  readonly values: readonly Value[];
  readonly describe: (value: Value) => string;
  readonly selected: readonly Value[];
}

/**
 * A checkbox group over a closed list of content types.
 *
 * Rendered from the same constant the schema matches against, so a type the domain adds
 * appears here without a second list to maintain.
 */
function TypeChoices<Value extends QuestionType | CardType>({
  name,
  legend,
  hint,
  state,
  values,
  describe,
  selected,
}: TypeChoicesProps<Value>) {
  const errors = fieldErrors(state, name);
  const hintId = `${name}-hint`;
  const errorId = `${name}-error`;

  return (
    <fieldset
      className="choice-set"
      aria-describedby={[
        hintId,
        ...(errors === undefined ? [] : [errorId]),
      ].join(" ")}
    >
      <legend>{legend}</legend>
      <p className="field-hint" id={hintId}>
        {hint}
      </p>
      <ul className="choice-list">
        {values.map((value) => (
          <li className="choice-row" key={value}>
            <input
              id={`${name}-${value}`}
              name={name}
              type="checkbox"
              value={value}
              defaultChecked={selected.includes(value)}
            />
            <label htmlFor={`${name}-${value}`}>{describe(value)}</label>
          </li>
        ))}
      </ul>
      <FieldErrors id={errorId} messages={errors} />
    </fieldset>
  );
}
