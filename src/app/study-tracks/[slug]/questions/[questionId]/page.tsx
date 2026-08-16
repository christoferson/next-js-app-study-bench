import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, TRACKS_CRUMB, trackCrumb } from "@/shared/ui/breadcrumbs";
import {
  CollapsibleSection,
  openWhenShort,
} from "@/shared/ui/collapsible-section";
import { getGenerationFacade } from "@/modules/ai-generation/composition";
import {
  acceptQuestionReviewAction,
  acceptSourceVerificationAction,
  askTutorAction,
  challengeQuestionAction,
  reviewQuestionAction,
  verifyQuestionAgainstSourcesAction,
} from "@/modules/ai-generation/ui/actions";
import { QuestionChallengePanel } from "@/modules/ai-generation/ui/question-challenge-panel";
import { QuestionReviewPanel } from "@/modules/ai-generation/ui/question-review-panel";
import {
  SourceEvidence,
  hasOutdatedEvidence,
} from "@/modules/ai-generation/ui/source-evidence";
import { SourceVerificationPanel } from "@/modules/ai-generation/ui/source-verification-panel";
import { TutorPanel } from "@/modules/ai-generation/ui/tutor-panel";
import {
  contentChoices,
  correctChoiceIds,
  describeDifficulty,
} from "@/modules/question-bank/domain/question";
import { getQuestionBankFacade } from "@/modules/question-bank/composition";
import {
  disputeQuestionAction,
  linkObjectiveAction,
  markQuestionOutdatedAction,
  unlinkObjectiveAction,
} from "@/modules/question-bank/ui/actions";
import {
  LifecycleBadge,
  ProvenanceBadge,
  QualityBadge,
  QuestionTypeBadge,
} from "@/modules/question-bank/ui/question-badges";
import { ObjectiveLinkForm } from "@/modules/question-bank/ui/objective-link-form";
import { QuestionOwnerPanel } from "@/modules/question-bank/ui/question-owner-panel";
import { QuestionPreview } from "@/modules/question-bank/ui/question-preview";
import { RevisionHistory } from "@/modules/question-bank/ui/revision-history";
import { convertQuestionAction } from "@/modules/flashcards/ui/actions";
import { ConvertQuestionForm } from "@/modules/flashcards/ui/convert-question-form";
import { getStudyFacade } from "@/modules/study-sessions/composition";
import { AttemptHistory } from "@/modules/study-sessions/ui/attempt-history";

interface QuestionDetailPageProps {
  readonly params: Promise<{
    readonly slug: string;
    readonly questionId: string;
  }>;
}

/**
 * One question: how it will be studied, plus everything the owner manages.
 *
 * The facade returns `null` both for an unknown id and for a question belonging
 * to another track, so a guessed address is a 404 rather than a cross-track leak.
 */
export default async function QuestionDetailPage({
  params,
}: QuestionDetailPageProps) {
  const { slug, questionId } = await params;
  const view = await getQuestionBankFacade().findDetail(slug, questionId);

  if (view === null) {
    notFound();
  }

  const { certification, question, currentRevision } = view;
  const bankPath = `/study-tracks/${certification.slug}/questions`;
  // Bounded to the most recent attempts: the history is a record to inspect, not a
  // log to page through (`spec/ARCHITECTURE.md` section 8).
  // Read-aloud was removed from question pages by owner decision (2026-08-15):
  // question audio belongs to future listening-comprehension study, not the
  // management view. Vocabulary card audio is unaffected.
  const [
    attempts,
    aiReview,
    tutorExchanges,
    aiChallenge,
    evidence,
    sourceCheck,
    checkableSourceCount,
  ] = await Promise.all([
    getStudyFacade().listAttemptsForQuestion(question.id),
    // The latest completed review of this question, or `null` if it has never been
    // reviewed. A cheap read that makes the findings panel part of the question
    // rather than a screen the owner has to go and find.
    getGenerationFacade().findQuestionReview(question.id),
    // The recent tutor answers, bounded by the facade. Read on the server so an
    // answer survives the reload it was recorded on: the ask action revalidates this
    // path rather than returning the answer to the client.
    getGenerationFacade().findTutorExchanges(question.id),
    // The latest challenge, or `null` if the owner has never objected to this question.
    // Read here rather than inside the panel for the reason the review is: the panel is a
    // client island, and a server read keeps the outcome durable across the reload the
    // challenge action revalidates.
    getGenerationFacade().findQuestionChallenge(question.id),
    // The passages this question was built from, if any. Loaded for every question rather
    // than only for grounded ones: a question can gain evidence and its mode alone does not
    // say whether it has any, so the presence of links is what the page reads.
    getGenerationFacade().findQuestionEvidence(question.id),
    // The latest source check, or null if this question has never been checked.
    getGenerationFacade().findSourceVerification(question.id),
    // Whether this track has anything to check against at all. A count rather than the
    // sources themselves: the check has no source picker, so the page only needs to know
    // whether the button would have somewhere to look.
    getGenerationFacade().countCheckableSources(certification.slug),
  ]);
  // Matches `isReviewableLifecycle` in the facade, which re-checks it: a retired or
  // archived question is out of study, so reviewing it would spend a model call on
  // something the owner is not using.
  const reviewable =
    question.lifecycleStatus === "DRAFT" ||
    question.lifecycleStatus === "ACTIVE";

  return (
    <main className="page">
      <Breadcrumbs
        trail={[
          TRACKS_CRUMB,
          trackCrumb(certification),
          { label: "Question bank", href: bankPath },
        ]}
        current="Question"
      />

      <header className="page-header">
        <p className="eyebrow">{certification.name}</p>
        <div className="card-heading">
          <h1>Question</h1>
          <QuestionTypeBadge type={currentRevision.questionType} />
          <LifecycleBadge status={question.lifecycleStatus} />
          <QualityBadge status={question.qualityStatus} />
          <ProvenanceBadge
            alwaysShow
            generationMode={question.generationMode}
            generationRunId={question.generationRunId}
            slug={certification.slug}
          />
        </div>
        {question.disputeReason !== null ? (
          <p className="lede">Disputed: {question.disputeReason}</p>
        ) : null}
        <dl className="meta">
          <div className="meta-item">
            <dt>Revision</dt>
            <dd>
              {currentRevision.revisionNumber} of {view.revisions.length}
            </dd>
          </div>
          <div className="meta-item">
            <dt>Difficulty</dt>
            <dd>
              {currentRevision.difficulty === null
                ? "Not graded"
                : describeDifficulty(currentRevision.difficulty)}
            </dd>
          </div>
          {currentRevision.language !== null ? (
            <div className="meta-item">
              <dt>Language</dt>
              <dd>{currentRevision.language}</dd>
            </div>
          ) : null}
          {currentRevision.tags.length > 0 ? (
            <div className="meta-item">
              <dt>Tags</dt>
              <dd>{currentRevision.tags.join(", ")}</dd>
            </div>
          ) : null}
          <div className="meta-item">
            <dt>Updated</dt>
            <dd>{question.updatedAt.slice(0, 10)}</dd>
          </div>
        </dl>
        <div className="section-actions">
          <Link className="button" href={`${bankPath}/${question.id}/edit`}>
            Edit question
          </Link>
        </div>
      </header>

      <section aria-labelledby="preview-heading" className="section">
        <div className="section-heading">
          <h2 id="preview-heading">How it will be studied</h2>
          <p className="section-note">
            The question as it appears while studying, without the answer.
          </p>
        </div>
        <QuestionPreview revision={currentRevision} revealAnswer={false} />
      </section>

      <section aria-labelledby="answer-heading" className="section">
        <div className="section-heading">
          <h2 id="answer-heading">Answer and explanation</h2>
        </div>
        {/* `details` keeps the answer off screen until the owner asks for it, so
            reviewing the bank does not spoil a question by accident. */}
        <details className="disclosure">
          <summary>Reveal the answer</summary>
          <QuestionPreview revision={currentRevision} revealAnswer />
        </details>
      </section>

      <section aria-labelledby="objectives-heading" className="section">
        <div className="section-heading">
          <h2 id="objectives-heading">Objectives</h2>
          <p className="section-note">
            Mapping a question to objectives places it in this track&apos;s
            study map. Only objectives of {certification.name} can be mapped.
          </p>
        </div>

        {view.linkedObjectives.length === 0 ? (
          <p className="empty-state">
            This question is not mapped to any objective yet.
          </p>
        ) : (
          <ul className="card-list">
            {view.linkedObjectives.map((objective) => (
              <li className="card" key={objective.id}>
                <div className="card-heading">
                  {objective.code !== null ? (
                    <span className="badge">{objective.code}</span>
                  ) : null}
                  <p className="card-title">{objective.title}</p>
                </div>
                <form action={unlinkObjectiveAction}>
                  <input
                    type="hidden"
                    name="slug"
                    value={certification.slug}
                    readOnly
                  />
                  <input
                    type="hidden"
                    name="questionId"
                    value={question.id}
                    readOnly
                  />
                  <input
                    type="hidden"
                    name="objectiveId"
                    value={objective.id}
                    readOnly
                  />
                  <button
                    type="submit"
                    className="button-quiet"
                    aria-label={`Remove mapping to ${objective.title}`}
                  >
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {view.linkableObjectives.length > 0 ? (
          <ObjectiveLinkForm
            action={linkObjectiveAction}
            slug={certification.slug}
            questionId={question.id}
            candidates={view.linkableObjectives}
          />
        ) : (
          <p className="field-hint">
            {view.linkedObjectives.length === 0
              ? "This track has no active objectives to map yet."
              : "Every active objective of this track is already mapped."}
          </p>
        )}
      </section>

      <section aria-labelledby="flashcard-heading" className="section">
        <div className="section-heading">
          <h2 id="flashcard-heading">Flashcards</h2>
          <p className="section-note">
            {question.lifecycleStatus === "ACTIVE"
              ? "A card copies this question's wording, answer, and objectives, then becomes independent of it."
              : "Only an active question can be turned into a flashcard."}
          </p>
        </div>
        {question.lifecycleStatus === "ACTIVE" ? (
          <ConvertQuestionForm
            action={convertQuestionAction}
            slug={certification.slug}
            questionId={question.id}
          />
        ) : (
          <p className="field-hint">
            Activate this question to make a flashcard from it.
          </p>
        )}
      </section>

      {/* Collapsible, and folded once there is more than a screenful: this is the owner's
          own record, read when they are deciding whether a question needs work, not on the
          way past it. */}
      <CollapsibleSection
        id="attempts"
        title="Attempt history"
        open={openWhenShort(attempts.length)}
        count={
          attempts.length === 1 ? "1 attempt" : `${attempts.length} attempts`
        }
        note="Every answer you have recorded for this question, newest first. Each names the revision it was answered against, so editing the question does not rewrite what you answered."
      >
        <AttemptHistory attempts={attempts} revisions={view.revisions} />
      </CollapsibleSection>

      {/* Before the AI panels, because it is the owner's own material rather than a model's
          opinion of it: someone deciding whether a question is right should read the passages
          it was built from before reading anything written about it. Folded once there is more
          than a screenful, like the other record sections. */}
      {evidence.length > 0 ? (
        <CollapsibleSection
          id="evidence"
          title="Source evidence"
          open={openWhenShort(evidence.length)}
          count={
            evidence.length === 1 ? "1 passage" : `${evidence.length} passages`
          }
          note="The passages of your own sources this question was built from, quoted as they were sent to the model. Each names the source and when it was read."
        >
          {hasOutdatedEvidence(evidence) ? (
            <div className="empty-state" role="status">
              <p>
                This question was built on an older snapshot of at least one of
                its sources. That source has been read again since, so the
                passages below may no longer be what the document says.
              </p>
              <p>
                Nothing has been changed for you. If the question no longer
                holds, mark it outdated and it leaves study until you revise it.
              </p>
              <form action={markQuestionOutdatedAction}>
                <input
                  type="hidden"
                  name="slug"
                  value={certification.slug}
                  readOnly
                />
                <input
                  type="hidden"
                  name="questionId"
                  value={question.id}
                  readOnly
                />
                <button type="submit" className="button-quiet">
                  Mark as outdated
                </button>
              </form>
            </div>
          ) : null}
          <SourceEvidence evidence={evidence} />
        </CollapsibleSection>
      ) : null}

      {/* Above Manage rather than inside it: a review is evidence the owner reads before
          deciding, and the decisions it argues for — approve, dispute — are the controls
          in the section below. */}
      <section aria-labelledby="ai-review-heading" className="section">
        <div className="section-heading">
          <h2 id="ai-review-heading">AI review</h2>
          <p className="section-note">
            A model&apos;s judgement of this question, from its own knowledge.
            It reports what it finds and changes nothing; you decide what to do
            about it.
          </p>
        </div>
        <QuestionReviewPanel
          slug={certification.slug}
          questionId={question.id}
          reviewable={reviewable}
          view={aiReview}
          reviewAction={reviewQuestionAction}
          disputeAction={disputeQuestionAction}
          acceptAction={acceptQuestionReviewAction}
        />
      </section>

      {/* Directly after the AI review, because the two answer one question from opposite
          evidence — what the model believes, and what the owner's own documents say — and the
          second is the one that can contradict the first.

          `id="source-check"` is the anchor a run-history row links to. */}
      <section
        aria-labelledby="source-check-heading"
        className="section"
        id="source-check"
        style={{ scrollMarginTop: "1rem" }}
      >
        <div className="section-heading">
          <h2 id="source-check-heading">Check against my sources</h2>
          <p className="section-note">
            A model reads passages of the documents you imported and says
            whether they support this question&apos;s answer. It answers from
            those passages only, and it changes nothing.
          </p>
        </div>
        <SourceVerificationPanel
          slug={certification.slug}
          questionId={question.id}
          checkable={checkableSourceCount > 0}
          view={sourceCheck}
          verifyAction={verifyQuestionAgainstSourcesAction}
          disputeAction={disputeQuestionAction}
          acceptAction={acceptSourceVerificationAction}
        />
      </section>

      {/* Directly after the review and before Manage, because the two AI panels answer
          different questions about the same text — "is this question sound" and "why is
          this the answer" — and an owner who has just read a finding they do not
          understand should not have to go looking for the tutor.

          `id="tutor"` is the anchor the in-session feedback deep-links to, so "ask the
          tutor about this" from a study session lands on the panel rather than at the top
          of a long page. */}
      <section
        aria-labelledby="tutor-heading"
        className="section"
        id="tutor"
        // Scrolled into view rather than merely reachable, so following the deep link puts
        // the panel on screen without the owner scrolling.
        style={{ scrollMarginTop: "1rem" }}
      >
        <div className="section-heading">
          <h2 id="tutor-heading">Ask the tutor</h2>
          <p className="section-note">
            A model explains this question to you, one ask at a time, from its
            own knowledge. Each ask is one call and is recorded with what it
            cost; nothing here changes the question or adds anything to your
            bank.
          </p>
        </div>
        <TutorPanel
          askAction={askTutorAction}
          choices={contentChoices(currentRevision.content)}
          correctChoiceIds={correctChoiceIds(currentRevision.content)}
          exchanges={tutorExchanges}
          questionId={question.id}
          slug={certification.slug}
        />
      </section>

      {/* Last of the three AI panels and directly before Manage, because a challenge is
          where reading turns into a decision: the two actions it argues for — dispute, or
          write a new revision — are the controls in the section below and the edit form it
          links to.

          `id="challenge"` is the anchor a run-history row links to, so a recorded challenge
          is reachable from the run that spent the call. */}
      <section
        aria-labelledby="challenge-heading"
        className="section"
        id="challenge"
        style={{ scrollMarginTop: "1rem" }}
      >
        <div className="section-heading">
          <h2 id="challenge-heading">Challenge this question</h2>
          <p className="section-note">
            If you think the marked answer is wrong, say why and a model will
            argue both readings. It reaches a verdict and recommends what to do;
            it never rewrites the question, so a new revision is yours to write.
          </p>
        </div>
        <QuestionChallengePanel
          slug={certification.slug}
          questionId={question.id}
          challengeable={reviewable}
          view={aiChallenge}
          challengeAction={challengeQuestionAction}
          disputeAction={disputeQuestionAction}
        />
      </section>

      <section aria-labelledby="manage-heading" className="section">
        <div className="section-heading">
          <h2 id="manage-heading">Manage</h2>
        </div>
        <QuestionOwnerPanel
          slug={certification.slug}
          question={question}
          deletable={view.deletable}
          blockingDependencies={view.blockingDependencies}
        />
      </section>

      <CollapsibleSection
        id="history"
        title="Revision history"
        open={openWhenShort(view.revisions.length)}
        count={
          view.revisions.length === 1
            ? "1 revision"
            : `${view.revisions.length} revisions`
        }
        note="Editing a question adds a revision. Earlier revisions are kept exactly as they were written."
      >
        <RevisionHistory
          slug={certification.slug}
          questionId={question.id}
          revisions={view.revisions}
          currentRevisionId={question.currentRevisionId}
        />
      </CollapsibleSection>
    </main>
  );
}
