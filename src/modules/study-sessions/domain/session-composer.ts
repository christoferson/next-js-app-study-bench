import type { IsoTimestamp } from "@/platform/clock";
import type { ObjectiveId } from "@/modules/certifications/domain/objective";
import type {
  QuestionId,
  QuestionRevisionId,
} from "@/modules/question-bank/domain/question";
import type { FlashcardId } from "@/modules/flashcards/domain/flashcard";
import type { AnswerConfidence } from "./question-attempt";
import { isConfident } from "./question-attempt";
import type { SessionItemContent, SessionMode } from "./study-session";
import { modeIncludesFlashcards, modeIncludesQuestions } from "./study-session";

/**
 * Deterministic session composition, isolated behind a strategy
 * (`spec/ARCHITECTURE.md` section 5.3 names session-composition policy as a
 * strategy). It is pure domain logic: it takes candidate lists and returns an
 * ordered selection, so every rule is unit-testable without a database
 * (`spec/CODING-STANDARDS.md` section 1.6, `spec/TESTING.md` section 3).
 *
 * The candidate queries themselves live in the repositories — the question and
 * flashcard repositories answer "what could be studied", bounded, and the study
 * repository answers "what has been attempted". The composer never reads
 * anything; it only decides.
 *
 * It calls no model. `spec/DOMAIN-RULES.md` section 2.1 and
 * `spec/ARCHITECTURE.md` section 8 both require that starting a session does not
 * wait for Bedrock, and nothing in this file could.
 *
 * Determinism: given the same candidate lists the composer returns the same
 * ordered selection. Every comparison ends in an identifier tie-break, so no two
 * candidates can ever compare equal and no ordering depends on the order the
 * database happened to return rows in.
 */

/**
 * A question the composer is allowed to consider.
 *
 * Deliberately narrower than the row the question repository returns: these are
 * the only facts the algorithm reads, so a wider candidate satisfies it
 * structurally and no translation layer is needed. Track filtering has already
 * happened — the repository was asked for the selected tracks — so there is no
 * certification here to re-filter on, and difficulty is absent because the
 * ordering policy below is built from priority bands and staleness rather than
 * from a difficulty ramp.
 *
 * The frozen revision is carried with the candidate rather than looked up later,
 * so the revision written into the session is the one that was current when the
 * candidate was read (`spec/DOMAIN-RULES.md` section 2.3).
 */
export interface CandidateQuestion {
  readonly questionId: QuestionId;
  readonly questionRevisionId: QuestionRevisionId;
  /** Objectives this question is mapped to. Empty when it is mapped to none. */
  readonly objectiveIds: readonly ObjectiveId[];
  readonly createdAt: IsoTimestamp;
}

/**
 * A flashcard that is due for review.
 *
 * Built from the D4 due-card query, so the session offers exactly the cards the
 * review screen would offer and the two cannot disagree about what is due.
 */
export interface CandidateFlashcard {
  readonly flashcardId: FlashcardId;
  readonly flashcardRevisionId: string;
  /** `null` for a card that has never been reviewed, which is due immediately. */
  readonly dueAt: IsoTimestamp | null;
  readonly createdAt: IsoTimestamp;
}

/** What the owner's answer history says about one question. */
export interface QuestionAttemptSummary {
  readonly questionId: QuestionId;
  readonly attemptCount: number;
  readonly lastAttemptedAt: IsoTimestamp;
  readonly lastIsCorrect: boolean;
  readonly lastConfidence: AnswerConfidence;
}

/** What the owner's answer history says about one objective. */
export interface ObjectiveAccuracy {
  readonly objectiveId: ObjectiveId;
  readonly attemptCount: number;
  readonly correctCount: number;
}

/**
 * Why an item was selected, in the priority order of
 * `spec/DOMAIN-RULES.md` section 2.2.
 *
 * Recorded on the composed item so tests assert the ordering rule rather than a
 * coincidental sequence, and so the study screen can explain why an item is
 * there.
 */
export type SelectionReason =
  | "OVERDUE_FLASHCARD"
  | "CONFIDENT_BUT_INCORRECT"
  | "OTHER_INCORRECT"
  | "WEAK_OBJECTIVE"
  | "UNSEEN_OBJECTIVE"
  | "NEVER_ATTEMPTED"
  | "GENERAL_RETENTION";

/** Priority bands in selection order. Lower index is selected first. */
const REASON_ORDER: readonly SelectionReason[] = [
  "OVERDUE_FLASHCARD",
  "CONFIDENT_BUT_INCORRECT",
  "OTHER_INCORRECT",
  "WEAK_OBJECTIVE",
  "UNSEEN_OBJECTIVE",
  "NEVER_ATTEMPTED",
  "GENERAL_RETENTION",
];

export function describeSelectionReason(reason: SelectionReason): string {
  switch (reason) {
    case "OVERDUE_FLASHCARD":
      return "Due for review";
    case "CONFIDENT_BUT_INCORRECT":
      return "You were sure and wrong";
    case "OTHER_INCORRECT":
      return "You answered this incorrectly";
    case "WEAK_OBJECTIVE":
      return "Weak objective";
    case "UNSEEN_OBJECTIVE":
      return "Objective you have not studied";
    case "NEVER_ATTEMPTED":
      return "Not attempted yet";
    case "GENERAL_RETENTION":
      return "Retention practice";
  }
}

/** One selected item, in final session order. */
export interface ComposedItem {
  readonly content: SessionItemContent;
  readonly reason: SelectionReason;
}

export interface CompositionRequest {
  readonly mode: SessionMode;
  readonly targetMinutes: number;
  readonly questions: readonly CandidateQuestion[];
  readonly flashcards: readonly CandidateFlashcard[];
  readonly attempts: readonly QuestionAttemptSummary[];
  readonly objectiveAccuracy: readonly ObjectiveAccuracy[];
}

/**
 * Replaceable composition policy.
 *
 * Implementations must be pure: the same request returns the same ordered items.
 */
export interface SessionCompositionStrategy {
  /** Stable identifier, so a later policy change is visible in review. */
  readonly id: string;
  compose(request: CompositionRequest): readonly ComposedItem[];
}

/**
 * Estimated cost of one item, used to size the session.
 *
 * `SPEC.md` section 6.6 requires estimating duration rather than enforcing a
 * timer, so these numbers only decide how many items are composed; nothing
 * measures against them and nothing expires. One minute for a question and
 * twenty seconds for a flashcard are the round numbers behind "a 10-minute
 * session is about ten questions, or about thirty cards", which is the promise
 * the primary call to action makes.
 */
export const QUESTION_ESTIMATE_SECONDS = 60;
export const FLASHCARD_ESTIMATE_SECONDS = 20;

/**
 * Hard ceiling on composed items.
 *
 * The estimate already bounds a normal session; this bounds the pathological one
 * (a 240-minute flashcards-only request would otherwise compose 720 items and
 * write them all). It keeps the composition write bounded like every other query
 * (`spec/ARCHITECTURE.md` section 8).
 */
export const MAX_SESSION_ITEMS = 60;

/**
 * An objective counts as weak below this accuracy, once there is enough evidence.
 *
 * Two attempts is the minimum evidence: one incorrect answer is already covered
 * by its own higher-priority band, and calling an objective weak on the strength
 * of a single answer would crowd out genuinely unseen material.
 */
export const WEAK_OBJECTIVE_ACCURACY = 0.7;
export const WEAK_OBJECTIVE_MIN_ATTEMPTS = 2;

/**
 * What a diagnostic needs before it can be offered
 * (`SPEC.md` section 6.9: "only when enough active questions exist across
 * relevant objectives").
 *
 * Three objectives and six questions: a diagnostic exists to say which parts of
 * a syllabus are weakest, and a measurement over one or two objectives cannot
 * say that. Six questions is two per objective at the threshold, so no single
 * answer decides an objective's verdict.
 */
export const DIAGNOSTIC_MIN_OBJECTIVES = 3;
export const DIAGNOSTIC_MIN_QUESTIONS = 6;

export const DETERMINISTIC_COMPOSER_ID = "deterministic-v1";

/** A scored candidate, before the budget is applied. */
interface RankedCandidate {
  readonly content: SessionItemContent;
  readonly reason: SelectionReason;
  /** Sorted ascending within a band: oldest evidence first. */
  readonly sortKey: string;
  readonly tieBreaker: string;
  readonly estimateSeconds: number;
}

/**
 * The first composition policy.
 *
 * Selection follows `spec/DOMAIN-RULES.md` section 2.2 exactly: overdue
 * flashcards, then confident-but-incorrect answers, then other incorrect
 * answers, then weak objectives, then unseen objectives, then never-attempted
 * active content, then general retention. Items are taken in that order until the
 * estimated duration reaches the requested length.
 *
 * Exclusions are applied by the repositories, which never return draft, retired,
 * archived, or disputed content, and again here for flashcards and questions that
 * would otherwise appear twice.
 */
export class DeterministicSessionComposer implements SessionCompositionStrategy {
  readonly id = DETERMINISTIC_COMPOSER_ID;

  compose(request: CompositionRequest): readonly ComposedItem[] {
    const ranked =
      request.mode === "DIAGNOSTIC"
        ? rankDiagnostic(request)
        : [...rankFlashcards(request), ...rankQuestions(request)];

    return applyBudget(ranked, request.targetMinutes);
  }
}

/**
 * Whether a diagnostic can be offered for these candidates.
 *
 * Exposed separately from `compose` because the session form has to decide
 * whether to offer the option at all, and a control that starts a session and
 * then fails would be a dead control (`spec/UI-GUIDELINES.md` section 1.4).
 */
export function isDiagnosticAvailable(
  questions: readonly CandidateQuestion[],
): boolean {
  const objectives = new Set(
    questions.flatMap((candidate) => candidate.objectiveIds),
  );

  return (
    questions.length >= DIAGNOSTIC_MIN_QUESTIONS &&
    objectives.size >= DIAGNOSTIC_MIN_OBJECTIVES
  );
}

/**
 * Whether a mistake-review session can be offered for these candidates.
 *
 * Exposed for the same reason as `isDiagnosticAvailable`, and it takes the
 * candidates rather than the attempt history alone because that is what
 * composition draws from: a wrong answer to a question since retired, disputed, or
 * deleted is still history the progress page reports, but it cannot be put back in
 * front of the owner. Deciding availability from history alone would offer a mode
 * that then refuses to start.
 */
export function hasStudiableMistake(
  questions: readonly CandidateQuestion[],
  attempts: readonly QuestionAttemptSummary[],
): boolean {
  const studiable = new Set(questions.map((candidate) => candidate.questionId));

  return attempts.some(
    (summary) => !summary.lastIsCorrect && studiable.has(summary.questionId),
  );
}

/**
 * Estimated minutes for a composed list, for the session summary.
 *
 * Derived from the same per-item estimates the composer sized the session with,
 * so the screen and the composer cannot disagree.
 */
export function estimateMinutes(items: readonly ComposedItem[]): number {
  const seconds = items.reduce(
    (total, item) =>
      total +
      (item.content.itemType === "QUESTION"
        ? QUESTION_ESTIMATE_SECONDS
        : FLASHCARD_ESTIMATE_SECONDS),
    0,
  );

  return Math.max(1, Math.round(seconds / 60));
}

/**
 * Due flashcards, longest overdue first.
 *
 * A card that has never been reviewed has no due date, so it sorts by when it
 * was created — the same single ordering key the D4 due queue uses, which keeps
 * the two screens offering cards in the same order.
 */
function rankFlashcards(request: CompositionRequest): RankedCandidate[] {
  if (!modeIncludesFlashcards(request.mode)) {
    return [];
  }

  const seen = new Set<FlashcardId>();
  const ranked: RankedCandidate[] = [];

  for (const candidate of request.flashcards) {
    if (seen.has(candidate.flashcardId)) {
      continue;
    }

    seen.add(candidate.flashcardId);
    ranked.push({
      content: {
        itemType: "FLASHCARD",
        flashcardId: candidate.flashcardId,
        flashcardRevisionId: candidate.flashcardRevisionId,
      },
      reason: "OVERDUE_FLASHCARD",
      sortKey: candidate.dueAt ?? candidate.createdAt,
      tieBreaker: candidate.flashcardId,
      estimateSeconds: FLASHCARD_ESTIMATE_SECONDS,
    });
  }

  return sortRanked(ranked);
}

/**
 * Questions in priority order.
 *
 * Each candidate lands in exactly one band, so no question can be selected
 * twice. `MISTAKE_REVIEW` keeps only the two incorrect-answer bands: a mistake is
 * a recorded wrong answer, and a weak objective is a statistic rather than a
 * mistake, so including it would put never-answered questions into a session the
 * owner asked to be about their mistakes.
 */
function rankQuestions(request: CompositionRequest): RankedCandidate[] {
  if (!modeIncludesQuestions(request.mode)) {
    return [];
  }

  const summaries = new Map(
    request.attempts.map((summary) => [summary.questionId, summary]),
  );
  const accuracy = new Map(
    request.objectiveAccuracy.map((row) => [row.objectiveId, row]),
  );
  const seen = new Set<QuestionId>();
  const ranked: RankedCandidate[] = [];

  for (const candidate of request.questions) {
    if (seen.has(candidate.questionId)) {
      continue;
    }

    seen.add(candidate.questionId);

    const summary = summaries.get(candidate.questionId);
    const reason = questionReason(candidate, summary, accuracy);

    if (request.mode === "MISTAKE_REVIEW" && !isMistakeReason(reason)) {
      continue;
    }

    ranked.push({
      content: {
        itemType: "QUESTION",
        questionId: candidate.questionId,
        questionRevisionId: candidate.questionRevisionId,
      },
      reason,
      // Attempted questions sort by when they were last seen, so the stalest
      // mistake comes back first; never-attempted ones sort by age, so the bank
      // is worked through in the order it was written.
      sortKey: summary?.lastAttemptedAt ?? candidate.createdAt,
      tieBreaker: candidate.questionId,
      estimateSeconds: QUESTION_ESTIMATE_SECONDS,
    });
  }

  return sortRanked(ranked);
}

/**
 * Diagnostic selection: a spread across objectives, unseen ones first.
 *
 * Objectives are visited in a fixed order and one question is taken from each in
 * turn, so a diagnostic measures breadth instead of exhausting the first
 * objective. Unseen objectives are visited before attempted ones because the
 * point of a diagnostic is to find out about material the owner has no evidence
 * for; `spec/DOMAIN-RULES.md` section 2.5 then treats whatever is skipped as new.
 *
 * Questions mapped to no objective are offered last: they cannot contribute to
 * objective coverage, but excluding them entirely would waste bank content when a
 * track has few mappings.
 */
function rankDiagnostic(request: CompositionRequest): RankedCandidate[] {
  const accuracy = new Map(
    request.objectiveAccuracy.map((row) => [row.objectiveId, row]),
  );
  const byObjective = new Map<ObjectiveId, CandidateQuestion[]>();
  const unmapped: CandidateQuestion[] = [];
  const claimed = new Set<QuestionId>();

  for (const candidate of dedupeQuestions(request.questions)) {
    if (candidate.objectiveIds.length === 0) {
      unmapped.push(candidate);
      continue;
    }

    // A question mapped to several objectives is filed under its
    // lowest-identifier objective only, so the round robin cannot offer it twice.
    const objectiveId = [...candidate.objectiveIds].sort()[0] as ObjectiveId;
    const bucket = byObjective.get(objectiveId) ?? [];

    bucket.push(candidate);
    byObjective.set(objectiveId, bucket);
  }

  const objectiveIds = [...byObjective.keys()].sort((left, right) => {
    const leftSeen = (accuracy.get(left)?.attemptCount ?? 0) > 0;
    const rightSeen = (accuracy.get(right)?.attemptCount ?? 0) > 0;

    if (leftSeen !== rightSeen) {
      return leftSeen ? 1 : -1;
    }

    return left < right ? -1 : 1;
  });

  for (const [objectiveId, bucket] of byObjective) {
    byObjective.set(
      objectiveId,
      [...bucket].sort((left, right) =>
        left.createdAt === right.createdAt
          ? compareText(left.questionId, right.questionId)
          : compareText(left.createdAt, right.createdAt),
      ),
    );
  }

  const ranked: RankedCandidate[] = [];
  let round = 0;
  let added = true;

  while (added && ranked.length < MAX_SESSION_ITEMS) {
    added = false;

    for (const objectiveId of objectiveIds) {
      const candidate = (byObjective.get(objectiveId) ?? [])[round];

      if (candidate === undefined || claimed.has(candidate.questionId)) {
        continue;
      }

      claimed.add(candidate.questionId);
      added = true;
      ranked.push(
        diagnosticItem(
          candidate,
          (accuracy.get(objectiveId)?.attemptCount ?? 0) > 0
            ? "GENERAL_RETENTION"
            : "UNSEEN_OBJECTIVE",
        ),
      );
    }

    round += 1;
  }

  for (const candidate of unmapped) {
    ranked.push(diagnosticItem(candidate, "GENERAL_RETENTION"));
  }

  // Already in deliberate round-robin order: sorting it again would collapse the
  // spread back into one objective at a time.
  return ranked;
}

function diagnosticItem(
  candidate: CandidateQuestion,
  reason: SelectionReason,
): RankedCandidate {
  return {
    content: {
      itemType: "QUESTION",
      questionId: candidate.questionId,
      questionRevisionId: candidate.questionRevisionId,
    },
    reason,
    sortKey: candidate.createdAt,
    tieBreaker: candidate.questionId,
    estimateSeconds: QUESTION_ESTIMATE_SECONDS,
  };
}

/** Which band one question belongs to. */
function questionReason(
  candidate: CandidateQuestion,
  summary: QuestionAttemptSummary | undefined,
  accuracy: ReadonlyMap<ObjectiveId, ObjectiveAccuracy>,
): SelectionReason {
  if (summary !== undefined && !summary.lastIsCorrect) {
    return isConfident(summary.lastConfidence)
      ? "CONFIDENT_BUT_INCORRECT"
      : "OTHER_INCORRECT";
  }

  if (candidate.objectiveIds.some((id) => isWeakObjective(accuracy.get(id)))) {
    return "WEAK_OBJECTIVE";
  }

  if (
    candidate.objectiveIds.length > 0 &&
    candidate.objectiveIds.every(
      (id) => (accuracy.get(id)?.attemptCount ?? 0) === 0,
    )
  ) {
    return "UNSEEN_OBJECTIVE";
  }

  return summary === undefined ? "NEVER_ATTEMPTED" : "GENERAL_RETENTION";
}

function isWeakObjective(row: ObjectiveAccuracy | undefined): boolean {
  return (
    row !== undefined &&
    row.attemptCount >= WEAK_OBJECTIVE_MIN_ATTEMPTS &&
    row.correctCount / row.attemptCount < WEAK_OBJECTIVE_ACCURACY
  );
}

function isMistakeReason(reason: SelectionReason): boolean {
  return reason === "CONFIDENT_BUT_INCORRECT" || reason === "OTHER_INCORRECT";
}

function dedupeQuestions(
  candidates: readonly CandidateQuestion[],
): CandidateQuestion[] {
  const seen = new Set<QuestionId>();

  return candidates.filter((candidate) => {
    if (seen.has(candidate.questionId)) {
      return false;
    }

    seen.add(candidate.questionId);

    return true;
  });
}

/** Band first, then the band's own key, then the identifier. */
function sortRanked(ranked: readonly RankedCandidate[]): RankedCandidate[] {
  return [...ranked].sort((left, right) => {
    const byBand =
      REASON_ORDER.indexOf(left.reason) - REASON_ORDER.indexOf(right.reason);

    if (byBand !== 0) {
      return byBand;
    }

    return left.sortKey === right.sortKey
      ? compareText(left.tieBreaker, right.tieBreaker)
      : compareText(left.sortKey, right.sortKey);
  });
}

/**
 * Takes items until the estimated duration reaches the requested length.
 *
 * At least one item is always composed when anything is available: a session the
 * owner asked for should not open empty because the first candidate happened to
 * cost more than the budget.
 */
function applyBudget(
  ranked: readonly RankedCandidate[],
  targetMinutes: number,
): readonly ComposedItem[] {
  const budgetSeconds = Math.max(1, targetMinutes) * 60;
  const items: ComposedItem[] = [];
  let spent = 0;

  for (const candidate of ranked) {
    if (items.length >= MAX_SESSION_ITEMS) {
      break;
    }

    if (items.length > 0 && spent + candidate.estimateSeconds > budgetSeconds) {
      break;
    }

    spent += candidate.estimateSeconds;
    items.push({ content: candidate.content, reason: candidate.reason });
  }

  return items;
}

/** Explicit text comparison, so ordering never depends on the host locale. */
function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}
