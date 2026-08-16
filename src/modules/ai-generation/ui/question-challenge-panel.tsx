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
import type { QuestionChallengeView } from "@/modules/ai-generation/application/generation-facade";
import type {
  ChallengeVerdict,
  QuestionChallenge,
} from "@/modules/ai-generation/domain/question-challenge";
import {
  CHALLENGE_REASON_LIMIT,
  describeChallengeRecommendation,
  describeChallengeVerdict,
} from "@/modules/ai-generation/domain/question-challenge";

interface QuestionChallengePanelProps {
  readonly slug: string;
  readonly questionId: string;
  /** Whether this question's lifecycle allows a challenge at all. */
  readonly challengeable: boolean;
  /** The latest completed challenge, or `null` if it has never been challenged. */
  readonly view: QuestionChallengeView | null;
  readonly challengeAction: (
    state: FormState,
    form: FormData,
  ) => Promise<FormState>;
  readonly disputeAction: (
    state: FormState,
    form: FormData,
  ) => Promise<FormState>;
}

/**
 * The owner's objection to this question, argued out.
 *
 * This is the third AI panel on a question's page and the only one the owner *starts by
 * disagreeing*. A review is unprompted and a tutor answer explains the question as it
 * stands; a challenge begins with "I think this answer is wrong, and here is why", and asks
 * a model to come down on one side.
 *
 * Three rules it holds to, and the last one is the acceptance criterion
 * (`SPEC.md` section 25.2 item 12, `spec/AI-GUIDELINES.md` section 1.10):
 *
 * - **The objection is the owner's own words.** It travels to the model as delimited data
 *   rather than as instruction, and it is not summarised or rewritten on the way.
 * - **The outcome is a finding, not an edit.** A verdict, an argument, a recommendation.
 * - **A revision is the owner's to write.** A `REVISE` recommendation renders the model's
 *   *note* about what would have to change, beside a link to the edit form the owner
 *   already has. There is no "apply" button, because there is nothing to apply: nothing in
 *   a challenge outcome can carry replacement question text.
 */
export function QuestionChallengePanel({
  slug,
  questionId,
  challengeable,
  view,
  challengeAction,
  disputeAction,
}: QuestionChallengePanelProps) {
  return (
    <div className="owner-panel">
      <div className="owner-group">
        <h3>Challenge this answer</h3>
        {challengeable ? (
          <ChallengeRequestForm
            action={challengeAction}
            slug={slug}
            questionId={questionId}
            challenged={view !== null}
          />
        ) : (
          <p className="field-hint">
            Only a draft or active question can be challenged. You have already
            taken this one out of study, so there is nothing a verdict would
            change.
          </p>
        )}
      </div>

      {view === null ? null : (
        <div className="owner-group">
          <h3>Outcome</h3>
          {view.challenge === null ? (
            <p className="field-hint">
              This challenge can no longer be read. It was recorded on{" "}
              {view.run.startedAt.slice(0, 10)}, but what it said does not match
              the shape a challenge has now, so nothing is shown rather than a
              partial verdict. Challenging again records a fresh one.
            </p>
          ) : (
            <ChallengeOutcome
              slug={slug}
              questionId={questionId}
              view={view}
              challenge={view.challenge}
              disputeAction={disputeAction}
            />
          )}

          <p className="question-row-meta">
            {view.run.modelId} via {view.run.modelProvider} · persona{" "}
            {view.run.personaId} v{view.run.personaVersion} · judged{" "}
            {view.run.startedAt.slice(0, 10)}
          </p>
          <p className="field-hint">
            Judged from model knowledge only — no sources were consulted and
            nothing was verified.
          </p>
          <p className="field-hint">
            A challenge never changes this question, and never writes a new
            revision. Disputing it and rewording it are both your own actions.{" "}
            <Link href={`/study-tracks/${slug}/generation-runs`}>
              Every challenge is in the run history.
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * The form that raises an objection.
 *
 * A textarea rather than a button, unlike every other AI control on this page, because the
 * objection *is* the request: there is nothing to adjudicate without it. The bound is stated
 * on the field, and the hint says what a usable objection contains — a model asked to judge
 * "this is wrong" can only guess at what the owner meant.
 *
 * Behind a `details` because this is the third control in the panel stack and the least
 * often wanted: most questions are not objected to.
 */
function ChallengeRequestForm({
  action,
  slug,
  questionId,
  challenged,
}: {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly slug: string;
  readonly questionId: string;
  readonly challenged: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const errors = formLevelErrors(state);
  const reasonErrors = fieldErrors(state, "reason");

  return (
    <>
      <p className="field-hint">
        If you think the answer this question marks correct is wrong, or that
        another answer is just as defensible, say why. The model argues both
        readings and says which one holds. It reports a verdict; it never
        rewrites the question.
      </p>
      {errors.length > 0 ? (
        <FieldErrors id="challenge-form-errors" messages={errors} />
      ) : null}
      <details className="disclosure" open={reasonErrors !== undefined}>
        <summary>
          {challenged ? "Raise another objection" : "Raise an objection"}
        </summary>
        <form action={formAction} className="stacked-form">
          <input type="hidden" name="slug" value={slug} readOnly />
          <input type="hidden" name="questionId" value={questionId} readOnly />
          <div className="field">
            <label htmlFor="challenge-reason">
              What do you disagree with, and why?
            </label>
            <textarea
              aria-describedby={
                reasonErrors === undefined
                  ? "challenge-reason-hint"
                  : "challenge-reason-hint challenge-reason-errors"
              }
              defaultValue={state.values.reason ?? ""}
              id="challenge-reason"
              maxLength={CHALLENGE_REASON_LIMIT}
              name="reason"
              rows={4}
            />
            <p className="field-hint" id="challenge-reason-hint">
              A sentence or two. Naming the choice you think should be correct,
              and the reason, gives the model something to weigh.
            </p>
            {reasonErrors === undefined ? null : (
              <FieldErrors
                id="challenge-reason-errors"
                messages={reasonErrors}
              />
            )}
          </div>
          <div className="section-actions">
            <button type="submit" className="button-quiet" disabled={isPending}>
              {isPending ? "Judging…" : "Challenge with AI"}
            </button>
          </div>
        </form>
      </details>
    </>
  );
}

/**
 * One challenge outcome, rendered.
 *
 * The verdict and the recommendation first, because they are the two facts the owner came
 * for, then the argument. The two action paths come last and are both the owner's: a
 * prefilled dispute button, and a note beside a link to the edit form.
 */
function ChallengeOutcome({
  slug,
  questionId,
  view,
  challenge,
  disputeAction,
}: {
  readonly slug: string;
  readonly questionId: string;
  readonly view: QuestionChallengeView;
  readonly challenge: QuestionChallenge;
  readonly disputeAction: (
    state: FormState,
    form: FormData,
  ) => Promise<FormState>;
}) {
  return (
    <>
      <div className="card-heading">
        <span className={verdictBadgeClass(challenge.verdict)}>
          {describeChallengeVerdict(challenge.verdict)}
        </span>
        <span className="badge">
          {describeChallengeRecommendation(challenge.recommendation)}
        </span>
      </div>

      {view.staleRevision ? (
        <p className="field-hint">
          This challenge is of an earlier revision. The question has been edited
          since, so the verdict below is about wording you no longer have.
        </p>
      ) : null}

      <p className="card-text">{challenge.reasoning}</p>

      {view.revisionNote === null ? null : (
        <div className="question-answer">
          <h4>What a new revision would have to change</h4>
          <p className="card-text">{view.revisionNote}</p>
          <p className="field-hint">
            A note, not a replacement. Nothing here has been written to the
            question — you write the new version, so the wording in your bank
            stays yours.
          </p>
          <div className="section-actions">
            <Link
              className="button-quiet"
              href={`/study-tracks/${slug}/questions/${questionId}/edit`}
            >
              Edit this question
            </Link>
          </div>
        </div>
      )}

      {view.offersDispute ? (
        <PrefilledDisputeForm
          action={disputeAction}
          slug={slug}
          questionId={questionId}
          reason={challenge.reasoning}
        />
      ) : null}
    </>
  );
}

/**
 * The one-click dispute a challenge recommends.
 *
 * The same shortcut the review panel offers, into the same `disputeQuestionAction` and the
 * same schema, so a dispute raised from a challenge is indistinguishable in the data from
 * one the owner typed. The reason is the challenge's own reasoning, in a hidden field, so
 * what is recorded is exactly the text the owner just read.
 */
function PrefilledDisputeForm({
  action,
  slug,
  questionId,
  reason,
}: {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly slug: string;
  readonly questionId: string;
  readonly reason: string;
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const errors = formLevelErrors(state);

  return (
    <details className="disclosure">
      <summary>
        Take this question out of study, using the reasoning above
      </summary>
      <p className="field-hint">
        This records the reasoning above as the reason and takes the question
        out of study until you resolve it. Disputed questions are left out of
        new sessions.
      </p>
      {errors.length > 0 ? (
        <FieldErrors id="challenge-dispute-errors" messages={errors} />
      ) : null}
      <form action={formAction} className="section-actions">
        <input type="hidden" name="slug" value={slug} readOnly />
        <input type="hidden" name="questionId" value={questionId} readOnly />
        <input type="hidden" name="reason" value={reason} readOnly />
        <button type="submit" className="button-quiet" disabled={isPending}>
          {isPending ? "Saving…" : "Dispute with this reason"}
        </button>
      </form>
    </details>
  );
}

/**
 * Badge class for a verdict.
 *
 * The alert variant on the one value that says the bank holds something wrong, and always
 * on top of the words it already carries: colour is never the signal
 * (`spec/UI-GUIDELINES.md` section 1.3).
 */
function verdictBadgeClass(verdict: ChallengeVerdict): string {
  return verdict === "STORED_ANSWER_WRONG" ? "badge badge-alert" : "badge";
}
