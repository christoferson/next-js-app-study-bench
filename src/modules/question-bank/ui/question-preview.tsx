import type { QuestionRevision } from "@/modules/question-bank/domain/question";
import {
  contentChoices,
  correctChoiceIds,
} from "@/modules/question-bank/domain/question";
import {
  choiceLetter,
  describeAnswerRule,
} from "@/modules/question-bank/domain/question-content";

interface QuestionPreviewProps {
  readonly revision: QuestionRevision;
  /**
   * When true the correct answers and the explanation are shown. The learner
   * view and the owner view render from the same component so a preview cannot
   * drift from what study will show.
   */
  readonly revealAnswer: boolean;
}

/**
 * Renders one revision as it will be studied.
 *
 * Choices are a static list, not inputs: D3 previews questions and does not
 * answer them, and a disabled answer control would be a dead control for a
 * feature that does not exist yet (`spec/UI-GUIDELINES.md`).
 *
 * Each choice carries the letter it is presented under, so a question can be
 * discussed, printed, or compared against a recorded answer by reference rather
 * than by repeating its text. The letters come from the position at render time and
 * are never stored (`choiceLetter`).
 *
 * A correct answer is marked with a tick *and* the words "Correct answer", so the
 * mark survives without colour (`spec/UI-GUIDELINES.md` section 1.3).
 */
export function QuestionPreview({
  revision,
  revealAnswer,
}: QuestionPreviewProps) {
  const choices = contentChoices(revision.content);
  const marked = new Set(correctChoiceIds(revision.content));

  return (
    <article className="question-preview">
      <p className="question-instruction">
        {revision.instructions ?? describeAnswerRule(revision.questionType)}
      </p>
      <p className="question-stem">{revision.stem}</p>

      {choices.length > 0 ? (
        <ol className="question-choices">
          {choices.map((choice, index) => {
            const isCorrect = revealAnswer && marked.has(choice.id);

            return (
              <li
                className={
                  isCorrect
                    ? "question-choice verdict-correct"
                    : "question-choice"
                }
                key={choice.id}
              >
                {isCorrect ? (
                  <span aria-hidden="true" className="verdict-mark">
                    ✓
                  </span>
                ) : null}
                <span className="choice-letter">{choiceLetter(index)}.</span>
                <span className="choice-text">{choice.text}</span>
                {isCorrect ? (
                  <span className="visually-hidden">Correct answer</span>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {revision.content.type === "SHORT_ANSWER" && revealAnswer ? (
        <div className="question-answer">
          <h3>Expected concepts</h3>
          <ul className="question-concepts">
            {revision.content.expectedConcepts.map((concept) => (
              <li key={concept}>{concept}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {revealAnswer && revision.explanation !== null ? (
        <div className="question-answer">
          <h3>Explanation</h3>
          <p>{revision.explanation}</p>
        </div>
      ) : null}
    </article>
  );
}
