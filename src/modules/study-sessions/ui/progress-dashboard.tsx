import Link from "next/link";
import { describeQuestionType } from "@/modules/question-bank/domain/question";
import type {
  AccuracyView,
  ProgressView,
  TrackProgressView,
} from "@/modules/study-sessions/application/progress-facade";
import {
  describeCalibrationBand,
  describeCalibrationMeaning,
  describeConfidence,
} from "@/modules/study-sessions/domain/question-attempt";
import { describeSessionMode } from "@/modules/study-sessions/domain/study-session";

interface ProgressDashboardProps {
  readonly view: ProgressView;
}

/**
 * The progress dashboard (`SPEC.md` section 6.8).
 *
 * Every figure is counted evidence: accuracy where answers exist, coverage of the
 * syllabus, which objectives have never been touched, recent mistakes, cards due, what
 * the bank holds, and how well the owner's confidence matched their results. There is
 * deliberately no pass probability and no readiness score — the facade cannot produce
 * one and this page does not imply one.
 *
 * Where there is no evidence the page says so instead of printing a zero. "Not
 * attempted yet" and "0% correct" are different statements, and only one of them is
 * true of unstudied material (`spec/UI-GUIDELINES.md` section 1.4).
 */
export function ProgressDashboard({ view }: ProgressDashboardProps) {
  return (
    <>
      <section className="section">
        <h2 className="section-heading">Overall</h2>
        {view.empty ? (
          <p className="empty-state">
            You have not answered any questions yet. Start a session and this
            page will fill in with what you have actually done — no estimates.
          </p>
        ) : (
          <dl className="meta">
            <div className="meta-item">
              <dt>Questions answered</dt>
              <dd>{view.overall.attemptCount}</dd>
            </div>
            <div className="meta-item">
              <dt>Answered correctly</dt>
              <dd>
                {view.overall.correctCount} ({describeAccuracy(view.overall)})
              </dd>
            </div>
          </dl>
        )}
      </section>

      {view.tracks.map((track) => (
        <TrackSection key={track.track.id} track={track} />
      ))}

      {view.confidence.length > 0 ? (
        <section className="section">
          <h2 className="section-heading">Confidence calibration</h2>
          <p className="section-note">
            How often each confidence level turned out to be right. Confident
            and wrong is the pattern worth acting on, and those questions are
            prioritised in your next session.
          </p>
          <ul className="card-list">
            {view.confidence.map((row) => (
              <li className="card" key={row.confidence}>
                <div className="card-heading">
                  <h3 className="card-title">
                    {describeConfidence(row.confidence)}
                  </h3>
                  <span className="badge">
                    {row.attemptCount} answer
                    {row.attemptCount === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="card-text">{describeAccuracy(row)}</p>
                <p className="question-row-meta">
                  {describeCalibrationBand(row.correctBand)}:{" "}
                  {describeCalibrationMeaning(row.correctBand)} ·{" "}
                  {describeCalibrationBand(row.incorrectBand)}:{" "}
                  {describeCalibrationMeaning(row.incorrectBand)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.recentMistakes.length > 0 ? (
        <section className="section">
          <h2 className="section-heading">Recent mistakes</h2>
          <ul className="card-list">
            {view.recentMistakes.map((mistake) => (
              <li className="card" key={mistake.attemptId}>
                <p className="card-text">{mistake.stem}</p>
                <p className="question-row-meta">
                  {view.trackNames.get(mistake.certificationId) ??
                    "Removed track"}{" "}
                  · {mistake.attemptedAt.slice(0, 10)} · you were{" "}
                  {describeConfidence(mistake.confidence).toLowerCase()}
                </p>
              </li>
            ))}
          </ul>
          <div className="section-actions">
            <Link className="button-quiet" href="/study/new">
              Start a mistake-review session
            </Link>
          </div>
        </section>
      ) : null}

      <section className="section">
        <h2 className="section-heading">Recent sessions</h2>
        {view.sessions.length === 0 ? (
          <p className="empty-state">No sessions recorded yet.</p>
        ) : (
          <ul className="card-list">
            {view.sessions.map((entry) => (
              <li className="card" key={entry.session.id}>
                <div className="card-heading">
                  <h3 className="card-title">
                    {describeSessionMode(entry.session.mode)}
                  </h3>
                  <span className="badge">
                    {entry.session.createdAt.slice(0, 10)}
                  </span>
                  {entry.session.status === "IN_PROGRESS" ? (
                    <span className="badge badge-alert">In progress</span>
                  ) : null}
                </div>
                <p className="question-row-meta">
                  {entry.settledCount} of {entry.itemCount} items ·{" "}
                  {entry.attemptCount === 0
                    ? "no questions answered"
                    : `${entry.correctCount} of ${entry.attemptCount} correct`}{" "}
                  ·{" "}
                  {entry.session.certificationIds
                    .map((id) => view.trackNames.get(id) ?? "Removed track")
                    .join(", ")}
                </p>
                {entry.session.status === "IN_PROGRESS" ? (
                  <div className="section-actions">
                    <Link
                      className="button-quiet"
                      href={`/study/sessions/${entry.session.id}`}
                    >
                      Resume
                    </Link>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** Everything measured for one track. */
export function TrackSection({ track }: { readonly track: TrackProgressView }) {
  const unseen = track.objectives.filter((row) => row.unseen);

  return (
    <section className="section">
      <h2 className="section-heading">{track.track.name}</h2>

      <dl className="meta">
        <div className="meta-item">
          <dt>Accuracy</dt>
          <dd>{describeAccuracy(track.accuracy)}</dd>
        </div>
        <div className="meta-item">
          <dt>Objective coverage</dt>
          <dd>
            {track.coverage.percentage === null
              ? "No objectives yet"
              : `${track.coverage.coveredObjectives} of ${track.coverage.totalObjectives} (${track.coverage.percentage}%)`}
          </dd>
        </div>
        <div className="meta-item">
          <dt>Cards due</dt>
          <dd>{track.dueFlashcardCount}</dd>
        </div>
        <div className="meta-item">
          <dt>Active questions</dt>
          <dd>{track.bank.activeQuestions}</dd>
        </div>
        <div className="meta-item">
          <dt>Active flashcards</dt>
          <dd>{track.bank.activeFlashcards}</dd>
        </div>
        {track.bank.disputedQuestions > 0 ? (
          <div className="meta-item">
            <dt>Disputed questions</dt>
            <dd>
              {track.bank.disputedQuestions} (kept out of study until resolved)
            </dd>
          </div>
        ) : null}
      </dl>

      {track.questionTypes.length > 0 ? (
        <section className="section">
          <h3 className="section-heading">Accuracy by question type</h3>
          <ul className="card-list">
            {track.questionTypes.map((row) => (
              <li className="card" key={row.questionType}>
                <div className="card-heading">
                  <h4 className="card-title">
                    {describeQuestionType(row.questionType)}
                  </h4>
                  <span className="badge">{describeAccuracy(row)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {track.objectives.length > 0 ? (
        <section className="section">
          <h3 className="section-heading">Accuracy by objective</h3>
          <ul className="card-list objective-progress-list">
            {track.objectives.map((row) => (
              <li
                className="card"
                key={row.objective.id}
                // Indentation by depth is expressed as a data attribute rather than
                // an inline style, so the spacing scale stays in the stylesheet. It
                // is capped at the third level, past which further indentation would
                // cost more width than it explains at 360 pixels.
                data-depth={Math.min(row.depth, 3)}
              >
                <div className="card-heading">
                  <h4 className="card-title">{row.objective.title}</h4>
                  {row.unseen ? (
                    <span className="badge">Not studied yet</span>
                  ) : (
                    <span className="badge">{describeAccuracy(row)}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {unseen.length > 0 ? (
        <p className="section-note">
          {unseen.length} objective{unseen.length === 1 ? "" : "s"} of this
          track
          {unseen.length === 1 ? " has" : " have"} no answers yet. A session
          prioritises these before revisiting what you already know.
        </p>
      ) : null}

      <div className="section-actions">
        <Link
          className="button-quiet"
          href={`/study/new?track=${track.track.slug}`}
        >
          Study {track.track.name}
        </Link>
      </div>
    </section>
  );
}

/**
 * Accuracy in words.
 *
 * Says "not attempted yet" rather than "0% correct" when there is no evidence, so the
 * page never reports a measurement it does not have.
 */
function describeAccuracy(accuracy: AccuracyView): string {
  return accuracy.percentage === null
    ? "Not attempted yet"
    : `${accuracy.percentage}% correct of ${accuracy.attemptCount} answered`;
}
