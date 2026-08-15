import { notFound } from "next/navigation";
import { Breadcrumbs, TRACKS_CRUMB, trackCrumb } from "@/shared/ui/breadcrumbs";
import { describeQuestionType } from "@/modules/question-bank/domain/question";
import { getQuestionBankFacade } from "@/modules/question-bank/composition";
import { reviseQuestionAction } from "@/modules/question-bank/ui/actions";
import { QuestionForm } from "@/modules/question-bank/ui/question-form";

interface EditQuestionPageProps {
  readonly params: Promise<{
    readonly slug: string;
    readonly questionId: string;
  }>;
}

/**
 * Edits a question by writing its next revision.
 *
 * The form is prefilled from the current revision, and saving appends revision
 * `n + 1` rather than overwriting revision `n`, so the wording being replaced
 * stays readable in the history.
 */
export default async function EditQuestionPage({
  params,
}: EditQuestionPageProps) {
  const { slug, questionId } = await params;
  const view = await getQuestionBankFacade().findEditForm(slug, questionId);

  if (view === null) {
    notFound();
  }

  const questionPath = `/study-tracks/${view.certification.slug}/questions/${view.question.id}`;
  const nextRevision = view.revision.revisionNumber + 1;

  return (
    <main className="page">
      <Breadcrumbs
        trail={[
          TRACKS_CRUMB,
          trackCrumb(view.certification),
          { label: "Question", href: questionPath },
        ]}
        current="Edit"
      />

      <header className="page-header">
        <p className="eyebrow">Edit question</p>
        <h1>
          Write revision {nextRevision} of this{" "}
          {describeQuestionType(view.revision.questionType).toLowerCase()}{" "}
          question
        </h1>
        <p className="lede">
          Saving keeps revision {view.revision.revisionNumber} exactly as it is
          and makes revision {nextRevision} the one that will be studied. The
          question stays{" "}
          {view.question.lifecycleStatus === "ACTIVE" ? "active" : "as it is"}.
        </p>
      </header>

      <QuestionForm
        action={reviseQuestionAction}
        submitLabel={`Save revision ${nextRevision}`}
        cancelHref={questionPath}
        slug={view.certification.slug}
        questionType={view.revision.questionType}
        questionId={view.question.id}
        revision={view.revision}
      />
    </main>
  );
}
