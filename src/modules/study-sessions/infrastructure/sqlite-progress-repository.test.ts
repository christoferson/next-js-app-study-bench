import { describe, expect, it } from "vitest";
import { countStreak } from "./sqlite-progress-repository";

/**
 * The streak calculation.
 *
 * It is computed in TypeScript from a bounded list of distinct active dates rather
 * than in SQL, because "consecutive days" needs date arithmetic and a gap test that a
 * `GROUP BY` cannot express without a window function per row. The repository test
 * covers the rule directly; the queries that feed it are covered end to end through the
 * facade against a real migrated database (`progress-facade.test.ts`).
 *
 * Dates are `YYYY-MM-DD` UTC strings, newest first, which is exactly what the query
 * returns.
 */
describe("countStreak", () => {
  it("is zero with no activity", () => {
    expect(countStreak([], "2026-03-12")).toBe(0);
  });

  it("counts consecutive days ending today", () => {
    expect(
      countStreak(["2026-03-12", "2026-03-11", "2026-03-10"], "2026-03-12"),
    ).toBe(3);
  });

  it("counts a streak that ended yesterday", () => {
    // Not having studied yet this morning has not broken anything, and a streak that
    // reset at midnight would punish the time of day the page was opened.
    expect(countStreak(["2026-03-11", "2026-03-10"], "2026-03-12")).toBe(2);
  });

  it("is zero once the last active day is older than yesterday", () => {
    expect(countStreak(["2026-03-10", "2026-03-09"], "2026-03-12")).toBe(0);
  });

  it("stops at the first missing day and ignores earlier runs", () => {
    expect(
      countStreak(
        ["2026-03-12", "2026-03-11", "2026-03-08", "2026-03-07"],
        "2026-03-12",
      ),
    ).toBe(2);
  });

  it("steps across a month boundary", () => {
    expect(
      countStreak(["2026-03-01", "2026-02-28", "2026-02-27"], "2026-03-01"),
    ).toBe(3);
  });

  it("steps across a leap day", () => {
    expect(
      countStreak(["2028-03-01", "2028-02-29", "2028-02-28"], "2028-03-01"),
    ).toBe(3);
  });

  it("counts a single day as a streak of one", () => {
    expect(countStreak(["2026-03-12"], "2026-03-12")).toBe(1);
  });
});
