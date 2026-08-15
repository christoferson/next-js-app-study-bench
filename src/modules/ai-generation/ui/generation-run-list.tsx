import Link from "next/link";
import {
  describeFailureCategory,
  describeItemKind,
  describeRunStatus,
} from "@/modules/ai-generation/domain/generation-run";
import type { GenerationRunSummary } from "@/modules/ai-generation/application/generation-facade";
import { RunStatusBadge } from "./run-status-badge";

interface GenerationRunListProps {
  readonly slug: string;
  readonly runs: readonly GenerationRunSummary[];
}

/**
 * Run history, newest first.
 *
 * A row answers the questions the owner has about a past batch without opening it:
 * what it produced, whether it worked, how much of it is still a draft waiting for
 * review, and which model and persona wrote it. The counts are of items that still
 * exist, so a batch the owner has since rejected does not keep claiming them.
 *
 * The model and the persona are on the row rather than only on the detail page
 * because they are the reason two runs of the same request differ.
 */
export function GenerationRunList({ slug, runs }: GenerationRunListProps) {
  return (
    <ul className="card-list">
      {runs.map(({ run, counts }) => {
        // A review wrote nothing into either bank, so the two facts every other row
        // carries — a provenance badge for generated content, and how much of the batch
        // survives — are both false for it. It gets what it does have instead: the
        // question it judged.
        const isReview = run.itemKind === "QUESTION_REVIEW";

        return (
          <li className="card" key={run.id}>
            <div className="card-heading">
              <RunStatusBadge status={run.status} />
              <span className="badge">{describeItemKind(run.itemKind)}</span>
              <span className="badge">
                {isReview
                  ? "Judged from model knowledge"
                  : "AI generated — model knowledge"}
              </span>
            </div>

            <h3 className="card-title">
              <Link href={`/study-tracks/${slug}/generation-runs/${run.id}`}>
                {isReview
                  ? `${describeRunStatus(run.status)} · one question judged`
                  : `${describeRunStatus(run.status)} · ${run.successfulItemCount} of ${run.requestedItemCount} written`}
              </Link>
            </h3>

            {run.failureReason === null ? null : (
              <p className="card-text">
                {describeFailureCategory(run.failureReason)}
              </p>
            )}

            {isReview ? (
              run.subjectQuestionId === null ? (
                // Set null by `ON DELETE SET NULL` when the question was deleted. The run
                // stays, because it records a model call that really happened.
                <p className="question-row-meta">
                  The question this review was about has since been deleted.
                </p>
              ) : (
                <p className="question-row-meta">
                  <Link
                    href={`/study-tracks/${slug}/questions/${run.subjectQuestionId}`}
                  >
                    Read the findings on the question
                  </Link>
                </p>
              )
            ) : (
              <p className="question-row-meta">
                {counts.total} kept · {counts.draft} still draft ·{" "}
                {counts.active} active
              </p>
            )}

            <p className="question-row-meta">
              {run.modelId} via {run.modelProvider} · persona {run.personaId} v
              {run.personaVersion} · started {run.startedAt.slice(0, 10)}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
