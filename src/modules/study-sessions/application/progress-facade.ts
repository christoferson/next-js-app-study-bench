import type { Clock } from "@/platform/clock";
import type {
  Certification,
  CertificationId,
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

/** Everything the dashboard shows for one track. */
export interface TrackProgressView {
  readonly track: Certification;
  readonly accuracy: AccuracyView;
  readonly coverage: ObjectiveCoverageView;
  readonly objectives: readonly ObjectiveAccuracyView[];
  readonly questionTypes: readonly QuestionTypeAccuracyView[];
  readonly bank: BankItemCounts;
  readonly dueFlashcardCount: number;
}

/** The whole progress dashboard. */
export interface ProgressView {
  readonly overall: AccuracyView;
  readonly tracks: readonly TrackProgressView[];
  readonly confidence: readonly ConfidenceAccuracyView[];
  readonly recentMistakes: readonly RecentMistake[];
  readonly sessions: readonly SessionHistoryEntry[];
  /** Tracks by identifier, so the history and mistake lists can name them. */
  readonly trackNames: ReadonlyMap<CertificationId, string>;
  /** True when no attempt has ever been recorded, so the page can say so. */
  readonly empty: boolean;
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
   * The dashboard for every active track.
   *
   * The per-track reads run concurrently but each is still one bounded aggregate,
   * so the page cost grows with the number of tracks the owner keeps rather than
   * with the size of the bank.
   */
  async findProgress(): Promise<ProgressView> {
    const now = this.deps.clock.now();
    const [tracks, trackAccuracy, confidence, recentMistakes, sessions] =
      await Promise.all([
        this.deps.certifications.listActive(),
        this.deps.progress.accuracyByTrack(),
        this.deps.progress.calibration(),
        this.deps.progress.recentMistakes(RECENT_MISTAKE_LIMIT),
        this.deps.sessions.listHistory(PROGRESS_SESSION_LIMIT),
      ]);

    const trackViews = await Promise.all(
      tracks.map(async (track) => this.findTrackProgress(track, now)),
    );

    return {
      // Summed across every track that has attempts, including tracks the owner
      // has since archived: the answers were still given.
      overall: toAccuracy(sumTotals(trackAccuracy)),
      tracks: trackViews,
      confidence: toConfidenceViews(confidence),
      recentMistakes,
      sessions,
      trackNames: new Map(tracks.map((track) => [track.id, track.name])),
      empty: trackAccuracy.every((row) => row.attemptCount === 0),
    };
  }

  /**
   * The dashboard section for one track, addressed by slug.
   *
   * Returns `null` for an unknown slug so the route renders a 404 rather than an
   * empty dashboard that looks like a track with no progress.
   */
  async findTrackProgressBySlug(
    slug: CertificationSlug,
  ): Promise<TrackProgressView | null> {
    const track = await this.deps.certifications.findBySlug(slug);

    return track === null
      ? null
      : this.findTrackProgress(track, this.deps.clock.now());
  }

  /** Every measure for one track. */
  private async findTrackProgress(
    track: Certification,
    now: string,
  ): Promise<TrackProgressView> {
    const [
      objectives,
      objectiveAccuracy,
      questionTypes,
      unseen,
      bank,
      dueFlashcardCount,
    ] = await Promise.all([
      this.deps.objectives.listByCertification(track.id),
      this.deps.progress.accuracyByObjective(track.id),
      this.deps.progress.accuracyByQuestionType(track.id),
      this.deps.progress.unseenObjectives(track.id),
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

    const objectiveViews = active.map((objective) => ({
      objective,
      depth: depths.get(objective.id) ?? 0,
      unseen: unseenIds.has(objective.id),
      ...toAccuracy(
        accuracyById.get(objective.id) ?? { attemptCount: 0, correctCount: 0 },
      ),
    }));
    const coveredObjectives = active.filter(
      (objective) => !unseenIds.has(objective.id),
    ).length;

    return {
      track,
      // Summed from the objective rows would double-count a question mapped to two
      // objectives, so the track total comes from its own query.
      accuracy: toAccuracy(sumTotals(questionTypes)),
      coverage: {
        totalObjectives: active.length,
        coveredObjectives,
        unseenObjectives: active.length - coveredObjectives,
        percentage:
          active.length === 0
            ? null
            : Math.round((coveredObjectives / active.length) * 100),
      },
      objectives: objectiveViews,
      questionTypes: questionTypes.map((row) => ({
        questionType: row.questionType,
        ...toAccuracy(row),
      })),
      bank,
      dueFlashcardCount,
    };
  }
}

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
