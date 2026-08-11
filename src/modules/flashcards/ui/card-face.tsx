import type { FlashcardContent } from "@/modules/flashcards/domain/flashcard";
import type { CardFaceLine } from "@/modules/flashcards/domain/flashcard-content";
import { cardFaces } from "@/modules/flashcards/domain/flashcard-content";

interface CardFaceProps {
  readonly content: FlashcardContent;
  /**
   * When true both faces are shown. The review screen and the owner preview
   * render from the same component, so a preview cannot drift from what study
   * shows.
   */
  readonly revealAnswer: boolean;
}

/**
 * Renders a card as it is studied: the prompt, and the answer once revealed.
 *
 * Which side prompts is decided by the domain's `cardFaces`, not here, so a
 * reversed card is prompted back-first everywhere and a cloze card's blanks are
 * derived from the one stored sentence.
 *
 * Faces are large, single-column text with generous line height so a card is
 * readable at a 360-pixel width without zooming (`spec/UI-GUIDELINES.md`
 * section 1.2).
 */
export function CardFace({ content, revealAnswer }: CardFaceProps) {
  const faces = cardFaces(content);

  return (
    <article className="card-study">
      <section className="card-study-face">
        <h3 className="card-study-label">{faces.promptLabel}</h3>
        <FaceLines lines={faces.prompt} emphasis />
      </section>

      {revealAnswer ? (
        <section className="card-study-face card-study-answer">
          <h3 className="card-study-label">{faces.answerLabel}</h3>
          <FaceLines lines={faces.answer} emphasis={false} />
        </section>
      ) : null}
    </article>
  );
}

function FaceLines({
  lines,
  emphasis,
}: {
  readonly lines: readonly CardFaceLine[];
  readonly emphasis: boolean;
}) {
  return (
    <div className="card-study-lines">
      {lines.map((line, index) => (
        <div
          className="card-study-line"
          key={`${line.label ?? "line"}-${index}`}
        >
          {line.label === null ? null : (
            <span className="card-study-line-label">{line.label}</span>
          )}
          <p className={emphasis ? "card-study-prompt" : "card-study-text"}>
            {line.text}
          </p>
        </div>
      ))}
    </div>
  );
}
