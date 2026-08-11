import type { QuestionRevision } from "@/modules/question-bank/domain/question";
import {
  contentChoices,
  correctChoiceIds,
} from "@/modules/question-bank/domain/question";
import type {
  QuestionAttempt,
  SubmittedAnswer,
} from "@/modules/study-sessions/domain/question-attempt";
import {
  describeConfidence,
  describeEvaluationMode,
} from "@/modules/study-sessions/domain/question-attempt";

interface AnswerFeedbackProps {
  readonly attempt: QuestionAttempt;
  /** The revision the attempt names, so the answer matches the wording answered. */
  readonly revision: QuestionRevision;
  /** Where "next" goes: the session, or the summary when nothing is left. */
  readonly continueHref: string;
  readonly continueLabel: string;
}

/**
 * What one answer turned out to be.
 *
 * The verdict is stated in words, never by colour alone, and the correct answer and
 * explanation come from the revision the attempt recorded rather than the current one,
 * so feedback cannot describe a wording the owner never saw
 * (`spec/DOMAIN-RULES.md` section 2.3).
 *
 * A self-assessed short answer says so, because "correct" that the owner decided is a
 * different claim from "correct" that the application checked.
 */
export function AnswerFeedback({
  attempt,
  revision,
  continueHref,
  continueLabel,
}: AnswerFeedbackProps) {
  const choices = contentChoices(revision.content);
  const correct = new Set(correctChoiceIds(revision.content));
  const chosen = new Set(chosenChoiceIds(attempt.submittedAnswer));

  return (
    <section className="section study-feedback">
      <div className="card-heading">
        <span className={attempt.isCorrect ? "badge" : "badge badge-alert"}>
          {attempt.isCorrect ? "Correct" : "Incorrect"}
        </span>
        <span className="badge">
          You were {describeConfidence(attempt.confidence).toLowerCase()}
        </span>
        {attempt.evaluationMode === "SELF_ASSESSED" ? (
          <span className="badge">
            {describeEvaluationMode(attempt.evaluationMode)}
          </span>
        ) : null}
      </div>

      <p className="question-stem">{revision.stem}</p>

      {choices.length > 0 ? (
        <ol className="question-choices">
          {choices.map((choice) => (
            <li className="question-choice" key={choice.id}>
              <span>{choice.text}</span>
              {correct.has(choice.id) ? (
                <span className="badge">Correct answer</span>
              ) : null}
              {chosen.has(choice.id) ? (
                <span className="badge">You chose this</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {attempt.submittedAnswer.type === "SHORT_ANSWER" ? (
        <div className="question-answer">
          <h3>Your answer</h3>
          <p className="card-text">{attempt.submittedAnswer.text}</p>
        </div>
      ) : null}

      {revision.content.type === "SHORT_ANSWER" ? (
        <div className="question-answer">
          <h3>Expected concepts</h3>
          <ul className="question-concepts">
            {revision.content.expectedConcepts.map((concept) => (
              <li key={concept}>{concept}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {revision.explanation !== null ? (
        <div className="question-answer">
          <h3>Explanation</h3>
          <p>{revision.explanation}</p>
        </div>
      ) : null}

      <div className="section-actions">
        <a className="button" href={continueHref}>
          {continueLabel}
        </a>
      </div>
    </section>
  );
}

/**
 * Which choices an attempt named.
 *
 * Exhaustive over the submitted-answer union: a short answer names no choice, and a
 * fourth answered type would have to say what it selected.
 */
function chosenChoiceIds(answer: SubmittedAnswer): readonly string[] {
  switch (answer.type) {
    case "SINGLE_CHOICE":
      return [answer.choiceId];
    case "MULTIPLE_RESPONSE":
      return answer.choiceIds;
    case "SHORT_ANSWER":
      return [];
  }
}
