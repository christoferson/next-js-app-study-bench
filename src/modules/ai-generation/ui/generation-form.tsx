"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
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
import {
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  QUESTION_TYPES,
  describeDifficulty,
  describeQuestionType,
} from "@/modules/question-bank/domain/question";
import {
  CARD_TYPES,
  describeCardType,
  describeCardTypeChoice,
} from "@/modules/flashcards/domain/flashcard";
import type { GeneratedItemKind } from "@/modules/ai-generation/domain/generation-run";
import { describeItemKind } from "@/modules/ai-generation/domain/generation-run";
import {
  LARGE_BATCH_THRESHOLD,
  MIN_BATCH_ITEMS,
} from "@/modules/ai-generation/domain/generation-limits";
import type { Persona } from "@/modules/ai-generation/domain/personas";

interface GenerationFormProps {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly slug: string;
  readonly persona: Persona;
  /** Active objectives of this track. */
  readonly objectives: readonly Objective[];
  readonly maxItemCount: number;
  readonly modelProvider: string;
  readonly modelId: string;
  /**
   * Set when the owner has just been shown a duplicate-batch notice.
   *
   * Renders the confirmation, pre-ticked, so pressing Generate again does what the
   * notice offered. Absent otherwise, so the control exists only when there is
   * something to confirm (`spec/UI-GUIDELINES.md`: no dead controls).
   */
  readonly generateAnyway?: boolean;
}

/**
 * The generate form.
 *
 * One decision drives the rest: questions or flashcards. It is a control rather than
 * a step in the URL — unlike the new-card form, where the type decides which fields
 * exist — because here the two kinds share every field but one and switching
 * discards nothing typed. The irrelevant type list is not rendered at all, so there
 * is never a disabled control on screen.
 *
 * Both type multi-selects are offered because both personas write several types.
 * Ticking none means "let the persona choose", which is stated on the control rather
 * than left as a guess.
 *
 * Every field is uncontrolled except the kind switch, so the browser keeps typed
 * text through a rejected submission.
 */
export function GenerationForm({
  action,
  slug,
  persona,
  objectives,
  maxItemCount,
  modelProvider,
  modelId,
  generateAnyway = false,
}: GenerationFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const [itemKind, setItemKind] = useState<GeneratedItemKind>(
    readKind(state.values.itemKind) ?? "QUESTION",
  );
  const initial = (field: string, fallback: string): string =>
    state.values[field] ?? fallback;
  const formErrors = formLevelErrors(state);
  const countErrors = fieldErrors(state, "itemCount");

  return (
    <form action={formAction} className="form" noValidate>
      <input type="hidden" name="slug" value={slug} readOnly />

      {formErrors.length > 0 ? (
        <FieldErrors id="generation-form-errors" messages={formErrors} />
      ) : null}

      <fieldset className="choice-set">
        <legend>
          What should the model write?{" "}
          <span className="field-required">Required</span>
        </legend>
        <ul className="choice-list">
          {(["QUESTION", "FLASHCARD"] as const).map((kind) => (
            <li className="choice-row" key={kind}>
              <label className="choice-label">
                <input
                  type="radio"
                  name="itemKind"
                  value={kind}
                  checked={itemKind === kind}
                  onChange={() => setItemKind(kind)}
                />
                <span>{describeItemKind(kind)}</span>
              </label>
            </li>
          ))}
        </ul>
        <FieldErrors
          id="itemKind-errors"
          messages={fieldErrors(state, "itemKind")}
        />
      </fieldset>

      <div className="field">
        <label htmlFor="itemCount">
          How many?<span className="field-required"> (required)</span>
        </label>
        <p className="field-hint" id="itemCount-hint">
          Between {MIN_BATCH_ITEMS} and {maxItemCount}. You wait here for the
          result and each item costs a model call, so more than{" "}
          {LARGE_BATCH_THRESHOLD} is a large batch.
        </p>
        <input
          id="itemCount"
          name="itemCount"
          type="number"
          inputMode="numeric"
          min={MIN_BATCH_ITEMS}
          max={maxItemCount}
          step={1}
          required
          className="input-narrow"
          aria-describedby={
            countErrors === undefined
              ? "itemCount-hint"
              : "itemCount-hint itemCount-errors"
          }
          aria-invalid={countErrors !== undefined}
          defaultValue={initial("itemCount", "3")}
        />
        <FieldErrors id="itemCount-errors" messages={countErrors} />
      </div>

      {itemKind === "QUESTION" ? (
        <>
          <div className="field">
            <label htmlFor="difficulty">Difficulty</label>
            <p className="field-hint" id="difficulty-hint">
              Leave this as any and the batch is written at a spread of levels.
            </p>
            <select
              id="difficulty"
              name="difficulty"
              className="input-narrow"
              aria-describedby="difficulty-hint"
              defaultValue={initial("difficulty", "")}
            >
              <option value="">Any</option>
              {difficultyOptions().map((value) => (
                <option key={value} value={value}>
                  {describeDifficulty(value)}
                </option>
              ))}
            </select>
            <FieldErrors
              id="difficulty-errors"
              messages={fieldErrors(state, "difficulty")}
            />
          </div>

          <fieldset className="choice-set">
            <legend>Question types</legend>
            <p className="field-hint">
              Tick none and this persona writes{" "}
              {joinLabels(
                persona.defaultQuestionTypes.map(describeQuestionType),
              )}
              .
            </p>
            <ul className="choice-list">
              {QUESTION_TYPES.map((type) => (
                <li className="choice-row" key={type}>
                  <label className="choice-label">
                    <input type="checkbox" name="questionTypes" value={type} />
                    <span>{describeQuestionType(type)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        </>
      ) : (
        <fieldset className="choice-set">
          <legend>Card types</legend>
          <p className="field-hint">
            Tick none and this persona writes{" "}
            {joinLabels(persona.defaultCardTypes.map(describeCardType))}.
          </p>
          <ul className="choice-list">
            {CARD_TYPES.map((type) => (
              <li className="choice-row" key={type}>
                <label className="choice-label">
                  <input type="checkbox" name="cardTypes" value={type} />
                  <span>{describeCardTypeChoice(type)}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      <fieldset className="choice-set">
        <legend>Objectives</legend>
        <p className="field-hint">
          {objectives.length === 0
            ? "This track has no active objectives yet, so nothing generated here will be mapped to one."
            : "Tick none and the batch is spread across every active objective."}
        </p>
        {objectives.length > 0 ? (
          <ul className="choice-list">
            {listObjectiveOptions(objectives).map((option) => (
              <li className="choice-row" key={option.objective.id}>
                <label className="choice-label">
                  <input
                    type="checkbox"
                    name="objectiveIds"
                    value={option.objective.id}
                  />
                  <span>{describeObjectiveOption(option)}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}
      </fieldset>

      <div className="field">
        <label htmlFor="additionalInstructions">Your notes</label>
        <p className="field-hint" id="additionalInstructions-hint">
          Optional. A topic, a focus, or a level — for example{" "}
          <q>focus on cost trade-offs</q>. Notes describe the material you want;
          they cannot change what the model is instructed to do.
        </p>
        <textarea
          id="additionalInstructions"
          name="additionalInstructions"
          rows={3}
          aria-describedby={
            fieldErrors(state, "additionalInstructions") === undefined
              ? "additionalInstructions-hint"
              : "additionalInstructions-hint additionalInstructions-errors"
          }
          aria-invalid={
            fieldErrors(state, "additionalInstructions") !== undefined
          }
          defaultValue={initial("additionalInstructions", "")}
        />
        <FieldErrors
          id="additionalInstructions-errors"
          messages={fieldErrors(state, "additionalInstructions")}
        />
      </div>

      {generateAnyway ? (
        <ul className="choice-list">
          <li className="choice-row">
            <label className="choice-label">
              <input
                type="checkbox"
                name="generateAnyway"
                value="yes"
                defaultChecked
              />
              <span>Generate this batch again anyway</span>
            </label>
          </li>
        </ul>
      ) : null}

      <p className="field-hint">
        Persona: {persona.label}, version {persona.version}. Model:{" "}
        <code>{modelId}</code> via {modelProvider}. Everything generated is
        saved as a draft for you to review, from the model&apos;s own knowledge
        — never as official exam material.
      </p>

      <div className="form-actions">
        <button type="submit" className="button" disabled={isPending}>
          {isPending ? "Generating…" : "Generate"}
        </button>
        <Link className="button-quiet" href={`/study-tracks/${slug}`}>
          Cancel
        </Link>
      </div>

      {isPending ? (
        <p className="field-hint" role="status">
          Waiting for the model. This takes a few seconds. Leaving the page does
          not cancel the request, but you would have to find the run in the
          history.
        </p>
      ) : null}
    </form>
  );
}

function difficultyOptions(): readonly number[] {
  return Array.from(
    { length: MAX_DIFFICULTY - MIN_DIFFICULTY + 1 },
    (_unused, index) => MIN_DIFFICULTY + index,
  );
}

function readKind(value: string | undefined): GeneratedItemKind | null {
  return value === "QUESTION" || value === "FLASHCARD" ? value : null;
}

/** "a, b and c" — a readable list rather than a comma-joined one. */
function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) {
    return labels[0] ?? "whatever suits";
  }

  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
