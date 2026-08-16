import Link from "next/link";
import {
  describeFailureCategory,
  describeItemKind,
  describeRunStatus,
} from "@/modules/ai-generation/domain/generation-run";
import type { GeneratedItemKind } from "@/modules/ai-generation/domain/generation-run";
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
        // A review and a tutor answer both wrote nothing into either bank, so the two
        // facts every other row carries — a provenance badge for generated content, and
        // how much of the batch survives — are false for them. They get what they do
        // have instead: the question they were about.
        const subject = subjectRunKind(run.itemKind);

        return (
          <li className="card" key={run.id}>
            <div className="card-heading">
              <RunStatusBadge status={run.status} />
              <span className="badge">{describeItemKind(run.itemKind)}</span>
              <span className="badge">
                {subject === null
                  ? "AI generated — model knowledge"
                  : subject.provenance}
              </span>
            </div>

            <h3 className="card-title">
              <Link href={`/study-tracks/${slug}/generation-runs/${run.id}`}>
                {subject === null
                  ? `${describeRunStatus(run.status)} · ${run.successfulItemCount} of ${run.requestedItemCount} written`
                  : `${describeRunStatus(run.status)} · ${subject.outcome}`}
              </Link>
            </h3>

            {run.failureReason === null ? null : (
              <p className="card-text">
                {describeFailureCategory(run.failureReason)}
              </p>
            )}

            {subject === null ? (
              <p className="question-row-meta">
                {counts.total} kept · {counts.draft} still draft ·{" "}
                {counts.active} active
              </p>
            ) : run.subjectQuestionId === null ? (
              // Set null by `ON DELETE SET NULL` when the question was deleted. The run
              // stays, because it records a model call that really happened.
              <p className="question-row-meta">{subject.deleted}</p>
            ) : (
              <p className="question-row-meta">
                <Link
                  href={`/study-tracks/${slug}/questions/${run.subjectQuestionId}${subject.anchor}`}
                >
                  {subject.link}
                </Link>
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

/**
 * How a run that is *about* one question describes itself, or `null` for one that
 * produced bank items.
 *
 * One function rather than two booleans on the row, because the two subject kinds differ in
 * every string while sharing the whole shape — and because a third kind of run about a
 * question would otherwise be added as a third boolean and read as generated content until
 * somebody noticed. The tutor's link carries the `#tutor` anchor so a run history row lands
 * on the panel holding the answer rather than at the top of the question.
 */
function subjectRunKind(kind: GeneratedItemKind): {
  readonly provenance: string;
  readonly outcome: string;
  readonly link: string;
  readonly deleted: string;
  readonly anchor: string;
} | null {
  switch (kind) {
    case "QUESTION_REVIEW":
      return {
        provenance: "Judged from model knowledge",
        outcome: "one question judged",
        link: "Read the findings on the question",
        deleted: "The question this review was about has since been deleted.",
        anchor: "",
      };
    case "TUTOR_EXPLANATION":
      return {
        provenance: "Explained from model knowledge",
        outcome: "one tutor answer",
        link: "Read the answer on the question",
        deleted: "The question this answer was about has since been deleted.",
        anchor: "#tutor",
      };
    case "ANSWER_EVALUATION":
      return {
        provenance: "Marked from model knowledge",
        outcome: "one written answer graded",
        link: "Open the question that was answered",
        deleted: "The question this grading was about has since been deleted.",
        // No anchor: a grading is read on the feedback screen of the session it happened
        // in, which is gone by the time this row is read. The question is what is left.
        anchor: "",
      };
    case "QUESTION_CHALLENGE":
      return {
        provenance: "Adjudicated from model knowledge",
        outcome: "one objection judged",
        link: "Read the outcome on the question",
        deleted:
          "The question this challenge was about has since been deleted.",
        anchor: "#challenge",
      };
    case "QUESTION":
    case "FLASHCARD":
    case "ENRICH_VOCABULARY":
    case "OBJECTIVE_IMPORT":
      return null;
  }
}
