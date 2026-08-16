import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, TRACKS_CRUMB } from "@/shared/ui/breadcrumbs";
import { getAudioFacade, isAudioEnabled } from "@/modules/audio/composition";
import { AudioClipList } from "@/modules/audio/ui/audio-clip-list";
import { AnswerGradingPanel } from "@/modules/ai-generation/ui/answer-grading-panel";
import { gradeAnswerAction } from "@/modules/ai-generation/ui/actions";
import { getStudyFacade } from "@/modules/study-sessions/composition";
import {
  finishSessionAction,
  rateSessionCardAction,
  skipSessionItemAction,
  submitAnswerAction,
} from "@/modules/study-sessions/ui/actions";
import { AnswerFeedback } from "@/modules/study-sessions/ui/answer-feedback";
import { AnswerForm } from "@/modules/study-sessions/ui/answer-form";
import { SessionCardItem } from "@/modules/study-sessions/ui/session-card-item";
import { SessionControls } from "@/modules/study-sessions/ui/session-controls";
import { describeSessionMode } from "@/modules/study-sessions/domain/study-session";
import type { QuestionAttempt } from "@/modules/study-sessions/domain/question-attempt";
import type { Certification } from "@/modules/certifications/domain/certification";
import type {
  Question,
  QuestionRevision,
} from "@/modules/question-bank/domain/question";

interface StudySessionPageProps {
  readonly params: Promise<{ readonly sessionId: string }>;
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
}

/**
 * The study screen.
 *
 * A plain GET shows the first item still pending, so reloading shows the same item,
 * and coming back tomorrow resumes exactly where the owner stopped. There is no cursor
 * to save because every answer was committed when it was given: pausing is simply
 * leaving the page.
 *
 * `?feedback=attemptId` shows what the last answer turned out to be. Keeping it in the
 * URL rather than in client state means the feedback survives a reload and is read back
 * from the recorded attempt, so what is on screen is what was actually saved.
 *
 * The item's content is the revision the session froze at composition, so editing a
 * question mid-session does not change the question being answered
 * (`spec/DOMAIN-RULES.md` section 2.3).
 */
export default async function StudySessionPage({
  params,
  searchParams,
}: StudySessionPageProps) {
  const { sessionId } = await params;
  const resolved = (await searchParams) ?? {};
  const facade = getStudyFacade();
  const view = await facade.findSession(sessionId);

  if (view === null) {
    notFound();
  }

  const requestedFeedback = resolved.feedback;
  const feedback =
    typeof requestedFeedback === "string"
      ? await facade.findFeedback(sessionId, requestedFeedback)
      : null;
  const summaryPath = `/study/sessions/${sessionId}/summary`;

  if (view.session.status !== "IN_PROGRESS") {
    return (
      <main className="page">
        <header className="page-header">
          <p className="eyebrow">Study</p>
          <h1>This session has ended</h1>
        </header>
        <section className="section">
          <p className="empty-state">
            Nothing more can be recorded against it. Its summary is still here.
          </p>
          <div className="section-actions">
            <Link className="button" href={summaryPath}>
              See the summary
            </Link>
            <Link className="button-quiet" href="/study/new">
              Start a new session
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const current = view.current;
  // Cards only. A question's stem is offered on its bank page, where the owner is
  // reading rather than being tested; mid-session it would be one more control on a
  // screen whose job is to take an answer.
  //
  // The track comes from the card's own `certificationId` rather than from the first of
  // `view.tracks`, because a mixed-track session holds cards from several tracks and the
  // voice must follow the card.
  //
  // Nothing at all when speech is unconfigured, for the reason the review screen gives.
  const clips =
    current === null || current.itemType !== "FLASHCARD" || !isAudioEnabled()
      ? []
      : await getAudioFacade().findFlashcardClips({
          content: current.revision.content,
          contentLanguage: current.revision.language,
          studyType:
            view.tracks.find(
              (track) => track.id === current.card.flashcard.certificationId,
            )?.studyType ?? "GENERAL",
        });

  return (
    <main className="page">
      <Breadcrumbs trail={[TRACKS_CRUMB]} current="Session" />

      {/* The one "Back to X" link that survived the sweep, and it survives because it is
          not a way back: it is the promise that leaving costs nothing. A trail says where
          "Tracks" is; it does not say that an unfinished session keeps every answer
          already given, which is the thing an owner mid-session needs to read before they
          feel able to stop. */}
      <nav aria-label="Leave session" className="breadcrumb">
        <Link href="/">Leave and come back later</Link>
      </nav>

      <header className="page-header">
        <p className="eyebrow">{describeSessionMode(view.session.mode)}</p>
        <h1>
          {current === null
            ? "Everything answered"
            : `Item ${view.position} of ${view.itemCount}`}
        </h1>
        <p className="lede">
          {view.tracks.map((track) => track.name).join(", ")}
          {view.attemptCount === 0
            ? ""
            : ` · ${view.correctCount} of ${view.attemptCount} correct so far`}
        </p>
      </header>

      {feedback === null ? null : (
        <AnswerFeedback
          attempt={feedback.attempt}
          revision={feedback.revision}
          continueHref={
            current === null ? summaryPath : `/study/sessions/${sessionId}`
          }
          continueLabel={current === null ? "Finish up" : "Next item"}
          // The answered question's own track, matched from the session's tracks rather
          // than fetched: a session already carries them, and a question whose track has
          // since been removed yields `null` and no link instead of a broken address.
          tutorHref={tutorHrefFor(view.tracks, feedback.question)}
          // Composed here rather than imported by the feedback panel, because
          // `study-sessions` may not depend on `modules/ai-generation`. An app-layer page
          // is the one place allowed to put two modules' views on one screen.
          grading={gradingPanelFor(
            trackSlugFor(view.tracks, feedback.question),
            feedback.attempt,
            feedback.revision,
          )}
        />
      )}

      {current === null ? (
        <section aria-labelledby="done-heading" className="section">
          <div className="section-heading">
            <h2 id="done-heading">That is everything in this session</h2>
          </div>
          <p className="section-note">
            Finish it to record the summary. Nothing you have already answered
            is waiting on this.
          </p>
          <SessionControls
            skipAction={skipSessionItemAction}
            finishAction={finishSessionAction}
            sessionId={sessionId}
            itemId={null}
          />
        </section>
      ) : feedback !== null ? null : (
        <>
          <section aria-labelledby="item-heading" className="section">
            <h2 className="section-heading" id="item-heading">
              {current.itemType === "QUESTION"
                ? current.revision.stem
                : "Recall this card"}
            </h2>

            {current.itemType === "QUESTION" ? (
              <AnswerForm
                action={submitAnswerAction}
                sessionId={sessionId}
                itemId={current.item.id}
                revision={current.revision}
              />
            ) : (
              <SessionCardItem
                action={rateSessionCardAction}
                sessionId={sessionId}
                itemId={current.item.id}
                revision={current.revision}
                audio={
                  <AudioClipList
                    clips={clips}
                    idPrefix="session-audio"
                    heading="Listen"
                  />
                }
              />
            )}
          </section>

          <SessionControls
            skipAction={skipSessionItemAction}
            finishAction={finishSessionAction}
            sessionId={sessionId}
            itemId={current.item.id}
          />
        </>
      )}
    </main>
  );
}

/**
 * Where "ask the tutor about this" goes for the question just answered.
 *
 * The tutor lives on the question's own page, which is addressed by track slug, so the
 * answered question's track has to be resolved before a link can be built. It is matched
 * from the tracks the session already loaded rather than fetched again: this is a link, and
 * a link is not worth a query.
 *
 * `null` when the track is not among them, which happens when it has been removed since
 * the session started. A recorded session stays readable in that case, so the feedback
 * renders without the link rather than pointing at an address that 404s.
 */
function tutorHrefFor(
  tracks: readonly Certification[],
  question: Question,
): string | null {
  const slug = trackSlugFor(tracks, question);

  return slug === null
    ? null
    : `/study-tracks/${slug}/questions/${question.id}#tutor`;
}

/**
 * The slug of the answered question's track, or `null` when the session no longer carries it.
 *
 * Shared by the tutor link and the grading panel because both are addressed by track and
 * both have to survive a track removed mid-session: neither renders rather than either
 * pointing somewhere that no longer resolves.
 */
function trackSlugFor(
  tracks: readonly Certification[],
  question: Question,
): string | null {
  return (
    tracks.find((candidate) => candidate.id === question.certificationId)
      ?.slug ?? null
  );
}

/**
 * The AI grading panel for one recorded attempt, or nothing.
 *
 * Three conditions, and each rules out a case where there is nothing to grade:
 *
 * - the answer must be written text, because a choice question was already marked by
 *   comparing ids and a second opinion on that would be theatre;
 * - the revision must record expected concepts, because they are what an answer is graded
 *   *against* — the facade refuses without them, so offering the button would be a lie;
 * - the track must still be resolvable, because the action is addressed by slug.
 *
 * The attempt's own verdict goes in so the panel can say whether the model agreed. It stays
 * the record either way: the grading is advice, and nothing here writes to the attempt
 * (`SPEC.md` section 25.2 item 5).
 */
function gradingPanelFor(
  slug: string | null,
  attempt: QuestionAttempt,
  revision: QuestionRevision,
): ReactNode {
  if (
    slug === null ||
    attempt.submittedAnswer.type !== "SHORT_ANSWER" ||
    revision.content.type !== "SHORT_ANSWER" ||
    revision.content.expectedConcepts.length === 0
  ) {
    return null;
  }

  return (
    <AnswerGradingPanel
      answerText={attempt.submittedAnswer.text}
      gradeAction={gradeAnswerAction}
      questionId={attempt.questionId}
      recordedCorrect={attempt.isCorrect}
      slug={slug}
    />
  );
}
