import type { QuestionEvidence } from "@/modules/ai-generation/ports/source-grounding-repository";

interface SourceEvidenceProps {
  readonly evidence: readonly QuestionEvidence[];
}

/**
 * The passages one question was built from.
 *
 * This is the acceptance criterion "source-grounded questions display their evidence" as a
 * component, and its whole job is to show the owner the text rather than a claim about it.
 * Three consequences:
 *
 * - **The passage is quoted verbatim**, from the chunk row. Not the model's paraphrase of it
 *   and not a summary: the excerpt on screen is the excerpt the model was sent, which is what
 *   makes this evidence rather than provenance.
 * - **Each passage names its source, when it was read, and where in the document it is.**
 *   Without the date a refreshed source would make old evidence unexplainable; without the
 *   position "my exam guide says so" cannot be checked against the exam guide.
 * - **A superseded passage says so.** The source has been read again since this question was
 *   written, so the question may have been built on text the document no longer contains.
 *   Stated as a fact about the passage, next to the passage, and it changes nothing by itself
 *   — the quality status stays the owner's decision (`SPEC.md` section 26.2).
 *
 * A server component: it renders stored text and has no interaction of its own.
 */
export function SourceEvidence({ evidence }: SourceEvidenceProps) {
  if (evidence.length === 0) {
    return (
      <p className="empty-state">
        This question records no source passages. It was written from the
        model&apos;s own knowledge, or by you.
      </p>
    );
  }

  return (
    <ul className="card-list">
      {evidence.map((passage) => (
        <li className="card" key={passage.chunkId}>
          <div className="card-heading">
            <p className="card-title">{passage.sourceTitle}</p>
            <span className="badge">Passage {passage.chunkIndex + 1}</span>
            {passage.supersededByNewerSnapshot ? (
              <span className="badge badge-alert">Older snapshot</span>
            ) : null}
          </div>
          {/* `blockquote` rather than a paragraph: this is somebody else's words, and the
              document it came from is named on the citation below it. */}
          <blockquote className="card-text">{passage.text}</blockquote>
          <p className="question-row-meta">
            Read {passage.retrievedAt.slice(0, 10)}
            {passage.supersededByNewerSnapshot
              ? " · this source has been read again since, so this passage is from an older snapshot of it"
              : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Whether any of this question's evidence is from a superseded snapshot.
 *
 * Derived here rather than stored, and derived from the evidence the page already loaded
 * rather than by a second query: the notice and the passages it is about are one read
 * (migration 0015 states why there is no column).
 */
export function hasOutdatedEvidence(
  evidence: readonly QuestionEvidence[],
): boolean {
  return evidence.some((passage) => passage.supersededByNewerSnapshot);
}
