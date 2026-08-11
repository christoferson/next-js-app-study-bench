import type { IsoTimestamp } from "@/platform/clock";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import type { ObjectiveId } from "@/modules/certifications/domain/objective";
import type {
  Question,
  QuestionId,
  QuestionLifecycleStatus,
  QuestionQualityStatus,
  QuestionRevision,
  QuestionRevisionId,
  QuestionType,
  QuestionWithRevision,
} from "@/modules/question-bank/domain/question";

/**
 * Persistence port for the question bank.
 *
 * The methods describe the access patterns the application actually needs. No
 * SQL, query builder, or database row crosses this boundary
 * (`spec/ARCHITECTURE.md` section 5.1).
 *
 * There is deliberately no method that updates a revision. Revisions are
 * append-only (`spec/DOMAIN-RULES.md` section 1.1), so the absence of the method
 * is the enforcement: no caller can rewrite history even by mistake.
 */

/** Bank search filters. Every field is optional; omitted means "any". */
export interface QuestionSearchCriteria {
  readonly certificationId: CertificationId;
  readonly lifecycleStatus?: QuestionLifecycleStatus;
  readonly qualityStatus?: QuestionQualityStatus;
  readonly questionType?: QuestionType;
  readonly objectiveId?: ObjectiveId;
  /** Case-insensitive substring match against the current revision's stem. */
  readonly stemContains?: string;
  /** Maximum rows to return. Required: the bank must never be read unbounded. */
  readonly limit: number;
  readonly offset: number;
}

/** One bounded page of results plus the total that matched. */
export interface QuestionSearchPage {
  readonly items: readonly QuestionWithRevision[];
  /** Total matching questions, so the view can show "showing x of y". */
  readonly totalCount: number;
  readonly limit: number;
  readonly offset: number;
}

/** Per-lifecycle totals for one certification, for the bank summary line. */
export interface QuestionBankCounts {
  readonly total: number;
  readonly active: number;
}

/**
 * Candidate query for session composition (`SPEC.md` section 8.5).
 *
 * Several tracks in one call because a mixed-track session composes from all of
 * them at once, and asking per track would make the composer's ordering depend on
 * how many queries it happened to run.
 */
export interface StudyCandidateCriteria {
  readonly certificationIds: readonly CertificationId[];
  /**
   * Maximum rows. Required: the bank must never be read unbounded, and session
   * composition is no exception (`spec/ARCHITECTURE.md` section 8).
   */
  readonly limit: number;
}

/**
 * A question that is eligible to be studied.
 *
 * Carries the current revision identifier so the caller can freeze it into a
 * session item without a second read (`spec/DOMAIN-RULES.md` section 2.3), and the
 * objective mappings so the composer can reason about coverage without one query
 * per question.
 */
export interface QuestionCandidate {
  readonly questionId: QuestionId;
  readonly questionRevisionId: QuestionRevisionId;
  readonly certificationId: CertificationId;
  readonly objectiveIds: readonly ObjectiveId[];
  readonly questionType: QuestionType;
  readonly difficulty: number | null;
  readonly createdAt: IsoTimestamp;
}

export interface QuestionRepository {
  findById(id: QuestionId): Promise<Question | null>;
  /** The root together with its current revision, or `null` if unknown. */
  findWithCurrentRevision(id: QuestionId): Promise<QuestionWithRevision | null>;
  /** Every revision of one question, revision number ascending. */
  listRevisions(id: QuestionId): Promise<QuestionRevision[]>;
  findRevision(
    id: QuestionId,
    revisionNumber: number,
  ): Promise<QuestionRevision | null>;
  /** Bounded bank query. `criteria.limit` is always applied. */
  search(criteria: QuestionSearchCriteria): Promise<QuestionSearchPage>;
  countsByCertification(
    certificationId: CertificationId,
  ): Promise<QuestionBankCounts>;
  /**
   * Questions that may appear in a study session, in a deterministic order.
   *
   * Eligibility is applied in SQL rather than by the caller, so ineligible content
   * is never fetched at all: only `ACTIVE` questions whose quality is not
   * `DISPUTED` are returned, which is `isStudyEligible` expressed as a query
   * (`SPEC.md` section 6.6 — avoid retired and archived items, exclude disputed
   * questions by default). Bounded by `criteria.limit`.
   */
  findStudyCandidates(
    criteria: StudyCandidateCriteria,
  ): Promise<QuestionCandidate[]>;
  /**
   * How many questions of one track are eligible to be studied.
   *
   * Backs the diagnostic-availability check and the progress dashboard's active
   * bank count without fetching the candidates themselves.
   */
  countStudyCandidates(certificationId: CertificationId): Promise<number>;

  /**
   * Inserts a new root together with its first revision.
   *
   * Both rows are written by one call because a root without a revision is not a
   * valid aggregate; callers run it inside a unit of work.
   */
  create(question: Question, revision: QuestionRevision): Promise<void>;
  /**
   * Appends a revision and points the root at it.
   *
   * Fails if `revision.revisionNumber` already exists for the question, so a
   * concurrent edit cannot silently overwrite a revision.
   */
  appendRevision(
    revision: QuestionRevision,
    occurredAt: IsoTimestamp,
  ): Promise<void>;
  setLifecycleStatus(
    id: QuestionId,
    status: QuestionLifecycleStatus,
    occurredAt: IsoTimestamp,
  ): Promise<void>;
  /** Sets the quality status and the dispute reason together. */
  setQualityStatus(
    id: QuestionId,
    status: QuestionQualityStatus,
    disputeReason: string | null,
    occurredAt: IsoTimestamp,
  ): Promise<void>;
  /** Removes the root, all of its revisions, and all of its objective links. */
  delete(id: QuestionId): Promise<void>;

  listObjectiveLinks(id: QuestionId): Promise<ObjectiveId[]>;
  /** Replaces the whole mapping set for one question. */
  replaceObjectiveLinks(
    id: QuestionId,
    objectiveIds: readonly ObjectiveId[],
    occurredAt: IsoTimestamp,
  ): Promise<void>;
}
