import Link from "next/link";
import { notFound } from "next/navigation";
import {
  QUESTION_TYPES,
  describeQuestionType,
} from "@/modules/question-bank/domain/question";
import type { QuestionType } from "@/modules/question-bank/domain/question";
import { describeAnswerRule } from "@/modules/question-bank/domain/question-content";
import { getQuestionBankFacade } from "@/modules/question-bank/composition";
import { createQuestionAction } from "@/modules/question-bank/ui/actions";
import { QuestionForm } from "@/modules/question-bank/ui/question-form";

interface NewQuestionPageProps {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Writes a new question.
 *
 * The type is chosen first, as a step in the URL rather than a control inside the
 * form: the type decides which fields exist, so a mid-form switch would either
 * discard typed content or need client state to preserve it. Each choice is a
 * plain link, so the chosen type is bookmarkable and the form itself renders one
 * shape only.
 */
export default async function NewQuestionPage({
  params,
  searchParams,
}: NewQuestionPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const certification = await getQuestionBankFacade().findNewQuestionForm(slug);

  if (certification === null) {
    notFound();
  }

  const bankPath = `/study-tracks/${certification.slug}/questions`;
  const questionType = readQuestionType(query.type);

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href={bankPath}>Back to the question bank</Link>
      </nav>

      <header className="page-header">
        <p className="eyebrow">New question</p>
        <h1>
          {questionType === null
            ? "Choose a question type"
            : `Write a ${describeQuestionType(questionType).toLowerCase()} question`}
        </h1>
        <p className="lede">
          {questionType === null
            ? `The type decides how the question is answered. It is fixed once you save, so pick the one that fits.`
            : `New questions start as drafts. Activate it when it is ready to study.`}
        </p>
      </header>

      {questionType === null ? (
        <ul className="card-list">
          {QUESTION_TYPES.map((candidate) => (
            <li className="card" key={candidate}>
              <h2 className="card-title">
                <Link href={`${bankPath}/new?type=${candidate}`}>
                  {describeQuestionType(candidate)}
                </Link>
              </h2>
              <p className="card-text">{describeAnswerRule(candidate)}</p>
            </li>
          ))}
        </ul>
      ) : (
        <QuestionForm
          action={createQuestionAction}
          submitLabel="Save as draft"
          cancelHref={bankPath}
          slug={certification.slug}
          certificationId={certification.id}
          questionType={questionType}
        />
      )}
    </main>
  );
}

/** An unknown `?type=` value falls back to the chooser rather than erroring. */
function readQuestionType(
  value: string | string[] | undefined,
): QuestionType | null {
  const candidate = Array.isArray(value) ? value[0] : value;

  return (
    QUESTION_TYPES.find((questionType) => questionType === candidate) ?? null
  );
}
