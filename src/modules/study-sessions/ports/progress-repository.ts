import type { IsoTimestamp } from "@/platform/clock";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import type { ObjectiveId } from "@/modules/certifications/domain/objective";
import type {
  QuestionId,
  QuestionType,
} from "@/modules/question-bank/domain/question";
import type { AnswerConfidence } from "@/modules/study-sessions/domain/question-attempt";

/**
 * Read-only reporting projections for the progress dashboard
 * (`SPEC.md` section 6.8).
 *
 * A port of its own rather than more methods on `StudySessionRepository`: these
 * are aggregate `GROUP BY` reads that no write path ever uses, and keeping them
 * separate means the session repository stays about persisting one aggregate.
 *
 * Every method returns counted evidence. Nothing here estimates, forecasts, or
 * scores: `SPEC.md` section 6.8 requires progress to remain evidence-based and
 * forbids displaying a pass probability, so there is deliberately no method that
 * could produce one. Results are computed on demand and never cached — the data
 * is small, and a cached figure that disagreed with the bank would be worse than
 * a slower one.
 */

/** Correct answers out of recorded attempts, for one grouping key. */
export interface AccuracyTotals {
  readonly attemptCount: number;
  readonly correctCount: number;
}

export interface TrackAccuracy extends AccuracyTotals {
  readonly certificationId: CertificationId;
}

export interface ObjectiveAccuracyRow extends AccuracyTotals {
  readonly objectiveId: ObjectiveId;
}

export interface QuestionTypeAccuracy extends AccuracyTotals {
  /** The type of the revision that was answered, not the current one. */
  readonly questionType: QuestionType;
}

/** One confidence level with how often it was right. */
export interface CalibrationTotals extends AccuracyTotals {
  readonly confidence: AnswerConfidence;
}

/**
 * A recent incorrect answer, for "recently missed concepts".
 *
 * The stem is read from the revision the attempt names rather than the current
 * one, so the list shows what the owner actually answered even after an edit.
 */
export interface RecentMistake {
  readonly attemptId: string;
  readonly questionId: QuestionId;
  readonly certificationId: CertificationId;
  readonly stem: string;
  readonly confidence: AnswerConfidence;
  readonly attemptedAt: IsoTimestamp;
}

/** Bank composition for one track, from `SPEC.md` section 6.8. */
export interface BankItemCounts {
  readonly activeQuestions: number;
  readonly disputedQuestions: number;
  readonly activeFlashcards: number;
}

/**
 * How much studying happened, and when, for one track or for everything.
 *
 * `answeringSeconds` sums `question_attempts.duration_seconds`, which is nullable:
 * an attempt recorded from a page restored from history carries no duration. Those
 * attempts contribute nothing rather than a guessed average, so the figure is a
 * floor, not an estimate — the view labels it "time answering" and says how many
 * attempts were untimed rather than calling it total study time.
 *
 * `activeDays` counts distinct local-free UTC dates on which anything was recorded,
 * over attempts and card reviews together: a day spent only on flashcards was still
 * a day studied.
 *
 * `lastStudiedAt` is the later of the newest attempt and the newest review, or
 * `null` when neither exists.
 */
export interface StudyActivity {
  readonly answeringSeconds: number;
  /** Attempts with no recorded duration, so the sum can be labelled honestly. */
  readonly untimedAttempts: number;
  readonly activeDays: number;
  /** Distinct active dates this calendar month, for the dashboard summary. */
  readonly activeDaysThisMonth: number;
  /** Consecutive active days ending today or yesterday; 0 when neither. */
  readonly streakDays: number;
  readonly lastStudiedAt: IsoTimestamp | null;
  /** Attempts plus card reviews inside the trailing window the caller asked for. */
  readonly recentItems: number;
}

/** What the activity read needs to know about "now". */
export interface StudyActivityCriteria {
  /** Today's UTC date, `YYYY-MM-DD`, against which the streak is measured. */
  readonly today: string;
  /** Start of the trailing window for `recentItems`, as an ISO timestamp. */
  readonly recentSince: IsoTimestamp;
}

/**
 * Accuracy over the most recent attempts, for the trend line.
 *
 * Bounded by count rather than by date: "the last 30 answers" is a comparable
 * sample whether they were given in one evening or over a month, whereas "the last
 * 30 days" is empty for an owner who studied heavily and then stopped.
 */
export interface RecentAccuracy extends AccuracyTotals {
  /** How many attempts the window actually held, which may be under the limit. */
  readonly windowSize: number;
}

/** One root objective's rolled-up coverage and accuracy. */
export interface ObjectiveRollupRow extends AccuracyTotals {
  readonly objectiveId: ObjectiveId;
  /** Active questions mapped to this objective or any descendant of it. */
  readonly questionCount: number;
  /** Of those, how many have at least one recorded attempt. */
  readonly attemptedQuestionCount: number;
}

export interface ProgressRepository {
  /** Accuracy per track, over every recorded attempt. */
  accuracyByTrack(): Promise<TrackAccuracy[]>;
  /**
   * Accuracy per objective within one track.
   *
   * An attempt counts towards every objective its question is mapped to, so a
   * question spanning two objectives is evidence about both.
   */
  accuracyByObjective(
    certificationId: CertificationId,
  ): Promise<ObjectiveAccuracyRow[]>;
  accuracyByQuestionType(
    certificationId: CertificationId,
  ): Promise<QuestionTypeAccuracy[]>;
  /**
   * Active questions and attempted questions rolled up to each root objective.
   *
   * One row per root (an objective with no parent) of the track, including roots
   * with nothing under them. A question counts towards a root when it is mapped to
   * that root or to any objective beneath it, and it counts once per root however
   * many of the root's descendants it is mapped to — otherwise a question mapped to
   * two sibling tasks would look like two questions in the domain.
   */
  objectiveRollup(
    certificationId: CertificationId,
  ): Promise<ObjectiveRollupRow[]>;
  /** One row per confidence level that has been used at least once. */
  calibration(certificationId?: CertificationId): Promise<CalibrationTotals[]>;
  /** Recent incorrect answers, most recent first, bounded. */
  recentMistakes(
    limit: number,
    certificationId?: CertificationId,
  ): Promise<RecentMistake[]>;
  /**
   * Timing, active days, streak, and last activity, for one track or for all.
   *
   * Scoped by the question's own track for attempts and by the card's track for
   * reviews, rather than by the session's tracks: a mixed session's answers belong
   * to the track each question came from.
   */
  studyActivity(
    criteria: StudyActivityCriteria,
    certificationId?: CertificationId,
  ): Promise<StudyActivity>;
  /** Accuracy over the most recent `limit` attempts of one track. */
  recentAccuracy(
    certificationId: CertificationId,
    limit: number,
  ): Promise<RecentAccuracy>;
  /**
   * Objectives of one track with no recorded attempt.
   *
   * Identifiers only: the caller already holds the objective tree for display, and
   * returning names here would duplicate it.
   */
  unseenObjectives(certificationId: CertificationId): Promise<ObjectiveId[]>;
  /** Active, disputed, and card counts for one track. */
  bankCounts(certificationId: CertificationId): Promise<BankItemCounts>;
}
