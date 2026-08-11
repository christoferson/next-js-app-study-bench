import type { IsoTimestamp } from "@/platform/clock";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import type { ObjectiveId } from "@/modules/certifications/domain/objective";
import type { QuestionId } from "@/modules/question-bank/domain/question";
import type {
  CardType,
  Flashcard,
  FlashcardId,
  FlashcardLifecycleStatus,
  FlashcardRevision,
  FlashcardRevisionId,
  FlashcardWithRevision,
} from "@/modules/flashcards/domain/flashcard";
import type {
  RecallRating,
  ReviewSchedule,
} from "@/modules/flashcards/domain/review-scheduling";

/**
 * Persistence port for flashcards, their schedules, and their review history.
 *
 * The methods describe the access patterns the application actually needs; no
 * SQL, query builder, or database row crosses this boundary
 * (`spec/ARCHITECTURE.md` section 5.1).
 *
 * As in the question bank, there is deliberately no method that updates a
 * revision and none that updates or deletes a recorded review. Revisions are
 * append-only and reviews are historical facts
 * (`spec/DOMAIN-RULES.md` sections 1.1 and 1.4), so the absence of those methods
 * is the enforcement.
 */

/** Bank filters. Every field but the certification and bounds is optional. */
export interface FlashcardSearchCriteria {
  readonly certificationId: CertificationId;
  readonly lifecycleStatus?: FlashcardLifecycleStatus;
  readonly cardType?: CardType;
  readonly objectiveId?: ObjectiveId;
  /** Case-insensitive substring match against the current revision's text. */
  readonly textContains?: string;
  /** Maximum rows to return. Required: the bank must never be read unbounded. */
  readonly limit: number;
  readonly offset: number;
}

/** One bounded page of bank results plus the total that matched. */
export interface FlashcardSearchPage {
  readonly items: readonly FlashcardWithRevision[];
  readonly totalCount: number;
  readonly limit: number;
  readonly offset: number;
}

/** Per-lifecycle totals for one certification, for the bank summary line. */
export interface FlashcardBankCounts {
  readonly total: number;
  readonly active: number;
}

/**
 * A card selected for review: its content plus the schedule being replaced.
 *
 * `schedule` is `null` for a card that has never been reviewed, which is exactly
 * the "new card" case the scheduling strategy takes.
 */
export interface DueFlashcard {
  readonly flashcard: Flashcard;
  readonly revision: FlashcardRevision;
  readonly schedule: ReviewSchedule | null;
}

/** Due-queue query. Bounded, like every other read. */
export interface DueCardCriteria {
  readonly certificationId: CertificationId;
  /** Cards due at or before this instant are returned. */
  readonly now: IsoTimestamp;
  readonly limit: number;
}

/**
 * Due-card query across several tracks, for mixed-track session composition.
 *
 * Separate from `DueCardCriteria` rather than replacing it: the review screen is
 * always about one track, and widening its criteria to a list would let a
 * single-track view accidentally read another track's cards.
 */
export interface DueCardCandidateCriteria {
  readonly certificationIds: readonly CertificationId[];
  readonly now: IsoTimestamp;
  readonly limit: number;
}

/**
 * One recorded review.
 *
 * The interval and due date this rating produced are stored with it, so the
 * history still explains the schedule after the scheduling strategy is replaced.
 */
export interface FlashcardReviewRecord {
  readonly id: string;
  readonly flashcardId: FlashcardId;
  /** The exact revision that was on screen when the rating was given. */
  readonly flashcardRevisionId: FlashcardRevisionId;
  readonly rating: RecallRating;
  readonly reviewedAt: IsoTimestamp;
  readonly intervalMinutes: number;
  readonly dueAt: IsoTimestamp;
  readonly schedulerId: string;
}

export interface FlashcardRepository {
  findById(id: FlashcardId): Promise<Flashcard | null>;
  /** The root together with its current revision, or `null` if unknown. */
  findWithCurrentRevision(
    id: FlashcardId,
  ): Promise<FlashcardWithRevision | null>;
  /** Every revision of one card, revision number ascending. */
  listRevisions(id: FlashcardId): Promise<FlashcardRevision[]>;
  findRevision(
    id: FlashcardId,
    revisionNumber: number,
  ): Promise<FlashcardRevision | null>;
  /** Bounded bank query. `criteria.limit` is always applied. */
  search(criteria: FlashcardSearchCriteria): Promise<FlashcardSearchPage>;
  countsByCertification(
    certificationId: CertificationId,
  ): Promise<FlashcardBankCounts>;

  /**
   * Inserts a new root together with its first revision.
   *
   * Both rows are written by one call because a root without a revision is not a
   * valid aggregate; callers run it inside a unit of work.
   */
  create(flashcard: Flashcard, revision: FlashcardRevision): Promise<void>;
  /**
   * Appends a revision and points the root at it.
   *
   * Fails if `revision.revisionNumber` already exists for the card, so a
   * concurrent edit cannot silently overwrite a revision.
   */
  appendRevision(
    revision: FlashcardRevision,
    occurredAt: IsoTimestamp,
  ): Promise<void>;
  setLifecycleStatus(
    id: FlashcardId,
    status: FlashcardLifecycleStatus,
    occurredAt: IsoTimestamp,
  ): Promise<void>;

  listObjectiveLinks(id: FlashcardId): Promise<ObjectiveId[]>;
  /** Replaces the whole mapping set for one card. */
  replaceObjectiveLinks(
    id: FlashcardId,
    objectiveIds: readonly ObjectiveId[],
    occurredAt: IsoTimestamp,
  ): Promise<void>;

  /**
   * Cards that are `ACTIVE` and due at `criteria.now`, in review order.
   *
   * Draft, retired, and archived cards are never returned
   * (`SPEC.md` section 22.3). Ordering is deterministic: longest overdue first,
   * with a card that has never been reviewed ordered by when it was created, and
   * the card identifier breaking ties. Reloading the review screen therefore
   * offers the same card until it is rated.
   */
  findDueCards(criteria: DueCardCriteria): Promise<DueFlashcard[]>;
  /**
   * The same due-card selection across several tracks at once.
   *
   * Used by session composition, where a mixed-track session draws from every
   * selected track and asking per track would make the resulting order depend on
   * how many queries were run. Ordering and eligibility match `findDueCards`
   * exactly, so a card the review screen would offer is the card a session offers.
   */
  findDueCandidates(
    criteria: DueCardCandidateCriteria,
  ): Promise<DueFlashcard[]>;
  /** How many active cards are due, for the review call to action. */
  countDueCards(
    certificationId: CertificationId,
    now: IsoTimestamp,
  ): Promise<number>;

  findSchedule(id: FlashcardId): Promise<ReviewSchedule | null>;
  /**
   * Writes the card's schedule, inserting it on the first review and replacing
   * it afterwards. One row per card, so there is nothing to accumulate here: the
   * history lives in the review records.
   */
  saveSchedule(
    id: FlashcardId,
    schedule: ReviewSchedule,
    occurredAt: IsoTimestamp,
  ): Promise<void>;

  /** Appends a review record. Callers pair it with `saveSchedule` in one transaction. */
  recordReview(review: FlashcardReviewRecord): Promise<void>;
  /** Reviews of one card, most recent first, bounded by `limit`. */
  listReviews(id: FlashcardId, limit: number): Promise<FlashcardReviewRecord[]>;

  /** Cards converted from one question, for provenance and dependency checks. */
  listBySourceQuestion(questionId: QuestionId): Promise<Flashcard[]>;
}
