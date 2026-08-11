import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { QuestionRevision } from "@/modules/question-bank/domain/question";
import {
  multipleResponseContent,
  revisionFixture,
  shortAnswerContent,
} from "@/modules/question-bank/infrastructure/test-support";
import type { QuestionAttempt } from "@/modules/study-sessions/domain/question-attempt";
import { attemptFixture } from "@/modules/study-sessions/infrastructure/test-support";
import { AnswerFeedback } from "./answer-feedback";

/**
 * Feedback for one recorded answer.
 *
 * Two properties are worth pinning: the verdict is readable without colour, and every
 * word of the answer comes from the revision the attempt named rather than the
 * question's current wording (`spec/DOMAIN-RULES.md` section 2.3).
 */
function renderFeedback(
  options: {
    readonly attempt?: QuestionAttempt;
    readonly revision?: QuestionRevision;
    readonly continueHref?: string;
    readonly continueLabel?: string;
  } = {},
): void {
  render(
    <AnswerFeedback
      attempt={options.attempt ?? attemptFixture()}
      revision={options.revision ?? revisionFixture()}
      continueHref={options.continueHref ?? "/study/sessions/session-1"}
      continueLabel={options.continueLabel ?? "Next question"}
    />,
  );
}

describe("AnswerFeedback", () => {
  it("states the verdict in words rather than by colour alone", () => {
    renderFeedback();

    // A badge class carries the colour; the word carries the meaning
    // (`spec/UI-GUIDELINES.md` section 1.3).
    expect(screen.getByText("Correct")).toBeVisible();
  });

  it("states a wrong answer as incorrect", () => {
    renderFeedback({ attempt: attemptFixture({ isCorrect: false }) });

    expect(screen.getByText("Incorrect")).toBeVisible();
    expect(screen.queryByText("Correct")).toBeNull();
  });

  it("repeats how sure the owner had been", () => {
    renderFeedback({ attempt: attemptFixture({ confidence: "GUESS" }) });

    // Named next to the verdict, because a lucky guess and a confident answer are
    // different evidence about the same question.
    expect(screen.getByText(/you were guessed/i)).toBeVisible();
  });

  it("shows the question as it was answered", () => {
    renderFeedback({
      revision: revisionFixture({ stem: "The wording the owner saw" }),
    });

    expect(screen.getByText("The wording the owner saw")).toBeVisible();
  });

  it("marks the correct answer and what the owner chose", () => {
    renderFeedback({
      attempt: attemptFixture({
        isCorrect: false,
        submittedAnswer: { type: "SINGLE_CHOICE", choiceId: "choice-2" },
      }),
    });

    const chosen = screen.getByText("Amazon EBS").closest("li");
    const answer = screen.getByText("Amazon S3").closest("li");

    expect(chosen?.textContent).toContain("You chose this");
    expect(chosen?.textContent).not.toContain("Correct answer");
    expect(answer?.textContent).toContain("Correct answer");
  });

  it("marks both markers on a choice that was right and chosen", () => {
    renderFeedback();

    const row = screen.getByText("Amazon S3").closest("li");

    expect(row?.textContent).toContain("Correct answer");
    expect(row?.textContent).toContain("You chose this");
  });

  it("marks every choice of a multiple response the owner selected", () => {
    renderFeedback({
      revision: revisionFixture({
        questionType: "MULTIPLE_RESPONSE",
        content: multipleResponseContent(),
      }),
      attempt: attemptFixture({
        isCorrect: false,
        submittedAnswer: {
          type: "MULTIPLE_RESPONSE",
          choiceIds: ["choice-1", "choice-3"],
        },
      }),
    });

    expect(screen.getAllByText("You chose this")).toHaveLength(2);
    expect(screen.getAllByText("Correct answer")).toHaveLength(2);
    expect(screen.getByText("Colour").closest("li")?.textContent).not.toContain(
      "Correct answer",
    );
  });

  describe("a short answer", () => {
    const REVISION = revisionFixture({
      questionType: "SHORT_ANSWER",
      content: shortAnswerContent(),
    });

    it("says the verdict was the owner's own", () => {
      renderFeedback({
        revision: REVISION,
        attempt: attemptFixture({
          evaluationMode: "SELF_ASSESSED",
          submittedAnswer: { type: "SHORT_ANSWER", text: "It stores objects." },
        }),
      });

      // "Correct" the owner decided is a different claim from "correct" the
      // application checked, so the screen distinguishes them.
      expect(screen.getByText("Graded by you")).toBeVisible();
    });

    it("shows what was written back with the concepts expected", () => {
      renderFeedback({
        revision: REVISION,
        attempt: attemptFixture({
          evaluationMode: "SELF_ASSESSED",
          submittedAnswer: { type: "SHORT_ANSWER", text: "It stores objects." },
        }),
      });

      expect(screen.getByText("Your answer")).toBeVisible();
      expect(screen.getByText("It stores objects.")).toBeVisible();
      expect(screen.getByText("Expected concepts")).toBeVisible();
      expect(screen.getByText("object storage")).toBeVisible();
      expect(screen.getByText("eleven nines")).toBeVisible();
    });

    it("offers no choice list, because there are no choices", () => {
      renderFeedback({
        revision: REVISION,
        attempt: attemptFixture({
          evaluationMode: "SELF_ASSESSED",
          submittedAnswer: { type: "SHORT_ANSWER", text: "Objects." },
        }),
      });

      expect(screen.queryByText("You chose this")).toBeNull();
    });
  });

  it("adds no self-graded badge to a checked answer", () => {
    renderFeedback();

    expect(screen.queryByText("Graded by you")).toBeNull();
    expect(
      screen.queryByText("Checked against the recorded answer"),
    ).toBeNull();
  });

  it("shows the explanation recorded on the answered revision", () => {
    renderFeedback({
      revision: revisionFixture({
        explanation: "S3 is object storage; EBS is block storage.",
      }),
    });

    expect(screen.getByText("Explanation")).toBeVisible();
    expect(
      screen.getByText("S3 is object storage; EBS is block storage."),
    ).toBeVisible();
  });

  it("shows no explanation heading when the revision recorded none", () => {
    renderFeedback({ revision: revisionFixture({ explanation: null }) });

    expect(screen.queryByText("Explanation")).toBeNull();
  });

  it("continues wherever the session says next is", () => {
    renderFeedback({
      continueHref: "/study/sessions/session-1/complete",
      continueLabel: "Finish session",
    });

    expect(
      screen.getByRole("link", { name: "Finish session" }),
    ).toHaveAttribute("href", "/study/sessions/session-1/complete");
  });
});
