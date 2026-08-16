"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FieldErrors } from "@/shared/ui/field-errors";
import type { FormState } from "@/shared/ui/form-state";
import {
  IDLE_FORM_STATE,
  fieldErrors,
  formLevelErrors,
} from "@/shared/ui/form-state";
import type { QuestionRevision } from "@/modules/question-bank/domain/question";
import { contentChoices } from "@/modules/question-bank/domain/question";
import {
  choiceLetter,
  describeAnswerRule,
} from "@/modules/question-bank/domain/question-content";
import {
  ANSWER_CONFIDENCES,
  describeConfidence,
  describeConfidenceHint,
} from "@/modules/study-sessions/domain/question-attempt";

interface AnswerFormProps {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly sessionId: string;
  readonly itemId: string;
  /** The revision the session froze, which is the wording being answered. */
  readonly revision: QuestionRevision;
}

/**
 * The answer controls for one question item.
 *
 * The inputs are real form controls rather than a preview, so answering works as a
 * plain submission whether or not hydration has finished. The question type decides
 * the control: one radio group for a single choice, checkboxes for a multiple
 * response, and a textarea for a short answer. Nothing is disabled and nothing is
 * hidden behind a handler.
 *
 * Confidence is required with every answer, not optional
 * (`SPEC.md` section 6.7): the calibration measures on the dashboard are only
 * meaningful if every attempt carries one, and an optional control would silently
 * produce a bank of uncalibrated attempts.
 *
 * Short answers additionally carry the owner's own verdict, submitted as the button
 * that was pressed. D5 has no free-text grader, so the honest recording is a
 * self-assessment rather than a machine verdict the application cannot justify.
 *
 * The elapsed time is measured by the page and submitted as a hidden field. It stays
 * empty until the client has actually timed something, so a page restored from
 * history records no duration rather than a false zero.
 */
export function AnswerForm({
  action,
  sessionId,
  itemId,
  revision,
}: AnswerFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const choices = contentChoices(revision.content);
  const isMultiple = revision.questionType === "MULTIPLE_RESPONSE";
  const isShortAnswer = revision.questionType === "SHORT_ANSWER";
  const formErrors = formLevelErrors(state);
  const answerField = isMultiple
    ? "choiceIds"
    : isShortAnswer
      ? "text"
      : "choiceId";
  const answerErrors = fieldErrors(state, answerField);
  const duration = useElapsedSeconds(itemId);

  return (
    <form action={formAction} className="form study-answer">
      <input type="hidden" name="sessionId" value={sessionId} readOnly />
      <input type="hidden" name="itemId" value={itemId} readOnly />
      <input type="hidden" name="type" value={revision.questionType} readOnly />
      <input type="hidden" name="durationSeconds" value={duration} readOnly />

      {formErrors.length > 0 ? (
        <FieldErrors id="answer-form-errors" messages={formErrors} />
      ) : null}

      <fieldset className="choice-set">
        <legend>
          {revision.instructions ?? describeAnswerRule(revision.questionType)}
        </legend>

        {isShortAnswer ? (
          <div className="field">
            <label htmlFor="answer-text">Your answer</label>
            <textarea
              id="answer-text"
              name="text"
              rows={5}
              required
              defaultValue={state.values.text ?? ""}
              aria-invalid={answerErrors !== undefined}
              aria-describedby="answer-errors"
            />
          </div>
        ) : (
          <ul className="choice-list">
            {choices.map((choice, index) => (
              <li className="choice-row" key={choice.id}>
                {/* The letter is part of the label text rather than a sibling of
                    it, so it is inside the control's accessible name and clicking
                    it selects the choice.

                    Letter and text are separate flex items of the label, matching
                    the static preview's `.question-choice`: the letter never wraps
                    away from the start of its choice, and a long choice wraps under
                    its own first line rather than under the letter. The space
                    between them is kept as a text node so the accessible name stays
                    "a. Amazon S3" — a flex `gap` is not text and would not appear
                    in it. */}
                <label className="choice-label study-choice">
                  <input
                    type={isMultiple ? "checkbox" : "radio"}
                    name={isMultiple ? "choiceIds" : "choiceId"}
                    value={choice.id}
                    aria-describedby="answer-errors"
                  />
                  <span className="choice-letter">{choiceLetter(index)}.</span>{" "}
                  <span className="choice-text">{choice.text}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <FieldErrors id="answer-errors" messages={answerErrors} />
      </fieldset>

      <ConfidenceChoice state={state} />

      {isShortAnswer ? (
        <SelfAssessment
          revision={revision}
          state={state}
          isPending={isPending}
        />
      ) : (
        <div className="form-actions">
          <button type="submit" className="button" disabled={isPending}>
            Submit answer
          </button>
        </div>
      )}

      <p className="field-hint">
        Answering saves straight away. You can close this page and come back to
        the same place.
      </p>
    </form>
  );
}

/**
 * The required confidence control.
 *
 * A radio group rather than a select, so all four levels and what they mean are
 * visible without opening anything, and each is a large touch target
 * (`spec/UI-GUIDELINES.md` section 1.2).
 */
function ConfidenceChoice({ state }: { readonly state: FormState }) {
  const errors = fieldErrors(state, "confidence");

  return (
    <fieldset className="choice-set">
      <legend>
        How sure are you? <span className="field-required">Required</span>
      </legend>
      <p className="field-hint" id="confidence-hint">
        This is what makes the calibration report possible: it shows where you
        felt sure and were wrong.
      </p>

      <ul className="choice-list confidence-list">
        {ANSWER_CONFIDENCES.map((confidence) => (
          <li className="choice-row" key={confidence}>
            <label className="choice-label study-choice">
              <input
                type="radio"
                name="confidence"
                value={confidence}
                required
                defaultChecked={state.values.confidence === confidence}
                aria-describedby="confidence-hint confidence-errors"
              />
              <span>
                <span className="confidence-word">
                  {describeConfidence(confidence)}
                </span>
                <span className="confidence-hint">
                  {describeConfidenceHint(confidence)}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <FieldErrors id="confidence-errors" messages={errors} />
    </fieldset>
  );
}

/**
 * Expected concepts plus the two self-grade buttons for a short answer.
 *
 * The expected concepts are shown before submitting, because the owner cannot mark
 * their own answer against a list they have not been given. That means a short answer
 * is an honesty exercise; the alternative would be a second round trip that still
 * ends in the same self-assessment.
 */
function SelfAssessment({
  revision,
  state,
  isPending,
}: {
  readonly revision: QuestionRevision;
  readonly state: FormState;
  readonly isPending: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const content = revision.content;
  const errors = fieldErrors(state, "selfAssessment");

  if (content.type !== "SHORT_ANSWER") {
    return null;
  }

  return (
    <div className="study-self-grade">
      {revealed ? (
        <>
          <div className="question-answer">
            <h3>Expected concepts</h3>
            <ul className="question-concepts">
              {content.expectedConcepts.map((concept) => (
                <li key={concept}>{concept}</li>
              ))}
            </ul>
          </div>

          <p className="field-hint" id="self-grade-hint">
            Mark yourself against the concepts above. StudyBench does not grade
            free text, so this verdict is yours.
          </p>

          <FieldErrors id="self-grade-errors" messages={errors} />

          <div className="form-actions study-self-grade-buttons">
            <button
              type="submit"
              name="selfAssessment"
              value="CORRECT"
              className="button"
              disabled={isPending}
              aria-describedby="self-grade-hint"
            >
              I got it right
            </button>
            <button
              type="submit"
              name="selfAssessment"
              value="INCORRECT"
              className="button-quiet"
              disabled={isPending}
              aria-describedby="self-grade-hint"
            >
              I got it wrong
            </button>
          </div>
        </>
      ) : (
        <div className="form-actions">
          <button
            type="button"
            className="button"
            onClick={() => setRevealed(true)}
          >
            Show expected concepts
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Seconds since this item appeared, as a string for the hidden field.
 *
 * Empty until the effect has run and at least one second has passed, so the value is
 * either a measurement or nothing. Keyed on the item so moving to the next item
 * restarts the clock.
 */
function useElapsedSeconds(itemId: string): string {
  const [elapsed, setElapsed] = useState("");
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    startedAt.current = Date.now();
    setElapsed("");

    const timer = setInterval(() => {
      const started = startedAt.current;

      if (started !== null) {
        setElapsed(String(Math.floor((Date.now() - started) / 1000)));
      }
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [itemId]);

  return elapsed;
}
