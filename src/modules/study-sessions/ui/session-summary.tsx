import Link from "next/link";
import type { SessionSummaryView } from "@/modules/study-sessions/application/study-facade";
import { describeConfidence } from "@/modules/study-sessions/domain/question-attempt";
import {
  describeSessionMode,
  describeSessionStatus,
} from "@/modules/study-sessions/domain/study-session";

interface SessionSummaryProps {
  readonly view: SessionSummaryView;
}

/**
 * What one finished session amounted to.
 *
 * Counted evidence only: items reached, answers given, how many were right, cards
 * rated, and which questions were missed. There is no score and no readiness estimate,
 * because a ten-minute session is not evidence for either
 * (`SPEC.md` section 6.8 forbids a pass probability, and this page has nothing that
 * could imply one).
 *
 * Accuracy is omitted rather than shown as 0% when nothing was answered: a session
 * spent entirely on flashcards has no accuracy, which is different from having bad
 * accuracy.
 */
export function SessionSummary({ view }: SessionSummaryProps) {
  const percentage =
    view.attemptCount === 0
      ? null
      : Math.round((view.correctCount / view.attemptCount) * 100);
  const unreached = view.itemCount - view.settledCount;

  return (
    <section className="section">
      <div className="card-heading">
        <span className="badge">{describeSessionMode(view.session.mode)}</span>
        <span className="badge">
          {describeSessionStatus(view.session.status)}
        </span>
        {view.tracks.map((track) => (
          <span className="badge" key={track.id}>
            {track.name}
          </span>
        ))}
      </div>

      <dl className="meta study-summary-figures">
        <div className="meta-item">
          <dt>Items reached</dt>
          <dd>
            {view.settledCount} of {view.itemCount}
          </dd>
        </div>
        <div className="meta-item">
          <dt>Questions answered</dt>
          <dd>{view.attemptCount}</dd>
        </div>
        {percentage === null ? null : (
          <div className="meta-item">
            <dt>Answered correctly</dt>
            <dd>
              {view.correctCount} of {view.attemptCount} ({percentage}%)
            </dd>
          </div>
        )}
        <div className="meta-item">
          <dt>Cards rated</dt>
          <dd>{view.cardsRated}</dd>
        </div>
        {unreached > 0 ? (
          <div className="meta-item">
            <dt>Not reached</dt>
            <dd>
              {unreached} item{unreached === 1 ? "" : "s"}
            </dd>
          </div>
        ) : null}
      </dl>

      {view.attemptCount === 0 ? (
        <p className="section-note">
          No questions were answered in this session, so it changed no accuracy
          measurements.
        </p>
      ) : null}

      {view.mistakes.length > 0 ? (
        <section className="section">
          <h2 className="section-heading">What you missed</h2>
          <p className="section-note">
            These are queued for a mistake-review session, so you do not have to
            remember them.
          </p>
          <ul className="card-list">
            {view.mistakes.map((mistake) => (
              <li className="card" key={mistake.attempt.id}>
                <p className="card-text">{mistake.stem}</p>
                <p className="question-row-meta">
                  You were{" "}
                  {describeConfidence(mistake.attempt.confidence).toLowerCase()}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="section-actions">
        <Link className="button" href="/study/new">
          Study again
        </Link>
        <Link className="button-quiet" href="/progress">
          See your progress
        </Link>
      </div>
    </section>
  );
}
