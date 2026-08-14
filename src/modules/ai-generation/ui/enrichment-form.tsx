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
import { MIN_BATCH_ITEMS } from "@/modules/ai-generation/domain/generation-limits";
import type { Persona } from "@/modules/ai-generation/domain/personas";

interface EnrichmentFormProps {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly slug: string;
  readonly persona: Persona;
  /** Active vocabulary cards still waiting for their extra detail. */
  readonly unenrichedCount: number;
  readonly maxItemCount: number;
  readonly modelProvider: string;
  readonly modelId: string;
  /** Set when the owner has just been shown a duplicate-run notice. */
  readonly generateAnyway?: boolean;
}

/**
 * The enrichment form.
 *
 * Much smaller than the generate form, and the difference is the point: the owner
 * chooses how many cards to do and nothing else. Which cards is not a choice — the
 * run always takes the next unenriched ones in the bank's own order, so repeated runs
 * walk the deck front to back without the owner having to track where they were. A
 * card picker would be a way to lose that property and a way to enrich the same card
 * twice.
 */
export function EnrichmentForm({
  action,
  slug,
  persona,
  unenrichedCount,
  maxItemCount,
  modelProvider,
  modelId,
  generateAnyway = false,
}: EnrichmentFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const formErrors = formLevelErrors(state);
  const countErrors = fieldErrors(state, "count");
  // Never offer more than there are: asking for twenty when four remain would
  // produce a run that reports sixteen failures for having nothing to do.
  const limit = Math.min(maxItemCount, Math.max(unenrichedCount, 1));

  return (
    <form action={formAction} className="form" noValidate>
      <input type="hidden" name="slug" value={slug} readOnly />

      {formErrors.length > 0 ? (
        <FieldErrors id="enrichment-form-errors" messages={formErrors} />
      ) : null}

      <div className="field">
        <label htmlFor="count">
          How many cards?<span className="field-required"> (required)</span>
        </label>
        <p className="field-hint" id="count-hint">
          Between {MIN_BATCH_ITEMS} and {limit}. The next {limit} vocabulary
          cards without extra detail are taken in the order you added them, so
          running this again continues where it left off.
        </p>
        <input
          id="count"
          name="count"
          type="number"
          inputMode="numeric"
          min={MIN_BATCH_ITEMS}
          max={limit}
          step={1}
          required
          className="input-narrow"
          aria-describedby={
            countErrors === undefined ? "count-hint" : "count-hint count-errors"
          }
          aria-invalid={countErrors !== undefined}
          defaultValue={state.values.count ?? String(limit)}
        />
        <FieldErrors id="count-errors" messages={countErrors} />
      </div>

      <div className="field">
        <label htmlFor="additionalInstructions">Your notes</label>
        <p className="field-hint" id="additionalInstructions-hint">
          Optional. For example <q>note formal versus spoken register</q>. Notes
          describe the detail you want; they cannot change what the model is
          instructed to do.
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
          defaultValue={state.values.additionalInstructions ?? ""}
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
              <span>Enrich these same cards again anyway</span>
            </label>
          </li>
        </ul>
      ) : null}

      <p className="field-hint">
        Persona: {persona.label}, version {persona.version}. Model:{" "}
        <code>{modelId}</code> via {modelProvider}. Each card keeps everything
        it already says and gains a new revision with the extra detail, so
        nothing you wrote is replaced.
      </p>

      <div className="form-actions">
        <button
          type="submit"
          className="button"
          disabled={isPending || unenrichedCount === 0}
        >
          {isPending ? "Enriching…" : "Enrich with AI"}
        </button>
        <Link className="button-quiet" href={`/study-tracks/${slug}`}>
          Cancel
        </Link>
      </div>

      {isPending ? (
        <p className="field-hint" role="status">
          Waiting for the model. A full batch takes longer than a small one.
          Leaving the page does not cancel the request, but you would have to
          find the run in the history.
        </p>
      ) : null}
    </form>
  );
}
