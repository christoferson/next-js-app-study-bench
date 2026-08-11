import type { QuestionRevision } from "@/modules/question-bank/domain/question";
import type { QuestionAttempt } from "@/modules/study-sessions/domain/question-attempt";
import {
  describeConfidence,
  describeEvaluationMode,
} from "@/modules/study-sessions/domain/question-attempt";

interface AttemptHistoryProps {
  readonly attempts: readonly QuestionAttempt[];
  /** Every revision of the question, so each attempt can name the one it answered. */
  readonly revisions: readonly QuestionRevision[];
}

/**
 * Every recorded answer to one question, most recent first
 * (`SPEC.md` section 6.3, deferred from D3 until attempts existed).
 *
 * Each row names the revision that was answered, which is what makes the history
 * honest after an edit: an attempt against revision 1 stays an attempt against
 * revision 1 even though the question now reads differently
 * (`spec/DOMAIN-RULES.md` section 1.1).
 */
export function AttemptHistory({ attempts, revisions }: AttemptHistoryProps) {
  if (attempts.length === 0) {
    return (
      <p className="empty-state">
        You have not answered this question yet. Answers recorded in a study
        session appear here.
      </p>
    );
  }

  const revisionNumbers = new Map(
    revisions.map((revision) => [revision.id, revision.revisionNumber]),
  );

  return (
    <ul className="revision-list">
      {attempts.map((attempt) => {
        const revisionNumber = revisionNumbers.get(attempt.questionRevisionId);

        return (
          <li className="revision-row" key={attempt.id}>
            <div className="card-heading">
              <span
                className={attempt.isCorrect ? "badge" : "badge badge-alert"}
              >
                {attempt.isCorrect ? "Correct" : "Incorrect"}
              </span>
              <span className="badge">
                {describeConfidence(attempt.confidence)}
              </span>
              {attempt.evaluationMode === "SELF_ASSESSED" ? (
                <span className="badge">
                  {describeEvaluationMode(attempt.evaluationMode)}
                </span>
              ) : null}
            </div>
            <p className="question-row-meta">
              Answered {attempt.attemptedAt.slice(0, 10)} ·{" "}
              {revisionNumber === undefined
                ? "an earlier revision"
                : `revision ${revisionNumber}`}
              {attempt.durationSeconds === null
                ? ""
                : ` · took ${attempt.durationSeconds}s`}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
