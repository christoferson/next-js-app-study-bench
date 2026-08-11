import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { certificationFixture } from "@/modules/certifications/infrastructure/test-support";
import type { SessionSummaryView } from "@/modules/study-sessions/application/study-facade";
import {
  attemptFixture,
  sessionFixture,
} from "@/modules/study-sessions/infrastructure/test-support";
import { SessionSummary } from "./session-summary";

/**
 * The complete-session screen.
 *
 * Every assertion here is about honesty of reporting: counted evidence, no accuracy
 * where nothing was answered, and — the prohibition worth a test of its own — nothing
 * resembling a score, a readiness estimate, or a pass probability
 * (`SPEC.md` section 6.8).
 */
function summaryView(
  overrides: Partial<SessionSummaryView> = {},
): SessionSummaryView {
  return {
    session: sessionFixture({ status: "COMPLETED" }),
    tracks: [certificationFixture()],
    itemCount: 4,
    settledCount: 4,
    attemptCount: 3,
    correctCount: 2,
    cardsRated: 1,
    mistakes: [],
    ...overrides,
  };
}

describe("SessionSummary", () => {
  it("reports what the session recorded", () => {
    render(<SessionSummary view={summaryView()} />);

    expect(screen.getByText("Items reached")).toBeVisible();
    expect(screen.getByText("4 of 4")).toBeVisible();
    expect(screen.getByText("Questions answered")).toBeVisible();
    expect(screen.getByText("2 of 3 (67%)")).toBeVisible();
    expect(screen.getByText("Cards rated")).toBeVisible();
  });

  it("names the mode, the outcome, and the tracks studied", () => {
    render(<SessionSummary view={summaryView()} />);

    expect(screen.getByText("One study track")).toBeVisible();
    expect(screen.getByText("Completed")).toBeVisible();
    expect(screen.getByText("Demo Cloud Practitioner")).toBeVisible();
  });

  it("reports items left unreached when the session was finished early", () => {
    render(
      <SessionSummary view={summaryView({ itemCount: 6, settledCount: 4 })} />,
    );

    expect(screen.getByText("Not reached")).toBeVisible();
    expect(screen.getByText("2 items")).toBeVisible();
  });

  it("counts one unreached item in the singular", () => {
    render(
      <SessionSummary view={summaryView({ itemCount: 5, settledCount: 4 })} />,
    );

    expect(screen.getByText("1 item")).toBeVisible();
  });

  it("mentions nothing unreached when the session was worked through", () => {
    render(<SessionSummary view={summaryView()} />);

    expect(screen.queryByText("Not reached")).toBeNull();
  });

  it("omits accuracy rather than reporting 0% for a flashcards-only session", () => {
    render(
      <SessionSummary
        view={summaryView({
          attemptCount: 0,
          correctCount: 0,
          cardsRated: 4,
        })}
      />,
    );

    // No answers is not bad accuracy (`spec/UI-GUIDELINES.md` section 1.4).
    expect(screen.queryByText("Answered correctly")).toBeNull();
    expect(screen.queryByText(/0%/)).toBeNull();
    expect(screen.getByText(/changed no accuracy measurements/i)).toBeVisible();
  });

  it("lists what was missed with how sure the owner had been", () => {
    render(
      <SessionSummary
        view={summaryView({
          mistakes: [
            {
              attempt: attemptFixture({
                id: "attempt-1",
                isCorrect: false,
                confidence: "CONFIDENT",
              }),
              stem: "Which service stores objects?",
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("What you missed")).toBeVisible();
    expect(screen.getByText("Which service stores objects?")).toBeVisible();
    // Confident and wrong is the pattern worth naming, so the summary says it.
    expect(screen.getByText(/you were confident/i)).toBeVisible();
    expect(
      screen.getByText(/queued for a mistake-review session/i),
    ).toBeVisible();
  });

  it("shows no missed section when everything answered was right", () => {
    render(<SessionSummary view={summaryView({ mistakes: [] })} />);

    expect(screen.queryByText("What you missed")).toBeNull();
  });

  it("offers the two next steps a finished session leads to", () => {
    render(<SessionSummary view={summaryView()} />);

    expect(screen.getByRole("link", { name: /study again/i })).toHaveAttribute(
      "href",
      "/study/new",
    );
    expect(
      screen.getByRole("link", { name: /see your progress/i }),
    ).toHaveAttribute("href", "/progress");
  });

  it("shows no score, grade, or readiness estimate", () => {
    render(<SessionSummary view={summaryView()} />);

    // The prohibition is worth asserting rather than trusting: a ten-minute session
    // is not evidence for an exam outcome (`SPEC.md` section 6.8).
    expect(
      screen.queryByText(/pass|probability|ready|readiness|score|grade/i),
    ).toBeNull();
  });
});
