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
import type { EffectivePersona } from "@/modules/ai-generation/domain/personas";
import type { StoredPersona } from "@/modules/ai-generation/domain/stored-persona";
import type { GroundingSourceSummary } from "@/modules/ai-generation/ports/source-grounding-repository";

interface GenerationFormProps {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly slug: string;
  /** The persona this request uses when the owner chooses none: the default. */
  readonly persona: EffectivePersona;
  /**
   * The owner's personas that suit this track, offered as a per-request choice.
   *
   * Empty when they have none, and the select is not rendered at all: one option that
   * cannot be changed is a dead control (`spec/UI-GUIDELINES.md`).
   */
  readonly personaChoices?: readonly StoredPersona[];
  /** The track's assignment, so the select opens on it. `null` is automatic. */
  readonly assignedPersonaId?: string | null;
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
  /**
   * Active sources of this track, offered as grounding.
   *
   * Empty renders the "import one first" state rather than hiding the choice: a form that
   * silently lacked the option would never tell the owner grounded generation exists.
   */
  readonly sources?: readonly GroundingSourceSummary[];
  readonly maxGroundingChunks?: number;
  readonly maxGroundingCharacters?: number;
}

/** The three modes the form offers, in the order they claim more. */
const GENERATION_MODES: readonly GenerationRequestMode[] = [
  "MODEL_KNOWLEDGE",
  "SOURCE_GROUNDED",
  "HYBRID",
];

type GenerationRequestMode = "MODEL_KNOWLEDGE" | "SOURCE_GROUNDED" | "HYBRID";

/**
 * What each mode means, in the owner's terms rather than the enum's.
 *
 * Written as a claim about where the facts come from, because that is the only difference
 * that matters to someone deciding: the first makes things up from what the model knows, the
 * second may only use what the owner's documents say, and the third mixes them and labels
 * which is which.
 */
function describeMode(mode: GenerationRequestMode): string {
  switch (mode) {
    case "MODEL_KNOWLEDGE":
      return "From the model's own knowledge";
    case "SOURCE_GROUNDED":
      return "From my sources only";
    case "HYBRID":
      return "Hybrid — facts from my sources, scenarios from the model";
  }
}

function modeHint(mode: GenerationRequestMode): string {
  switch (mode) {
    case "MODEL_KNOWLEDGE":
      return "No document is consulted. Fast and unrestricted, and nothing it writes can be traced back to anything you have read.";
    case "SOURCE_GROUNDED":
      return "Every fact must come from passages of the sources you pick, and each question records which passages. If your sources cannot support the number you asked for, you get fewer.";
    case "HYBRID":
      return "Facts from your sources; the situation a question is set in and the wrong answers from the model. Each question records which passages carry its facts.";
  }
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
  personaChoices = [],
  assignedPersonaId = null,
  objectives,
  maxItemCount,
  modelProvider,
  modelId,
  generateAnyway = false,
  sources = [],
  maxGroundingChunks = 0,
  maxGroundingCharacters = 0,
}: GenerationFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const [itemKind, setItemKind] = useState<GeneratedItemKind>(
    readKind(state.values.itemKind) ?? "QUESTION",
  );
  // Controlled, because the source picker exists only for the two grounded modes and the
  // submit is blocked without a source while grounded. Everything else stays uncontrolled so
  // the browser keeps typed text through a rejected submission.
  const [mode, setMode] = useState<GenerationRequestMode>(
    readMode(state.values.generationMode) ?? "MODEL_KNOWLEDGE",
  );
  const [chosenSources, setChosenSources] = useState<readonly string[]>([]);
  const initial = (field: string, fallback: string): string =>
    state.values[field] ?? fallback;
  const formErrors = formLevelErrors(state);
  const countErrors = fieldErrors(state, "itemCount");
  // Grounding is a question-only choice: the link table points at questions, and there is no
  // evidence panel on a card. Switching to flashcards therefore drops back to model
  // knowledge rather than sending a mode the facade would ignore.
  const grounding = itemKind === "QUESTION" && mode !== "MODEL_KNOWLEDGE";
  const missingSource = grounding && chosenSources.length === 0;

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

      {/* Question-only, and after the type choice because "what should it write" comes before
          "what should it write from". The hidden field keeps the submitted mode honest when
          the picker is not on screen: a flashcard batch always posts MODEL_KNOWLEDGE. */}
      {itemKind === "QUESTION" ? (
        <fieldset className="choice-set">
          <legend>What should it write from?</legend>
          <ul className="choice-list">
            {GENERATION_MODES.map((option) => (
              <li className="choice-row" key={option}>
                <label className="choice-label">
                  <input
                    type="radio"
                    name="generationMode"
                    value={option}
                    checked={mode === option}
                    onChange={() => setMode(option)}
                  />
                  <span>{describeMode(option)}</span>
                </label>
                <p className="field-hint">{modeHint(option)}</p>
              </li>
            ))}
          </ul>
          <FieldErrors
            id="generationMode-errors"
            messages={fieldErrors(state, "generationMode")}
          />
        </fieldset>
      ) : (
        <input
          type="hidden"
          name="generationMode"
          value="MODEL_KNOWLEDGE"
          readOnly
        />
      )}

      {grounding ? (
        <fieldset className="choice-set">
          <legend>
            Which sources? <span className="field-required">Required</span>
          </legend>
          {sources.length === 0 ? (
            <p className="empty-state">
              This track has no sources yet. Grounded questions are built from
              documents you have imported, so{" "}
              <Link href={`/study-tracks/${slug}/sources`}>
                import a source
              </Link>{" "}
              first — or switch back to the model&apos;s own knowledge above.
            </p>
          ) : (
            <>
              <p className="field-hint">
                Passages are chosen from the newest content of each source you
                tick, preferring sources you mapped to the objectives above. At
                most {maxGroundingChunks} passages and{" "}
                {maxGroundingCharacters.toLocaleString("en-GB")} characters are
                sent, so a large document contributes its most relevant parts
                rather than all of it.
              </p>
              <ul className="choice-list">
                {sources.map((source) => (
                  <li className="choice-row" key={source.id}>
                    <label className="choice-label">
                      <input
                        type="checkbox"
                        name="sourceIds"
                        value={source.id}
                        checked={chosenSources.includes(source.id)}
                        onChange={(event) => {
                          setChosenSources((current) =>
                            event.target.checked
                              ? [...current, source.id]
                              : current.filter((id) => id !== source.id),
                          );
                        }}
                      />
                      <span>{source.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          <FieldErrors
            id="sourceIds-errors"
            messages={fieldErrors(state, "sourceIds")}
          />
        </fieldset>
      ) : null}

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

      {personaChoices.length > 0 ? (
        <div className="field">
          <label htmlFor="personaId">Persona</label>
          <p className="field-hint" id="personaId-hint">
            Which voice writes this batch. Automatic uses the built-in persona
            for this track&apos;s study type. Choosing one here applies to this
            batch only; it does not change the track.
          </p>
          <select
            id="personaId"
            name="personaId"
            aria-describedby={
              fieldErrors(state, "personaId") === undefined
                ? "personaId-hint"
                : "personaId-hint personaId-errors"
            }
            aria-invalid={fieldErrors(state, "personaId") !== undefined}
            defaultValue={initial("personaId", assignedPersonaId ?? "")}
          >
            <option value="">Automatic (by study type)</option>
            {personaChoices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
          <FieldErrors
            id="personaId-errors"
            messages={fieldErrors(state, "personaId")}
          />
        </div>
      ) : null}

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
        <code>{modelId}</code> via {modelProvider}.{" "}
        {grounding
          ? "Everything generated is saved as a draft for you to review, built from passages of your own sources and labelled with which ones — never as official exam material."
          : "Everything generated is saved as a draft for you to review, from the model's own knowledge — never as official exam material."}
      </p>

      <div className="form-actions">
        <button
          type="submit"
          className="button"
          disabled={isPending || missingSource}
        >
          {isPending ? "Generating…" : "Generate"}
        </button>
        <Link className="button-quiet" href={`/study-tracks/${slug}`}>
          Cancel
        </Link>
      </div>

      {missingSource ? (
        <p className="field-hint" role="status">
          {sources.length === 0
            ? "Import a source, or switch back to the model's own knowledge, to generate."
            : "Tick at least one source to generate from."}
        </p>
      ) : null}

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

function readMode(value: string | undefined): GenerationRequestMode | null {
  return value === "MODEL_KNOWLEDGE" ||
    value === "SOURCE_GROUNDED" ||
    value === "HYBRID"
    ? value
    : null;
}

/** "a, b and c" — a readable list rather than a comma-joined one. */
function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) {
    return labels[0] ?? "whatever suits";
  }

  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
