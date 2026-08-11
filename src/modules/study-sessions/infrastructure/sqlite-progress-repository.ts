import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import type { ObjectiveId } from "@/modules/certifications/domain/objective";
import type {
  BankItemCounts,
  CalibrationTotals,
  ObjectiveAccuracyRow,
  ProgressRepository,
  QuestionTypeAccuracy,
  RecentMistake,
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

  async calibration(): Promise<CalibrationTotals[]> {
    const rows = this.database
      .prepare(
        `SELECT confidence,
                COUNT(*) AS attempt_count,
                SUM(is_correct) AS correct_count
         FROM question_attempts
         GROUP BY confidence`,
      )
      .all() as TotalsRow<{ readonly confidence: string }>[];

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
  async recentMistakes(limit: number): Promise<RecentMistake[]> {
    const rows = this.database
      .prepare(
        `SELECT a.id AS attempt_id, a.question_id AS question_id,
                q.certification_id AS certification_id, r.stem AS stem,
                a.confidence AS confidence, a.attempted_at AS attempted_at
         FROM question_attempts a
         JOIN questions q ON q.id = a.question_id
         JOIN question_revisions r ON r.id = a.question_revision_id
         WHERE a.is_correct = 0
         ORDER BY a.attempted_at DESC, a.id DESC
         LIMIT @limit`,
      )
      .all({ limit }) as {
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
