"use client";

import { useActionState } from "react";
import { FieldErrors } from "@/shared/ui/field-errors";
import { formLevelErrors } from "@/shared/ui/form-state";
import type { AnswerGradingState } from "@/modules/ai-generation/ui/grading-state";
import { IDLE_GRADING_STATE } from "@/modules/ai-generation/ui/grading-state";
import { describeAnswerVerdict } from "@/modules/ai-generation/domain/answer-evaluation";
import { describeFailureCategory } from "@/modules/ai-generation/domain/generation-run";

interface AnswerGradingPanelProps {
  readonly slug: string;
  readonly questionId: string;
  /** The answer text as it was submitted, so the grading is of what was recorded. */
  readonly answerText: string;
  /** The verdict the owner recorded themselves, which stays the record. */
  readonly recordedCorrect: boolean;
  readonly gradeAction: (
    state: AnswerGradingState,
    form: FormData,
  ) => Promise<AnswerGradingState>;
}

/**
 * A second opinion on a written answer the owner has already marked.
 *
 * **The grading is advice; the owner's own verdict is the record.** Everything about this
 * panel follows from that. It appears on the feedback screen *after* the self-grade is
 * recorded, it never offers to change the attempt, and the one thing it says about the
 * owner's own verdict is whether it agrees — because a grading that quietly overrode the
 * self-assessment would turn `SELF_ASSESSED` into a lie
 * (`domain/answer-evaluation.ts`, `spec/DOMAIN-RULES.md` on evaluation modes).
 *
 * The result is returned by the action rather than read back from a revalidated page, and
 * that is deliberate: a grading belongs to one attempt on one feedback screen, and there is
 * no attempt-to-run link to read it back through. The run history is where it is durable;
 * this panel is where it is useful.
 *
 * Opt-in, behind a button, because it costs a model call. A written answer the owner is sure
 * about should not spend one.
 */
export function AnswerGradingPanel({
  slug,
  questionId,
  answerText,
  recordedCorrect,
  gradeAction,
}: AnswerGradingPanelProps) {
  const [state, formAction, isPending] = useActionState(
    gradeAction,
    IDLE_GRADING_STATE,
  );
  const errors = formLevelErrors(state);
  const { grading } = state;

  return (
    <div className="owner-panel">
      <div className="owner-group">
        <h3>Grade with AI</h3>
        <p className="field-hint">
          Asks the configured model which of the expected concepts your answer
          actually covers. It is a second opinion: the verdict you recorded
          above stays the one on record, and nothing here changes it.
        </p>
        {errors.length > 0 ? (
          <FieldErrors id="grade-answer-errors" messages={errors} />
        ) : null}
        <form action={formAction} className="section-actions">
          <input type="hidden" name="slug" value={slug} readOnly />
          <input type="hidden" name="questionId" value={questionId} readOnly />
          <input type="hidden" name="answerText" value={answerText} readOnly />
          <button type="submit" className="button-quiet" disabled={isPending}>
            {isPending
              ? "Marking…"
              : grading === null
                ? "Grade with AI"
                : "Grade with AI again"}
          </button>
        </form>
      </div>

      {state.failureCategory === null ? null : (
        <div className="owner-group">
          <h3>The grading did not arrive</h3>
          <p className="field-hint">
            {describeFailureCategory(state.failureCategory)} Your own verdict is
            unaffected, and the attempt is still recorded exactly as you marked
            it.
          </p>
        </div>
      )}

      {grading === null ? null : (
        <div className="owner-group">
          <h3>What the model made of it</h3>
          <div className="card-heading">
            <span
              className={
                grading.verdict === "INCORRECT" ? "badge badge-alert" : "badge"
              }
            >
              {describeAnswerVerdict(grading.verdict)}
            </span>
            <span className="badge">
              {/* Agreement or disagreement with the owner, stated as such. The
                  self-grade is the record either way, so a disagreement is
                  information rather than a correction. */}
              {agreementLabel(grading.verdict, recordedCorrect)}
            </span>
          </div>

          {grading.conceptsCovered.length === 0 ? null : (
            <div className="question-answer">
              <h4>Concepts your answer covered</h4>
              <ul className="question-concepts">
                {grading.conceptsCovered.map((concept) => (
                  <li key={concept}>{concept}</li>
                ))}
              </ul>
            </div>
          )}

          {grading.conceptsMissed.length === 0 ? null : (
            <div className="question-answer">
              <h4>Concepts it did not find</h4>
              <ul className="question-concepts">
                {grading.conceptsMissed.map((concept) => (
                  <li key={concept}>{concept}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="card-text">{grading.feedback}</p>

          <p className="field-hint">
            Graded from model knowledge against the concepts this question
            records — no sources were consulted. It is advice on your answer,
            not a mark: your own verdict is what this attempt keeps.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Whether the model came out where the owner did.
 *
 * `PARTIALLY_CORRECT` agrees with neither and is labelled as the third thing it is, because
 * calling it agreement or disagreement would put a judgement in the badge that the model
 * declined to make.
 */
function agreementLabel(
  verdict: "CORRECT" | "PARTIALLY_CORRECT" | "INCORRECT",
  recordedCorrect: boolean,
): string {
  if (verdict === "PARTIALLY_CORRECT") {
    return "Partly — your call";
  }

  return (verdict === "CORRECT") === recordedCorrect
    ? "Agrees with your verdict"
    : "Differs from your verdict";
}
