import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { certificationFixture } from "@/modules/certifications/infrastructure/test-support";
import type {
  ProgressView,
  StudyActivityView,
  TrackSummaryView,
} from "@/modules/study-sessions/application/progress-facade";
import { ProgressDashboard } from "./progress-dashboard";

/**
 * The progress dashboard.
 *
 * Two things are being tested: what the page is allowed to claim — counted figures
 * where evidence exists, "not studied yet" where it does not, and no pass probability
 * anywhere (`SPEC.md` section 6.8) — and that it stays short. The detail that used to
 * live here now belongs to `/progress/[slug]`, so several of these tests assert the
 * *absence* of a section rather than its contents.
 */

const TRACK = certificationFixture();
const SECOND_TRACK = certificationFixture({
  id: "certification-2",
  slug: "second-track",
  name: "Second Track",
});

function activity(
  overrides: Partial<StudyActivityView> = {},
): StudyActivityView {
  return {
    answeringSeconds: 5_400,
    untimedAttempts: 0,
    activeDays: 6,
    activeDaysThisMonth: 4,
    streakDays: 3,
    lastStudiedAt: "2026-03-12T08:00:00.000Z",
    recentItems: 24,
    ...overrides,
  };
}

function trackSummary(
  overrides: Partial<TrackSummaryView> = {},
): TrackSummaryView {
  return {
    track: TRACK,
    accuracy: { attemptCount: 10, correctCount: 7, percentage: 70 },
    coverage: {
      totalObjectives: 4,
      coveredObjectives: 3,
      unseenObjectives: 1,
      percentage: 75,
    },
    activity: activity(),
    dueFlashcardCount: 2,
    unstudied: false,
    ...overrides,
  };
}

function progressView(overrides: Partial<ProgressView> = {}): ProgressView {
  return {
    overall: { attemptCount: 10, correctCount: 7, percentage: 70 },
    activity: activity(),
    tracks: [trackSummary()],
    empty: false,
    ...overrides,
  };
}

describe("ProgressDashboard", () => {
  describe("with no evidence", () => {
    it("says so instead of reporting zeroes", () => {
      render(
        <ProgressDashboard
          view={progressView({
            empty: true,
            overall: { attemptCount: 0, correctCount: 0, percentage: null },
            activity: activity({
              answeringSeconds: 0,
              activeDays: 0,
              activeDaysThisMonth: 0,
              streakDays: 0,
              lastStudiedAt: null,
              recentItems: 0,
            }),
          })}
        />,
      );

      expect(
        screen.getByText(/have not answered any questions yet/i),
      ).toBeVisible();
      expect(screen.queryByText("Time answering")).toBeNull();
      expect(screen.getByText(/no estimates/i)).toBeVisible();
    });

    it("says a track has not been studied rather than 0% correct", () => {
      render(
        <ProgressDashboard
          view={progressView({
            empty: true,
            overall: { attemptCount: 0, correctCount: 0, percentage: null },
            tracks: [
              trackSummary({
                unstudied: true,
                accuracy: {
                  attemptCount: 0,
                  correctCount: 0,
                  percentage: null,
                },
                activity: activity({ lastStudiedAt: null, streakDays: 0 }),
              }),
            ],
          })}
        />,
      );

      expect(screen.getByText("Not studied yet.")).toBeVisible();
      expect(screen.queryByText(/0% correct/)).toBeNull();
      // Not a date either: there is no last-studied date to print.
      expect(screen.queryByText("Last studied")).toBeNull();
    });

    it("reports a track with no objectives without inventing a coverage figure", () => {
      render(
        <ProgressDashboard
          view={progressView({
            tracks: [
              trackSummary({
                coverage: {
                  totalObjectives: 0,
                  coveredObjectives: 0,
                  unseenObjectives: 0,
                  percentage: null,
                },
              }),
            ],
          })}
        />,
      );

      expect(screen.getByText("No objectives yet")).toBeVisible();
    });

    it("says so when there are no tracks at all", () => {
      render(<ProgressDashboard view={progressView({ tracks: [] })} />);

      expect(screen.getByText(/no active study tracks yet/i)).toBeVisible();
    });
  });

  describe("the all-tracks summary", () => {
    it("labels recorded answering time as time answering, not study time", () => {
      render(<ProgressDashboard view={progressView()} />);

      expect(screen.getByText("Time answering")).toBeVisible();
      // 5400 seconds, in hours and minutes.
      expect(screen.getByText("1 h 30 min")).toBeVisible();
      expect(screen.queryByText(/total study time/i)).toBeNull();
    });

    it("says how many answers were untimed rather than filling them in", () => {
      render(
        <ProgressDashboard
          view={progressView({
            activity: activity({ answeringSeconds: 600, untimedAttempts: 3 }),
          })}
        />,
      );

      expect(screen.getByText("10 min (3 answers untimed)")).toBeVisible();
    });

    it("reports days active this month and items studied recently", () => {
      render(<ProgressDashboard view={progressView()} />);

      expect(screen.getByText("Days active this month")).toBeVisible();
      expect(screen.getByText("4")).toBeVisible();
      expect(screen.getByText(/items in the last 7 days/i)).toBeVisible();
      expect(screen.getByText("24")).toBeVisible();
    });

    it("reports overall accuracy from counted answers", () => {
      render(
        <ProgressDashboard
          view={progressView({
            overall: { attemptCount: 24, correctCount: 18, percentage: 75 },
          })}
        />,
      );

      // A different figure from the track card below it, so the assertion cannot
      // pass by matching the card instead of the summary.
      expect(screen.getByText("75% correct of 24 answered")).toBeVisible();
    });
  });

  describe("the per-track cards", () => {
    it("links each track to its own progress page", () => {
      render(
        <ProgressDashboard
          view={progressView({
            tracks: [trackSummary(), trackSummary({ track: SECOND_TRACK })],
          })}
        />,
      );

      expect(screen.getByRole("link", { name: TRACK.name })).toHaveAttribute(
        "href",
        `/progress/${TRACK.slug}`,
      );
      expect(
        screen.getByRole("link", { name: SECOND_TRACK.name }),
      ).toHaveAttribute("href", `/progress/${SECOND_TRACK.slug}`);
    });

    it("shows last studied, streak, days active, coverage, accuracy, and cards due", () => {
      render(<ProgressDashboard view={progressView()} />);

      const card = within(screen.getByRole("listitem"));

      expect(card.getByText("Last studied")).toBeVisible();
      expect(card.getByText("2026-03-12")).toBeVisible();
      expect(card.getByText("3 days")).toBeVisible();
      expect(card.getByText("75%")).toBeVisible();
      expect(card.getByText("70% correct of 10 answered")).toBeVisible();
      expect(card.getByText("2 due")).toBeVisible();
    });

    it("says there is no current streak rather than printing a bare zero", () => {
      render(
        <ProgressDashboard
          view={progressView({
            tracks: [trackSummary({ activity: activity({ streakDays: 0 }) })],
          })}
        />,
      );

      expect(screen.getByText("No current streak")).toBeVisible();
    });

    it("offers a session for the track", () => {
      render(<ProgressDashboard view={progressView()} />);

      expect(
        screen.getByRole("link", { name: `Study ${TRACK.name}` }),
      ).toHaveAttribute("href", `/study/new?track=${TRACK.slug}`);
    });
  });

  describe("what the dashboard deliberately leaves out", () => {
    it("carries no objective detail, mistakes, calibration, or session history", () => {
      render(<ProgressDashboard view={progressView()} />);

      // All four moved to the per-track page: the owner said this screen was too
      // busy, and a summary that renders everything is not a summary.
      expect(screen.queryByText(/accuracy by objective/i)).toBeNull();
      expect(screen.queryByText(/recent mistakes/i)).toBeNull();
      expect(screen.queryByText(/confidence calibration/i)).toBeNull();
      expect(screen.queryByText(/recent sessions/i)).toBeNull();
    });

    it("never reports a pass probability or a readiness score", () => {
      render(<ProgressDashboard view={progressView()} />);

      // `SPEC.md` section 6.8 forbids both, and the facade cannot produce them.
      expect(screen.queryByText(/likely to pass/i)).toBeNull();
      expect(screen.queryByText(/readiness/i)).toBeNull();
      expect(screen.queryByText(/predict/i)).toBeNull();
    });
  });
});
