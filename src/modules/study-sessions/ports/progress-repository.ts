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
  /** One row per confidence level that has been used at least once. */
  calibration(): Promise<CalibrationTotals[]>;
  /** Recent incorrect answers, most recent first, bounded. */
  recentMistakes(limit: number): Promise<RecentMistake[]>;
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
