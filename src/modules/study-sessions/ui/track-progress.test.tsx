import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  certificationFixture,
  objectiveFixture,
} from "@/modules/certifications/infrastructure/test-support";
import type {
  AccuracyTrendView,
  ObjectiveRollupView,
  StudyActivityView,
  TrackProgressView,
} from "@/modules/study-sessions/application/progress-facade";
import { sessionFixture } from "@/modules/study-sessions/infrastructure/test-support";
import { TrackProgress } from "./track-progress";

/**
 * One track's progress page.
 *
 * The behaviour under test is the shape the owner asked for: a headline row read every
 * visit, domains as rows whose objectives are one press away, and the long reference
 * lists folded until wanted. Plus the standing prohibition — no pass probability and no
 * readiness score anywhere (`SPEC.md` section 6.8).
 */

const TRACK = certificationFixture();

const DOMAIN = objectiveFixture({
  id: "objective-1",
  code: "Domain 1",
  title: "Design secure architectures",
  displayOrder: 1,
});

const TASK = objectiveFixture({
  id: "objective-1-1",
  parentObjectiveId: DOMAIN.id,
  code: "Task 1.1",
  title: "Design secure access",
  displayOrder: 1,
});

function activity(
  overrides: Partial<StudyActivityView> = {},
): StudyActivityView {
  return {
    answeringSeconds: 3_600,
    untimedAttempts: 0,
    activeDays: 9,
    activeDaysThisMonth: 5,
    streakDays: 4,
    lastStudiedAt: "2026-03-12T08:00:00.000Z",
    recentItems: 30,
    ...overrides,
  };
}

function trend(overrides: Partial<AccuracyTrendView> = {}): AccuracyTrendView {
  return {
    trend: "IMPROVING",
    recentPercentage: 82,
    windowSize: 30,
    deltaPoints: 12,
    ...overrides,
  };
}

function rollup(
  overrides: Partial<ObjectiveRollupView> = {},
): ObjectiveRollupView {
  return {
    objective: DOMAIN,
    attemptCount: 12,
    correctCount: 9,
    percentage: 75,
    questionCount: 20,
    attemptedQuestionCount: 8,
    attemptedPercentage: 40,
    children: [
      {
        objective: TASK,
        depth: 1,
        unseen: false,
        attemptCount: 6,
        correctCount: 3,
        percentage: 50,
      },
    ],
    ...overrides,
  };
}

function trackView(
  overrides: Partial<TrackProgressView> = {},
): TrackProgressView {
  return {
    track: TRACK,
    accuracy: { attemptCount: 40, correctCount: 28, percentage: 70 },
    trend: trend(),
    activity: activity(),
    coverage: {
      totalObjectives: 4,
      coveredObjectives: 3,
      unseenObjectives: 1,
      percentage: 75,
    },
    roots: [rollup()],
    questionTypes: [],
    confidence: [],
    recentMistakes: [],
    sessions: [],
    bank: { activeQuestions: 20, disputedQuestions: 0, activeFlashcards: 5 },
    dueFlashcardCount: 3,
    ...overrides,
  };
}

describe("TrackProgress", () => {
  describe("the headline row", () => {
    it("reports time answering, last studied, days active, streak, and accuracy", () => {
      render(<TrackProgress view={trackView()} />);

      expect(screen.getByText("Time answering")).toBeVisible();
      expect(screen.getByText("1 h 0 min")).toBeVisible();
      expect(screen.getByText("2026-03-12")).toBeVisible();
      expect(screen.getByText("9")).toBeVisible();
      expect(screen.getByText("4 days")).toBeVisible();
      expect(screen.getByText("70% correct of 40 answered")).toBeVisible();
      expect(screen.getByText("3 of 4 (75%)")).toBeVisible();
    });

    it("names the trend and prints the figures behind it", () => {
      render(<TrackProgress view={trackView()} />);

      // The word carries the meaning; the numbers let the owner disagree with it.
      expect(
        screen.getByText("Improving — last 30 answers 82% correct"),
      ).toBeVisible();
    });

    it("says there is not enough evidence rather than calling a small sample steady", () => {
      render(
        <TrackProgress
          view={trackView({
            trend: trend({
              trend: "INSUFFICIENT",
              recentPercentage: 100,
              windowSize: 3,
              deltaPoints: null,
            }),
          })}
        />,
      );

      expect(
        screen.getByText(/not enough recent answers to compare/i),
      ).toBeVisible();
      expect(screen.queryByText(/^Steady/)).toBeNull();
    });

    it("says how much answering time was never measured", () => {
      render(
        <TrackProgress
          view={trackView({
            activity: activity({ answeringSeconds: 300, untimedAttempts: 1 }),
          })}
        />,
      );

      expect(screen.getByText("5 min (1 answer untimed)")).toBeVisible();
    });
  });

  describe("progress by domain", () => {
    it("lists root objectives with their rolled-up counts", () => {
      render(<TrackProgress view={trackView()} />);

      expect(screen.getByText("Domain 1")).toBeVisible();
      expect(screen.getByText(DOMAIN.title)).toBeVisible();
      expect(screen.getByText("8 of 20 attempted · 75% correct")).toBeVisible();
    });

    it("keeps child objectives out of the way until the domain is opened", async () => {
      render(<TrackProgress view={trackView()} />);

      // Closed `<details>` content is present in the DOM but not visible, which is
      // exactly the "reachable but not in the way" the owner asked for.
      expect(screen.getByText(`${TASK.code} ${TASK.title}`)).not.toBeVisible();

      const user = userEvent.setup();

      await user.click(screen.getByText("Domain 1"));

      expect(screen.getByText(`${TASK.code} ${TASK.title}`)).toBeVisible();
      expect(screen.getByText("50% correct of 6 answered")).toBeVisible();
    });

    it("shows the attempted share as a progress bar as well as words", async () => {
      render(<TrackProgress view={trackView()} />);

      const user = userEvent.setup();

      await user.click(screen.getByText("Domain 1"));

      const bar = screen.getByRole("progressbar", {
        name: `Questions attempted in ${DOMAIN.title}`,
      });

      expect(bar).toHaveAttribute("value", "8");
      expect(bar).toHaveAttribute("max", "20");
      // The same figure in text, so the bar is never the only carrier of it.
      expect(
        screen.getByText(/8 of 20 questions attempted · 75% correct/),
      ).toBeVisible();
    });

    it("says a domain has no questions rather than reporting zero progress", () => {
      render(
        <TrackProgress
          view={trackView({
            roots: [
              rollup({
                attemptCount: 0,
                correctCount: 0,
                percentage: null,
                questionCount: 0,
                attemptedQuestionCount: 0,
                attemptedPercentage: null,
                children: [],
              }),
            ],
          })}
        />,
      );

      expect(screen.getByText("No questions yet")).toBeVisible();
      expect(screen.queryByRole("progressbar")).toBeNull();
    });

    it("says so when the track has no objectives at all", () => {
      render(<TrackProgress view={trackView({ roots: [] })} />);

      expect(screen.getByText(/no objectives yet/i)).toBeVisible();
    });

    it("points out domains with no answers yet", () => {
      render(
        <TrackProgress
          view={trackView({
            roots: [rollup({ attemptedQuestionCount: 0 })],
          })}
        />,
      );

      expect(
        screen.getByText(/1 domain of this track has no answers/i),
      ).toBeVisible();
    });
  });

  describe("the folded reference sections", () => {
    it("keeps the calibration table collapsed", () => {
      render(
        <TrackProgress
          view={trackView({
            confidence: [
              {
                confidence: "CONFIDENT",
                correctBand: "CORRECT_CONFIDENT",
                incorrectBand: "INCORRECT_CONFIDENT",
                attemptCount: 8,
                correctCount: 4,
                percentage: 50,
              },
            ],
          })}
        />,
      );

      // Collapsed: the table is reference material the owner opens deliberately.
      expect(screen.getByText("50% correct of 8 answered")).not.toBeVisible();
      // Still in the outline, so heading navigation reaches it while collapsed.
      expect(
        screen.getByRole("heading", { name: /confidence calibration/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: /confidence calibration/i }),
      ).toBeInTheDocument();
    });

    it("lists recent mistakes for this track without naming the track on every row", () => {
      render(
        <TrackProgress
          view={trackView({
            recentMistakes: [
              {
                attemptId: "attempt-1",
                questionId: "question-1",
                certificationId: TRACK.id,
                stem: "Which service stores objects?",
                confidence: "CONFIDENT",
                attemptedAt: "2026-03-11T08:00:00.000Z",
              },
            ],
          })}
        />,
      );

      expect(screen.getByText("Which service stores objects?")).toBeVisible();
      // The whole page is this track, so repeating its name per row would be noise.
      expect(screen.queryByText(new RegExp(`${TRACK.name} ·`))).toBeNull();
    });

    it("lists this track's sessions and says so when there are none", () => {
      render(<TrackProgress view={trackView()} />);

      expect(
        screen.getByText(/no sessions recorded for this track yet/i),
      ).toBeVisible();
    });

    it("offers to resume a session that is still in progress", () => {
      render(
        <TrackProgress
          view={trackView({
            sessions: [
              {
                session: sessionFixture({
                  id: "session-9",
                  status: "IN_PROGRESS",
                }),
                itemCount: 5,
                settledCount: 2,
                attemptCount: 2,
                correctCount: 1,
              },
            ],
          })}
        />,
      );

      const history = within(
        screen.getByRole("region", { name: /recent sessions/i }),
      );

      expect(history.getByRole("link", { name: /resume/i })).toHaveAttribute(
        "href",
        "/study/sessions/session-9",
      );
      expect(history.getByText(/2 of 5 items · 1 of 2 correct/)).toBeVisible();
    });
  });

  it("never reports a pass probability or a readiness score", () => {
    render(<TrackProgress view={trackView()} />);

    // `SPEC.md` section 6.8 forbids both, and the facade cannot produce them.
    expect(screen.queryByText(/likely to pass/i)).toBeNull();
    expect(screen.queryByText(/readiness/i)).toBeNull();
    expect(screen.queryByText(/predict/i)).toBeNull();
  });
});
