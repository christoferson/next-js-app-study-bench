import Link from "next/link";
import type { QuestionWithRevision } from "@/modules/question-bank/domain/question";
import { stemExcerpt } from "@/modules/question-bank/domain/question";
import {
  LifecycleBadge,
  ProvenanceBadge,
  QualityBadge,
  QuestionTypeBadge,
} from "./question-badges";

interface QuestionBankListProps {
  readonly slug: string;
  readonly items: readonly QuestionWithRevision[];
}

/**
 * Bank rows, one per question.
 *
 * A row shows an excerpt rather than the full stem, so a long question does not
 * push the rest of the bank off the screen, and both status dimensions so the
 * owner can see at a glance what is studiable. The row links to the detail page
 * for everything else.
 */
export function QuestionBankList({ slug, items }: QuestionBankListProps) {
  return (
    <ul className="card-list">
      {items.map(({ question, revision }) => (
        <li className="card" key={question.id}>
          <div className="card-heading">
            <QuestionTypeBadge type={revision.questionType} />
            <LifecycleBadge status={question.lifecycleStatus} />
            <QualityBadge status={question.qualityStatus} />
            <ProvenanceBadge
              generationMode={question.generationMode}
              generationRunId={question.generationRunId}
              slug={slug}
            />
          </div>

          <h3 className="card-title">
            <Link href={`/study-tracks/${slug}/questions/${question.id}`}>
              {stemExcerpt(revision.stem)}
            </Link>
          </h3>

          {question.disputeReason !== null ? (
            <p className="card-text">Disputed: {question.disputeReason}</p>
          ) : null}

          <p className="question-row-meta">
            Revision {revision.revisionNumber} · updated{" "}
            {formatDate(question.updatedAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Date-only rendering of a stored UTC timestamp.
 *
 * The date part of the ISO string is used directly rather than a locale
 * formatter, so the server render and any client render agree
 * (`spec/CODING-STANDARDS.md`: time is stored and compared in UTC).
 */
function formatDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}
