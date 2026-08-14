import Link from "next/link";
import { notFound } from "next/navigation";
import { getAudioFacade, isAudioEnabled } from "@/modules/audio/composition";
import { AudioClipList } from "@/modules/audio/ui/audio-clip-list";
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
      <nav aria-label="Breadcrumb" className="breadcrumb">
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
