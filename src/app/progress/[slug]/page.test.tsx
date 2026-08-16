import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  certificationFixture,
  objectiveFixture,
} from "@/modules/certifications/infrastructure/test-support";
import type { TrackProgressView } from "@/modules/study-sessions/application/progress-facade";
import TrackProgressPage from "@/app/progress/[slug]/page";

/**
 * The per-track progress route.
 *
 * What the figures mean is the `TrackProgress` component's test; what belongs here is
 * the routing behaviour — an unknown slug is a 404, a known one is named in the trail,
 * and a track put aside is still readable.
 */
class NotFoundSignal extends Error {}

const findTrackProgressBySlug =
  vi.fn<(slug: string) => Promise<TrackProgressView | null>>();

vi.mock("@/modules/study-sessions/composition", () => ({
  getProgressFacade: () => ({ findTrackProgressBySlug }),
}));

vi.mock("next/navigation", () => ({
  notFound: (): never => {
    throw new NotFoundSignal("NEXT_NOT_FOUND");
  },
}));

const TRACK = certificationFixture({ name: "Demo HSK 1", slug: "demo-hsk-1" });

function stubProgress(overrides: Partial<TrackProgressView> = {}): void {
  findTrackProgressBySlug.mockResolvedValue({
    track: TRACK,
    accuracy: { attemptCount: 12, correctCount: 9, percentage: 75 },
    trend: {
      trend: "STEADY",
      recentPercentage: 75,
      windowSize: 12,
      deltaPoints: 0,
    },
    activity: {
      answeringSeconds: 900,
      untimedAttempts: 0,
      activeDays: 3,
      activeDaysThisMonth: 3,
      streakDays: 2,
      lastStudiedAt: "2026-03-12T08:00:00.000Z",
      recentItems: 12,
    },
    coverage: {
      totalObjectives: 2,
      coveredObjectives: 1,
      unseenObjectives: 1,
      percentage: 50,
    },
    roots: [
      {
        objective: objectiveFixture({ code: "Domain 1", title: "Vocabulary" }),
        attemptCount: 12,
        correctCount: 9,
        percentage: 75,
        questionCount: 10,
        attemptedQuestionCount: 6,
        attemptedPercentage: 60,
        children: [],
      },
    ],
    questionTypes: [],
    confidence: [],
    recentMistakes: [],
    sessions: [],
    bank: { activeQuestions: 10, disputedQuestions: 0, activeFlashcards: 4 },
    dueFlashcardCount: 1,
    ...overrides,
  });
}

describe("TrackProgressPage", () => {
  beforeEach(() => {
    findTrackProgressBySlug.mockReset();
  });

  it("renders the track's progress under a trail back to the dashboard", async () => {
    stubProgress();

    render(
      await TrackProgressPage({
        params: Promise.resolve({ slug: TRACK.slug }),
      }),
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Demo HSK 1" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Progress" })).toHaveAttribute(
      "href",
      "/progress",
    );
    expect(screen.getByText("Domain 1")).toBeVisible();
    expect(screen.getByText("75% correct of 12 answered")).toBeVisible();
  });

  it("is a 404 for a slug that names no track", async () => {
    findTrackProgressBySlug.mockResolvedValue(null);

    // A 404 rather than an empty page, which would read as a track with no progress.
    await expect(
      TrackProgressPage({ params: Promise.resolve({ slug: "nope" }) }),
    ).rejects.toThrow(NotFoundSignal);
  });

  it("still reports a track the owner has archived", async () => {
    stubProgress({ track: { ...TRACK, status: "ARCHIVED" } });

    render(
      await TrackProgressPage({
        params: Promise.resolve({ slug: TRACK.slug }),
      }),
    );

    // Studying stopped; the evidence did not.
    expect(screen.getByText("Archived")).toBeVisible();
    expect(screen.getByText("75% correct of 12 answered")).toBeVisible();
  });
});
