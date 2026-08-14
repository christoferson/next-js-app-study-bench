import type {
  Choice,
  QuestionRevision,
} from "@/modules/question-bank/domain/question";
import {
  contentChoices,
  correctChoiceIds,
} from "@/modules/question-bank/domain/question";
import { choiceLetter } from "@/modules/question-bank/domain/question-content";
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
 * The question stem is deliberately *not* repeated: this panel is rendered directly
 * below the question that was just answered, and repeating it pushed the part the
 * owner came for — which choice was right — below the fold on a phone.
 *
 * Each choice is one line: a mark, its letter, and its text. The mark is a text glyph
 * with a colour, never a colour alone, and every marked line also carries a
 * visually-hidden word, so the verdict survives both a monochrome screen and a screen
 * reader (`spec/UI-GUIDELINES.md` section 1.3).
 *
 * There is one explanation per revision rather than one per choice: `choiceExplanations`
 * from `SPEC.md` section 6.3 is not part of the content model (see
 * `question.ts`), so the explanation is stated once below the list rather than
 * repeated, or worse dangled as an empty dash, against every line.
 *
 * The correct answer and the explanation come from the revision the attempt recorded
 * rather than the current one, so feedback cannot describe a wording the owner never
 * saw (`spec/DOMAIN-RULES.md` section 2.3).
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

      {choices.length > 0 ? (
        <>
          <p className="feedback-your-answer">
            Your answer: {describeChosen(choices, chosen)}
          </p>
          <ol className="feedback-choices">
            {choices.map((choice, index) => (
              <ChoiceVerdict
                choice={choice}
                isChosen={chosen.has(choice.id)}
                isCorrect={correct.has(choice.id)}
                key={choice.id}
                letter={choiceLetter(index)}
              />
            ))}
          </ol>
        </>
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

interface ChoiceVerdictProps {
  readonly choice: Choice;
  readonly letter: string;
  readonly isCorrect: boolean;
  readonly isChosen: boolean;
}

/**
 * One choice, marked.
 *
 * Three states, because they are three different things to know: a correct answer
 * (ticked), a wrong choice the owner made (crossed), and a wrong choice they left
 * alone (unmarked — there is nothing to say about it). A correct answer the owner
 * chose is ticked and says so, which is the whole point of the panel on a question
 * they got right.
 */
function ChoiceVerdict({
  choice,
  letter,
  isCorrect,
  isChosen,
}: ChoiceVerdictProps) {
  const isWrongChoice = isChosen && !isCorrect;
  const className = isCorrect
    ? "feedback-choice verdict-correct"
    : isWrongChoice
      ? "feedback-choice verdict-incorrect"
      : "feedback-choice";

  return (
    <li className={className}>
      {/* `aria-hidden` on the glyph and a word for assistive technology, rather
          than a glyph a screen reader would read as "check mark". */}
      <span aria-hidden="true" className="verdict-mark">
        {isCorrect ? "✓" : isWrongChoice ? "✗" : ""}
      </span>
      <span className="choice-letter">{letter}.</span>
      <span className="choice-text">{choice.text}</span>
      {isCorrect ? (
        <span className="visually-hidden">Correct answer</span>
      ) : null}
      {isWrongChoice ? (
        <span className="visually-hidden">Incorrect</span>
      ) : null}
      {isChosen ? <span className="feedback-chose">you chose this</span> : null}
    </li>
  );
}

/**
 * The letters the owner picked, as "b" or "a and c".
 *
 * Letters rather than the choice text, because the text is on the line below and
 * repeating it is what made the old panel unreadable on a phone. An answer whose
 * choice is no longer in the revision — which the schema prevents — reads as a dash
 * rather than as nothing at all.
 */
function describeChosen(
  choices: readonly Choice[],
  chosen: ReadonlySet<string>,
): string {
  const letters = choices
    .map((choice, index) =>
      chosen.has(choice.id) ? choiceLetter(index) : null,
    )
    .filter((letter): letter is string => letter !== null);

  if (letters.length === 0) {
    return "—";
  }

  if (letters.length === 1) {
    return letters[0] ?? "—";
  }

  return `${letters.slice(0, -1).join(", ")} and ${letters[letters.length - 1]}`;
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
