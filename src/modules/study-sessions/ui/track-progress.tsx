import Link from "next/link";
import {
  CollapsibleSection,
  openWhenShort,
} from "@/shared/ui/collapsible-section";
import { describeQuestionType } from "@/modules/question-bank/domain/question";
import type {
  AccuracyTrendView,
  ObjectiveRollupView,
  TrackProgressView,
} from "@/modules/study-sessions/application/progress-facade";
import {
  RECENT_ACTIVITY_DAYS,
  TREND_MINIMUM_ATTEMPTS,
} from "@/modules/study-sessions/application/progress-facade";
import {
  describeCalibrationBand,
  describeCalibrationMeaning,
  describeConfidence,
} from "@/modules/study-sessions/domain/question-attempt";
import { describeSessionMode } from "@/modules/study-sessions/domain/study-session";
import {
  describeAccuracy,
  describeAnsweringTime,
  describeStreak,
} from "./progress-dashboard";

interface TrackProgressProps {
  readonly view: TrackProgressView;
}

/**
 * One track's progress in detail (`SPEC.md` section 6.8).
 *
 * The shape is a headline row the owner reads every time, then sections they open when
 * they want them. Objectives are shown by domain — the root objectives — with the
 * child objectives one press away, because "which domain am I weak in" is the question
 * asked on the way into a session and the nested task list is what made the old
 * dashboard unreadable.
 *
 * Still evidence only: counted answers, counted dates, and a trend that is the
 * difference between two measured accuracies. No pass probability, no readiness score,
 * and nothing extrapolated (`SPEC.md` section 6.8).
 */
export function TrackProgress({ view }: TrackProgressProps) {
  const unseen = view.roots.filter((root) => root.attemptedQuestionCount === 0);

  return (
    <>
      <section className="section">
        <h2 className="section-heading">Where you are</h2>
        <dl className="meta">
          <div className="meta-item">
            <dt>Time answering</dt>
            <dd>{describeAnsweringTime(view.activity)}</dd>
          </div>
          <div className="meta-item">
            <dt>Last studied</dt>
            <dd>{view.activity.lastStudiedAt?.slice(0, 10) ?? "Never"}</dd>
          </div>
          <div className="meta-item">
            <dt>Days active</dt>
            <dd>{view.activity.activeDays}</dd>
          </div>
          <div className="meta-item">
            <dt>Streak</dt>
            <dd>{describeStreak(view.activity.streakDays)}</dd>
          </div>
          <div className="meta-item">
            <dt>Accuracy</dt>
            <dd>{describeAccuracy(view.accuracy)}</dd>
          </div>
          <div className="meta-item">
            <dt>Recent answers</dt>
            <dd>{describeTrend(view.trend)}</dd>
          </div>
          <div className="meta-item">
            <dt>Objective coverage</dt>
            <dd>
              {view.coverage.percentage === null
                ? "No objectives yet"
                : `${view.coverage.coveredObjectives} of ${view.coverage.totalObjectives} (${view.coverage.percentage}%)`}
            </dd>
          </div>
          <div className="meta-item">
            <dt>Cards due</dt>
            <dd>{view.dueFlashcardCount}</dd>
          </div>
          <div className="meta-item">
            <dt>Items in the last {RECENT_ACTIVITY_DAYS} days</dt>
            <dd>{view.activity.recentItems}</dd>
          </div>
          {view.bank.disputedQuestions > 0 ? (
            <div className="meta-item">
              <dt>Disputed questions</dt>
              <dd>
                {view.bank.disputedQuestions} (kept out of study until resolved)
              </dd>
            </div>
          ) : null}
        </dl>

        <div className="section-actions">
          <Link className="button" href={`/study/new?track=${view.track.slug}`}>
            Study {view.track.name}
          </Link>
        </div>
      </section>

      <section className="section">
        <h2 className="section-heading">Progress by domain</h2>
        {view.roots.length === 0 ? (
          <p className="empty-state">
            This track has no objectives yet, so there is nothing to break
            progress down by.
          </p>
        ) : (
          <>
            <p className="section-note">
              Each domain counts every active question mapped to it or to
              anything beneath it. Open one to see its objectives.
            </p>
            <ul className="card-list">
              {view.roots.map((root) => (
                <DomainRow key={root.objective.id} root={root} />
              ))}
            </ul>
          </>
        )}
        {unseen.length > 0 ? (
          <p className="section-note">
            {unseen.length} domain{unseen.length === 1 ? "" : "s"} of this track
            {unseen.length === 1 ? " has" : " have"} no answers yet. A session
            prioritises these before revisiting what you already know.
          </p>
        ) : null}
      </section>

      {view.questionTypes.length > 0 ? (
        <CollapsibleSection
          id="question-types"
          open={false}
          title="Accuracy by question type"
        >
          <ul className="card-list">
            {view.questionTypes.map((row) => (
              <li className="card" key={row.questionType}>
                <div className="card-heading">
                  <h3 className="card-title">
                    {describeQuestionType(row.questionType)}
                  </h3>
                  <span className="badge">{describeAccuracy(row)}</span>
                </div>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      ) : null}

      {view.confidence.length > 0 ? (
        <CollapsibleSection
          id="calibration"
          note="How often each confidence level turned out to be right. Confident and wrong is the pattern worth acting on, and those questions are prioritised in your next session."
          open={false}
          title="Confidence calibration"
        >
          <ul className="card-list">
            {view.confidence.map((row) => (
              <li className="card" key={row.confidence}>
                <div className="card-heading">
                  <h3 className="card-title">
                    {describeConfidence(row.confidence)}
                  </h3>
                  <span className="badge">
                    {row.attemptCount} answer{row.attemptCount === 1 ? "" : "s"}
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
        </CollapsibleSection>
      ) : null}

      {view.recentMistakes.length > 0 ? (
        <CollapsibleSection
          count={`${view.recentMistakes.length} listed`}
          id="recent-mistakes"
          open={openWhenShort(view.recentMistakes.length)}
          title="Recent mistakes"
        >
          <ul className="card-list">
            {view.recentMistakes.map((mistake) => (
              <li className="card" key={mistake.attemptId}>
                <p className="card-text">{mistake.stem}</p>
                <p className="question-row-meta">
                  {mistake.attemptedAt.slice(0, 10)} · you were{" "}
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
        </CollapsibleSection>
      ) : null}

      <CollapsibleSection
        count={`${view.sessions.length} listed`}
        id="session-history"
        open={openWhenShort(view.sessions.length)}
        title="Recent sessions"
      >
        {view.sessions.length === 0 ? (
          <p className="empty-state">
            No sessions recorded for this track yet.
          </p>
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
                    : `${entry.correctCount} of ${entry.attemptCount} correct`}
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
      </CollapsibleSection>
    </>
  );
}

/**
 * One domain: its rolled-up progress, with its objectives behind a disclosure.
 *
 * A `<details>` rather than a link to a third page. The child rows are a handful of
 * lines the owner glances at and folds away again, and a page transition for that
 * would cost more than it explains. The summary line carries the counts, so the row is
 * readable without opening it.
 */
function DomainRow({ root }: { readonly root: ObjectiveRollupView }) {
  const label = root.objective.code ?? root.objective.title;

  return (
    <li className="card">
      {/* Flush inside the card rather than a bordered block of its own: the card is
          already a panel, and a panel inside a panel is what the old dashboard's
          nested sections looked like. */}
      <details className="collapsible domain-row">
        <summary>
          <span className="domain-row-title">
            <span className="domain-row-label">{label}</span>
            {root.objective.code === null ? null : (
              <span className="domain-row-name">{root.objective.title}</span>
            )}
          </span>
          <span className="collapsible-count">
            {describeDomainProgress(root)}
          </span>
        </summary>
        <div className="collapsible-body">
          <ObjectiveBar root={root} />
          {root.children.length === 0 ? (
            <p className="section-note">
              This domain has no objectives under it.
            </p>
          ) : (
            <ul className="card-list objective-child-list">
              {root.children.map((child) => (
                <li className="card" key={child.objective.id}>
                  <div className="card-heading">
                    <h4 className="card-title">
                      {child.objective.code === null
                        ? child.objective.title
                        : `${child.objective.code} ${child.objective.title}`}
                    </h4>
                    <span className="badge">
                      {child.unseen
                        ? "Not studied yet"
                        : describeAccuracy(child)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </li>
  );
}

/**
 * The attempted share of a domain's questions, as a bar and as words.
 *
 * `<progress>` rather than a styled div: it is announced as a progress indicator with
 * its value, and the sentence beneath it says the same thing in text, so the bar is
 * never the only carrier of the figure (`spec/UI-GUIDELINES.md` section 1.4).
 */
function ObjectiveBar({ root }: { readonly root: ObjectiveRollupView }) {
  return (
    <div className="domain-bar">
      {root.questionCount === 0 ? null : (
        <progress
          aria-label={`Questions attempted in ${root.objective.title}`}
          max={root.questionCount}
          value={root.attemptedQuestionCount}
        />
      )}
      <p className="question-row-meta">
        {root.questionCount === 0
          ? "No active questions mapped to this domain yet."
          : `${root.attemptedQuestionCount} of ${root.questionCount} questions attempted · ${describeAccuracy(root)}`}
      </p>
    </div>
  );
}

/** A domain's headline figure for its summary line. */
function describeDomainProgress(root: ObjectiveRollupView): string {
  if (root.questionCount === 0) {
    return "No questions yet";
  }

  return root.percentage === null
    ? `0 of ${root.questionCount} attempted`
    : `${root.attemptedQuestionCount} of ${root.questionCount} attempted · ${root.percentage}% correct`;
}

/**
 * The trend in words, with the two figures it compares.
 *
 * Never a bare arrow or colour: the label is a word, and the numbers behind it are
 * printed beside it so the owner can disagree with the label. Under
 * `TREND_MINIMUM_ATTEMPTS` recent answers it says there is not enough evidence rather
 * than calling that steady.
 */
export function describeTrend(trend: AccuracyTrendView): string {
  if (trend.trend === "INSUFFICIENT") {
    return `Not enough recent answers to compare (fewer than ${TREND_MINIMUM_ATTEMPTS})`;
  }

  const word =
    trend.trend === "IMPROVING"
      ? "Improving"
      : trend.trend === "DECLINING"
        ? "Declining"
        : "Steady";

  return `${word} — last ${trend.windowSize} answers ${trend.recentPercentage ?? 0}% correct`;
}
