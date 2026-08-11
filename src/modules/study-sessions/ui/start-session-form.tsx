"use client";

import { useActionState, useState } from "react";
import { FieldErrors } from "@/shared/ui/field-errors";
import type { FormState } from "@/shared/ui/form-state";
import {
  IDLE_FORM_STATE,
  fieldErrors,
  formLevelErrors,
} from "@/shared/ui/form-state";
import type { StartSessionView } from "@/modules/study-sessions/application/study-facade";
import type { SessionMode } from "@/modules/study-sessions/domain/study-session";
import {
  describeSessionMode,
  describeSessionModeHint,
  modeAllowsSeveralTracks,
} from "@/modules/study-sessions/domain/study-session";

interface StartSessionFormProps {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly view: StartSessionView;
}

/**
 * The start form: what kind of session, which tracks, how long.
 *
 * Unavailable modes are rendered as disabled radios with the reason stated next to
 * them, rather than hidden. A mode that is missing without explanation looks like a
 * missing feature; a mode that says "there are no active questions yet" tells the
 * owner what to do about it. This is the one place a disabled control is right: the
 * mode exists and will work as soon as the bank has content, which is different from a
 * control for an unbuilt feature.
 *
 * The track control changes shape with the mode, because the modes genuinely differ:
 * a single-track session takes one track and a mixed-track session takes several.
 * Which is which comes from the domain's `modeAllowsSeveralTracks`, so the form and
 * the facade cannot disagree about it.
 */
export function StartSessionForm({ action, view }: StartSessionFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const firstAvailable =
    view.modes.find((option) => option.available)?.mode ?? "SINGLE_TRACK";
  const [mode, setMode] = useState<SessionMode>(firstAvailable);
  const several = modeAllowsSeveralTracks(mode);
  const formErrors = formLevelErrors(state);
  const trackErrors = fieldErrors(state, "certificationIds");
  const preselected = view.preselectedId;

  return (
    <form action={formAction} className="form" noValidate>
      {formErrors.length > 0 ? (
        <FieldErrors id="start-session-errors" messages={formErrors} />
      ) : null}

      <fieldset className="choice-set">
        <legend>
          What kind of session? <span className="field-required">Required</span>
        </legend>

        <ul className="choice-list">
          {view.modes.map((option) => (
            <li className="choice-row" key={option.mode}>
              <label
                className={
                  option.available
                    ? "choice-label study-choice"
                    : "choice-label study-choice study-choice-unavailable"
                }
              >
                <input
                  type="radio"
                  name="mode"
                  value={option.mode}
                  required
                  disabled={!option.available}
                  checked={mode === option.mode}
                  onChange={() => setMode(option.mode)}
                  aria-describedby={`mode-hint-${option.mode}`}
                />
                <span>
                  <span className="confidence-word">
                    {describeSessionMode(option.mode)}
                  </span>
                  <span
                    className="confidence-hint"
                    id={`mode-hint-${option.mode}`}
                  >
                    {option.unavailableReason ??
                      describeSessionModeHint(option.mode)}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        <FieldErrors id="mode-errors" messages={fieldErrors(state, "mode")} />
      </fieldset>

      <fieldset className="choice-set">
        <legend>
          {several ? "Which study tracks?" : "Which study track?"}{" "}
          <span className="field-required">Required</span>
        </legend>
        <p className="field-hint" id="track-hint">
          {several
            ? "Questions and cards are drawn from every track you choose."
            : "A single-track session studies one track at a time."}
        </p>

        {view.tracks.length === 0 ? (
          <p className="empty-state">
            You have no active study tracks yet. Add one before starting a
            session.
          </p>
        ) : (
          <ul className="choice-list">
            {view.tracks.map((track) => (
              <li className="choice-row" key={track.id}>
                <label className="choice-label study-choice">
                  <input
                    // Keyed on the control kind so switching between one track and
                    // several remounts the input and re-applies its default, rather
                    // than leaving a checkbox carrying a radio's checked state.
                    key={several ? "many" : "one"}
                    type={several ? "checkbox" : "radio"}
                    name="certificationIds"
                    value={track.id}
                    defaultChecked={
                      preselected === null
                        ? // With nothing preselected a single-track session needs
                          // one track chosen, so the first is checked; a mixed
                          // session starts with all of them.
                          several || view.tracks[0]?.id === track.id
                        : preselected === track.id
                    }
                    aria-describedby="track-hint track-errors"
                  />
                  <span>{track.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <FieldErrors id="track-errors" messages={trackErrors} />
      </fieldset>

      <div className="field">
        <label htmlFor="target-minutes">How long?</label>
        <select
          id="target-minutes"
          name="targetMinutes"
          className="input-narrow"
          defaultValue={String(
            state.values.targetMinutes ?? view.defaultMinutes,
          )}
          aria-describedby="minutes-hint minutes-errors"
        >
          {view.minuteOptions.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} minutes
            </option>
          ))}
        </select>
        <p className="field-hint" id="minutes-hint">
          A guide, not a timer. StudyBench picks about that much material and
          you can finish early at any point.
        </p>
        <FieldErrors
          id="minutes-errors"
          messages={fieldErrors(state, "targetMinutes")}
        />
      </div>

      <div className="form-actions">
        <button
          type="submit"
          className="button"
          disabled={isPending || view.tracks.length === 0}
        >
          Start studying
        </button>
      </div>
    </form>
  );
}
