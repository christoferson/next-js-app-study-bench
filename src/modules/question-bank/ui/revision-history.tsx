import Link from "next/link";
import type {
  QuestionRevision,
  QuestionRevisionId,
} from "@/modules/question-bank/domain/question";
import { stemExcerpt } from "@/modules/question-bank/domain/question";

interface RevisionHistoryProps {
  readonly slug: string;
  readonly questionId: string;
  readonly revisions: readonly QuestionRevision[];
  readonly currentRevisionId: QuestionRevisionId;
}

/**
 * Revision list, newest first.
 *
 * Every revision links to a read-only view of itself, which is what makes the
 * append-only history useful: after an edit the owner can still read exactly what
 * the previous wording was (`spec/DOMAIN-RULES.md` section 1.1).
 */
export function RevisionHistory({
  slug,
  questionId,
  revisions,
  currentRevisionId,
}: RevisionHistoryProps) {
  return (
    <ol className="revision-list">
      {revisions.map((revision) => (
        <li className="revision-row" key={revision.id}>
          <div className="card-heading">
            <span className="badge">Revision {revision.revisionNumber}</span>
            {revision.id === currentRevisionId ? (
              <span className="badge">Current</span>
            ) : null}
          </div>
          <p className="question-row-meta">
            Written {revision.createdAt.slice(0, 10)}
          </p>
          <p className="card-text">{stemExcerpt(revision.stem, 90)}</p>
          <Link
            className="button-quiet"
            href={`/study-tracks/${slug}/questions/${questionId}/revisions/${revision.revisionNumber}`}
          >
            Read revision {revision.revisionNumber}
          </Link>
        </li>
      ))}
    </ol>
  );
}
