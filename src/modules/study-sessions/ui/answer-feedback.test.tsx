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

  it("does not repeat the question it is rendered underneath", () => {
    // Migrated from an assertion that the stem *was* repeated. The panel is rendered
    // directly below the question that was just answered, so repeating the wording
    // pushed the verdict — the thing the owner came for — off a 360px screen. The
    // property that made the old test worth having is kept by the test below: every
    // word still comes from the revision the attempt named.
    renderFeedback({
      revision: revisionFixture({ stem: "The wording the owner saw" }),
    });

    expect(screen.queryByText("The wording the owner saw")).toBeNull();
  });

  it("answers from the revision that was attempted, not the current wording", () => {
    renderFeedback({
      revision: revisionFixture({
        stem: "A wording since edited away",
        explanation: "The reason recorded on that revision.",
      }),
    });

    expect(
      screen.getByText("The reason recorded on that revision."),
    ).toBeVisible();
    // The choices come from the same revision, so an edit cannot change what the
    // owner is told they answered (`spec/DOMAIN-RULES.md` section 2.3).
    expect(screen.getByText("Amazon S3")).toBeVisible();
  });

  it("names the letters the owner picked rather than repeating the text", () => {
    renderFeedback({
      attempt: attemptFixture({
        isCorrect: false,
        submittedAnswer: { type: "SINGLE_CHOICE", choiceId: "choice-2" },
      }),
    });

    expect(screen.getByText("Your answer: b")).toBeVisible();
  });

  it("names every letter of a multiple response the owner picked", () => {
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

    expect(screen.getByText("Your answer: a and c")).toBeVisible();
  });

  it("ticks the correct answer and crosses the wrong choice the owner made", () => {
    renderFeedback({
      attempt: attemptFixture({
        isCorrect: false,
        submittedAnswer: { type: "SINGLE_CHOICE", choiceId: "choice-2" },
      }),
    });

    const chosen = screen.getByText("Amazon EBS").closest("li");
    const answer = screen.getByText("Amazon S3").closest("li");

    // The glyph carries the verdict, the class carries the colour, and a
    // visually-hidden word carries it for a screen reader: three signals, so no one
    // of them is load-bearing alone (`spec/UI-GUIDELINES.md` section 1.3).
    expect(chosen?.textContent).toContain("✗");
    expect(chosen?.className).toContain("verdict-incorrect");
    expect(chosen?.textContent).toContain("Incorrect");
    expect(chosen?.textContent).toContain("you chose this");

    expect(answer?.textContent).toContain("✓");
    expect(answer?.className).toContain("verdict-correct");
    expect(answer?.textContent).toContain("Correct answer");
    expect(answer?.textContent).not.toContain("you chose this");
  });

  it("labels every choice with the letter the answer form offered it under", () => {
    renderFeedback();

    const rows = screen.getAllByRole("listitem");

    expect(rows[0]?.textContent).toContain("a.");
    expect(rows[0]?.textContent).toContain("Amazon S3");
    expect(rows[1]?.textContent).toContain("b.");
    expect(rows[1]?.textContent).toContain("Amazon EBS");
  });

  it("ticks a correct answer the owner chose and says it was theirs", () => {
    renderFeedback();

    const row = screen.getByText("Amazon S3").closest("li");

    expect(row?.textContent).toContain("✓");
    expect(row?.textContent).toContain("Correct answer");
    expect(row?.textContent).toContain("you chose this");
  });

  it("leaves a wrong choice the owner never picked unmarked", () => {
    // There is nothing to say about it, and a mark on every line would make the two
    // that matter harder to find.
    renderFeedback({
      revision: revisionFixture({
        questionType: "MULTIPLE_RESPONSE",
        content: multipleResponseContent(),
      }),
      // Only one of the two correct answers, and not the wrong one.
      attempt: attemptFixture({
        isCorrect: false,
        submittedAnswer: {
          type: "MULTIPLE_RESPONSE",
          choiceIds: ["choice-1"],
        },
      }),
    });

    const untouched = screen.getByText("Colour").closest("li");

    expect(untouched?.className).toBe("feedback-choice");
    expect(untouched?.textContent).not.toContain("✓");
    expect(untouched?.textContent).not.toContain("✗");
    expect(untouched?.textContent).not.toContain("you chose this");
  });

  it("marks each correct answer of a multiple response", () => {
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

    expect(screen.getAllByText("Correct answer")).toHaveLength(2);
    expect(screen.getAllByText("you chose this")).toHaveLength(2);
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

      expect(screen.queryByText("you chose this")).toBeNull();
      // No "Your answer: —" either: the written answer is shown in full below, so a
      // letter summary of nothing would be noise.
      expect(screen.queryByText(/^Your answer: /)).toBeNull();
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
