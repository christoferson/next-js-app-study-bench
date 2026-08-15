"use client";

import { useActionState } from "react";
import Link from "next/link";
import { FieldErrors } from "@/shared/ui/field-errors";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE, formLevelErrors } from "@/shared/ui/form-state";
import type { TutorExchangeView } from "@/modules/ai-generation/application/generation-facade";
import {
  TUTOR_ASK_KINDS,
  describeAskKind,
} from "@/modules/ai-generation/domain/tutor-exchange";
import type {
  TutorAskKind,
  TutorResponse,
} from "@/modules/ai-generation/domain/tutor-exchange";
import type { Choice } from "@/modules/question-bank/domain/question";
import { choiceLetter } from "@/modules/question-bank/domain/question-content";

interface TutorPanelProps {
  readonly slug: string;
  readonly questionId: string;
  /**
   * The question's choices, in the order the page shows them.
   *
   * Empty for a short-answer question, which is why the choice-by-choice ask is rendered
   * from this list rather than always: there is no choice to ask about.
   */
  readonly choices: readonly Choice[];
  /** The identifiers the question marks correct, so the ask offers only the wrong ones. */
  readonly correctChoiceIds: readonly string[];
  /** The most recent exchanges, newest first. */
  readonly exchanges: readonly TutorExchangeView[];
  readonly askAction: (state: FormState, form: FormData) => Promise<FormState>;
}

/**
 * The tutor: a fixed menu of things to ask about this question, and what it said.
 *
 * Buttons rather than a message box, and that is the design rather than a simplification
 * (`tutor-exchange.ts`). Each button is one structured call whose answer is recorded as its
 * own run, so there is no thread to hold, no history to re-send, and no way for a
 * conversation to drift off the question. What the owner gets in exchange for the missing
 * text box is that every answer is about the question in front of them, and every answer is
 * costed and readable in the run history.
 *
 * Three things this component is careful about:
 *
 * - **It never renders replacement question text.** `TutorResponse` has no field that could
 *   carry one (`tutor-schema.ts`), so an answer cannot appear beside the question looking
 *   like a corrected version of it (`spec/AI-GUIDELINES.md` section 1.10).
 * - **Every answer says where it came from.** The note under the panel states that the
 *   tutor answered from the model's own knowledge and consulted nothing, because prose this
 *   fluent reads like something that was checked otherwise
 *   (`spec/AI-GUIDELINES.md` section 1.2).
 * - **A follow-up question is not a bank question.** It is behind a disclosure with its
 *   answer, and it is labelled as something to think about rather than something that was
 *   added — because it was not added.
 */
export function TutorPanel({
  slug,
  questionId,
  choices,
  correctChoiceIds,
  exchanges,
  askAction,
}: TutorPanelProps) {
  // Only the wrong choices: "why is this choice wrong" about the correct one is a question
  // the ask cannot answer honestly, and `EXPLAIN_ANSWER` already covers the right one.
  const wrongChoices = choices
    .map((choice, index) => ({ choice, letter: choiceLetter(index) }))
    .filter((entry) => !correctChoiceIds.includes(entry.choice.id));

  return (
    <div className="owner-panel">
      <div className="owner-group">
        <h3>Ask the tutor</h3>
        <p className="field-hint">
          Each of these asks the configured model one thing about this question,
          as it is stored, and records the answer below. It explains the
          question; it never changes it.
        </p>
        <div className="section-actions">
          {TUTOR_ASK_KINDS.filter(
            (kind) =>
              kind !== "EXPLAIN_CHOICE" && kind !== "FOLLOW_UP_QUESTION",
          ).map((kind) => (
            <AskForm
              action={askAction}
              key={kind}
              kind={kind}
              questionId={questionId}
              slug={slug}
            />
          ))}
        </div>

        {/* Last of the buttons, because it produces something to work on rather than
            something to read. */}
        <AskForm
          action={askAction}
          kind="FOLLOW_UP_QUESTION"
          questionId={questionId}
          slug={slug}
        />

        {wrongChoices.length === 0 ? null : (
          <ChoiceAskForm
            action={askAction}
            choices={wrongChoices}
            questionId={questionId}
            slug={slug}
          />
        )}
      </div>

      <div className="owner-group">
        <h3>What the tutor said</h3>
        {exchanges.length === 0 ? (
          <p className="field-hint">
            You have not asked anything about this question yet.
          </p>
        ) : (
          <>
            <ul className="card-list">
              {exchanges.map((exchange) => (
                <Exchange exchange={exchange} key={exchange.run.id} />
              ))}
            </ul>
            <p className="field-hint">
              The tutor answered from the model&apos;s own knowledge — nothing
              was looked up, and it cites nothing. Treat an explanation as a
              study aid to check, not as a source. Only the most recent asks are
              shown here;{" "}
              <Link href={`/study-tracks/${slug}/generation-runs`}>
                every ask is in the run history
              </Link>
              , with what it cost.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One ask, as a button.
 *
 * `useActionState` for the pending label, because the owner is waiting on a model call and
 * the wait has to be visible (`spec/UI-GUIDELINES.md` section 1.4). One `useActionState`
 * per button rather than one for the panel is deliberate: separate state means only the
 * button that was pressed says it is thinking, instead of all six going grey at once.
 *
 * Form-level errors are rendered because an ask can be refused as a *request* — a question
 * that has gone from this track — and that message belongs beside the button that produced
 * it rather than at the top of the page.
 */
function AskForm({
  action,
  kind,
  questionId,
  slug,
}: {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly kind: TutorAskKind;
  readonly questionId: string;
  readonly slug: string;
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const errors = formLevelErrors(state);

  return (
    <form action={formAction} className="section-actions">
      <input type="hidden" name="slug" value={slug} readOnly />
      <input type="hidden" name="questionId" value={questionId} readOnly />
      <input type="hidden" name="kind" value={kind} readOnly />
      <button type="submit" className="button-quiet" disabled={isPending}>
        {isPending ? "Asking…" : describeAskKind(kind)}
      </button>
      {errors.length > 0 ? (
        <FieldErrors id={`tutor-${kind}-errors`} messages={errors} />
      ) : null}
    </form>
  );
}

/**
 * The choice-by-choice ask: pick a wrong choice, ask why it is wrong.
 *
 * A select rather than a button per choice, because a question can have six choices and six
 * more buttons would bury the other asks. The options are labelled by the same letter the
 * question preview shows, so "B" here is the "B" the owner just read, while the value posted
 * is the stored identifier the answer is filed against.
 */
function ChoiceAskForm({
  action,
  choices,
  questionId,
  slug,
}: {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly choices: readonly {
    readonly choice: Choice;
    readonly letter: string;
  }[];
  readonly questionId: string;
  readonly slug: string;
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const errors = formLevelErrors(state);
  const first = choices[0];

  return (
    <form action={formAction} className="form-grid">
      <input type="hidden" name="slug" value={slug} readOnly />
      <input type="hidden" name="questionId" value={questionId} readOnly />
      <input type="hidden" name="kind" value="EXPLAIN_CHOICE" readOnly />
      <div className="field">
        <label htmlFor="tutor-choice-id">
          Why is one of the other choices wrong?
        </label>
        <select
          defaultValue={first === undefined ? "" : first.choice.id}
          id="tutor-choice-id"
          name="choiceId"
        >
          {choices.map((entry) => (
            <option key={entry.choice.id} value={entry.choice.id}>
              {entry.letter}. {entry.choice.text}
            </option>
          ))}
        </select>
        <p className="field-hint">
          Only the choices this question does not mark correct are offered.
        </p>
      </div>
      {errors.length > 0 ? (
        <FieldErrors id="tutor-choice-errors" messages={errors} />
      ) : null}
      <div className="section-actions">
        <button type="submit" className="button-quiet" disabled={isPending}>
          {isPending ? "Asking…" : "Explain that choice"}
        </button>
      </div>
    </form>
  );
}

/**
 * One recorded exchange.
 *
 * Labelled with the ask it answers, because six kinds of answer in one list are otherwise
 * indistinguishable prose — an owner scrolling back for the plain-language explanation needs
 * to see which one it was. The model and the date are shown for the reason the review panel
 * shows them: an answer from a model the owner has since changed is worth knowing about.
 */
function Exchange({ exchange }: { readonly exchange: TutorExchangeView }) {
  const { run, response } = exchange;

  return (
    <li className="card">
      <div className="card-heading">
        <p className="card-title">
          {response === null
            ? "This answer can no longer be read"
            : describeAskKind(response.kind)}
        </p>
        <span className="badge">Model knowledge only</span>
      </div>

      {exchange.staleRevision ? (
        <p className="field-hint">
          This answer is about an earlier revision. The question has been edited
          since, so it explains wording you no longer have.
        </p>
      ) : null}

      {response === null ? (
        <p className="field-hint">
          It was recorded on {run.startedAt.slice(0, 10)}, but what it said does
          not match the shape a tutor answer has now, so nothing is shown rather
          than part of one. Asking again records a fresh answer.
        </p>
      ) : (
        <TutorAnswer response={response} />
      )}

      <p className="question-row-meta">
        {run.modelId} via {run.modelProvider} · persona {run.personaId} v
        {run.personaVersion} · asked {run.startedAt.slice(0, 10)}
      </p>
    </li>
  );
}

/**
 * The answer itself, by kind.
 *
 * Exhaustive over the response union, so a seventh kind of answer has to decide how it is
 * displayed rather than falling through to the prose case and rendering as an empty card.
 *
 * A follow-up question is the one that renders differently, and it renders as a *question*:
 * the stem in the open, its answer and explanation behind a disclosure, so it can be
 * attempted before it is checked. The note under it says plainly that it was not added to
 * the bank, because everything else on this page that looks like a question is one.
 */
function TutorAnswer({ response }: { readonly response: TutorResponse }) {
  switch (response.kind) {
    case "FOLLOW_UP_QUESTION":
      return (
        <>
          <p className="card-text">{response.stem}</p>
          <details className="disclosure">
            <summary>Show the answer</summary>
            <p className="card-text">{response.answer}</p>
            <p className="card-text">{response.explanation}</p>
          </details>
          <p className="field-hint">
            This is for you to think about now. It was not added to your
            question bank, so it will not appear in a study session — if you
            want to keep it, write it as your own question.
          </p>
        </>
      );
    case "EXPLAIN_ANSWER":
    case "EXPLAIN_CHOICE":
    case "EXPLAIN_SIMPLER":
    case "EXPLAIN_TECHNICAL":
    case "GIVE_EXAMPLE":
      return <p className="card-text">{response.text}</p>;
  }
}
