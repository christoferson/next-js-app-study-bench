import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { certificationFixture } from "@/modules/certifications/infrastructure/test-support";
import type { ProgressView } from "@/modules/study-sessions/application/progress-facade";
import ProgressPage from "@/app/progress/page";

/**
 * The progress dashboard route.
 *
 * The card contents are the `ProgressDashboard` component's test; what belongs here is
 * that the page is short and that each track leads somewhere — the owner's complaint was
 * that this screen carried everything at once.
 */
const findProgress = vi.fn<() => Promise<ProgressView>>();

vi.mock("@/modules/study-sessions/composition", () => ({
  getProgressFacade: () => ({ findProgress }),
}));

const TRACK = certificationFixture({ name: "Demo HSK 1", slug: "demo-hsk-1" });
const SECOND = certificationFixture({
  id: "certification-2",
  name: "Demo Cloud",
  slug: "demo-cloud",
});

function stubProgress(overrides: Partial<ProgressView> = {}): void {
  findProgress.mockResolvedValue({
    overall: { attemptCount: 12, correctCount: 9, percentage: 75 },
    activity: {
      answeringSeconds: 900,
      untimedAttempts: 0,
      activeDays: 3,
      activeDaysThisMonth: 3,
      streakDays: 2,
      lastStudiedAt: "2026-03-12T08:00:00.000Z",
      recentItems: 12,
    },
    tracks: [TRACK, SECOND].map((track) => ({
      track,
      accuracy: { attemptCount: 6, correctCount: 4, percentage: 67 },
      coverage: {
        totalObjectives: 2,
        coveredObjectives: 1,
        unseenObjectives: 1,
        percentage: 50,
      },
      activity: {
        answeringSeconds: 450,
        untimedAttempts: 0,
        activeDays: 2,
        activeDaysThisMonth: 2,
        streakDays: 1,
        lastStudiedAt: "2026-03-12T08:00:00.000Z",
        recentItems: 6,
      },
      dueFlashcardCount: 0,
      unstudied: false,
    })),
    empty: false,
    ...overrides,
  });
}

describe("ProgressPage", () => {
  beforeEach(() => {
    findProgress.mockReset();
  });

  it("links every track card to its own progress page", async () => {
    stubProgress();

    render(await ProgressPage());

    expect(screen.getByRole("link", { name: TRACK.name })).toHaveAttribute(
      "href",
      "/progress/demo-hsk-1",
    );
    expect(screen.getByRole("link", { name: SECOND.name })).toHaveAttribute(
      "href",
      "/progress/demo-cloud",
    );
  });

  it("carries no per-track detail, which lives on the track pages", async () => {
    stubProgress();

    render(await ProgressPage());

    expect(screen.queryByText(/recent mistakes/i)).toBeNull();
    expect(screen.queryByText(/confidence calibration/i)).toBeNull();
    expect(screen.queryByText(/recent sessions/i)).toBeNull();
  });

  it("says nothing has been answered yet rather than reporting zeroes", async () => {
    stubProgress({
      empty: true,
      overall: { attemptCount: 0, correctCount: 0, percentage: null },
      tracks: [],
    });

    render(await ProgressPage());

    expect(
      screen.getByText(/have not answered any questions yet/i),
    ).toBeVisible();
  });
});
