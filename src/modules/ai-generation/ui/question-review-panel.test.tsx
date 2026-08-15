import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE } from "@/shared/ui/form-state";
import type { QuestionReviewView } from "@/modules/ai-generation/application/generation-facade";
import type {
  QuestionReview,
  ReviewFinding,
} from "@/modules/ai-generation/domain/question-review";
import { generationRunFixture } from "@/modules/ai-generation/infrastructure/test-support";
import { QuestionReviewPanel } from "./question-review-panel";

/**
 * The findings panel.
 *
 * What this screen must get right is honesty about what it is showing. A confident list of
 * findings from a model that consulted nothing reads like a checked question unless the
 * page says otherwise, so the disclaimer is asserted. A dispute is the owner's decision, so
 * the button is asserted to carry the summary as its reason and to submit to the question
 * bank's own action rather than to a second dispute path. And a severity or a verdict must
 * never be communicated by colour alone, so each badge is asserted to carry its word.
 */

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    severity: "MAJOR",
    category: "WRONG_ANSWER",
    detail: "The marked choice describes block storage, not object storage.",
    ...overrides,
  };
}

function review(overrides: Partial<QuestionReview> = {}): QuestionReview {
  return {
    verdict: "SOUND",
    answerCorrect: true,
    findings: [],
    suggestedAction: "APPROVE",
    summary: "The marked answer is correct and no other choice is defensible.",
    ...overrides,
  };
}

function view(overrides: Partial<QuestionReviewView> = {}): QuestionReviewView {
  return {
    run: generationRunFixture({
      itemKind: "QUESTION_REVIEW",
      subjectQuestionId: "question-1",
      subjectRevisionId: "revision-1",
      status: "COMPLETED",
      startedAt: "2026-04-02T10:00:00.000Z",
    }),
    review: review(),
    staleRevision: false,
    offersDispute: false,
    offersAccept: false,
    ...overrides,
  };
}

/** An action that records what a form submitted, for the dispute assertions. */
function recordingAction(sink: Record<string, string>) {
  return async (_state: FormState, form: FormData): Promise<FormState> => {
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") {
        sink[key] = value;
      }
    }

    return IDLE_FORM_STATE;
  };
}

async function noop(): Promise<FormState> {
  return IDLE_FORM_STATE;
}

function renderPanel(
  options: {
    readonly reviewable?: boolean;
    readonly view?: QuestionReviewView | null;
    readonly reviewAction?: (
      state: FormState,
      form: FormData,
    ) => Promise<FormState>;
    readonly disputeAction?: (
      state: FormState,
      form: FormData,
    ) => Promise<FormState>;
    readonly acceptAction?: (
      state: FormState,
      form: FormData,
    ) => Promise<FormState>;
  } = {},
): void {
  render(
    <QuestionReviewPanel
      slug="demo"
      questionId="question-1"
      reviewable={options.reviewable ?? true}
      view={options.view === undefined ? view() : options.view}
      reviewAction={options.reviewAction ?? noop}
      disputeAction={options.disputeAction ?? noop}
      acceptAction={options.acceptAction ?? noop}
    />,
  );
}

describe("the review button", () => {
  it("offers a review for a question that has never had one", () => {
    renderPanel({ view: null });

    expect(
      screen.getByRole("button", { name: "Review with AI" }),
    ).toBeEnabled();
  });

  it("offers a re-review once a review exists", () => {
    // Each request is its own run, so a second opinion is available rather than hidden.
    renderPanel();

    expect(
      screen.getByRole("button", { name: "Review with AI again" }),
    ).toBeEnabled();
  });

  it("says what the review checks and what it will not do", () => {
    renderPanel({ view: null });

    expect(
      screen.getByText(/whether the stated answer is correct/),
    ).toBeVisible();
    expect(screen.getByText(/never rewrites the question/)).toBeVisible();
  });

  it("submits the track and the question, and nothing else to decide", () => {
    const submitted: Record<string, string> = {};

    renderPanel({ view: null, reviewAction: recordingAction(submitted) });

    return userEvent
      .click(screen.getByRole("button", { name: "Review with AI" }))
      .then(async () => {
        await waitFor(() => {
          expect(submitted).toEqual({
            slug: "demo",
            questionId: "question-1",
          });
        });
      });
  });

  it("offers no review for a question taken out of study", () => {
    renderPanel({ reviewable: false, view: null });

    expect(screen.queryByRole("button", { name: /Review with AI/ })).toBeNull();
    expect(
      screen.getByText(/Only a draft or active question can be reviewed/),
    ).toBeVisible();
  });

  it("still shows an earlier review of a question now out of study", () => {
    // The findings were true about the revision they judged, and retiring a question does
    // not unmake them.
    renderPanel({ reviewable: false });

    expect(screen.getByText("Sound")).toBeVisible();
  });
});

describe("the findings panel", () => {
  it("leads with the verdict and the answer judgement", () => {
    renderPanel();

    expect(screen.getByText("Sound")).toBeVisible();
    expect(screen.getByText("Stated answer looks correct")).toBeVisible();
    expect(
      screen.getByText(
        "The marked answer is correct and no other choice is defensible.",
      ),
    ).toBeVisible();
  });

  it("marks a major verdict and a wrong answer with the alert variant, on top of their words", () => {
    renderPanel({
      view: view({
        review: review({
          verdict: "MAJOR_ISSUES",
          answerCorrect: false,
          suggestedAction: "DISPUTE",
          summary: "The marked answer is wrong.",
          findings: [finding()],
        }),
      }),
    });

    expect(screen.getByText("Major issues")).toHaveClass("badge-alert");
    expect(screen.getByText("Stated answer looks wrong")).toHaveClass(
      "badge-alert",
    );
  });

  it("leaves a minor verdict unalarmed, since the question is still usable", () => {
    renderPanel({
      view: view({
        review: review({
          verdict: "MINOR_ISSUES",
          suggestedAction: "REVISE",
          summary: "Correct, but one distractor is implausible.",
          findings: [
            finding({ severity: "MINOR", category: "WEAK_DISTRACTOR" }),
          ],
        }),
      }),
    });

    expect(screen.getByText("Minor issues")).not.toHaveClass("badge-alert");
  });

  it("renders every finding with its severity and its category in words", () => {
    renderPanel({
      view: view({
        review: review({
          verdict: "MAJOR_ISSUES",
          answerCorrect: false,
          suggestedAction: "DISPUTE",
          summary: "Two problems.",
          findings: [
            finding(),
            finding({
              severity: "MINOR",
              category: "AMBIGUOUS",
              detail: "The second choice is defensible too.",
            }),
            finding({
              severity: "INFO",
              category: "OTHER",
              detail: "The explanation could name the service version.",
            }),
          ],
        }),
      }),
    });

    expect(screen.getByText("Major")).toHaveClass("badge-alert");
    expect(screen.getByText("Minor")).not.toHaveClass("badge-alert");
    expect(screen.getByText("Note")).toBeVisible();
    expect(screen.getByText("Stated answer is wrong")).toBeVisible();
    expect(screen.getByText("More than one defensible answer")).toBeVisible();
    expect(
      screen.getByText(
        "The marked choice describes block storage, not object storage.",
      ),
    ).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("says so when the reviewer recorded no individual findings", () => {
    renderPanel();

    expect(
      screen.getByText("The reviewer recorded no individual findings."),
    ).toBeVisible();
  });

  it("names what the reviewer recommends", () => {
    renderPanel();

    expect(screen.getByText("Suggested: Approve this question")).toBeVisible();
  });

  it("states plainly that no source was consulted", () => {
    // The line the whole panel is qualified by (`spec/AI-GUIDELINES.md` section 1.2).
    renderPanel();

    expect(
      screen.getByText(
        "AI review used model knowledge only — no sources were consulted.",
      ),
    ).toBeVisible();
  });

  it("records the model, persona, and version that produced it", () => {
    renderPanel();

    expect(
      screen.getByText(
        /fake-deterministic via fake · persona technical-certification v1 · reviewed 2026-04-02/,
      ),
    ).toBeVisible();
  });

  it("says a review is of an earlier revision when the question has moved on", () => {
    renderPanel({ view: view({ staleRevision: true }) });

    expect(
      screen.getByText(/This review is of an earlier revision/),
    ).toBeVisible();
  });

  it("says nothing about staleness for a current review", () => {
    renderPanel();

    expect(document.body.textContent ?? "").not.toMatch(/earlier revision/);
  });

  it("says the review cannot be read rather than rendering an empty verdict", () => {
    // A hand-edited row, or a payload from a schema that has since changed.
    renderPanel({ view: view({ review: null }) });

    expect(screen.getByText(/This review can no longer be read/)).toBeVisible();
    expect(screen.queryByText("Sound")).toBeNull();
  });

  it("shows no panel at all for a question that has never been reviewed", () => {
    renderPanel({ view: null });

    expect(screen.queryByText("Findings")).toBeNull();
  });
});

describe("the prefilled dispute", () => {
  const DISPUTED = view({
    review: review({
      verdict: "MAJOR_ISSUES",
      answerCorrect: false,
      suggestedAction: "DISPUTE",
      summary: "The marked answer describes the wrong service.",
      findings: [finding()],
    }),
    offersDispute: true,
  });

  it("submits the review's own summary as the recorded reason", async () => {
    // What gets recorded is exactly the text the owner just read, and it goes through the
    // question bank's own dispute action so an AI-prompted dispute is indistinguishable in
    // the data from a typed one.
    const submitted: Record<string, string> = {};

    renderPanel({ view: DISPUTED, disputeAction: recordingAction(submitted) });

    await userEvent.click(
      screen.getByRole("button", { name: "Dispute with this reason" }),
    );

    await waitFor(() => {
      expect(submitted).toEqual({
        slug: "demo",
        questionId: "question-1",
        reason: "The marked answer describes the wrong service.",
      });
    });
  });

  it("says what disputing will do before the owner clicks", async () => {
    // Behind a disclosure, because it takes a question out of study: the owner opens it
    // deliberately rather than finding a live dispute button under a list of findings.
    renderPanel({ view: DISPUTED });

    await userEvent.click(
      screen.getByText("Dispute this question, using the summary above"),
    );

    expect(
      screen.getByText(/takes the question out of study until you resolve it/),
    ).toBeVisible();
  });

  it("offers no dispute button when the reviewer did not recommend one", () => {
    renderPanel();

    expect(
      screen.queryByRole("button", { name: /Dispute with this reason/ }),
    ).toBeNull();
  });

  it("offers no dispute button when the facade withheld it", () => {
    // An already-disputed question: the button would overwrite the owner's own reason.
    renderPanel({
      view: view({ review: DISPUTED.review, offersDispute: false }),
    });

    expect(
      screen.queryByRole("button", { name: /Dispute with this reason/ }),
    ).toBeNull();
    // The recommendation is still readable — only the shortcut is withheld.
    expect(screen.getByText("Suggested: Dispute this question")).toBeVisible();
  });

  it("offers Mark as AI-reviewed only when the facade says accepting would succeed", async () => {
    // The owner's explicit accept (no automatic state change, owner decision
    // 2026-08-15): the button submits the question to the accept action.
    const sink: Record<string, string> = {};
    const user = userEvent.setup();

    renderPanel({
      view: view({ offersAccept: true }),
      acceptAction: recordingAction(sink),
    });

    const button = screen.getByRole("button", { name: "Mark as AI-reviewed" });

    await user.click(button);
    await waitFor(() => {
      expect(sink.questionId).toBe("question-1");
    });
    expect(sink.slug).toBe("demo");
  });

  it("offers no accept button when the promotion is unavailable", () => {
    renderPanel({ view: view({ offersAccept: false }) });

    expect(
      screen.queryByRole("button", { name: "Mark as AI-reviewed" }),
    ).toBeNull();
  });
});
