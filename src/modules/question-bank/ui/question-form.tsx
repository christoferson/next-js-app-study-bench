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
import {
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  contentChoices,
  correctChoiceIds,
  describeDifficulty,
  describeQuestionType,
} from "@/modules/question-bank/domain/question";
import type {
  QuestionRevision,
  QuestionType,
} from "@/modules/question-bank/domain/question";
import {
  MAX_CHOICES,
  MIN_CHOICES,
  choiceId,
  describeAnswerRule,
} from "@/modules/question-bank/domain/question-content";

type QuestionFormAction = (
  state: FormState,
  form: FormData,
) => Promise<FormState>;

interface QuestionFormProps {
  readonly action: QuestionFormAction;
  readonly submitLabel: string;
  readonly cancelHref: string;
  readonly slug: string;
  readonly questionType: QuestionType;
  /** Present when creating; the question the new draft will belong to. */
  readonly certificationId?: string;
  /** Present when editing; the question a new revision will be appended to. */
  readonly questionId?: string;
  /** The revision being edited, used to prefill the fields. */
  readonly revision?: QuestionRevision;
}

const DEFAULT_CHOICE_ROWS = 4;
const DIFFICULTY_VALUES: readonly number[] = [1, 2, 3, 4, 5];

/**
 * Create and edit form for one question.
 *
 * The question type is fixed by the caller rather than chosen inside the form:
 * the type decides which fields exist, and the new-question route asks for it
 * first. On edit the type comes from the revision being edited, so a revision
 * always describes the same kind of question as the one before it.
 *
 * Choice rows submit under one repeated `choiceText` name, and the correct-answer
 * control submits the row index, so a mark always refers to the row the owner
 * clicked even when earlier rows are left blank. The only client state is the
 * number of visible rows; everything else is an uncontrolled field, and the
 * browser keeps typed text through a rejected submission.
 */
export function QuestionForm({
  action,
  submitLabel,
  cancelHref,
  slug,
  questionType,
  certificationId,
  questionId,
  revision,
}: QuestionFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const existingChoices =
    revision === undefined ? [] : contentChoices(revision.content);
  const [choiceRows, setChoiceRows] = useState(
    Math.max(DEFAULT_CHOICE_ROWS, existingChoices.length),
  );

  const initial = (field: string, fallback: string): string =>
    state.values[field] ?? fallback;

  const formErrors = formLevelErrors(state);
  const choiceErrors = fieldErrors(state, "choices");
  // The domain names the correct-answer field differently per type; both map to
  // the one control this form renders.
  const answerErrors =
    fieldErrors(state, "correctChoiceId") ??
    fieldErrors(state, "correctChoiceIds");
  const conceptErrors = fieldErrors(state, "expectedConcepts");
  const markedChoiceIds =
    revision === undefined ? [] : correctChoiceIds(revision.content);
  const isMultiple = questionType === "MULTIPLE_RESPONSE";
  const isChoiceType = questionType !== "SHORT_ANSWER";

  return (
    <form action={formAction} className="form" noValidate>
      <input type="hidden" name="slug" value={slug} readOnly />
      <input type="hidden" name="questionType" value={questionType} readOnly />
      {certificationId !== undefined ? (
        <input
          type="hidden"
          name="certificationId"
          value={certificationId}
          readOnly
        />
      ) : null}
      {questionId !== undefined ? (
        <input type="hidden" name="questionId" value={questionId} readOnly />
      ) : null}

      {formErrors.length > 0 ? (
        <FieldErrors id="question-form-errors" messages={formErrors} />
      ) : null}

      <p className="field-hint">
        {describeQuestionType(questionType)} —{" "}
        {describeAnswerRule(questionType)}
      </p>

      <div className="field">
        <label htmlFor="stem">
          Question text
          <span className="field-required"> (required)</span>
        </label>
        <textarea
          id="stem"
          name="stem"
          rows={4}
          required
          aria-describedby={
            fieldErrors(state, "stem") !== undefined ? "stem-error" : undefined
          }
          aria-invalid={fieldErrors(state, "stem") !== undefined}
          defaultValue={initial("stem", revision?.stem ?? "")}
        />
        <FieldErrors id="stem-error" messages={fieldErrors(state, "stem")} />
      </div>

      <div className="field">
        <label htmlFor="instructions">Instructions</label>
        <p className="field-hint" id="instructions-hint">
          Optional. Shown above the question, for example &quot;Choose
          two&quot;.
        </p>
        <input
          id="instructions"
          name="instructions"
          type="text"
          aria-describedby={
            fieldErrors(state, "instructions") !== undefined
              ? "instructions-hint instructions-error"
              : "instructions-hint"
          }
          aria-invalid={fieldErrors(state, "instructions") !== undefined}
          defaultValue={initial("instructions", revision?.instructions ?? "")}
        />
        <FieldErrors
          id="instructions-error"
          messages={fieldErrors(state, "instructions")}
        />
      </div>

      {isChoiceType ? (
        <fieldset className="choice-set">
          <legend>Choices</legend>
          <p className="field-hint" id="choices-hint">
            {isMultiple
              ? `Write at least ${MIN_CHOICES} choices and tick every correct one.`
              : `Write at least ${MIN_CHOICES} choices and select the correct one.`}{" "}
            Leave unused rows empty.
          </p>
          <FieldErrors id="choices-error" messages={choiceErrors} />
          <FieldErrors id="answer-error" messages={answerErrors} />

          <ol className="choice-list">
            {Array.from({ length: choiceRows }, (_unused, index) => {
              const id = choiceId(index);
              const existing = existingChoices[index];

              return (
                <li className="choice-row" key={id}>
                  <input
                    id={`correct-${id}`}
                    type={isMultiple ? "checkbox" : "radio"}
                    name="correctChoiceIndex"
                    value={String(index)}
                    defaultChecked={markedChoiceIds.includes(id)}
                    aria-label={`Choice ${index + 1} is correct`}
                  />
                  <label
                    className="choice-label"
                    htmlFor={`choiceText-${index}`}
                  >
                    Choice {index + 1}
                  </label>
                  <input
                    id={`choiceText-${index}`}
                    name="choiceText"
                    type="text"
                    aria-describedby="choices-hint"
                    aria-invalid={choiceErrors !== undefined}
                    defaultValue={existing?.text ?? ""}
                  />
                </li>
              );
            })}
          </ol>

          <button
            type="button"
            className="button-quiet"
            onClick={() =>
              setChoiceRows((rows) => Math.min(MAX_CHOICES, rows + 1))
            }
            disabled={choiceRows >= MAX_CHOICES}
          >
            Add another choice
          </button>
        </fieldset>
      ) : (
        <div className="field">
          <label htmlFor="expectedConcepts">
            Expected concepts
            <span className="field-required"> (required)</span>
          </label>
          <p className="field-hint" id="expectedConcepts-hint">
            One concept per line. An answer should mention these.
          </p>
          <textarea
            id="expectedConcepts"
            name="expectedConcepts"
            rows={4}
            required
            aria-describedby={
              conceptErrors !== undefined
                ? "expectedConcepts-hint expectedConcepts-error"
                : "expectedConcepts-hint"
            }
            aria-invalid={conceptErrors !== undefined}
            defaultValue={initial(
              "expectedConcepts",
              revision !== undefined && revision.content.type === "SHORT_ANSWER"
                ? revision.content.expectedConcepts.join("\n")
                : "",
            )}
          />
          <FieldErrors id="expectedConcepts-error" messages={conceptErrors} />
        </div>
      )}

      <div className="field">
        <label htmlFor="explanation">Explanation</label>
        <p className="field-hint" id="explanation-hint">
          Optional. Why the answer is right; shown after you reveal the answer.
        </p>
        <textarea
          id="explanation"
          name="explanation"
          rows={3}
          aria-describedby={
            fieldErrors(state, "explanation") !== undefined
              ? "explanation-hint explanation-error"
              : "explanation-hint"
          }
          aria-invalid={fieldErrors(state, "explanation") !== undefined}
          defaultValue={initial("explanation", revision?.explanation ?? "")}
        />
        <FieldErrors
          id="explanation-error"
          messages={fieldErrors(state, "explanation")}
        />
      </div>

      <div className="form-row">
        <div className="field">
          <label htmlFor="difficulty">Difficulty</label>
          <p className="field-hint" id="difficulty-hint">
            Optional, {MIN_DIFFICULTY} to {MAX_DIFFICULTY}.
          </p>
          <select
            id="difficulty"
            name="difficulty"
            className="input-narrow"
            defaultValue={initial(
              "difficulty",
              revision?.difficulty === null ||
                revision?.difficulty === undefined
                ? ""
                : String(revision.difficulty),
            )}
            aria-describedby={
              fieldErrors(state, "difficulty") !== undefined
                ? "difficulty-hint difficulty-error"
                : "difficulty-hint"
            }
            aria-invalid={fieldErrors(state, "difficulty") !== undefined}
          >
            <option value="">Not graded</option>
            {DIFFICULTY_VALUES.map((value) => (
              <option key={value} value={String(value)}>
                {describeDifficulty(value)}
              </option>
            ))}
          </select>
          <FieldErrors
            id="difficulty-error"
            messages={fieldErrors(state, "difficulty")}
          />
        </div>

        <div className="field">
          <label htmlFor="language">Language</label>
          <p className="field-hint" id="language-hint">
            Optional tag such as <code>en</code> or <code>zh</code>.
          </p>
          <input
            id="language"
            name="language"
            type="text"
            className="input-narrow"
            aria-describedby={
              fieldErrors(state, "language") !== undefined
                ? "language-hint language-error"
                : "language-hint"
            }
            aria-invalid={fieldErrors(state, "language") !== undefined}
            defaultValue={initial("language", revision?.language ?? "")}
          />
          <FieldErrors
            id="language-error"
            messages={fieldErrors(state, "language")}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="tags">Tags</label>
        <p className="field-hint" id="tags-hint">
          Optional, comma separated.
        </p>
        <input
          id="tags"
          name="tags"
          type="text"
          aria-describedby={
            fieldErrors(state, "tags") !== undefined
              ? "tags-hint tags-error"
              : "tags-hint"
          }
          aria-invalid={fieldErrors(state, "tags") !== undefined}
          defaultValue={initial("tags", revision?.tags.join(", ") ?? "")}
        />
        <FieldErrors id="tags-error" messages={fieldErrors(state, "tags")} />
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
