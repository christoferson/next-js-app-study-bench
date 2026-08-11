import type { QuestionRevision } from "@/modules/question-bank/domain/question";
import {
  contentChoices,
  correctChoiceIds,
} from "@/modules/question-bank/domain/question";
import { describeAnswerRule } from "@/modules/question-bank/domain/question-content";

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
 * Correct answers are marked with a word, never with colour alone.
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
          {choices.map((choice) => (
            <li className="question-choice" key={choice.id}>
              <span>{choice.text}</span>
              {revealAnswer && marked.has(choice.id) ? (
                <span className="badge">Correct</span>
              ) : null}
            </li>
          ))}
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
