import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE } from "@/shared/ui/form-state";
import type { TutorExchangeView } from "@/modules/ai-generation/application/generation-facade";
import type { TutorResponse } from "@/modules/ai-generation/domain/tutor-exchange";
import { generationRunFixture } from "@/modules/ai-generation/infrastructure/test-support";
import type { Choice } from "@/modules/question-bank/domain/question";
import { TutorPanel } from "./tutor-panel";

/**
 * The tutor panel.
 *
 * What this screen has to get right is what it is *not*. It is not a chat box, so the asks
 * are asserted to be a fixed set of buttons. It is not a source, so the model-knowledge
 * disclaimer is asserted. And a follow-up question it shows is not a bank question, so the
 * line saying it was not added is asserted rather than left to the reader's charity — that
 * is the one place on this page where AI prose looks exactly like owner content.
 *
 * The six asks are also asserted to post their own `kind`, because an ask that posts the
 * wrong kind would spend a real model call answering the wrong question.
 */

// A choice carries no correctness of its own — the content names the correct identifiers —
// so which one is right is passed separately, exactly as the question page passes it.
const CHOICES: readonly Choice[] = [
  { id: "choice-1", text: "Amazon S3" },
  { id: "choice-2", text: "Amazon EBS" },
  { id: "choice-3", text: "Amazon EFS" },
];

function exchange(
  response: TutorResponse,
  overrides: Partial<TutorExchangeView> = {},
): TutorExchangeView {
  return {
    run: generationRunFixture({
      id: `run-${response.kind}`,
      itemKind: "TUTOR_EXPLANATION",
      subjectQuestionId: "question-1",
      subjectRevisionId: "revision-1",
      status: "COMPLETED",
      startedAt: "2026-04-02T10:00:00.000Z",
    }),
    response,
    staleRevision: false,
    ...overrides,
  };
}

async function noop(): Promise<FormState> {
  return IDLE_FORM_STATE;
}

/** An action that records what one form submitted. */
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

function renderPanel(
  options: {
    readonly choices?: readonly Choice[];
    readonly correctChoiceIds?: readonly string[];
    readonly exchanges?: readonly TutorExchangeView[];
    readonly askAction?: (
      state: FormState,
      form: FormData,
    ) => Promise<FormState>;
  } = {},
): void {
  render(
    <TutorPanel
      askAction={options.askAction ?? noop}
      choices={options.choices ?? CHOICES}
      correctChoiceIds={options.correctChoiceIds ?? ["choice-1"]}
      exchanges={options.exchanges ?? []}
      questionId="question-1"
      slug="demo"
    />,
  );
}

describe("the asks", () => {
  it("offers the five explanations and the follow-up question as buttons", () => {
    // A fixed menu, not a message box: this is the design (`tutor-exchange.ts`), so the
    // absence of a free-text prompt field is asserted rather than assumed.
    renderPanel();

    for (const label of [
      "Explain the answer",
      "Explain it simply",
      "Explain it technically",
      "Give an example",
      "Ask me a follow-up question",
      "Explain that choice",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeEnabled();
    }

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("posts the track, the question, and its own ask kind", async () => {
    const sink: Record<string, string> = {};

    renderPanel({ askAction: recordingAction(sink) });

    await userEvent.click(
      screen.getByRole("button", { name: "Explain it simply" }),
    );

    await waitFor(() => {
      expect(sink).toEqual({
        slug: "demo",
        questionId: "question-1",
        kind: "EXPLAIN_SIMPLER",
      });
    });
  });

  it("posts the chosen identifier with the choice ask", async () => {
    const sink: Record<string, string> = {};

    renderPanel({ askAction: recordingAction(sink) });

    await userEvent.selectOptions(
      screen.getByLabelText("Why is one of the other choices wrong?"),
      "choice-3",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Explain that choice" }),
    );

    await waitFor(() => {
      expect(sink.kind).toBe("EXPLAIN_CHOICE");
      expect(sink.choiceId).toBe("choice-3");
    });
  });

  it("offers only the choices the question does not mark correct", () => {
    // "Why is the right answer wrong" is not answerable, and `EXPLAIN_ANSWER` already
    // covers the correct one.
    renderPanel();

    const options = screen
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(options).toEqual(["b. Amazon EBS", "c. Amazon EFS"]);
  });

  it("drops the choice ask entirely for a question with no choices", () => {
    // A short-answer question has no choice to ask about.
    renderPanel({ choices: [], correctChoiceIds: [] });

    expect(
      screen.queryByRole("button", { name: "Explain that choice" }),
    ).toBeNull();
    // The other asks still work, because they are about the question rather than a choice.
    expect(
      screen.getByRole("button", { name: "Explain the answer" }),
    ).toBeEnabled();
  });

  it("drops the choice ask when every choice is marked correct", () => {
    renderPanel({
      correctChoiceIds: ["choice-1", "choice-2", "choice-3"],
    });

    expect(
      screen.queryByRole("button", { name: "Explain that choice" }),
    ).toBeNull();
  });

  it("says the tutor explains the question and never changes it", () => {
    renderPanel();

    expect(screen.getByText(/it never changes it/)).toBeVisible();
  });

  it("marks only the pressed ask as waiting", async () => {
    // One `useActionState` per button: a model call takes seconds, and six buttons going
    // grey at once would say the panel is busy rather than that this ask is.
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    renderPanel({
      askAction: async () => {
        await pending;

        return IDLE_FORM_STATE;
      },
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Explain the answer" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Asking…" })).toBeDisabled();
    });
    expect(
      screen.getByRole("button", { name: "Explain it technically" }),
    ).toBeEnabled();

    release();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Explain the answer" }),
      ).toBeEnabled();
    });
  });

  it("shows a refusal beside the ask that was refused", async () => {
    // A question that has gone from the track: the message belongs next to the button
    // rather than at the top of a long page.
    renderPanel({
      askAction: async () => ({
        status: "invalid",
        fieldErrors: {
          "": ["This question is no longer here. Reload the page."],
        },
        values: {},
      }),
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Give an example" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("This question is no longer here. Reload the page."),
      ).toBeVisible();
    });
  });
});

describe("what the tutor said", () => {
  it("says nothing has been asked yet when there are no exchanges", () => {
    renderPanel();

    expect(
      screen.getByText("You have not asked anything about this question yet."),
    ).toBeVisible();
  });

  it("renders an explanation under the name of the ask it answers", () => {
    // Six kinds of answer in one list are otherwise indistinguishable prose.
    renderPanel({
      exchanges: [
        exchange({
          kind: "EXPLAIN_TECHNICAL",
          text: "Object storage addresses whole objects by key.",
        }),
      ],
    });

    // The heading of the recorded card, not the button of the same name that asks again.
    expect(screen.getByRole("listitem").textContent).toContain(
      "Explain it technically",
    );
    expect(
      screen.getByText("Object storage addresses whole objects by key."),
    ).toBeVisible();
  });

  it("states that nothing was looked up and nothing is cited", () => {
    // The claim the whole panel is qualified by (`spec/AI-GUIDELINES.md` section 1.2).
    renderPanel({
      exchanges: [
        exchange({ kind: "EXPLAIN_ANSWER", text: "Because buckets." }),
      ],
    });

    expect(screen.getByText(/nothing was looked up/)).toBeVisible();
    expect(screen.getAllByText("Model knowledge only")[0]).toBeVisible();
  });

  it("records the model, the persona, and the date of each answer", () => {
    renderPanel({
      exchanges: [
        exchange({ kind: "EXPLAIN_ANSWER", text: "Because buckets." }),
      ],
    });

    expect(
      screen.getByText(
        /fake-deterministic via fake · persona technical-certification v1 · asked 2026-04-02/,
      ),
    ).toBeVisible();
  });

  it("links the run history, where the cost of every ask is", () => {
    renderPanel({
      exchanges: [
        exchange({ kind: "EXPLAIN_ANSWER", text: "Because buckets." }),
      ],
    });

    expect(
      screen.getByRole("link", { name: "every ask is in the run history" }),
    ).toHaveAttribute("href", "/study-tracks/demo/generation-runs");
  });

  it("shows a follow-up question with its answer behind a disclosure", async () => {
    renderPanel({
      exchanges: [
        exchange({
          kind: "FOLLOW_UP_QUESTION",
          stem: "Which tier suits a 40 TB archive?",
          answer: "S3 Glacier Deep Archive.",
          explanation: "It is the cheapest durable tier for rarely-read data.",
        }),
      ],
    });

    expect(screen.getByText("Which tier suits a 40 TB archive?")).toBeVisible();
    // Attemptable before it is checked, as everywhere else in the bank.
    expect(screen.getByText("S3 Glacier Deep Archive.")).not.toBeVisible();

    await userEvent.click(screen.getByText("Show the answer"));

    expect(screen.getByText("S3 Glacier Deep Archive.")).toBeVisible();
  });

  it("says plainly that a follow-up question was not added to the bank", () => {
    // The one place on this page where model prose looks exactly like owner content.
    renderPanel({
      exchanges: [
        exchange({
          kind: "FOLLOW_UP_QUESTION",
          stem: "Which tier suits a 40 TB archive?",
          answer: "S3 Glacier Deep Archive.",
          explanation: "It is the cheapest durable tier for rarely-read data.",
        }),
      ],
    });

    expect(
      screen.getByText(/It was not added to your question bank/),
    ).toBeVisible();
  });

  it("says an answer is about an earlier revision once the question is edited", () => {
    renderPanel({
      exchanges: [
        exchange(
          { kind: "EXPLAIN_ANSWER", text: "Because buckets." },
          { staleRevision: true },
        ),
      ],
    });

    expect(
      screen.getByText(/This answer is about an earlier revision/),
    ).toBeVisible();
  });

  it("says nothing about staleness for a current answer", () => {
    renderPanel({
      exchanges: [
        exchange({ kind: "EXPLAIN_ANSWER", text: "Because buckets." }),
      ],
    });

    expect(document.body.textContent ?? "").not.toMatch(/earlier revision/);
  });

  it("says an answer cannot be read rather than rendering an empty card", () => {
    // A payload from a schema that has since changed, or a hand-edited row.
    renderPanel({
      exchanges: [
        {
          ...exchange({ kind: "EXPLAIN_ANSWER", text: "unused" }),
          response: null,
        },
      ],
    });

    expect(screen.getByText("This answer can no longer be read")).toBeVisible();
    expect(
      screen.getByText(/Asking again records a fresh answer/),
    ).toBeVisible();
  });

  it("lists several exchanges in the order it was given them", () => {
    // Newest first is the facade's ordering; the panel does not re-sort it.
    renderPanel({
      exchanges: [
        exchange({ kind: "EXPLAIN_SIMPLER", text: "The simple one." }),
        exchange({ kind: "EXPLAIN_ANSWER", text: "The first one." }),
      ],
    });

    expect(
      screen
        .getAllByRole("listitem")
        .map((item) => item.textContent?.startsWith("Explain it simply")),
    ).toEqual([true, false]);
    expect(screen.getAllByRole("listitem")[1]?.textContent).toContain(
      "The first one.",
    );
  });
});
