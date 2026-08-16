"use client";

import { useActionState } from "react";
import Link from "next/link";
import { FieldErrors } from "@/shared/ui/field-errors";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE, formLevelErrors } from "@/shared/ui/form-state";
import type { SourceVerificationView } from "@/modules/ai-generation/application/generation-facade";
import type {
  SourceVerification,
  SourceVerificationVerdict,
} from "@/modules/ai-generation/domain/source-verification";
import {
  describeExcerptRelevance,
  describeVerificationVerdict,
} from "@/modules/ai-generation/domain/source-verification";

interface SourceVerificationPanelProps {
  readonly slug: string;
  readonly questionId: string;
  /** Whether this track has any active source to check against at all. */
  readonly checkable: boolean;
  /** The latest completed check, or `null` if this question has never been checked. */
  readonly view: SourceVerificationView | null;
  readonly verifyAction: (
    state: FormState,
    form: FormData,
  ) => Promise<FormState>;
  readonly disputeAction: (
    state: FormState,
    form: FormData,
  ) => Promise<FormState>;
  /** The owner's explicit accept of a supported check (→ SOURCE_CHECKED). */
  readonly acceptAction: (
    state: FormState,
    form: FormData,
  ) => Promise<FormState>;
}

/**
 * What the owner's own documents say about this question, and the button that asks.
 *
 * Deliberately offered for *every* question, whatever it was generated from. A question the
 * model wrote from its own knowledge is exactly the one worth checking against a real exam
 * guide, and restricting the check to grounded questions would have made it useless where it
 * is most useful.
 *
 * Three rules the wording holds to, and each is the reason a field exists:
 *
 * - **Silence is not disagreement.** `NOT_SUPPORTED` reads as "your sources do not say",
 *   offers no dispute, and is presented as a normal answer about an incomplete library.
 *   Only `CONTRADICTED` offers the dispute button.
 * - **The check is only as good as the passages.** The per-excerpt assessments are shown so
 *   the owner can see what was actually consulted, and the closing line says the verdict is
 *   about those passages rather than about the subject.
 * - **Nothing is promoted automatically.** A `SUPPORTED` verdict offers "Mark
 *   source-checked" as a button; the quality status changes on the owner's click
 *   (`spec/AI-GUIDELINES.md` section 1.9).
 */
export function SourceVerificationPanel({
  slug,
  questionId,
  checkable,
  view,
  verifyAction,
  disputeAction,
  acceptAction,
}: SourceVerificationPanelProps) {
  return (
    <div className="owner-panel">
      <div className="owner-group">
        <h3>Check against my sources</h3>
        {checkable ? (
          <VerifyRequestForm
            action={verifyAction}
            slug={slug}
            questionId={questionId}
            checked={view !== null}
          />
        ) : (
          <p className="field-hint">
            This track has no sources yet, so there is nothing to check against.{" "}
            <Link href={`/study-tracks/${slug}/sources`}>Import a source</Link>{" "}
            and this question can be checked against it.
          </p>
        )}
      </div>

      {view === null ? null : (
        <div className="owner-group">
          <h3>What your sources say</h3>
          {view.verification === null ? (
            <p className="field-hint">
              This check can no longer be read. It was recorded on{" "}
              {view.run.startedAt.slice(0, 10)}, but what it said does not match
              the shape a check has now, so nothing is shown rather than a
              partial verdict. Checking again records a fresh one.
            </p>
          ) : (
            <VerificationResult
              slug={slug}
              questionId={questionId}
              view={view}
              verification={view.verification}
              disputeAction={disputeAction}
              acceptAction={acceptAction}
            />
          )}

          <p className="question-row-meta">
            {view.run.modelId} via {view.run.modelProvider} · persona{" "}
            {view.run.personaId} v{view.run.personaVersion} · checked{" "}
            {view.run.startedAt.slice(0, 10)}
          </p>
          <p className="field-hint">
            This verdict is about the passages the check was shown, not about
            the subject. Passages are selected from your active sources by word
            overlap with this question, so a source that covers the topic in
            different words may not have been consulted.{" "}
            <Link href={`/study-tracks/${slug}/generation-runs`}>
              Every check is in the run history.
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * The button that asks for a check.
 *
 * `useActionState` for the pending label, as everywhere the owner waits on a model call.
 * Re-checking is offered rather than hidden once a check exists, because the answer changes:
 * a source refreshed or a new document imported is exactly the reason to ask again.
 */
function VerifyRequestForm({
  action,
  slug,
  questionId,
  checked,
}: {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly slug: string;
  readonly questionId: string;
  readonly checked: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const errors = formLevelErrors(state);

  return (
    <>
      <p className="field-hint">
        Sends passages of your own sources, chosen by their overlap with this
        question, and asks whether they support the answer it marks correct. The
        answer comes from those passages only — not from what the model knows.
      </p>
      {errors.length > 0 ? (
        <FieldErrors id="verify-form-errors" messages={errors} />
      ) : null}
      <form action={formAction} className="section-actions">
        <input type="hidden" name="slug" value={slug} readOnly />
        <input type="hidden" name="questionId" value={questionId} readOnly />
        <button type="submit" className="button-quiet" disabled={isPending}>
          {isPending
            ? "Checking…"
            : checked
              ? "Check against sources again"
              : "Verify against sources"}
        </button>
      </form>
    </>
  );
}

/** One check, rendered: the verdict, the reasoning, then the passages it rests on. */
function VerificationResult({
  slug,
  questionId,
  view,
  verification,
  disputeAction,
  acceptAction,
}: {
  readonly slug: string;
  readonly questionId: string;
  readonly view: SourceVerificationView;
  readonly verification: SourceVerification;
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
        <span className={verdictBadgeClass(verification.verdict)}>
          {describeVerificationVerdict(verification.verdict)}
        </span>
      </div>

      {view.staleRevision ? (
        <p className="field-hint">
          This check is of an earlier revision. The question has been edited
          since, so the verdict below is about wording you no longer have.
        </p>
      ) : null}

      <p className="card-text">{verification.summary}</p>

      {verification.excerpts.length === 0 ? (
        <p className="field-hint">
          The check recorded nothing about individual passages.
        </p>
      ) : (
        <ul className="card-list">
          {verification.excerpts.map((assessment) => (
            <li className="card" key={assessment.excerptIndex}>
              <div className="card-heading">
                <span
                  className={
                    assessment.relevance === "CONTRADICTS"
                      ? "badge badge-alert"
                      : "badge"
                  }
                >
                  {describeExcerptRelevance(assessment.relevance)}
                </span>
                <p className="card-title">Passage {assessment.excerptIndex}</p>
              </div>
              {assessment.note === null ? null : (
                <p className="card-text">{assessment.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {view.offersAccept ? (
        <AcceptVerificationForm
          action={acceptAction}
          slug={slug}
          questionId={questionId}
        />
      ) : null}

      {view.offersDispute && view.disputeReason !== null ? (
        <PrefilledDisputeForm
          action={disputeAction}
          slug={slug}
          questionId={questionId}
          reason={view.disputeReason}
        />
      ) : null}
    </>
  );
}

/**
 * The owner's explicit accept of a supported check.
 *
 * Rendered only while accepting would succeed, so the button never exists to refuse. What it
 * records is the narrower claim of the two: "checked against a source and held up", which is
 * `SOURCE_CHECKED` rather than the owner's own approval.
 */
function AcceptVerificationForm({
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
        {isPending ? "Marking…" : "Mark as source-checked"}
      </button>
      {errors.length > 0 ? (
        <FieldErrors id="accept-verification-errors" messages={errors} />
      ) : null}
    </form>
  );
}

/**
 * The one-click dispute a contradiction recommends.
 *
 * Through the question bank's own dispute action and schema, so a dispute raised from a
 * source check is indistinguishable in the data from one the owner typed — the same shortcut
 * the review panel takes into the same single path. The reason is prefilled by the facade,
 * prefixed to say where it came from.
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
      <summary>Dispute this question, using what your sources say</summary>
      <p className="field-hint">
        This records the summary above as the reason and takes the question out
        of study until you resolve it.
      </p>
      {errors.length > 0 ? (
        <FieldErrors id="verification-dispute-errors" messages={errors} />
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
 * The alert variant on the contradiction only, and always on top of the words it already
 * carries: colour is never the signal (`spec/UI-GUIDELINES.md` section 1.3). `NOT_SUPPORTED`
 * deliberately gets the plain badge — an incomplete source library is not an alarm.
 */
function verdictBadgeClass(verdict: SourceVerificationVerdict): string {
  return verdict === "CONTRADICTED" ? "badge badge-alert" : "badge";
}
