import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  certificationFixture,
  objectiveFixture,
} from "@/modules/certifications/infrastructure/test-support";
import type {
  ProgressView,
  TrackProgressView,
} from "@/modules/study-sessions/application/progress-facade";
import { sessionFixture } from "@/modules/study-sessions/infrastructure/test-support";
import { ProgressDashboard } from "./progress-dashboard";

/**
 * The progress dashboard.
 *
 * The tests are about what the page is allowed to claim: counted figures where
 * evidence exists, "not attempted yet" where it does not, and no pass probability
 * anywhere (`SPEC.md` section 6.8).
 */

const TRACK = certificationFixture();

function trackView(
  overrides: Partial<TrackProgressView> = {},
): TrackProgressView {
  return {
    track: TRACK,
    accuracy: { attemptCount: 10, correctCount: 7, percentage: 70 },
    coverage: {
      totalObjectives: 4,
      coveredObjectives: 3,
      unseenObjectives: 1,
      percentage: 75,
    },
    objectives: [],
    questionTypes: [],
    bank: { activeQuestions: 20, disputedQuestions: 0, activeFlashcards: 5 },
    dueFlashcardCount: 2,
    ...overrides,
  };
}

function progressView(overrides: Partial<ProgressView> = {}): ProgressView {
  return {
    overall: { attemptCount: 10, correctCount: 7, percentage: 70 },
    tracks: [trackView()],
    confidence: [],
    recentMistakes: [],
    sessions: [],
    trackNames: new Map([[TRACK.id, TRACK.name]]),
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
          })}
        />,
      );

      expect(
        screen.getByText(/have not answered any questions yet/i),
      ).toBeVisible();
      expect(screen.queryByText("Questions answered")).toBeNull();
      expect(screen.getByText(/no estimates/i)).toBeVisible();
    });

    it("says a track has not been attempted rather than 0% correct", () => {
      render(
        <ProgressDashboard
          view={progressView({
            empty: true,
            overall: { attemptCount: 0, correctCount: 0, percentage: null },
            tracks: [
              trackView({
                accuracy: {
                  attemptCount: 0,
                  correctCount: 0,
                  percentage: null,
                },
              }),
            ],
          })}
        />,
      );

      expect(screen.getByText("Not attempted yet")).toBeVisible();
      expect(screen.queryByText(/0% correct/)).toBeNull();
    });

    it("reports a track with no objectives without inventing a coverage figure", () => {
      render(
        <ProgressDashboard
          view={progressView({
            tracks: [
              trackView({
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

    it("says no sessions are recorded yet", () => {
      render(<ProgressDashboard view={progressView({ sessions: [] })} />);

      expect(screen.getByText("No sessions recorded yet.")).toBeVisible();
    });
  });

  describe("with recorded answers", () => {
    it("reports overall accuracy from counted answers", () => {
      render(<ProgressDashboard view={progressView()} />);

      expect(screen.getByText("Questions answered")).toBeVisible();
      expect(screen.getByText("10")).toBeVisible();
      expect(
        screen.getByText(/7 \(70% correct of 10 answered\)/),
      ).toBeVisible();
    });

    it("reports objective coverage and what the bank holds", () => {
      render(<ProgressDashboard view={progressView()} />);

      expect(screen.getByText("3 of 4 (75%)")).toBeVisible();
      expect(screen.getByText("Cards due")).toBeVisible();
      expect(screen.getByText("Active questions")).toBeVisible();
      expect(screen.getByText("20")).toBeVisible();
      expect(screen.getByText("Active flashcards")).toBeVisible();
    });

    it("names disputed questions as kept out of study, and only when there are some", () => {
      render(<ProgressDashboard view={progressView()} />);

      expect(screen.queryByText("Disputed questions")).toBeNull();

      render(
        <ProgressDashboard
          view={progressView({
            tracks: [
              trackView({
                bank: {
                  activeQuestions: 20,
                  disputedQuestions: 2,
                  activeFlashcards: 5,
                },
              }),
            ],
          })}
        />,
      );

      expect(screen.getByText("Disputed questions")).toBeVisible();
      expect(
        screen.getByText(/kept out of study until resolved/i),
      ).toBeVisible();
    });

    it("reports accuracy by question type", () => {
      render(
        <ProgressDashboard
          view={progressView({
            tracks: [
              trackView({
                questionTypes: [
                  {
                    questionType: "SINGLE_CHOICE",
                    attemptCount: 8,
                    correctCount: 6,
                    percentage: 75,
                  },
                  {
                    questionType: "SHORT_ANSWER",
                    attemptCount: 2,
                    correctCount: 1,
                    percentage: 50,
                  },
                ],
              }),
            ],
          })}
        />,
      );

      expect(screen.getByText("Accuracy by question type")).toBeVisible();
      expect(screen.getByText("Single choice")).toBeVisible();
      expect(screen.getByText("75% correct of 8 answered")).toBeVisible();
      expect(screen.getByText("Short answer")).toBeVisible();
    });

    it("marks an unstudied objective as not studied yet, not as zero", () => {
      render(
        <ProgressDashboard
          view={progressView({
            tracks: [
              trackView({
                objectives: [
                  {
                    objective: objectiveFixture({ title: "Studied objective" }),
                    depth: 0,
                    unseen: false,
                    attemptCount: 4,
                    correctCount: 3,
                    percentage: 75,
                  },
                  {
                    objective: objectiveFixture({
                      id: "objective-2",
                      title: "Untouched objective",
                    }),
                    depth: 1,
                    unseen: true,
                    attemptCount: 0,
                    correctCount: 0,
                    percentage: null,
                  },
                ],
              }),
            ],
          })}
        />,
      );

      expect(screen.getByText("Untouched objective")).toBeVisible();
      // Skipping a question must not read as scoring zero on the objective
      // (`spec/DOMAIN-RULES.md` section 2.5).
      expect(screen.getByText("Not studied yet")).toBeVisible();
      expect(screen.getByText("75% correct of 4 answered")).toBeVisible();
      expect(
        screen.getByText(/1 objective of this track has no answers yet/i),
      ).toBeVisible();
    });

    it("expresses objective depth as a data attribute, not an inline style", () => {
      render(
        <ProgressDashboard
          view={progressView({
            tracks: [
              trackView({
                objectives: [
                  {
                    objective: objectiveFixture({ title: "Child objective" }),
                    depth: 5,
                    unseen: true,
                    attemptCount: 0,
                    correctCount: 0,
                    percentage: null,
                  },
                ],
              }),
            ],
          })}
        />,
      );

      const row = screen.getByText("Child objective").closest("li");

      // Capped at three levels, because deeper indentation costs more width than it
      // explains at 360 pixels (`spec/UI-GUIDELINES.md` section 1.2).
      expect(row).toHaveAttribute("data-depth", "3");
      expect(row?.getAttribute("style")).toBeNull();
    });

    it("reports confidence calibration in words, with what each band means", () => {
      render(
        <ProgressDashboard
          view={progressView({
            confidence: [
              {
                confidence: "GUESS",
                attemptCount: 3,
                correctCount: 1,
                percentage: 33,
                correctBand: "CORRECT_UNCERTAIN",
                incorrectBand: "INCORRECT_UNCERTAIN",
              },
              {
                confidence: "CONFIDENT",
                attemptCount: 7,
                correctCount: 6,
                percentage: 86,
                correctBand: "CORRECT_CONFIDENT",
                incorrectBand: "INCORRECT_CONFIDENT",
              },
            ],
          })}
        />,
      );

      expect(screen.getByText("Confidence calibration")).toBeVisible();
      expect(screen.getByText("Guessed")).toBeVisible();
      expect(screen.getByText("Confident")).toBeVisible();
      expect(screen.getByText("3 answers")).toBeVisible();
      expect(screen.getByText("86% correct of 7 answered")).toBeVisible();
      expect(
        screen.getByText(/confident and wrong is the pattern worth acting on/i),
      ).toBeVisible();
    });

    it("counts one answer at a confidence level in the singular", () => {
      render(
        <ProgressDashboard
          view={progressView({
            confidence: [
              {
                confidence: "GUESS",
                attemptCount: 1,
                correctCount: 0,
                percentage: 0,
                correctBand: "CORRECT_UNCERTAIN",
                incorrectBand: "INCORRECT_UNCERTAIN",
              },
            ],
          })}
        />,
      );

      expect(screen.getByText("1 answer")).toBeVisible();
    });

    it("lists recent mistakes with their track, date, and confidence", () => {
      render(
        <ProgressDashboard
          view={progressView({
            recentMistakes: [
              {
                attemptId: "attempt-1",
                questionId: "question-1",
                certificationId: TRACK.id,
                stem: "Which service stores objects?",
                confidence: "CONFIDENT",
                attemptedAt: "2026-03-01T08:00:00.000Z",
              },
            ],
          })}
        />,
      );

      expect(screen.getByText("Recent mistakes")).toBeVisible();
      expect(screen.getByText("Which service stores objects?")).toBeVisible();
      expect(
        screen.getByText(
          /Demo Cloud Practitioner · 2026-03-01 · you were confident/,
        ),
      ).toBeVisible();
      expect(
        screen.getByRole("link", { name: /start a mistake-review session/i }),
      ).toHaveAttribute("href", "/study/new");
    });

    it("names a mistake from a track that has since gone away", () => {
      render(
        <ProgressDashboard
          view={progressView({
            trackNames: new Map(),
            recentMistakes: [
              {
                attemptId: "attempt-1",
                questionId: "question-1",
                certificationId: "certification-gone",
                stem: "An orphaned question",
                confidence: "GUESS",
                attemptedAt: "2026-03-01T08:00:00.000Z",
              },
            ],
          })}
        />,
      );

      // A missing name must not blank the row: the answer was still given.
      expect(screen.getByText(/Removed track/)).toBeVisible();
    });

    it("lists recent sessions with their counts and tracks", () => {
      render(
        <ProgressDashboard
          view={progressView({
            sessions: [
              {
                session: sessionFixture({
                  status: "COMPLETED",
                  createdAt: "2026-03-01T08:00:00.000Z",
                }),
                itemCount: 6,
                settledCount: 5,
                attemptCount: 4,
                correctCount: 3,
              },
            ],
          })}
        />,
      );

      expect(screen.getByText("Recent sessions")).toBeVisible();
      expect(screen.getByText("One study track")).toBeVisible();
      expect(screen.getByText("2026-03-01")).toBeVisible();
      expect(
        screen.getByText(
          /5 of 6 items · 3 of 4 correct · Demo Cloud Practitioner/,
        ),
      ).toBeVisible();
    });

    it("says a flashcards-only session answered no questions", () => {
      render(
        <ProgressDashboard
          view={progressView({
            sessions: [
              {
                session: sessionFixture({ status: "COMPLETED" }),
                itemCount: 4,
                settledCount: 4,
                attemptCount: 0,
                correctCount: 0,
              },
            ],
          })}
        />,
      );

      expect(screen.getByText(/no questions answered/i)).toBeVisible();
      expect(screen.queryByText(/0 of 0 correct/)).toBeNull();
    });

    it("offers to resume a session that is still running", () => {
      render(
        <ProgressDashboard
          view={progressView({
            sessions: [
              {
                session: sessionFixture({ status: "IN_PROGRESS" }),
                itemCount: 6,
                settledCount: 2,
                attemptCount: 2,
                correctCount: 1,
              },
            ],
          })}
        />,
      );

      expect(screen.getByText("In progress")).toBeVisible();
      expect(screen.getByRole("link", { name: /resume/i })).toHaveAttribute(
        "href",
        "/study/sessions/session-1",
      );
    });

    it("offers no resume link for a finished session", () => {
      render(
        <ProgressDashboard
          view={progressView({
            sessions: [
              {
                session: sessionFixture({ status: "COMPLETED" }),
                itemCount: 6,
                settledCount: 6,
                attemptCount: 6,
                correctCount: 4,
              },
            ],
          })}
        />,
      );

      expect(screen.queryByRole("link", { name: /resume/i })).toBeNull();
    });

    it("links straight into a session for the track being read about", () => {
      render(<ProgressDashboard view={progressView()} />);

      expect(
        screen.getByRole("link", { name: /study demo cloud practitioner/i }),
      ).toHaveAttribute("href", `/study/new?track=${TRACK.slug}`);
    });

    it("shows no pass probability, readiness score, or predicted grade", () => {
      render(<ProgressDashboard view={progressView()} />);

      // `SPEC.md` section 6.8 forbids it, and this is the page that would be
      // tempted to add one.
      expect(
        screen.queryByText(
          /pass probability|readiness|predicted|likely to pass/i,
        ),
      ).toBeNull();
    });
  });
});
