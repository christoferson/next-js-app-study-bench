import type { Question } from "@/modules/question-bank/domain/question";
import { describeQualityStatus } from "@/modules/question-bank/domain/question";
import { DISPUTE_RESOLUTIONS } from "@/modules/question-bank/domain/question-lifecycle";
import {
  activateQuestionAction,
  approveQuestionAction,
  deleteQuestionAction,
  disputeQuestionAction,
  resolveDisputeAction,
  restoreQuestionAction,
  retireQuestionAction,
} from "./actions";
import { DisputeForm } from "./dispute-form";

interface QuestionOwnerPanelProps {
  readonly slug: string;
  readonly question: Question;
  readonly deletable: boolean;
  readonly blockingDependencies: readonly string[];
}

/**
 * Owner actions for one question.
 *
 * Only the actions the question's current state allows are rendered: a draft
 * offers activation, an active question offers retirement, a retired one offers
 * restoration. The facade re-checks every transition, so a stale page cannot
 * apply an illegal one.
 *
 * Lifecycle and review actions sit in separate groups because they are separate
 * dimensions: disputing a question does not retire it, and activating one does
 * not approve it.
 */
export function QuestionOwnerPanel({
  slug,
  question,
  deletable,
  blockingDependencies,
}: QuestionOwnerPanelProps) {
  const isDisputed = question.qualityStatus === "DISPUTED";

  return (
    <div className="owner-panel">
      <div className="owner-group">
        <h3>Availability</h3>
        <div className="section-actions">
          {question.lifecycleStatus === "DRAFT" ? (
            <ActionButton
              action={activateQuestionAction}
              slug={slug}
              questionId={question.id}
              label="Activate"
            />
          ) : null}
          {question.lifecycleStatus === "ACTIVE" ? (
            <ActionButton
              action={retireQuestionAction}
              slug={slug}
              questionId={question.id}
              label="Retire"
            />
          ) : null}
          {question.lifecycleStatus === "RETIRED" ? (
            <ActionButton
              action={restoreQuestionAction}
              slug={slug}
              questionId={question.id}
              label="Restore to active"
            />
          ) : null}
        </div>
      </div>

      <div className="owner-group">
        <h3>Review</h3>
        {isDisputed ? (
          <>
            <p className="field-hint">
              Disputed: {question.disputeReason ?? "no reason recorded"}
            </p>
            <div className="section-actions">
              {DISPUTE_RESOLUTIONS.map((resolution) => (
                <form action={resolveDisputeAction} key={resolution}>
                  <input type="hidden" name="slug" value={slug} readOnly />
                  <input
                    type="hidden"
                    name="questionId"
                    value={question.id}
                    readOnly
                  />
                  <input
                    type="hidden"
                    name="resolution"
                    value={resolution}
                    readOnly
                  />
                  <button type="submit" className="button-quiet">
                    Resolve as {describeQualityStatus(resolution).toLowerCase()}
                  </button>
                </form>
              ))}
            </div>
          </>
        ) : (
          <>
            {question.qualityStatus === "USER_APPROVED" ? null : (
              <div className="section-actions">
                <ActionButton
                  action={approveQuestionAction}
                  slug={slug}
                  questionId={question.id}
                  label="Mark approved"
                />
              </div>
            )}
            {/* `details` reveals the reason field without client JavaScript and
                without a browser `confirm()` dialog. */}
            <details className="disclosure">
              <summary>Dispute this question</summary>
              <DisputeForm
                action={disputeQuestionAction}
                slug={slug}
                questionId={question.id}
              />
            </details>
          </>
        )}
      </div>

      <div className="owner-group">
        <h3>Delete</h3>
        {deletable ? (
          <details className="disclosure">
            <summary>Delete this question permanently</summary>
            <p className="field-hint">
              This removes the question, all of its revisions, and its objective
              mappings. Retire it instead if you may want it back.
            </p>
            <form action={deleteQuestionAction}>
              <input type="hidden" name="slug" value={slug} readOnly />
              <input
                type="hidden"
                name="questionId"
                value={question.id}
                readOnly
              />
              <button type="submit" className="button-quiet">
                Yes, delete permanently
              </button>
            </form>
          </details>
        ) : (
          <p className="field-hint">
            This question cannot be deleted because it has{" "}
            {blockingDependencies.join(", ")}. Retire it instead.
          </p>
        )}
      </div>
    </div>
  );
}

interface ActionButtonProps {
  readonly action: (form: FormData) => Promise<void>;
  readonly slug: string;
  readonly questionId: string;
  readonly label: string;
}

function ActionButton({ action, slug, questionId, label }: ActionButtonProps) {
  return (
    <form action={action}>
      <input type="hidden" name="slug" value={slug} readOnly />
      <input type="hidden" name="questionId" value={questionId} readOnly />
      <button type="submit" className="button-quiet">
        {label}
      </button>
    </form>
  );
}
