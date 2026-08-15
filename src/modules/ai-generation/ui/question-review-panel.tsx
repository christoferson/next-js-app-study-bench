"use client";

import { useActionState } from "react";
import Link from "next/link";
import { FieldErrors } from "@/shared/ui/field-errors";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE, formLevelErrors } from "@/shared/ui/form-state";
import type { QuestionReviewView } from "@/modules/ai-generation/application/generation-facade";
import type {
  FindingSeverity,
  QuestionReview,
  ReviewVerdict,
} from "@/modules/ai-generation/domain/question-review";
import {
  describeFindingCategory,
  describeReviewAction,
  describeSeverity,
  describeVerdict,
} from "@/modules/ai-generation/domain/question-review";

interface QuestionReviewPanelProps {
  readonly slug: string;
  readonly questionId: string;
  /** Whether this question's lifecycle allows a review to be requested at all. */
  readonly reviewable: boolean;
  /** The latest completed review, or `null` if the question has never been reviewed. */
  readonly view: QuestionReviewView | null;
  readonly reviewAction: (
    state: FormState,
    form: FormData,
  ) => Promise<FormState>;
  readonly disputeAction: (
    state: FormState,
    form: FormData,
  ) => Promise<FormState>;
  /** The explicit owner accept of a clean review (UNREVIEWED → AI_REVIEWED). */
  readonly acceptAction: (
    state: FormState,
    form: FormData,
  ) => Promise<FormState>;
}

/**
 * What an AI reviewer said about this question, and the button that asks it.
 *
 * Both in one component because they are one thing to the owner: a review is a request
 * whose whole result is the findings below it. Keeping them together also means the
 * pending state and the panel it will replace are on the same screen, so a review that
 * takes several seconds is visibly in progress rather than a button that seems to have
 * done nothing.
 *
 * Three rules this component exists to hold to:
 *
 * - **It renders findings, never replacements.** There is nothing in `QuestionReview` to
 *   render but judgements, so this panel cannot show the owner a rewritten stem beside
 *   their own (`spec/AI-GUIDELINES.md` section 1.10). The question's text stays where the
 *   page already showed it.
 * - **It says what the review was and was not.** The closing line states that the review
 *   used the model's own knowledge and consulted no source, because a confident list of
 *   findings reads like a checked one otherwise (`spec/AI-GUIDELINES.md` section 1.2).
 * - **A dispute is the owner's click.** `DISPUTE` is a recommendation, so it becomes a
 *   button with the reason prefilled from the summary — submitted to the question bank's
 *   own dispute action, unchanged, so the AI path and the manual path record a dispute
 *   the same way.
 */
export function QuestionReviewPanel({
  slug,
  questionId,
  reviewable,
  view,
  reviewAction,
  disputeAction,
  acceptAction,
}: QuestionReviewPanelProps) {
  return (
    <div className="owner-panel">
      <div className="owner-group">
        <h3>AI review</h3>
        {reviewable ? (
          <ReviewRequestForm
            action={reviewAction}
            slug={slug}
            questionId={questionId}
            reviewed={view !== null}
          />
        ) : (
          <p className="field-hint">
            Only a draft or active question can be reviewed. Reviewing one you
            have taken out of study would spend a model call on a question you
            are not using.
          </p>
        )}
      </div>

      {view === null ? null : (
        <div className="owner-group">
          <h3>Findings</h3>
          {view.review === null ? (
            <p className="field-hint">
              This review can no longer be read. It was recorded on{" "}
              {view.run.startedAt.slice(0, 10)}, but what it said does not match
              the shape a review has now, so nothing is shown rather than a
              partial verdict. Reviewing again records a fresh one.
            </p>
          ) : (
            <ReviewFindings
              slug={slug}
              questionId={questionId}
              view={view}
              review={view.review}
              disputeAction={disputeAction}
              acceptAction={acceptAction}
            />
          )}

          <p className="question-row-meta">
            {view.run.modelId} via {view.run.modelProvider} · persona{" "}
            {view.run.personaId} v{view.run.personaVersion} · reviewed{" "}
            {view.run.startedAt.slice(0, 10)}
          </p>
          <p className="field-hint">
            AI review used model knowledge only — no sources were consulted.
          </p>
          <p className="field-hint">
            A review never changes this question by itself. Everything here is a
            recommendation you decide on — including marking a clean review as
            AI-reviewed, which is a button, not an automatic step.{" "}
            <Link href={`/study-tracks/${slug}/generation-runs`}>
              Every review is in the run history.
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * The button that asks for a review.
 *
 * `useActionState` rather than a plain form action, for the pending label: the owner is
 * waiting on a model call here, and the wait has to be visible
 * (`spec/UI-GUIDELINES.md` section 1.4). Form-level errors are rendered because the one
 * thing that can fail as a *form* is a question that is no longer reviewable — a stale
 * tab, most likely — and that message belongs beside the button that produced it.
 *
 * Re-review is offered rather than hidden once a review exists: a second opinion after an
 * edit, or after changing the configured model, is a reasonable thing to want, and each
 * request is recorded as its own run.
 */
function ReviewRequestForm({
  action,
  slug,
  questionId,
  reviewed,
}: {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly slug: string;
  readonly questionId: string;
  readonly reviewed: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const errors = formLevelErrors(state);

  return (
    <>
      <p className="field-hint">
        Asks the configured model to judge whether the stated answer is correct,
        whether more than one answer is defensible, and how good the wrong
        choices are. It reports what it finds; it never rewrites the question.
      </p>
      {errors.length > 0 ? (
        <FieldErrors id="review-form-errors" messages={errors} />
      ) : null}
      <form action={formAction} className="section-actions">
        <input type="hidden" name="slug" value={slug} readOnly />
        <input type="hidden" name="questionId" value={questionId} readOnly />
        <button type="submit" className="button-quiet" disabled={isPending}>
          {isPending
            ? "Reviewing…"
            : reviewed
              ? "Review with AI again"
              : "Review with AI"}
        </button>
      </form>
    </>
  );
}

/**
 * One review, rendered.
 *
 * The verdict first, then the answer judgement, because those are the two facts the owner
 * came for. The summary is next and the findings last: the findings are the evidence, and
 * an owner who trusts the verdict should not have to read twelve of them to reach the
 * conclusion.
 */
function ReviewFindings({
  slug,
  questionId,
  view,
  review,
  disputeAction,
  acceptAction,
}: {
  readonly slug: string;
  readonly questionId: string;
  readonly view: QuestionReviewView;
  readonly review: QuestionReview;
  readonly disputeAction: (
    state: FormState,
    form: FormData,
  ) => Promise<FormState>;
  readonly acceptAction: (
    state: FormState,
    form: FormData,
  ) => Promise<FormState>;
}) {
  return (
    <>
      <div className="card-heading">
        <span className={verdictBadgeClass(review.verdict)}>
          {describeVerdict(review.verdict)}
        </span>
        <span className={review.answerCorrect ? "badge" : "badge badge-alert"}>
          {review.answerCorrect
            ? "Stated answer looks correct"
            : "Stated answer looks wrong"}
        </span>
      </div>

      {view.staleRevision ? (
        <p className="field-hint">
          This review is of an earlier revision. The question has been edited
          since, so the findings below are about wording you no longer have.
        </p>
      ) : null}

      <p className="card-text">{review.summary}</p>

      {review.findings.length === 0 ? (
        <p className="field-hint">
          The reviewer recorded no individual findings.
        </p>
      ) : (
        <ul className="card-list">
          {review.findings.map((finding, index) => (
            // Findings have no identifiers of their own and the list never reorders, so
            // position is the stable key here.
            <li className="card" key={`${finding.category}-${index}`}>
              <div className="card-heading">
                <span className={severityBadgeClass(finding.severity)}>
                  {describeSeverity(finding.severity)}
                </span>
                <p className="card-title">
                  {describeFindingCategory(finding.category)}
                </p>
              </div>
              <p className="card-text">{finding.detail}</p>
            </li>
          ))}
        </ul>
      )}

      <p className="question-row-meta">
        Suggested: {describeReviewAction(review.suggestedAction)}
      </p>

      {view.offersAccept ? (
        <AcceptReviewForm
          action={acceptAction}
          slug={slug}
          questionId={questionId}
        />
      ) : null}

      {view.offersDispute ? (
        <PrefilledDisputeForm
          action={disputeAction}
          slug={slug}
          questionId={questionId}
          reason={review.summary}
        />
      ) : null}
    </>
  );
}

/**
 * The owner's explicit accept of a clean review.
 *
 * A review only records findings; marking the question AI-reviewed is this click
 * (owner decision, 2026-08-15: no state change is automatic). Rendered only while
 * accepting would actually succeed, so the button never exists just to refuse.
 */
function AcceptReviewForm({
  action,
  slug,
  questionId,
}: {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly slug: string;
  readonly questionId: string;
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
      <button type="submit" className="button-quiet" disabled={isPending}>
        {isPending ? "Marking…" : "Mark as AI-reviewed"}
      </button>
      {errors.length > 0 ? (
        <FieldErrors id="accept-review-errors" messages={errors} />
      ) : null}
    </form>
  );
}

/**
 * The one-click dispute the review recommends.
 *
 * The reason travels in a hidden field rather than being assembled by the action, so what
 * gets recorded is exactly the text the owner just read — and it goes through the question
 * bank's own `disputeQuestionAction` and its schema, so a dispute raised from a review is
 * indistinguishable in the data from one the owner typed. That is the point: the bank has
 * one dispute path, and this is a shortcut into it rather than a second one.
 *
 * Behind a `details` because it takes a question out of study. Nothing about the recorded
 * dispute says a model suggested it beyond the wording itself, and that is deliberate — the
 * owner clicked it, so it is the owner's dispute.
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
      <summary>Dispute this question, using the summary above</summary>
      <p className="field-hint">
        This records the summary above as the reason and takes the question out
        of study until you resolve it. You can edit the reason later by
        resolving the dispute and raising your own.
      </p>
      {errors.length > 0 ? (
        <FieldErrors id="review-dispute-errors" messages={errors} />
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
 * Badge classes for a verdict and a severity.
 *
 * The alert variant is added to the worst value only, and always on top of the word it
 * already carries: colour is never the signal (`spec/UI-GUIDELINES.md` section 1.3).
 */
function verdictBadgeClass(verdict: ReviewVerdict): string {
  return verdict === "MAJOR_ISSUES" ? "badge badge-alert" : "badge";
}

function severityBadgeClass(severity: FindingSeverity): string {
  return severity === "MAJOR" ? "badge badge-alert" : "badge";
}
