import { describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE } from "@/shared/ui/form-state";
import type { QuestionChallengeView } from "@/modules/ai-generation/application/generation-facade";
import type { QuestionChallenge } from "@/modules/ai-generation/domain/question-challenge";
import { generationRunFixture } from "@/modules/ai-generation/infrastructure/test-support";
import { QuestionChallengePanel } from "./question-challenge-panel";

/**
 * The challenge panel.
 *
 * Two acceptance criteria are asserted here. A challenge must produce a **structured quality
 * finding** the owner can act on — so the verdict, the recommendation, and the prefilled
 * dispute are asserted. And the AI must never write the revision — so a `REVISE`
 * recommendation is asserted to render a *note* beside a link to the owner's own edit form,
 * with no control anywhere that applies anything
 * (`spec/AI-GUIDELINES.md` section 1.10).
 */

function challenge(
  overrides: Partial<QuestionChallenge> = {},
): QuestionChallenge {
  return {
    verdict: "STORED_ANSWER_STANDS",
    reasoning:
      "Block storage is durable, but the stem asks which service stores objects.",
    recommendation: "KEEP",
    suggestedRevisionNote: null,
    ...overrides,
  };
}

function view(
  overrides: Partial<QuestionChallengeView> = {},
): QuestionChallengeView {
  return {
    run: generationRunFixture({
      itemKind: "QUESTION_CHALLENGE",
      subjectQuestionId: "question-1",
      subjectRevisionId: "revision-1",
      status: "COMPLETED",
      startedAt: "2026-04-02T10:00:00.000Z",
    }),
    challenge: challenge(),
    staleRevision: false,
    offersDispute: false,
    revisionNote: null,
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
    readonly challengeable?: boolean;
    readonly view?: QuestionChallengeView | null;
    readonly challengeAction?: (
      state: FormState,
      form: FormData,
    ) => Promise<FormState>;
    readonly disputeAction?: (
      state: FormState,
      form: FormData,
    ) => Promise<FormState>;
  } = {},
): void {
  render(
    <QuestionChallengePanel
      challengeAction={options.challengeAction ?? noop}
      challengeable={options.challengeable ?? true}
      disputeAction={options.disputeAction ?? noop}
      questionId="question-1"
      slug="demo"
      view={options.view === undefined ? view() : options.view}
    />,
  );
}

describe("raising an objection", () => {
  it("asks for the objection in the owner's own words", async () => {
    // A textarea rather than a button, unlike every other AI control on the page: there is
    // nothing to adjudicate without the objection. Behind a disclosure because most
    // questions are not objected to, so the summary is opened first.
    renderPanel({ view: null });

    await userEvent.click(screen.getByText("Raise an objection"));

    expect(
      screen.getByRole("textbox", {
        name: "What do you disagree with, and why?",
      }),
    ).toBeVisible();
  });

  it("says the model argues both readings and rewrites nothing", () => {
    renderPanel({ view: null });

    expect(screen.getByText(/argues both\s+readings/)).toBeVisible();
    expect(screen.getByText(/never\s+rewrites the question/)).toBeVisible();
  });

  it("submits the track, the question, and the objection", async () => {
    const submitted: Record<string, string> = {};

    renderPanel({ view: null, challengeAction: recordingAction(submitted) });

    await userEvent.type(
      screen.getByRole("textbox", {
        name: "What do you disagree with, and why?",
      }),
      "choice-2 is also defensible",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Challenge with AI" }),
    );

    await waitFor(() => {
      expect(submitted).toEqual({
        slug: "demo",
        questionId: "question-1",
        reason: "choice-2 is also defensible",
      });
    });
  });

  it("offers another objection once one has been judged", () => {
    renderPanel();

    expect(screen.getByText("Raise another objection")).toBeVisible();
  });

  it("offers no challenge for a question already out of study", () => {
    renderPanel({ challengeable: false, view: null });

    expect(
      screen.queryByRole("button", { name: /Challenge with AI/ }),
    ).toBeNull();
    expect(
      screen.getByText(/Only a draft or active question can be challenged/),
    ).toBeVisible();
  });

  it("still shows an earlier outcome for a question now out of study", () => {
    renderPanel({ challengeable: false });

    expect(screen.getByText("The stored answer stands")).toBeVisible();
  });
});

describe("the outcome", () => {
  it("leads with the verdict and the recommendation, in words", () => {
    // `spec/UI-GUIDELINES.md` section 1.3: never colour alone.
    renderPanel();

    expect(screen.getByText("The stored answer stands")).toBeVisible();
    expect(screen.getByText("Keep this question as it is")).toBeVisible();
    expect(
      screen.getByText(
        "Block storage is durable, but the stem asks which service stores objects.",
      ),
    ).toBeVisible();
  });

  it("names every verdict it can render", () => {
    for (const [verdict, label] of [
      ["OWNER_HAS_A_POINT", "Your objection has a point"],
      ["STORED_ANSWER_WRONG", "The stored answer looks wrong"],
    ] as const) {
      cleanup();
      renderPanel({
        view: view({
          challenge: challenge({ verdict, recommendation: "DISPUTE" }),
        }),
      });

      expect(screen.getByText(label)).toBeVisible();
      expect(screen.getByText("Take this question out of study")).toBeVisible();
    }
  });

  it("says the outcome consulted nothing and changes nothing", () => {
    renderPanel();

    expect(screen.getByText(/no sources were consulted/)).toBeVisible();
    expect(
      screen.getByText(/never changes this question, and never writes a new/),
    ).toBeVisible();
  });

  it("warns when the challenge judged a revision the owner no longer has", () => {
    renderPanel({ view: view({ staleRevision: true }) });

    expect(
      screen.getByText(/This challenge is of an earlier revision/),
    ).toBeVisible();
  });

  it("says the outcome cannot be read when the stored payload no longer validates", () => {
    // Better than a partial verdict: the owner is told to challenge again.
    renderPanel({ view: view({ challenge: null }) });

    expect(
      screen.getByText(/This challenge can no longer be read/),
    ).toBeVisible();
  });

  it("shows nothing at all for a question never challenged", () => {
    renderPanel({ view: null });

    expect(screen.queryByText("Outcome")).toBeNull();
  });
});

describe("the dispute a challenge recommends", () => {
  it("submits the challenge's own reasoning as the reason", async () => {
    // The same action and schema the review panel and the owner's own form use, so a
    // dispute raised from a challenge is indistinguishable in the data.
    const submitted: Record<string, string> = {};

    renderPanel({
      view: view({
        challenge: challenge({
          verdict: "OWNER_HAS_A_POINT",
          recommendation: "DISPUTE",
        }),
        offersDispute: true,
      }),
      disputeAction: recordingAction(submitted),
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Dispute with this reason" }),
    );

    await waitFor(() => {
      expect(submitted).toEqual({
        slug: "demo",
        questionId: "question-1",
        reason:
          "Block storage is durable, but the stem asks which service stores objects.",
      });
    });
  });

  it("says what disputing does before the owner clicks it", async () => {
    renderPanel({
      view: view({
        challenge: challenge({
          verdict: "OWNER_HAS_A_POINT",
          recommendation: "DISPUTE",
        }),
        offersDispute: true,
      }),
    });

    await userEvent.click(
      screen.getByText(
        "Take this question out of study, using the reasoning above",
      ),
    );

    expect(
      screen.getByText(/Disputed questions are left out of new\s+sessions/),
    ).toBeVisible();
  });

  it("offers no dispute when the challenge did not recommend one", () => {
    renderPanel();

    expect(
      screen.queryByRole("button", { name: "Dispute with this reason" }),
    ).toBeNull();
  });
});

describe("the revision a challenge recommends", () => {
  it("shows the note and links to the owner's own edit form", () => {
    // The acceptance criterion: the AI never writes the revision, so what is rendered is a
    // note and a link, and there is no control that applies anything
    // (`spec/AI-GUIDELINES.md` section 1.10).
    renderPanel({
      view: view({
        challenge: challenge({
          recommendation: "REVISE",
          suggestedRevisionNote: "The stem has to name the region.",
        }),
        revisionNote: "The stem has to name the region.",
      }),
    });

    expect(
      screen.getByText("What a new revision would have to change"),
    ).toBeVisible();
    expect(screen.getByText("The stem has to name the region.")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Edit this question" }),
    ).toHaveAttribute("href", "/study-tracks/demo/questions/question-1/edit");
  });

  it("says the note is a note and that nothing was written", () => {
    renderPanel({
      view: view({
        challenge: challenge({
          recommendation: "REVISE",
          suggestedRevisionNote: "The stem has to name the region.",
        }),
        revisionNote: "The stem has to name the region.",
      }),
    });

    expect(screen.getByText(/A note, not a replacement/)).toBeVisible();
    expect(screen.getByText(/you write the new version/)).toBeVisible();
  });

  it("offers no control that applies a revision", () => {
    renderPanel({
      view: view({
        challenge: challenge({
          recommendation: "REVISE",
          suggestedRevisionNote: "The stem has to name the region.",
        }),
        revisionNote: "The stem has to name the region.",
      }),
    });

    for (const name of [/Apply/, /Accept/, /Use this wording/, /Save/]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("shows no note heading when the challenge suggested no revision", () => {
    renderPanel();

    expect(
      screen.queryByText("What a new revision would have to change"),
    ).toBeNull();
  });
});
