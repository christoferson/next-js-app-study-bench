import Link from "next/link";
import type {
  AccuracyView,
  ProgressView,
  StudyActivityView,
  TrackSummaryView,
} from "@/modules/study-sessions/application/progress-facade";
import { RECENT_ACTIVITY_DAYS } from "@/modules/study-sessions/application/progress-facade";

interface ProgressDashboardProps {
  readonly view: ProgressView;
}

/**
 * The progress dashboard (`SPEC.md` section 6.8).
 *
 * One thin line about everything, then one compact card per track. Nothing more: the
 * earlier version of this page rendered every objective, every recent mistake, the
 * calibration table, and the session history for every track on one screen, which
 * answered "how am I doing" by requiring the owner to read the whole bank. The detail
 * lives on `/progress/[slug]` now, and each card links to it.
 *
 * Every figure is counted evidence — accuracy where answers exist, dates where
 * activity exists — and there is deliberately no pass probability or readiness score
 * (`SPEC.md` section 6.8). Where there is no evidence the card says "not studied yet"
 * rather than printing a zero: those are different statements, and only one of them is
 * true of unstudied material (`spec/UI-GUIDELINES.md` section 1.4).
 */
export function ProgressDashboard({ view }: ProgressDashboardProps) {
  return (
    <>
      <section className="section">
        <h2 className="section-heading">Everything so far</h2>
        {view.empty ? (
          <p className="empty-state">
            You have not answered any questions yet. Start a session and this
            page will fill in with what you have actually done — no estimates.
          </p>
        ) : (
          <dl className="meta">
            <div className="meta-item">
              <dt>Time answering</dt>
              <dd>{describeAnsweringTime(view.activity)}</dd>
            </div>
            <div className="meta-item">
              <dt>Days active this month</dt>
              <dd>{view.activity.activeDaysThisMonth}</dd>
            </div>
            <div className="meta-item">
              <dt>Items in the last {RECENT_ACTIVITY_DAYS} days</dt>
              <dd>{view.activity.recentItems}</dd>
            </div>
            <div className="meta-item">
              <dt>Answered correctly</dt>
              <dd>{describeAccuracy(view.overall)}</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="section">
        <h2 className="section-heading">Your tracks</h2>
        {view.tracks.length === 0 ? (
          <p className="empty-state">
            You have no active study tracks yet. Add one and it will appear
            here.
          </p>
        ) : (
          <ul className="card-list">
            {view.tracks.map((summary) => (
              <TrackSummaryCard key={summary.track.id} summary={summary} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * One track, compact enough to compare against the others at a glance.
 *
 * The name is the link to the detail page rather than a separate "view progress"
 * button: the card is about one track, so the heading is the way into it.
 */
function TrackSummaryCard({ summary }: { readonly summary: TrackSummaryView }) {
  return (
    <li className="card">
      <div className="card-heading">
        <h3 className="card-title">
          <Link href={`/progress/${summary.track.slug}`}>
            {summary.track.name}
          </Link>
        </h3>
        {summary.dueFlashcardCount > 0 ? (
          <span className="badge badge-highlight">
            {summary.dueFlashcardCount} due
          </span>
        ) : null}
      </div>

      {summary.unstudied ? (
        <p className="card-text">Not studied yet.</p>
      ) : (
        <dl className="meta">
          <div className="meta-item">
            <dt>Last studied</dt>
            <dd>{summary.activity.lastStudiedAt?.slice(0, 10) ?? "Never"}</dd>
          </div>
          <div className="meta-item">
            <dt>Streak</dt>
            <dd>{describeStreak(summary.activity.streakDays)}</dd>
          </div>
          <div className="meta-item">
            <dt>Days active</dt>
            <dd>{summary.activity.activeDays}</dd>
          </div>
          <div className="meta-item">
            <dt>Objective coverage</dt>
            <dd>
              {summary.coverage.percentage === null
                ? "No objectives yet"
                : `${summary.coverage.percentage}%`}
            </dd>
          </div>
          <div className="meta-item">
            <dt>Accuracy</dt>
            <dd>{describeAccuracy(summary.accuracy)}</dd>
          </div>
        </dl>
      )}

      <div className="section-actions">
        <Link
          className="button-quiet"
          href={`/study/new?track=${summary.track.slug}`}
        >
          Study {summary.track.name}
        </Link>
      </div>
    </li>
  );
}

/**
 * Accuracy in words.
 *
 * Says "not attempted yet" rather than "0% correct" when there is no evidence, so the
 * page never reports a measurement it does not have.
 */
export function describeAccuracy(accuracy: AccuracyView): string {
  return accuracy.percentage === null
    ? "Not attempted yet"
    : `${accuracy.percentage}% correct of ${accuracy.attemptCount} answered`;
}

/**
 * A streak in words, including the honest zero.
 *
 * Zero is a real answer here — there is no live streak — unlike an accuracy of zero,
 * which would be a measurement standing in for no measurement.
 */
export function describeStreak(days: number): string {
  return days === 0
    ? "No current streak"
    : `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Recorded answering time, labelled for what it is.
 *
 * "Time answering", not "study time": the sum is over the per-question timers the
 * answer form reports, so it excludes reading explanations, reviewing cards, and any
 * attempt whose page was restored from history and carried no timing. The count of
 * untimed answers is shown beside it rather than filled in with an average, so the
 * figure stays a floor the owner can trust instead of an estimate
 * (`spec/UI-GUIDELINES.md` section 1.4).
 */
export function describeAnsweringTime(activity: StudyActivityView): string {
  const measured = describeDuration(activity.answeringSeconds);

  return activity.untimedAttempts === 0
    ? measured
    : `${measured} (${activity.untimedAttempts} answer${
        activity.untimedAttempts === 1 ? "" : "s"
      } untimed)`;
}

/** Whole minutes, or hours and minutes once there are enough of them. */
export function describeDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes} min`;
  }

  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
