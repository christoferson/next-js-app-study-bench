import type { Clock, IsoTimestamp } from "@/platform/clock";
import { MINUTES_PER_DAY, addMinutes } from "@/platform/clock";

/**
 * Review scheduling, isolated behind a strategy.
 *
 * `SPEC.md` section 6.5 requires that "the scheduling algorithm must be isolated
 * behind a strategy so it can be replaced later without changing route handlers
 * or persistence interfaces" (`spec/ARCHITECTURE.md` section 5.3). The strategy
 * therefore takes a recall rating plus the card's current schedule and returns
 * the next one; it reads no database, holds no state, and gets its time from an
 * injected clock, so every rule is unit-testable without persistence
 * (`spec/CODING-STANDARDS.md` section 1.6, `spec/TESTING.md` section 3).
 *
 * Intervals are whole minutes. The specified algorithm mixes a 10-minute step
 * with multi-day steps, so one integer unit fine enough for the smallest step
 * covers both, keeps the multipliers exact in integer arithmetic, and stores
 * without floating-point drift.
 */

/** Recall ratings from `SPEC.md` section 6.5. */
export type RecallRating = "AGAIN" | "HARD" | "GOOD" | "EASY";

export const RECALL_RATINGS: readonly RecallRating[] = [
  "AGAIN",
  "HARD",
  "GOOD",
  "EASY",
];

export function describeRating(rating: RecallRating): string {
  switch (rating) {
    case "AGAIN":
      return "Again";
    case "HARD":
      return "Hard";
    case "GOOD":
      return "Good";
    case "EASY":
      return "Easy";
  }
}

/** What each rating tells the owner it means, shown on the review buttons. */
export function describeRatingHint(rating: RecallRating): string {
  switch (rating) {
    case "AGAIN":
      return "I did not recall it";
    case "HARD":
      return "Recalled with difficulty";
    case "GOOD":
      return "Recalled correctly";
    case "EASY":
      return "Recalled immediately";
  }
}

/**
 * A card's review schedule.
 *
 * A card with no schedule is a new card: `SPEC.md` section 6.5 distinguishes
 * "new card" from "existing card", and the only honest definition of new is
 * "never reviewed". There is no schedule row until the first rating is recorded,
 * so no null-interval sentinel is needed and a card cannot look reviewed while
 * having no review history.
 */
export interface ReviewSchedule {
  readonly intervalMinutes: number;
  readonly dueAt: IsoTimestamp;
  /** How many times recall failed (`AGAIN`) since the card was created. */
  readonly lapseCount: number;
  readonly reviewCount: number;
  readonly lastReviewedAt: IsoTimestamp;
  /** Which strategy produced this schedule. */
  readonly schedulerId: string;
}

/** The strategy's input: the rating, and the schedule it is applied to. */
export interface ScheduleReviewCommand {
  readonly rating: RecallRating;
  /** `null` for a new card — one that has never been reviewed. */
  readonly current: ReviewSchedule | null;
}

/**
 * Replaceable scheduling algorithm.
 *
 * Implementations must be pure with respect to their input: given the same
 * command and the same clock reading, they return the same schedule. Persistence
 * stores what they return and never recomputes it, so replacing the
 * implementation changes only future reviews and leaves recorded history intact.
 */
export interface ReviewSchedulingStrategy {
  /** Stable identifier recorded with every review and schedule row. */
  readonly id: string;
  schedule(command: ScheduleReviewCommand): ReviewSchedule;
}

/** The interval each rating produces for a card that has never been reviewed. */
const NEW_CARD_INTERVAL_MINUTES: Readonly<Record<RecallRating, number>> = {
  AGAIN: 10,
  HARD: MINUTES_PER_DAY,
  GOOD: 3 * MINUTES_PER_DAY,
  EASY: 7 * MINUTES_PER_DAY,
};

/**
 * The floor and growth factor each rating applies to an existing card.
 *
 * `AGAIN` is absent because it does not grow an interval at all: it resets to
 * 10 minutes regardless of the interval reached, and increments the lapse count.
 */
const EXISTING_CARD_RULES: Readonly<
  Record<
    Exclude<RecallRating, "AGAIN">,
    { readonly floorMinutes: number; readonly factor: number }
  >
> = {
  HARD: { floorMinutes: MINUTES_PER_DAY, factor: 1.2 },
  GOOD: { floorMinutes: 3 * MINUTES_PER_DAY, factor: 2 },
  EASY: { floorMinutes: 7 * MINUTES_PER_DAY, factor: 3 },
};

export const DETERMINISTIC_SCHEDULER_ID = "deterministic-v1";

/**
 * The first deterministic algorithm, exactly as `SPEC.md` section 6.5 specifies.
 *
 * ```
 * New card       AGAIN → 10 minutes   HARD → 1 day
 *                GOOD  → 3 days       EASY → 7 days
 *
 * Existing card  AGAIN → 10 minutes, lapse count + 1
 *                HARD  → max(1 day, interval × 1.2)
 *                GOOD  → max(3 days, interval × 2)
 *                EASY  → max(7 days, interval × 3)
 * ```
 *
 * No ease factor, no fuzz, and no rounding beyond whole minutes: this is the
 * deterministic baseline, and a spaced-repetition model with per-card ease is a
 * different strategy for a later milestone rather than a change here.
 */
export class DeterministicReviewScheduler implements ReviewSchedulingStrategy {
  readonly id = DETERMINISTIC_SCHEDULER_ID;

  constructor(private readonly clock: Clock) {}

  schedule(command: ScheduleReviewCommand): ReviewSchedule {
    const now = this.clock.now();
    const { rating, current } = command;
    const intervalMinutes = nextIntervalMinutes(rating, current);

    return {
      intervalMinutes,
      dueAt: addMinutes(now, intervalMinutes),
      // A lapse counts a failure to recall, so it survives later successes: it
      // is how the owner sees which cards keep collapsing.
      lapseCount: (current?.lapseCount ?? 0) + (rating === "AGAIN" ? 1 : 0),
      reviewCount: (current?.reviewCount ?? 0) + 1,
      lastReviewedAt: now,
      schedulerId: this.id,
    };
  }
}

/**
 * The next interval in whole minutes.
 *
 * Exhaustive over the rating union, so adding a fifth rating fails to compile
 * until both the new-card and existing-card rules for it are written.
 */
function nextIntervalMinutes(
  rating: RecallRating,
  current: ReviewSchedule | null,
): number {
  if (current === null) {
    return NEW_CARD_INTERVAL_MINUTES[rating];
  }

  switch (rating) {
    case "AGAIN":
      // A lapse always returns to the 10-minute step, however long the interval
      // had grown: the card was not recalled, so the elapsed spacing is not
      // evidence of anything.
      return NEW_CARD_INTERVAL_MINUTES.AGAIN;
    case "HARD":
    case "GOOD":
    case "EASY": {
      const rule = EXISTING_CARD_RULES[rating];

      // `Math.round` keeps × 1.2 on a whole-day interval a whole number of
      // minutes; `Math.max` applies the specified floor, which is what makes an
      // early `HARD` on a 10-minute interval jump to a day rather than to 12
      // minutes.
      return Math.max(
        rule.floorMinutes,
        Math.round(current.intervalMinutes * rule.factor),
      );
    }
  }
}

/**
 * Whether a card with this schedule is due at `now`.
 *
 * A card due exactly now is due: the owner asked for the queue at this instant,
 * and excluding the boundary would leave a card invisible until the next
 * request. The SQL due-card query uses the same `<=` comparison, which is valid
 * because every stored timestamp is UTC ISO-8601 and therefore orders
 * lexicographically.
 */
export function isDue(
  schedule: ReviewSchedule | null,
  now: IsoTimestamp,
): boolean {
  return schedule === null || schedule.dueAt <= now;
}

/** Owner-facing description of an interval, for the review and history views. */
export function describeInterval(intervalMinutes: number): string {
  if (intervalMinutes < 60) {
    return `${intervalMinutes} minute${intervalMinutes === 1 ? "" : "s"}`;
  }

  if (intervalMinutes < MINUTES_PER_DAY) {
    const hours = Math.round((intervalMinutes / 60) * 10) / 10;

    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  const days = Math.round((intervalMinutes / MINUTES_PER_DAY) * 10) / 10;

  return `${days} day${days === 1 ? "" : "s"}`;
}
