import { describe, expect, it } from "vitest";
import type { Clock, IsoTimestamp } from "@/platform/clock";
import { MINUTES_PER_DAY, addMinutes } from "@/platform/clock";
import type { RecallRating, ReviewSchedule } from "./review-scheduling";
import {
  DETERMINISTIC_SCHEDULER_ID,
  DeterministicReviewScheduler,
  RECALL_RATINGS,
  describeInterval,
  describeRating,
  isDue,
} from "./review-scheduling";

/**
 * Scheduling rules, tested without a database and without the real clock.
 *
 * `SPEC.md` section 22.3 requires that scheduling logic has unit tests
 * independent of the database, so nothing here opens a connection: the strategy
 * is pure domain code over an injected clock, and every assertion is about the
 * interval and due date it returns.
 */

const NOW = "2026-03-01T08:00:00.000Z";
const TEN_MINUTES = 10;
const ONE_DAY = MINUTES_PER_DAY;

/** Advances only when a test asks it to, so due dates are exact. */
class StubClock implements Clock {
  constructor(private current: IsoTimestamp = NOW) {}

  now(): IsoTimestamp {
    return this.current;
  }

  set(timestamp: IsoTimestamp): void {
    this.current = timestamp;
  }
}

function scheduleFixture(
  overrides: Partial<ReviewSchedule> = {},
): ReviewSchedule {
  return {
    intervalMinutes: 3 * ONE_DAY,
    dueAt: "2026-03-04T08:00:00.000Z",
    lapseCount: 0,
    reviewCount: 1,
    lastReviewedAt: "2026-03-01T08:00:00.000Z",
    schedulerId: DETERMINISTIC_SCHEDULER_ID,
    ...overrides,
  };
}

describe("DeterministicReviewScheduler for a new card", () => {
  // A new card is one that has never been reviewed, so it has no schedule at
  // all. Every rating below is the card's first.
  const cases: readonly {
    readonly rating: RecallRating;
    readonly minutes: number;
    readonly dueAt: string;
  }[] = [
    {
      rating: "AGAIN",
      minutes: TEN_MINUTES,
      dueAt: "2026-03-01T08:10:00.000Z",
    },
    { rating: "HARD", minutes: ONE_DAY, dueAt: "2026-03-02T08:00:00.000Z" },
    { rating: "GOOD", minutes: 3 * ONE_DAY, dueAt: "2026-03-04T08:00:00.000Z" },
    { rating: "EASY", minutes: 7 * ONE_DAY, dueAt: "2026-03-08T08:00:00.000Z" },
  ];

  for (const entry of cases) {
    it(`schedules ${entry.rating} at ${describeInterval(entry.minutes)}`, () => {
      const scheduler = new DeterministicReviewScheduler(new StubClock());

      const result = scheduler.schedule({
        rating: entry.rating,
        current: null,
      });

      expect(result.intervalMinutes).toBe(entry.minutes);
      expect(result.dueAt).toBe(entry.dueAt);
    });
  }

  it("covers every rating, so no rating falls through unscheduled", () => {
    expect(cases.map((entry) => entry.rating)).toEqual([...RECALL_RATINGS]);
  });

  it("counts the first review and no lapse for a recalled card", () => {
    const scheduler = new DeterministicReviewScheduler(new StubClock());

    const result = scheduler.schedule({ rating: "GOOD", current: null });

    expect(result.reviewCount).toBe(1);
    expect(result.lapseCount).toBe(0);
    expect(result.lastReviewedAt).toBe(NOW);
    expect(result.schedulerId).toBe(DETERMINISTIC_SCHEDULER_ID);
  });

  it("counts a first-review failure as a lapse", () => {
    const scheduler = new DeterministicReviewScheduler(new StubClock());

    const result = scheduler.schedule({ rating: "AGAIN", current: null });

    expect(result.lapseCount).toBe(1);
    expect(result.reviewCount).toBe(1);
  });
});

describe("DeterministicReviewScheduler for an existing card", () => {
  it("resets AGAIN to ten minutes however long the interval had grown", () => {
    const scheduler = new DeterministicReviewScheduler(new StubClock());

    const result = scheduler.schedule({
      rating: "AGAIN",
      current: scheduleFixture({ intervalMinutes: 90 * ONE_DAY }),
    });

    expect(result.intervalMinutes).toBe(TEN_MINUTES);
    expect(result.dueAt).toBe("2026-03-01T08:10:00.000Z");
  });

  it("increments the lapse count on every AGAIN and keeps it afterwards", () => {
    const scheduler = new DeterministicReviewScheduler(new StubClock());

    const first = scheduler.schedule({
      rating: "AGAIN",
      current: scheduleFixture({ lapseCount: 2, reviewCount: 5 }),
    });

    expect(first.lapseCount).toBe(3);
    expect(first.reviewCount).toBe(6);

    // A later success does not forgive a recorded lapse: the count is history,
    // not a current state.
    const second = scheduler.schedule({ rating: "GOOD", current: first });

    expect(second.lapseCount).toBe(3);
    expect(second.reviewCount).toBe(7);
  });

  it("multiplies HARD by 1.2 once the interval is past the one-day floor", () => {
    const scheduler = new DeterministicReviewScheduler(new StubClock());

    const result = scheduler.schedule({
      rating: "HARD",
      current: scheduleFixture({ intervalMinutes: 10 * ONE_DAY }),
    });

    expect(result.intervalMinutes).toBe(12 * ONE_DAY);
  });

  it("applies the HARD floor to a short interval instead of shrinking it", () => {
    const scheduler = new DeterministicReviewScheduler(new StubClock());

    // 10 × 1.2 is 12 minutes; the specified floor of one day wins.
    const result = scheduler.schedule({
      rating: "HARD",
      current: scheduleFixture({ intervalMinutes: TEN_MINUTES }),
    });

    expect(result.intervalMinutes).toBe(ONE_DAY);
  });

  it("keeps HARD at the floor exactly at the boundary", () => {
    const scheduler = new DeterministicReviewScheduler(new StubClock());

    // 1 day × 1.2 is 1.2 days, which is above the floor, so the product wins.
    const result = scheduler.schedule({
      rating: "HARD",
      current: scheduleFixture({ intervalMinutes: ONE_DAY }),
    });

    expect(result.intervalMinutes).toBe(Math.round(ONE_DAY * 1.2));
    expect(result.intervalMinutes).toBeGreaterThan(ONE_DAY);
  });

  it("doubles GOOD once the interval is past the three-day floor", () => {
    const scheduler = new DeterministicReviewScheduler(new StubClock());

    const result = scheduler.schedule({
      rating: "GOOD",
      current: scheduleFixture({ intervalMinutes: 5 * ONE_DAY }),
    });

    expect(result.intervalMinutes).toBe(10 * ONE_DAY);
  });

  it("applies the GOOD floor to an interval below three days", () => {
    const scheduler = new DeterministicReviewScheduler(new StubClock());

    // 1 day × 2 is 2 days; the specified floor of 3 days wins.
    const result = scheduler.schedule({
      rating: "GOOD",
      current: scheduleFixture({ intervalMinutes: ONE_DAY }),
    });

    expect(result.intervalMinutes).toBe(3 * ONE_DAY);
  });

  it("triples EASY once the interval is past the seven-day floor", () => {
    const scheduler = new DeterministicReviewScheduler(new StubClock());

    const result = scheduler.schedule({
      rating: "EASY",
      current: scheduleFixture({ intervalMinutes: 10 * ONE_DAY }),
    });

    expect(result.intervalMinutes).toBe(30 * ONE_DAY);
  });

  it("applies the EASY floor to an interval below seven days", () => {
    const scheduler = new DeterministicReviewScheduler(new StubClock());

    // 2 days × 3 is 6 days; the specified floor of 7 days wins.
    const result = scheduler.schedule({
      rating: "EASY",
      current: scheduleFixture({ intervalMinutes: 2 * ONE_DAY }),
    });

    expect(result.intervalMinutes).toBe(7 * ONE_DAY);
  });

  it("measures the next due date from the review, not from the old due date", () => {
    const clock = new StubClock();
    const scheduler = new DeterministicReviewScheduler(clock);

    // The card was due on the 4th and is reviewed late, on the 10th.
    clock.set("2026-03-10T09:30:00.000Z");

    const result = scheduler.schedule({
      rating: "GOOD",
      current: scheduleFixture({
        intervalMinutes: 4 * ONE_DAY,
        dueAt: "2026-03-04T08:00:00.000Z",
      }),
    });

    expect(result.lastReviewedAt).toBe("2026-03-10T09:30:00.000Z");
    expect(result.dueAt).toBe("2026-03-18T09:30:00.000Z");
  });
});

describe("interval growth over a sequence of reviews", () => {
  it("grows a GOOD chain 3 days → 6 → 12 → 24", () => {
    const clock = new StubClock();
    const scheduler = new DeterministicReviewScheduler(clock);
    const intervals: number[] = [];
    let schedule: ReviewSchedule | null = null;

    for (let review = 0; review < 4; review += 1) {
      schedule = scheduler.schedule({ rating: "GOOD", current: schedule });
      intervals.push(schedule.intervalMinutes / ONE_DAY);
      // Study happens exactly when the card falls due.
      clock.set(schedule.dueAt);
    }

    expect(intervals).toEqual([3, 6, 12, 24]);
    expect(schedule?.reviewCount).toBe(4);
    expect(schedule?.lapseCount).toBe(0);
  });

  it("collapses a long interval back to ten minutes after a lapse, then rebuilds", () => {
    const clock = new StubClock();
    const scheduler = new DeterministicReviewScheduler(clock);

    let schedule = scheduler.schedule({ rating: "EASY", current: null });

    expect(schedule.intervalMinutes).toBe(7 * ONE_DAY);

    clock.set(schedule.dueAt);
    schedule = scheduler.schedule({ rating: "EASY", current: schedule });

    expect(schedule.intervalMinutes).toBe(21 * ONE_DAY);

    clock.set(schedule.dueAt);
    schedule = scheduler.schedule({ rating: "AGAIN", current: schedule });

    expect(schedule.intervalMinutes).toBe(TEN_MINUTES);
    expect(schedule.lapseCount).toBe(1);

    clock.set(schedule.dueAt);
    schedule = scheduler.schedule({ rating: "GOOD", current: schedule });

    // Rebuilding starts from the GOOD floor rather than from 20 minutes.
    expect(schedule.intervalMinutes).toBe(3 * ONE_DAY);
    expect(schedule.reviewCount).toBe(4);
  });

  it("never returns a non-positive interval for any rating and interval", () => {
    const scheduler = new DeterministicReviewScheduler(new StubClock());

    for (const rating of RECALL_RATINGS) {
      for (const intervalMinutes of [1, TEN_MINUTES, ONE_DAY, 365 * ONE_DAY]) {
        const result = scheduler.schedule({
          rating,
          current: scheduleFixture({ intervalMinutes }),
        });

        expect(result.intervalMinutes).toBeGreaterThan(0);
        expect(result.dueAt > NOW).toBe(true);
      }
    }
  });
});

describe("isDue", () => {
  it("treats a card that has never been reviewed as due", () => {
    expect(isDue(null, NOW)).toBe(true);
  });

  it("treats a card due exactly now as due", () => {
    expect(isDue(scheduleFixture({ dueAt: NOW }), NOW)).toBe(true);
  });

  it("treats an overdue card as due", () => {
    expect(isDue(scheduleFixture({ dueAt: addMinutes(NOW, -1) }), NOW)).toBe(
      true,
    );
  });

  it("treats a card due in the future as not due", () => {
    expect(isDue(scheduleFixture({ dueAt: addMinutes(NOW, 1) }), NOW)).toBe(
      false,
    );
  });
});

describe("rating and interval descriptions", () => {
  it("names every rating in words", () => {
    expect(RECALL_RATINGS.map(describeRating)).toEqual([
      "Again",
      "Hard",
      "Good",
      "Easy",
    ]);
  });

  it("describes short intervals in minutes and long ones in days", () => {
    expect(describeInterval(1)).toBe("1 minute");
    expect(describeInterval(TEN_MINUTES)).toBe("10 minutes");
    expect(describeInterval(60)).toBe("1 hour");
    expect(describeInterval(90)).toBe("1.5 hours");
    expect(describeInterval(ONE_DAY)).toBe("1 day");
    expect(describeInterval(3 * ONE_DAY)).toBe("3 days");
    expect(describeInterval(Math.round(ONE_DAY * 1.2))).toBe("1.2 days");
  });
});

describe("addMinutes", () => {
  it("advances a UTC timestamp across a day boundary", () => {
    expect(addMinutes("2026-03-01T23:55:00.000Z", 10)).toBe(
      "2026-03-02T00:05:00.000Z",
    );
  });

  it("rejects a timestamp it cannot parse rather than returning an invalid date", () => {
    expect(() => addMinutes("not-a-timestamp", 10)).toThrow(/ISO-8601/);
  });
});
