import type { Clock } from "@/platform/clock";
import type {
  Certification,
  CertificationSlug,
} from "@/modules/certifications/domain/certification";
import type { Objective } from "@/modules/certifications/domain/objective";
import type { CertificationRepository } from "@/modules/certifications/ports/certification-repository";
import type { ObjectiveRepository } from "@/modules/certifications/ports/objective-repository";
import type { FlashcardRepository } from "@/modules/flashcards/ports/flashcard-repository";
import type { QuestionType } from "@/modules/question-bank/domain/question";
import type { AnswerConfidence } from "@/modules/study-sessions/domain/question-attempt";
import type { CalibrationBand } from "@/modules/study-sessions/domain/question-attempt";
import { isConfident } from "@/modules/study-sessions/domain/question-attempt";
import type {
  AccuracyTotals,
  BankItemCounts,
  ProgressRepository,
  RecentMistake,
} from "@/modules/study-sessions/ports/progress-repository";
import type {
  SessionHistoryEntry,
  StudySessionRepository,
} from "@/modules/study-sessions/ports/study-session-repository";

/**
 * Progress reporting facade (`SPEC.md` section 6.8).
 *
 * Assembles the dashboard from bounded aggregate queries plus the objective trees
 * and track records the view needs to label them. Every figure is counted evidence:
 * there is no forecast, no score, and deliberately no pass probability
 * (`SPEC.md` section 6.8 forbids displaying one, and nothing in this facade or its
 * port could produce one).
 *
 * Nothing is cached. The data is small, the queries are aggregates over one SQLite
 * file, and a cached accuracy that disagreed with the bank would be worse than a
 * slightly slower page.
 */

/** How many recent mistakes the dashboard lists. */
export const RECENT_MISTAKE_LIMIT = 10;

/** How many past sessions the dashboard lists. */
export const PROGRESS_SESSION_LIMIT = 10;

/**
 * Accuracy with the percentage the view shows.
 *
 * `percentage` is `null` when nothing has been attempted, rather than 0: zero
 * attempts is not zero accuracy, and printing "0%" for unstudied material would be a
 * measurement the application does not have
 * (`spec/UI-GUIDELINES.md` section 1.4, `SPEC.md` section 6.8).
 */
export interface AccuracyView extends AccuracyTotals {
  readonly percentage: number | null;
}

/** Accuracy for one track, with the track record for labelling. */
export interface TrackAccuracyView extends AccuracyView {
  readonly track: Certification;
}

/** Accuracy for one objective, with its record and depth in the tree. */
export interface ObjectiveAccuracyView extends AccuracyView {
  readonly objective: Objective;
  readonly depth: number;
  /** True when nothing has ever been attempted against this objective. */
  readonly unseen: boolean;
}

/** Accuracy for one question type that has been answered at least once. */
export interface QuestionTypeAccuracyView extends AccuracyView {
  readonly questionType: QuestionType;
}

/** One confidence level with how often it turned out to be right. */
export interface ConfidenceAccuracyView extends AccuracyView {
  readonly confidence: AnswerConfidence;
  /** Which of the four calibration bands its correct answers fall in. */
  readonly correctBand: CalibrationBand;
  /** Which band its incorrect answers fall in. */
  readonly incorrectBand: CalibrationBand;
}

/**
 * How many objectives of a track have any evidence at all
 * (`SPEC.md` section 6.8, "objective coverage").
 *
 * Counted over active objectives only: an archived objective is not part of the
 * syllabus the owner is studying, so including it would make coverage look worse
 * than it is for a reason the owner cannot act on.
 */
export interface ObjectiveCoverageView {
  readonly totalObjectives: number;
  readonly coveredObjectives: number;
  readonly unseenObjectives: number;
  /** `null` when the track has no objectives to cover yet. */
  readonly percentage: number | null;
}

/**
 * One root objective (a domain) with its subtree rolled up, and its children.
 *
 * Coverage here counts *questions*, not objectives: a domain the owner has answered
 * two of forty questions in is barely studied, and the objective-level "covered or
 * not" flag cannot say that. The counts include every active question mapped to the
 * root or any descendant of it, each counted once per root
 * (see `ProgressRepository.objectiveRollup`).
 */
export interface ObjectiveRollupView extends AccuracyView {
  readonly objective: Objective;
  readonly questionCount: number;
  readonly attemptedQuestionCount: number;
  /** Attempted share of the root's questions; `null` when it has none. */
  readonly attemptedPercentage: number | null;
  /** Child objectives one level down, shown when the root is expanded. */
  readonly children: readonly ObjectiveAccuracyView[];
}

/**
 * Which way recent answers are going (`SPEC.md` section 6.8, evidence only).
 *
 * A comparison of two counted figures, not a forecast: `IMPROVING` means the recent
 * window scored materially better than the track's whole history, `DECLINING` worse,
 * `STEADY` neither. `INSUFFICIENT` is its own case rather than `STEADY`, because "not
 * enough answers to say" and "no change" are different statements.
 */
export type AccuracyTrend =
  "IMPROVING" | "STEADY" | "DECLINING" | "INSUFFICIENT";

/**
 * How many recent attempts the trend compares.
 *
 * Thirty is roughly two or three sessions' worth: enough that one unlucky question
 * cannot flip the label, few enough that it still describes the present.
 */
export const TREND_WINDOW = 30;

/** Fewer recent answers than this and the trend says so instead of guessing. */
export const TREND_MINIMUM_ATTEMPTS = 10;

/**
 * How many percentage points count as a real move.
 *
 * Below this the difference is inside the noise of a thirty-answer sample — at 30
 * answers one question is 3.3 points — so anything smaller is reported as steady
 * rather than dressed up as a trend.
 */
export const TREND_THRESHOLD_POINTS = 8;

/** Recent accuracy against the track's whole history. */
export interface AccuracyTrendView {
  readonly trend: AccuracyTrend;
  /** Accuracy over the recent window, `null` when the window is too small. */
  readonly recentPercentage: number | null;
  readonly windowSize: number;
  /** Recent minus overall, in points; `null` when there is nothing to compare. */
  readonly deltaPoints: number | null;
}

/** Time and dates studied, for one track or for everything. */
export interface StudyActivityView {
  readonly answeringSeconds: number;
  readonly untimedAttempts: number;
  readonly activeDays: number;
  readonly activeDaysThisMonth: number;
  readonly streakDays: number;
  readonly lastStudiedAt: string | null;
  readonly recentItems: number;
}

/** One compact card on the dashboard: enough to decide where to study next. */
export interface TrackSummaryView {
  readonly track: Certification;
  readonly accuracy: AccuracyView;
  readonly coverage: ObjectiveCoverageView;
  readonly activity: StudyActivityView;
  readonly dueFlashcardCount: number;
  /** True when this track has no attempt and no card review at all. */
  readonly unstudied: boolean;
}

/** The dashboard: one thin summary line and one card per track. */
export interface ProgressView {
  readonly overall: AccuracyView;
  readonly activity: StudyActivityView;
  readonly tracks: readonly TrackSummaryView[];
  /** True when no attempt has ever been recorded, so the page can say so. */
  readonly empty: boolean;
}

/** Everything the per-track detail page shows. */
export interface TrackProgressView {
  readonly track: Certification;
  readonly accuracy: AccuracyView;
  readonly trend: AccuracyTrendView;
  readonly activity: StudyActivityView;
  readonly coverage: ObjectiveCoverageView;
  readonly roots: readonly ObjectiveRollupView[];
  readonly questionTypes: readonly QuestionTypeAccuracyView[];
  readonly confidence: readonly ConfidenceAccuracyView[];
  readonly recentMistakes: readonly RecentMistake[];
  readonly sessions: readonly SessionHistoryEntry[];
  readonly bank: BankItemCounts;
  readonly dueFlashcardCount: number;
}

export interface ProgressFacadeDependencies {
  readonly progress: ProgressRepository;
  readonly sessions: StudySessionRepository;
  readonly certifications: CertificationRepository;
  readonly objectives: ObjectiveRepository;
  readonly flashcards: FlashcardRepository;
  readonly clock: Clock;
}

export class ProgressFacade {
  constructor(private readonly deps: ProgressFacadeDependencies) {}

  /**
   * The dashboard: one summary line and one compact card per active track.
   *
   * Deliberately thin. The previous version of this page rendered every objective,
   * every mistake, the calibration table, and the session history for every track at
   * once, which answered "how is everything going" by making the owner read
   * everything. The detail moved to `findTrackProgressBySlug`, and the dashboard now
   * carries only what is needed to choose a track to open.
   *
   * The per-track reads run concurrently and each is still one bounded aggregate, so
   * the cost grows with the number of tracks the owner keeps rather than with the size
   * of the bank.
   */
  async findProgress(): Promise<ProgressView> {
    const now = this.deps.clock.now();
    const [tracks, trackAccuracy, activity] = await Promise.all([
      this.deps.certifications.listActive(),
      this.deps.progress.accuracyByTrack(),
      this.deps.progress.studyActivity(activityCriteria(now)),
    ]);

    const summaries = await Promise.all(
      tracks.map(async (track) => this.findTrackSummary(track, now)),
    );

    return {
      // Summed across every track that has attempts, including tracks the owner
      // has since archived: the answers were still given.
      overall: toAccuracy(sumTotals(trackAccuracy)),
      activity,
      tracks: summaries,
      empty: trackAccuracy.every((row) => row.attemptCount === 0),
    };
  }

  /**
   * Everything measured for one track, addressed by slug.
   *
   * Returns `null` for an unknown slug so the route renders a 404 rather than an
   * empty page that looks like a track with no progress.
   */
  async findTrackProgressBySlug(
    slug: CertificationSlug,
  ): Promise<TrackProgressView | null> {
    const track = await this.deps.certifications.findBySlug(slug);

    return track === null
      ? null
      : this.findTrackProgress(track, this.deps.clock.now());
  }

  /** The compact card for one track. */
  private async findTrackSummary(
    track: Certification,
    now: string,
  ): Promise<TrackSummaryView> {
    const [questionTypes, objectives, unseen, activity, dueFlashcardCount] =
      await Promise.all([
        this.deps.progress.accuracyByQuestionType(track.id),
        this.deps.objectives.listByCertification(track.id),
        this.deps.progress.unseenObjectives(track.id),
        this.deps.progress.studyActivity(activityCriteria(now), track.id),
        this.deps.flashcards.countDueCards(track.id, now),
      ]);
    const accuracy = toAccuracy(sumTotals(questionTypes));

    return {
      track,
      accuracy,
      coverage: toCoverage(objectives, unseen),
      activity,
      dueFlashcardCount,
      // Nothing recorded at all, rather than nothing answered: a track studied only
      // through flashcards has been studied.
      unstudied: activity.lastStudiedAt === null,
    };
  }

  /** Every measure for one track. */
  private async findTrackProgress(
    track: Certification,
    now: string,
  ): Promise<TrackProgressView> {
    const [
      objectives,
      objectiveAccuracy,
      rollup,
      questionTypes,
      unseen,
      confidence,
      recentMistakes,
      sessions,
      activity,
      recentAccuracy,
      bank,
      dueFlashcardCount,
    ] = await Promise.all([
      this.deps.objectives.listByCertification(track.id),
      this.deps.progress.accuracyByObjective(track.id),
      this.deps.progress.objectiveRollup(track.id),
      this.deps.progress.accuracyByQuestionType(track.id),
      this.deps.progress.unseenObjectives(track.id),
      this.deps.progress.calibration(track.id),
      this.deps.progress.recentMistakes(RECENT_MISTAKE_LIMIT, track.id),
      this.deps.sessions.listHistory(PROGRESS_SESSION_LIMIT, track.id),
      this.deps.progress.studyActivity(activityCriteria(now), track.id),
      this.deps.progress.recentAccuracy(track.id, TREND_WINDOW),
      this.deps.progress.bankCounts(track.id),
      this.deps.flashcards.countDueCards(track.id, now),
    ]);

    const active = objectives.filter(
      (objective) => objective.status === "ACTIVE",
    );
    const unseenIds = new Set(unseen);
    const accuracyById = new Map(
      objectiveAccuracy.map((row) => [row.objectiveId, row]),
    );
    const depths = objectiveDepths(objectives);
    const objectiveView = (objective: Objective): ObjectiveAccuracyView => ({
      objective,
      depth: depths.get(objective.id) ?? 0,
      unseen: unseenIds.has(objective.id),
      ...toAccuracy(
        accuracyById.get(objective.id) ?? { attemptCount: 0, correctCount: 0 },
      ),
    });
    // Summed from the objective rows would double-count a question mapped to two
    // objectives, so the track total comes from its own query.
    const accuracy = toAccuracy(sumTotals(questionTypes));

    return {
      track,
      accuracy,
      trend: toTrend(accuracy, recentAccuracy),
      activity,
      coverage: toCoverage(objectives, unseen),
      roots: rollup.map((row) => {
        const objective = active.find(
          (candidate) => candidate.id === row.objectiveId,
        );

        return {
          objective: objective ?? MISSING_OBJECTIVE,
          questionCount: row.questionCount,
          attemptedQuestionCount: row.attemptedQuestionCount,
          attemptedPercentage:
            row.questionCount === 0
              ? null
              : Math.round(
                  (row.attemptedQuestionCount / row.questionCount) * 100,
                ),
          // One level down only. The domain row already carries the whole subtree's
          // counts, so a full tree here would repeat the same evidence at four
          // indents; the child rows are the useful next question ("which part of
          // this domain").
          children: active
            .filter(
              (candidate) => candidate.parentObjectiveId === row.objectiveId,
            )
            .map(objectiveView),
          ...toAccuracy(row),
        };
      }),
      questionTypes: questionTypes.map((row) => ({
        questionType: row.questionType,
        ...toAccuracy(row),
      })),
      confidence: toConfidenceViews(confidence),
      recentMistakes,
      sessions,
      bank,
      dueFlashcardCount,
    };
  }
}

/**
 * What the activity read needs to know about now.
 *
 * The recent window is a fixed number of days ending at the clock's now, so
 * "items studied" on the dashboard means the same thing on every visit.
 */
function activityCriteria(now: string): {
  readonly today: string;
  readonly recentSince: string;
} {
  const since = new Date(now);

  since.setUTCDate(since.getUTCDate() - RECENT_ACTIVITY_DAYS);

  return { today: now.slice(0, 10), recentSince: since.toISOString() };
}

/** The trailing window "items studied" counts over. */
export const RECENT_ACTIVITY_DAYS = 7;

/**
 * Objective coverage, counted over active objectives only.
 *
 * An archived objective is not part of the syllabus being studied, so including it
 * would make coverage look worse for a reason the owner cannot act on.
 */
function toCoverage(
  objectives: readonly Objective[],
  unseen: readonly string[],
): ObjectiveCoverageView {
  const active = objectives.filter(
    (objective) => objective.status === "ACTIVE",
  );
  const unseenIds = new Set(unseen);
  const coveredObjectives = active.filter(
    (objective) => !unseenIds.has(objective.id),
  ).length;

  return {
    totalObjectives: active.length,
    coveredObjectives,
    unseenObjectives: active.length - coveredObjectives,
    percentage:
      active.length === 0
        ? null
        : Math.round((coveredObjectives / active.length) * 100),
  };
}

/**
 * Recent accuracy against the track's whole history.
 *
 * Compares two counted percentages and names the difference; it does not extrapolate.
 * Under `TREND_MINIMUM_ATTEMPTS` recent answers the label is `INSUFFICIENT`, because a
 * handful of answers can swing thirty points on luck alone. The window is also
 * compared against the full history including itself, which drags the difference
 * towards zero for a small bank — a conservative bias, and the safer one for a figure
 * the owner might act on.
 */
function toTrend(
  overall: AccuracyView,
  recent: { readonly windowSize: number } & AccuracyTotals,
): AccuracyTrendView {
  const recentAccuracy = toAccuracy(recent);

  if (
    recent.windowSize < TREND_MINIMUM_ATTEMPTS ||
    overall.percentage === null ||
    recentAccuracy.percentage === null
  ) {
    return {
      trend: "INSUFFICIENT",
      recentPercentage: recentAccuracy.percentage,
      windowSize: recent.windowSize,
      deltaPoints: null,
    };
  }

  const deltaPoints = recentAccuracy.percentage - overall.percentage;

  return {
    trend:
      deltaPoints >= TREND_THRESHOLD_POINTS
        ? "IMPROVING"
        : deltaPoints <= -TREND_THRESHOLD_POINTS
          ? "DECLINING"
          : "STEADY",
    recentPercentage: recentAccuracy.percentage,
    windowSize: recent.windowSize,
    deltaPoints,
  };
}

/**
 * Stands in for a root the rollup returned but the objective list did not.
 *
 * Only reachable if the two reads disagree, which one archiving between them could
 * cause. Rendering a named placeholder is better than dropping the row's counts
 * silently or throwing on a reporting page.
 */
const MISSING_OBJECTIVE: Objective = {
  id: "",
  certificationId: "",
  parentObjectiveId: null,
  code: null,
  title: "Removed objective",
  description: null,
  weight: null,
  sourceType: "USER_DEFINED",
  displayOrder: 0,
  status: "ACTIVE",
  createdAt: "",
  updatedAt: "",
};

/** Adds the percentage the view shows, leaving it `null` with no evidence. */
function toAccuracy(totals: AccuracyTotals): AccuracyView {
  return {
    attemptCount: totals.attemptCount,
    correctCount: totals.correctCount,
    percentage:
      totals.attemptCount === 0
        ? null
        : Math.round((totals.correctCount / totals.attemptCount) * 100),
  };
}

function sumTotals(rows: readonly AccuracyTotals[]): AccuracyTotals {
  return rows.reduce<AccuracyTotals>(
    (total, row) => ({
      attemptCount: total.attemptCount + row.attemptCount,
      correctCount: total.correctCount + row.correctCount,
    }),
    { attemptCount: 0, correctCount: 0 },
  );
}

/**
 * Confidence rows in least-to-most-confident order, with their calibration bands.
 *
 * The bands come from the domain rather than being recomputed here, so the table
 * and the composer's confident-but-incorrect priority agree on where the line falls.
 */
function toConfidenceViews(
  rows: readonly (AccuracyTotals & { readonly confidence: AnswerConfidence })[],
): readonly ConfidenceAccuracyView[] {
  return [...rows]
    .sort(
      (left, right) =>
        CONFIDENCE_ORDER.indexOf(left.confidence) -
        CONFIDENCE_ORDER.indexOf(right.confidence),
    )
    .map((row) => ({
      confidence: row.confidence,
      correctBand: isConfident(row.confidence)
        ? "CORRECT_CONFIDENT"
        : "CORRECT_UNCERTAIN",
      incorrectBand: isConfident(row.confidence)
        ? "INCORRECT_CONFIDENT"
        : "INCORRECT_UNCERTAIN",
      ...toAccuracy(row),
    }));
}

const CONFIDENCE_ORDER: readonly AnswerConfidence[] = [
  "GUESS",
  "UNCERTAIN",
  "FAIRLY_SURE",
  "CONFIDENT",
];

/**
 * Depth of each objective, for the indented objective list.
 *
 * Walks parents with a visited set, so a hand-edited cycle in the database yields a
 * flat list instead of hanging the page.
 */
function objectiveDepths(
  objectives: readonly Objective[],
): ReadonlyMap<string, number> {
  const byId = new Map(
    objectives.map((objective) => [objective.id, objective]),
  );
  const depths = new Map<string, number>();

  for (const objective of objectives) {
    let depth = 0;
    let current = objective;
    const visited = new Set<string>([objective.id]);

    while (current.parentObjectiveId !== null) {
      const parent = byId.get(current.parentObjectiveId);

      if (parent === undefined || visited.has(parent.id)) {
        break;
      }

      visited.add(parent.id);
      current = parent;
      depth += 1;
    }

    depths.set(objective.id, depth);
  }

  return depths;
}
