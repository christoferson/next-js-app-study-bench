import Link from "next/link";
import { notFound } from "next/navigation";
import { describeQuestionType } from "@/modules/question-bank/domain/question";
import { getQuestionBankFacade } from "@/modules/question-bank/composition";
import { QuestionPreview } from "@/modules/question-bank/ui/question-preview";

interface RevisionPageProps {
  readonly params: Promise<{
    readonly slug: string;
    readonly questionId: string;
    readonly revisionNumber: string;
  }>;
}

/**
 * One historical revision, read-only.
 *
 * There is no edit control here: a revision is immutable, and editing means
 * appending a new one from the current revision. Showing the stored wording with
 * its answer is the whole point of keeping history.
 */
export default async function QuestionRevisionPage({
  params,
}: RevisionPageProps) {
  const { slug, questionId, revisionNumber } = await params;
  const parsed = Number(revisionNumber);

  if (!Number.isInteger(parsed) || parsed < 1) {
    notFound();
  }

  const view = await getQuestionBankFacade().findRevisionView(
    slug,
    questionId,
    parsed,
  );

  if (view === null) {
    notFound();
  }

  const questionPath = `/study-tracks/${view.certification.slug}/questions/${view.question.id}`;

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href={questionPath}>Back to this question</Link>
      </nav>

      <header className="page-header">
        <p className="eyebrow">{view.certification.name}</p>
        <div className="card-heading">
          <h1>Revision {view.revision.revisionNumber}</h1>
          {view.isCurrent ? (
            <span className="badge">Current</span>
          ) : (
            <span className="badge">Superseded</span>
          )}
          <span className="badge">
            {describeQuestionType(view.revision.questionType)}
          </span>
        </div>
        <p className="lede">
          Written {view.revision.createdAt.slice(0, 10)}. Revisions are never
          changed after they are written.
        </p>
      </header>

      <section aria-labelledby="revision-heading" className="section">
        <div className="section-heading">
          <h2 id="revision-heading">Content as written</h2>
        </div>
        <QuestionPreview revision={view.revision} revealAnswer />
      </section>
    </main>
  );
}
