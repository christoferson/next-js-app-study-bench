import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import type { ObjectiveId } from "@/modules/certifications/domain/objective";
import type {
  BankItemCounts,
  CalibrationTotals,
  ObjectiveAccuracyRow,
  ObjectiveRollupRow,
  ProgressRepository,
  QuestionTypeAccuracy,
  RecentAccuracy,
  RecentMistake,
  StudyActivity,
  StudyActivityCriteria,
  TrackAccuracy,
} from "@/modules/study-sessions/ports/progress-repository";
import { toQuestionType } from "@/modules/question-bank/infrastructure/rows";
import { toConfidence } from "./rows";

/**
 * SQLite-backed progress reporting.
 *
 * Every method is one bounded aggregate query. There is no cache: the figures are
 * counted from the attempts table on each request, so the dashboard cannot show a
 * stale accuracy that disagrees with the bank.
 *
 * The queries deliberately join attempts to `question_revisions` on the revision
 * the attempt names, not on the question's current revision. Progress must report
 * what the owner actually answered: after an edit, an attempt against revision 1 is
 * still evidence about revision 1's question type and wording.
 */
export class SqliteProgressRepository implements ProgressRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async accuracyByTrack(): Promise<TrackAccuracy[]> {
    const rows = this.database
      .prepare(
        `SELECT q.certification_id AS certification_id,
                COUNT(*) AS attempt_count,
                SUM(a.is_correct) AS correct_count
         FROM question_attempts a
         JOIN questions q ON q.id = a.question_id
         GROUP BY q.certification_id
         ORDER BY q.certification_id ASC`,
      )
      .all() as TotalsRow<{ readonly certification_id: string }>[];

    return rows.map((row) => ({
      certificationId: row.certification_id,
      ...totals(row),
    }));
  }

  /**
   * Accuracy per objective within one track.
   *
   * An attempt counts towards every objective its question is mapped to, so the
   * summed attempt counts can exceed the number of answers given. That is the
   * intended reading: one answer is evidence about each objective it covers.
   */
  async accuracyByObjective(
    certificationId: CertificationId,
  ): Promise<ObjectiveAccuracyRow[]> {
    const rows = this.database
      .prepare(
        `SELECT l.objective_id AS objective_id,
                COUNT(*) AS attempt_count,
                SUM(a.is_correct) AS correct_count
         FROM question_attempts a
         JOIN questions q ON q.id = a.question_id
         JOIN question_objective_links l ON l.question_id = a.question_id
         JOIN certification_objectives o ON o.id = l.objective_id
         WHERE q.certification_id = ?
         GROUP BY l.objective_id
         ORDER BY o.display_order ASC, o.id ASC`,
      )
      .all(certificationId) as TotalsRow<{ readonly objective_id: string }>[];

    return rows.map((row) => ({
      objectiveId: row.objective_id,
      ...totals(row),
    }));
  }

  async accuracyByQuestionType(
    certificationId: CertificationId,
  ): Promise<QuestionTypeAccuracy[]> {
    const rows = this.database
      .prepare(
        `SELECT r.question_type AS question_type,
                COUNT(*) AS attempt_count,
                SUM(a.is_correct) AS correct_count
         FROM question_attempts a
         JOIN questions q ON q.id = a.question_id
         JOIN question_revisions r ON r.id = a.question_revision_id
         WHERE q.certification_id = ?
         GROUP BY r.question_type
         ORDER BY r.question_type ASC`,
      )
      .all(certificationId) as TotalsRow<{ readonly question_type: string }>[];

    return rows.map((row) => ({
      questionType: toQuestionType(row.question_type),
      ...totals(row),
    }));
  }

  /**
   * Active questions and attempted questions per root objective.
   *
   * The recursive CTE walks each root down to its leaves, so a question mapped to a
   * nested task is counted in the domain that contains it — the owner reads progress
   * by domain, and a domain with only leaf-level mappings would otherwise report
   * zero questions.
   *
   * `COUNT(DISTINCT q.id)` rather than `COUNT(*)`: a question mapped to two
   * objectives inside the same root is one question in that root, not two. The
   * accuracy counts come from a separate subquery over distinct attempts for the
   * same reason — joining links and attempts in one pass would multiply an attempt
   * by the number of the root's objectives its question touches.
   */
  async objectiveRollup(
    certificationId: CertificationId,
  ): Promise<ObjectiveRollupRow[]> {
    const rows = this.database
      .prepare(
        `WITH RECURSIVE subtree(root_id, objective_id) AS (
           SELECT o.id, o.id
           FROM certification_objectives o
           WHERE o.certification_id = @id AND o.parent_objective_id IS NULL
           UNION ALL
           SELECT s.root_id, c.id
           FROM subtree s
           JOIN certification_objectives c ON c.parent_objective_id = s.objective_id
         ),
         mapped(root_id, question_id) AS (
           SELECT DISTINCT s.root_id, q.id
           FROM subtree s
           JOIN question_objective_links l ON l.objective_id = s.objective_id
           JOIN questions q ON q.id = l.question_id
           WHERE q.certification_id = @id
             AND q.lifecycle_status = 'ACTIVE'
             AND q.quality_status <> 'DISPUTED'
         )
         SELECT r.id AS objective_id,
                (SELECT COUNT(*) FROM mapped m WHERE m.root_id = r.id)
                  AS question_count,
                (SELECT COUNT(*) FROM mapped m
                  WHERE m.root_id = r.id
                    AND EXISTS (SELECT 1 FROM question_attempts a
                                 WHERE a.question_id = m.question_id))
                  AS attempted_question_count,
                (SELECT COUNT(*) FROM question_attempts a
                  JOIN mapped m ON m.question_id = a.question_id
                  WHERE m.root_id = r.id) AS attempt_count,
                (SELECT COUNT(*) FROM question_attempts a
                  JOIN mapped m ON m.question_id = a.question_id
                  WHERE m.root_id = r.id AND a.is_correct = 1) AS correct_count
         FROM certification_objectives r
         WHERE r.certification_id = @id
           AND r.parent_objective_id IS NULL
           AND r.status = 'ACTIVE'
         ORDER BY r.display_order ASC, r.id ASC`,
      )
      .all({ id: certificationId }) as TotalsRow<{
      readonly objective_id: string;
      readonly question_count: number;
      readonly attempted_question_count: number;
    }>[];

    return rows.map((row) => ({
      objectiveId: row.objective_id,
      questionCount: row.question_count,
      attemptedQuestionCount: row.attempted_question_count,
      ...totals(row),
    }));
  }

  async calibration(
    certificationId?: CertificationId,
  ): Promise<CalibrationTotals[]> {
    const rows = this.database
      .prepare(
        `SELECT a.confidence AS confidence,
                COUNT(*) AS attempt_count,
                SUM(a.is_correct) AS correct_count
         FROM question_attempts a
         JOIN questions q ON q.id = a.question_id
         WHERE (@id IS NULL OR q.certification_id = @id)
         GROUP BY a.confidence`,
      )
      .all({ id: certificationId ?? null }) as TotalsRow<{
      readonly confidence: string;
    }>[];

    return rows.map((row) => ({
      confidence: toConfidence(row.confidence),
      ...totals(row),
    }));
  }

  /**
   * Recent incorrect answers.
   *
   * The stem comes from the answered revision, so the list still reads correctly
   * after the question has been edited or retired.
   */
  async recentMistakes(
    limit: number,
    certificationId?: CertificationId,
  ): Promise<RecentMistake[]> {
    const rows = this.database
      .prepare(
        `SELECT a.id AS attempt_id, a.question_id AS question_id,
                q.certification_id AS certification_id, r.stem AS stem,
                a.confidence AS confidence, a.attempted_at AS attempted_at
         FROM question_attempts a
         JOIN questions q ON q.id = a.question_id
         JOIN question_revisions r ON r.id = a.question_revision_id
         WHERE a.is_correct = 0
           AND (@id IS NULL OR q.certification_id = @id)
         ORDER BY a.attempted_at DESC, a.id DESC
         LIMIT @limit`,
      )
      .all({ limit, id: certificationId ?? null }) as {
      readonly attempt_id: string;
      readonly question_id: string;
      readonly certification_id: string;
      readonly stem: string;
      readonly confidence: string;
      readonly attempted_at: string;
    }[];

    return rows.map((row) => ({
      attemptId: row.attempt_id,
      questionId: row.question_id,
      certificationId: row.certification_id,
      stem: row.stem,
      confidence: toConfidence(row.confidence),
      attemptedAt: row.attempted_at,
    }));
  }

  /**
   * Objectives of one track with no attempt against them.
   *
   * `NOT EXISTS` rather than a left join with a null test, so an objective mapped
   * to several attempted questions cannot slip through on one unmatched row.
   */
  async unseenObjectives(
    certificationId: CertificationId,
  ): Promise<ObjectiveId[]> {
    const rows = this.database
      .prepare(
        `SELECT o.id AS objective_id
         FROM certification_objectives o
         WHERE o.certification_id = ?
           AND NOT EXISTS (
             SELECT 1
             FROM question_objective_links l
             JOIN question_attempts a ON a.question_id = l.question_id
             WHERE l.objective_id = o.id
           )
         ORDER BY o.display_order ASC, o.id ASC`,
      )
      .all(certificationId) as { readonly objective_id: string }[];

    return rows.map((row) => row.objective_id);
  }

  async bankCounts(certificationId: CertificationId): Promise<BankItemCounts> {
    const row = this.database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM questions
             WHERE certification_id = @id AND lifecycle_status = 'ACTIVE'
               AND quality_status <> 'DISPUTED') AS active_questions,
           (SELECT COUNT(*) FROM questions
             WHERE certification_id = @id AND quality_status = 'DISPUTED')
             AS disputed_questions,
           (SELECT COUNT(*) FROM flashcards
             WHERE certification_id = @id AND lifecycle_status = 'ACTIVE')
             AS active_flashcards`,
      )
      .get({ id: certificationId }) as
      | {
          readonly active_questions: number;
          readonly disputed_questions: number;
          readonly active_flashcards: number;
        }
      | undefined;

    return {
      activeQuestions: row?.active_questions ?? 0,
      disputedQuestions: row?.disputed_questions ?? 0,
      activeFlashcards: row?.active_flashcards ?? 0,
    };
  }

  /**
   * Timing and activity dates, over attempts and card reviews together.
   *
   * Dates are taken with `substr(timestamp, 1, 10)` rather than SQLite's `date()`:
   * the stored values are ISO-8601 UTC with a `Z` suffix, and the first ten
   * characters of that are the UTC date by definition, whereas `date()` depends on
   * the SQLite build's tolerance for the suffix. Everything the application writes
   * goes through the same clock, so the comparison is consistent.
   *
   * `SUM(duration_seconds)` skips nulls, and `untimedAttempts` counts them, so the
   * caller can present a floor with the size of the gap rather than an average
   * standing in for measurements that were never taken.
   *
   * The streak walks a bounded list of the most recent distinct active dates rather
   * than every date the bank has ever seen; a year of dates is far more than any
   * streak the view shows.
   */
  async studyActivity(
    criteria: StudyActivityCriteria,
    certificationId?: CertificationId,
  ): Promise<StudyActivity> {
    const parameters = {
      id: certificationId ?? null,
      today: criteria.today,
      since: criteria.recentSince,
    };
    const answering = this.database
      .prepare(
        `SELECT COALESCE(SUM(a.duration_seconds), 0) AS answering_seconds,
                COALESCE(SUM(CASE WHEN a.duration_seconds IS NULL THEN 1 ELSE 0 END), 0)
                  AS untimed_attempts
         FROM question_attempts a
         JOIN questions q ON q.id = a.question_id
         WHERE (@id IS NULL OR q.certification_id = @id)`,
      )
      .get(parameters) as {
      readonly answering_seconds: number;
      readonly untimed_attempts: number;
    };
    const activity = this.database
      .prepare(
        `WITH activity(happened_at) AS (${ACTIVITY_UNION})
         SELECT COUNT(DISTINCT substr(happened_at, 1, 10)) AS active_days,
                COUNT(DISTINCT CASE
                  WHEN substr(happened_at, 1, 7) = substr(@today, 1, 7)
                  THEN substr(happened_at, 1, 10) END) AS active_days_this_month,
                COALESCE(SUM(CASE WHEN happened_at >= @since THEN 1 ELSE 0 END), 0)
                  AS recent_items,
                MAX(happened_at) AS last_studied_at
         FROM activity`,
      )
      .get(parameters) as {
      readonly active_days: number;
      readonly active_days_this_month: number;
      readonly recent_items: number;
      readonly last_studied_at: string | null;
    };
    const dates = this.database
      .prepare(
        `WITH activity(happened_at) AS (${ACTIVITY_UNION})
         SELECT DISTINCT substr(happened_at, 1, 10) AS day
         FROM activity
         ORDER BY day DESC
         LIMIT ${String(STREAK_DAY_LIMIT)}`,
      )
      .all(parameters) as { readonly day: string }[];

    return {
      answeringSeconds: answering.answering_seconds,
      untimedAttempts: answering.untimed_attempts,
      activeDays: activity.active_days,
      activeDaysThisMonth: activity.active_days_this_month,
      streakDays: countStreak(
        dates.map((row) => row.day),
        criteria.today,
      ),
      lastStudiedAt: activity.last_studied_at,
      recentItems: activity.recent_items,
    };
  }

  /**
   * Accuracy over the most recent attempts of one track.
   *
   * The window is applied in a subquery and counted outside it, so the limit selects
   * attempts rather than truncating an aggregate.
   */
  async recentAccuracy(
    certificationId: CertificationId,
    limit: number,
  ): Promise<RecentAccuracy> {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS attempt_count,
                SUM(recent.is_correct) AS correct_count
         FROM (
           SELECT a.is_correct AS is_correct
           FROM question_attempts a
           JOIN questions q ON q.id = a.question_id
           WHERE q.certification_id = @id
           ORDER BY a.attempted_at DESC, a.id DESC
           LIMIT @limit
         ) recent`,
      )
      .get({ id: certificationId, limit }) as TotalsRow<unknown>;

    return { windowSize: row.attempt_count, ...totals(row) };
  }
}

/**
 * Every recorded study event, as one timestamp column.
 *
 * `UNION ALL`, not `UNION`: the counts want every event, and de-duplication is done
 * per date by the aggregate rather than across the two tables, where an attempt and a
 * review sharing a timestamp are still two things that happened.
 *
 * Scoped by the question's or card's own track rather than by the session's tracks, so
 * a mixed session's evidence lands on the track each item came from.
 */
const ACTIVITY_UNION = `
  SELECT a.attempted_at AS happened_at
  FROM question_attempts a
  JOIN questions q ON q.id = a.question_id
  WHERE (@id IS NULL OR q.certification_id = @id)
  UNION ALL
  SELECT v.reviewed_at AS happened_at
  FROM flashcard_reviews v
  JOIN flashcards f ON f.id = v.flashcard_id
  WHERE (@id IS NULL OR f.certification_id = @id)`;

/**
 * How far back the streak read looks.
 *
 * A streak longer than a year is not a figure this page needs to distinguish from
 * "a year", and the bound keeps the read from growing with the age of the bank.
 */
const STREAK_DAY_LIMIT = 400;

/**
 * Consecutive active days ending today or yesterday.
 *
 * Yesterday counts as the end of a live streak: the owner studying every evening has
 * not broken anything by not having studied yet this morning, and a streak that
 * silently reset at midnight would be a number that punished the time of day the page
 * was opened. A gap of two or more days ends the streak, so the count stops at the
 * first missing date rather than skipping it.
 *
 * Dates arrive newest first as `YYYY-MM-DD` strings, which compare and step by day
 * without a timezone entering the calculation.
 */
export function countStreak(
  descendingDays: readonly string[],
  today: string,
): number {
  const [latest] = descendingDays;

  if (latest === undefined) {
    return 0;
  }

  const yesterday = previousDay(today);

  if (latest !== today && latest !== yesterday) {
    return 0;
  }

  let streak = 0;
  let expected = latest;

  for (const day of descendingDays) {
    if (day !== expected) {
      break;
    }

    streak += 1;
    expected = previousDay(day);
  }

  return streak;
}

/** The `YYYY-MM-DD` date one UTC day before the given one. */
function previousDay(day: string): string {
  const stepped = new Date(`${day}T00:00:00.000Z`);

  stepped.setUTCDate(stepped.getUTCDate() - 1);

  return stepped.toISOString().slice(0, 10);
}

/** A grouped row: the grouping key plus its two counts. */
type TotalsRow<Key> = Key & {
  readonly attempt_count: number;
  readonly correct_count: number | null;
};

/**
 * Converts a grouped row's counts.
 *
 * `SUM` returns null over an empty set, which `GROUP BY` cannot produce here, but
 * the fallback keeps the mapping total rather than relying on that.
 */
function totals(row: TotalsRow<unknown>): {
  readonly attemptCount: number;
  readonly correctCount: number;
} {
  return {
    attemptCount: row.attempt_count,
    correctCount: row.correct_count ?? 0,
  };
}
