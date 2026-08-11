import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { revisionFixture } from "@/modules/question-bank/infrastructure/test-support";
import { attemptFixture } from "@/modules/study-sessions/infrastructure/test-support";
import { AttemptHistory } from "./attempt-history";

/**
 * One question's answer history.
 *
 * The point of the component is that a row keeps naming the revision it answered, so
 * editing a question cannot rewrite what the owner was asked
 * (`spec/DOMAIN-RULES.md` section 1.1).
 */
describe("AttemptHistory", () => {
  it("says the question has not been answered yet, and where answers come from", () => {
    render(<AttemptHistory attempts={[]} revisions={[revisionFixture()]} />);

    expect(
      screen.getByText(/have not answered this question yet/i),
    ).toBeVisible();
    expect(screen.getByText(/in a study session appear here/i)).toBeVisible();
  });

  it("lists the answers in the order given, with verdict and confidence", () => {
    render(
      <AttemptHistory
        attempts={[
          attemptFixture({
            id: "attempt-2",
            isCorrect: true,
            confidence: "CONFIDENT",
            attemptedAt: "2026-03-02T08:00:00.000Z",
          }),
          attemptFixture({
            id: "attempt-1",
            isCorrect: false,
            confidence: "GUESS",
            attemptedAt: "2026-03-01T08:00:00.000Z",
          }),
        ]}
        revisions={[revisionFixture()]}
      />,
    );

    const rows = screen.getAllByRole("listitem");

    // The facade hands over newest first; the component preserves that order rather
    // than sorting again, so there is one place the ordering is decided.
    expect(rows[0]?.textContent).toContain("2026-03-02");
    expect(rows[0]?.textContent).toContain("Correct");
    expect(rows[0]?.textContent).toContain("Confident");
    expect(rows[1]?.textContent).toContain("2026-03-01");
    expect(rows[1]?.textContent).toContain("Incorrect");
    expect(rows[1]?.textContent).toContain("Guessed");
  });

  it("names the revision each answer was given against", () => {
    render(
      <AttemptHistory
        attempts={[
          attemptFixture({ id: "attempt-2", questionRevisionId: "revision-2" }),
          attemptFixture({ id: "attempt-1", questionRevisionId: "revision-1" }),
        ]}
        revisions={[
          revisionFixture({ id: "revision-1", revisionNumber: 1 }),
          revisionFixture({
            id: "revision-2",
            revisionNumber: 2,
            stem: "The reworded question",
          }),
        ]}
      />,
    );

    expect(screen.getByText(/revision 2/)).toBeVisible();
    expect(screen.getByText(/revision 1/)).toBeVisible();
  });

  it("still reports an answer whose revision was not supplied", () => {
    render(
      <AttemptHistory
        attempts={[attemptFixture({ questionRevisionId: "revision-9" })]}
        revisions={[revisionFixture({ id: "revision-1", revisionNumber: 1 })]}
      />,
    );

    // A row that cannot name its revision number is still evidence of an answer, so
    // it degrades to a phrase rather than disappearing or showing "revision
    // undefined".
    expect(screen.getByText(/an earlier revision/)).toBeVisible();
  });

  it("reports how long an answer took when it was measured", () => {
    render(
      <AttemptHistory
        attempts={[attemptFixture({ durationSeconds: 42 })]}
        revisions={[revisionFixture()]}
      />,
    );

    expect(screen.getByText(/took 42s/)).toBeVisible();
  });

  it("mentions no duration when nothing was measured", () => {
    render(
      <AttemptHistory
        attempts={[attemptFixture({ durationSeconds: null })]}
        revisions={[revisionFixture()]}
      />,
    );

    // An unmeasured answer must not read as "took 0s".
    expect(screen.queryByText(/took/)).toBeNull();
  });

  it("marks a self-graded answer as the owner's own verdict", () => {
    render(
      <AttemptHistory
        attempts={[
          attemptFixture({
            evaluationMode: "SELF_ASSESSED",
            submittedAnswer: { type: "SHORT_ANSWER", text: "Objects." },
          }),
        ]}
        revisions={[revisionFixture()]}
      />,
    );

    expect(screen.getByText("Graded by you")).toBeVisible();
  });

  it("adds no grading badge to an answer the application checked", () => {
    render(
      <AttemptHistory
        attempts={[attemptFixture()]}
        revisions={[revisionFixture()]}
      />,
    );

    expect(screen.queryByText("Graded by you")).toBeNull();
    expect(
      screen.queryByText("Checked against the recorded answer"),
    ).toBeNull();
  });
});
