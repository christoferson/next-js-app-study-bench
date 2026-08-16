import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnswerEvaluation } from "@/modules/ai-generation/domain/answer-evaluation";
import type { AnswerGradingState } from "./grading-state";
import { IDLE_GRADING_STATE } from "./grading-state";
import { AnswerGradingPanel } from "./answer-grading-panel";

/**
 * The grading panel on the session's feedback screen.
 *
 * The property this screen exists to hold is that **the grading is advice and the owner's
 * own verdict is the record**. So there is asserted to be no control that changes the
 * attempt, the panel is asserted to state whether the model agreed rather than to correct
 * anything, and a provider failure is asserted to say the owner's verdict is unaffected.
 *
 * The result arrives through the action's own return value rather than through a revalidated
 * page, which is unlike every other AI panel and is why the action is the thing scripted
 * here (`ui/grading-state.ts`).
 */

function evaluation(
  overrides: Partial<AnswerEvaluation> = {},
): AnswerEvaluation {
  return {
    verdict: "PARTIALLY_CORRECT",
    conceptsCovered: ["object storage"],
    conceptsMissed: ["eleven nines"],
    feedback: "You named the storage model but not the durability figure.",
    ...overrides,
  };
}

/** An action that returns one grading, and records what the form submitted. */
function gradingAction(
  grading: AnswerEvaluation | null,
  sink: Record<string, string> = {},
  failureCategory: AnswerGradingState["failureCategory"] = null,
) {
  return async (
    _state: AnswerGradingState,
    form: FormData,
  ): Promise<AnswerGradingState> => {
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") {
        sink[key] = value;
      }
    }

    return { ...IDLE_GRADING_STATE, grading, failureCategory };
  };
}

function renderPanel(
  options: {
    readonly recordedCorrect?: boolean;
    readonly answerText?: string;
    readonly gradeAction?: (
      state: AnswerGradingState,
      form: FormData,
    ) => Promise<AnswerGradingState>;
  } = {},
): void {
  render(
    <AnswerGradingPanel
      answerText={options.answerText ?? "It stores objects."}
      gradeAction={options.gradeAction ?? gradingAction(null)}
      questionId="question-1"
      recordedCorrect={options.recordedCorrect ?? false}
      slug="demo"
    />,
  );
}

describe("asking for a grading", () => {
  it("offers a grading behind a button, because it costs a model call", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: "Grade with AI" })).toBeEnabled();
  });

  it("says the owner's own verdict stays the record", () => {
    renderPanel();

    expect(
      screen.getByText(
        /the verdict you recorded above\s+stays the one on record/,
      ),
    ).toBeVisible();
  });

  it("submits the track, the question, and the answer that was recorded", async () => {
    // The answer text travels with the request rather than being re-read, so the grading is
    // of exactly what the attempt stored.
    const submitted: Record<string, string> = {};

    renderPanel({
      answerText: "Objects live in buckets.",
      gradeAction: gradingAction(evaluation(), submitted),
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Grade with AI" }),
    );

    await waitFor(() => {
      expect(submitted).toEqual({
        slug: "demo",
        questionId: "question-1",
        answerText: "Objects live in buckets.",
      });
    });
  });

  it("offers a second grading once one has arrived", async () => {
    renderPanel({ gradeAction: gradingAction(evaluation()) });

    await userEvent.click(
      screen.getByRole("button", { name: "Grade with AI" }),
    );

    expect(
      await screen.findByRole("button", { name: "Grade with AI again" }),
    ).toBeEnabled();
  });
});

describe("the grading that came back", () => {
  it("shows the verdict, the concept lists, and the feedback", async () => {
    renderPanel({ gradeAction: gradingAction(evaluation()) });

    await userEvent.click(
      screen.getByRole("button", { name: "Grade with AI" }),
    );

    expect(await screen.findByText("Covers some of it")).toBeVisible();
    expect(screen.getByText("object storage")).toBeVisible();
    expect(screen.getByText("eleven nines")).toBeVisible();
    expect(
      screen.getByText(
        "You named the storage model but not the durability figure.",
      ),
    ).toBeVisible();
  });

  it("says whether the model agreed with the verdict the owner recorded", async () => {
    renderPanel({
      recordedCorrect: true,
      gradeAction: gradingAction(evaluation({ verdict: "CORRECT" })),
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Grade with AI" }),
    );

    expect(await screen.findByText("Agrees with your verdict")).toBeVisible();
  });

  it("says so plainly when the model disagreed, and corrects nothing", async () => {
    // A disagreement is information, not a correction: there is no control here that
    // changes the attempt (`domain/answer-evaluation.ts`).
    renderPanel({
      recordedCorrect: true,
      gradeAction: gradingAction(
        evaluation({
          verdict: "INCORRECT",
          conceptsCovered: [],
          conceptsMissed: ["object storage", "eleven nines"],
        }),
      ),
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Grade with AI" }),
    );

    expect(await screen.findByText("Differs from your verdict")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Change/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Correct/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Record/ })).toBeNull();
  });

  it("calls a partly-correct grading neither agreement nor disagreement", async () => {
    // Forcing it into either would put a judgement in the badge that the model declined to
    // make.
    renderPanel({
      recordedCorrect: true,
      gradeAction: gradingAction(evaluation()),
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Grade with AI" }),
    );

    expect(await screen.findByText("Partly — your call")).toBeVisible();
  });

  it("names the verdict in words as well as in a badge colour", async () => {
    // `spec/UI-GUIDELINES.md` section 1.3: colour is never the signal.
    renderPanel({
      gradeAction: gradingAction(
        evaluation({ verdict: "INCORRECT", conceptsCovered: [] }),
      ),
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Grade with AI" }),
    );

    expect(await screen.findByText("Does not cover it")).toBeVisible();
  });

  it("says the grading consulted nothing and is not the mark", async () => {
    renderPanel({ gradeAction: gradingAction(evaluation()) });

    await userEvent.click(
      screen.getByRole("button", { name: "Grade with AI" }),
    );

    expect(await screen.findByText(/no sources were consulted/)).toBeVisible();
    expect(
      screen.getByText(/your own verdict is what this attempt keeps/),
    ).toBeVisible();
  });

  it("leaves out an empty concept list rather than showing an empty heading", async () => {
    renderPanel({
      gradeAction: gradingAction(
        evaluation({
          verdict: "CORRECT",
          conceptsCovered: ["object storage", "eleven nines"],
          conceptsMissed: [],
        }),
      ),
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Grade with AI" }),
    );

    expect(
      await screen.findByText("Concepts your answer covered"),
    ).toBeVisible();
    expect(screen.queryByText("Concepts it did not find")).toBeNull();
  });
});

describe("a grading that did not arrive", () => {
  it("says what happened and that the owner's verdict is unaffected", async () => {
    renderPanel({
      gradeAction: gradingAction(null, {}, "PROVIDER_UNAVAILABLE"),
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Grade with AI" }),
    );

    expect(await screen.findByText(/The grading did not arrive/)).toBeVisible();
    expect(
      screen.getByText(/the attempt is still recorded exactly as you marked/),
    ).toBeVisible();
  });

  it("shows nothing about concepts when nothing was graded", async () => {
    renderPanel({ gradeAction: gradingAction(null, {}, "TIMED_OUT") });

    await userEvent.click(
      screen.getByRole("button", { name: "Grade with AI" }),
    );

    await screen.findByText(/The grading did not arrive/);

    expect(screen.queryByText("What the model made of it")).toBeNull();
  });
});
