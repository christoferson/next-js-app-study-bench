import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { submitAnswerSchema } from "@/modules/study-sessions/application/schemas";
import type { SubmitAnswerInput } from "@/modules/study-sessions/application/schemas";
import type { QuestionContent } from "@/modules/question-bank/domain/question";
import {
  multipleResponseContent,
  revisionFixture,
  shortAnswerContent,
  singleChoiceContent,
} from "@/modules/question-bank/infrastructure/test-support";
import { AnswerForm } from "./answer-form";

/**
 * The answer controls are the heart of the study screen, so they are tested through
 * what the server needs from them: the item on screen, the answer, and a confidence
 * that cannot be omitted.
 *
 * The action parses with the real `submitAnswerSchema`, because that is what the
 * Server Action runs. A stub taking arbitrary values would not prove the form supplies
 * the fields the action requires, nor that it names them as the schema expects.
 */
function answerAction(
  onSubmitted: (input: SubmitAnswerInput) => void = () => undefined,
) {
  return async (_state: FormState, form: FormData): Promise<FormState> => {
    const type = String(form.get("type") ?? "");

    onSubmitted(
      parseInput(submitAnswerSchema, {
        type,
        sessionId: String(form.get("sessionId") ?? ""),
        itemId: String(form.get("itemId") ?? ""),
        confidence: String(form.get("confidence") ?? ""),
        durationSeconds: String(form.get("durationSeconds") ?? ""),
        ...(type === "MULTIPLE_RESPONSE"
          ? { choiceIds: form.getAll("choiceIds").map(String) }
          : type === "SHORT_ANSWER"
            ? {
                text: String(form.get("text") ?? ""),
                selfAssessment: String(form.get("selfAssessment") ?? ""),
              }
            : { choiceId: String(form.get("choiceId") ?? "") }),
      }),
    );

    return { status: "idle", fieldErrors: {}, values: {} };
  };
}

function renderAnswerForm(
  options: {
    readonly content?: QuestionContent;
    readonly instructions?: string | null;
    readonly action?: ReturnType<typeof answerAction>;
  } = {},
): void {
  const content = options.content ?? singleChoiceContent();

  render(
    <AnswerForm
      action={options.action ?? answerAction()}
      sessionId="session-1"
      itemId="item-1"
      revision={revisionFixture({
        content,
        questionType: content.type,
        instructions: options.instructions ?? null,
      })}
    />,
  );
}

describe("AnswerForm", () => {
  describe("single choice", () => {
    it("offers one radio per choice and requires a confidence", () => {
      renderAnswerForm();

      const choices = screen.getAllByRole("radio", {
        name: /Amazon (S3|EBS)/,
      });

      expect(choices).toHaveLength(2);
      // Radios, not checkboxes: one answer means one selection is possible.
      expect(choices[0]).toHaveAttribute("type", "radio");
      expect(
        screen.getByRole("group", { name: /how sure are you/i }),
      ).toBeInTheDocument();
      expect(screen.getByText("Required")).toBeVisible();
    });

    it("offers all four confidence levels with what they mean", () => {
      renderAnswerForm();

      for (const word of ["Guessed", "Unsure", "Fairly sure", "Confident"]) {
        expect(
          screen.getByRole("radio", { name: new RegExp(word) }),
        ).toBeInTheDocument();
      }
    });

    it("submits the session, the item, the choice, and the confidence", async () => {
      const onSubmitted = vi.fn();

      renderAnswerForm({ action: answerAction(onSubmitted) });

      const user = userEvent.setup();

      await user.click(screen.getByRole("radio", { name: /Amazon S3/ }));
      await user.click(screen.getByRole("radio", { name: /Fairly sure/ }));
      await user.click(screen.getByRole("button", { name: /submit answer/i }));

      await waitFor(() => {
        expect(onSubmitted).toHaveBeenCalledTimes(1);
      });

      expect(onSubmitted.mock.calls[0]?.[0]).toEqual({
        type: "SINGLE_CHOICE",
        sessionId: "session-1",
        itemId: "item-1",
        choiceId: "choice-1",
        confidence: "FAIRLY_SURE",
        // Nothing measured in the test environment, so no duration is claimed
        // rather than a false zero.
        durationSeconds: null,
      });
    });

    it("marks every confidence radio required, so no attempt is uncalibrated", () => {
      renderAnswerForm();

      for (const radio of screen.getAllByRole("radio", {
        name: /Guessed|Unsure|Fairly sure|Confident/,
      })) {
        expect(radio).toBeRequired();
      }
    });

    it("shows the question's own instructions when it has them", () => {
      renderAnswerForm({ instructions: "Pick the cheapest option." });

      expect(screen.getByText("Pick the cheapest option.")).toBeVisible();
    });

    it("states the answering rule when the question gives no instructions", () => {
      renderAnswerForm();

      expect(screen.getByText(/choose one answer/i)).toBeVisible();
    });

    it("says that answering saves immediately, which is what makes pausing safe", () => {
      renderAnswerForm();

      expect(screen.getByText(/answering saves straight away/i)).toBeVisible();
    });
  });

  describe("multiple response", () => {
    it("offers checkboxes and says several answers are expected", () => {
      renderAnswerForm({ content: multipleResponseContent() });

      const choices = screen.getAllByRole("checkbox");

      expect(choices).toHaveLength(3);
      expect(screen.getByText(/choose all/i)).toBeVisible();
    });

    it("submits every checked choice", async () => {
      const onSubmitted = vi.fn();

      renderAnswerForm({
        content: multipleResponseContent(),
        action: answerAction(onSubmitted),
      });

      const user = userEvent.setup();

      await user.click(screen.getByRole("checkbox", { name: "Durability" }));
      await user.click(screen.getByRole("checkbox", { name: "Availability" }));
      await user.click(screen.getByRole("radio", { name: /Confident/ }));
      await user.click(screen.getByRole("button", { name: /submit answer/i }));

      await waitFor(() => {
        expect(onSubmitted).toHaveBeenCalledTimes(1);
      });

      expect(onSubmitted.mock.calls[0]?.[0]).toMatchObject({
        type: "MULTIPLE_RESPONSE",
        choiceIds: ["choice-1", "choice-2"],
      });
    });
  });

  describe("short answer", () => {
    it("offers a textarea and no choices", () => {
      renderAnswerForm({ content: shortAnswerContent() });

      expect(screen.getByLabelText(/your answer/i)).toBeInTheDocument();
      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    });

    it("keeps the expected concepts hidden until the owner asks for them", () => {
      renderAnswerForm({ content: shortAnswerContent() });

      // Marking yourself against concepts you can already see is not an answer.
      expect(screen.queryByText("object storage")).toBeNull();
      expect(
        screen.getByRole("button", { name: /show expected concepts/i }),
      ).toBeInTheDocument();
    });

    it("offers no self-grade buttons before the concepts are shown", () => {
      renderAnswerForm({ content: shortAnswerContent() });

      expect(
        screen.queryByRole("button", { name: /i got it right/i }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: /i got it wrong/i }),
      ).toBeNull();
    });

    it("reveals the concepts and then offers both verdicts", async () => {
      renderAnswerForm({ content: shortAnswerContent() });

      const user = userEvent.setup();

      await user.click(
        screen.getByRole("button", { name: /show expected concepts/i }),
      );

      expect(screen.getByText("object storage")).toBeVisible();
      expect(screen.getByText("eleven nines")).toBeVisible();
      expect(
        screen.getByRole("button", { name: /i got it right/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /i got it wrong/i }),
      ).toBeInTheDocument();
    });

    it("says the verdict is the owner's, not a machine grade", async () => {
      renderAnswerForm({ content: shortAnswerContent() });

      const user = userEvent.setup();

      await user.click(
        screen.getByRole("button", { name: /show expected concepts/i }),
      );

      expect(
        screen.getByText(/does not grade free text, so this verdict is yours/i),
      ).toBeVisible();
    });

    it("submits the text with the verdict of whichever button was pressed", async () => {
      const onSubmitted = vi.fn();

      renderAnswerForm({
        content: shortAnswerContent(),
        action: answerAction(onSubmitted),
      });

      const user = userEvent.setup();

      await user.type(
        screen.getByLabelText(/your answer/i),
        "It stores objects durably.",
      );
      await user.click(screen.getByRole("radio", { name: /Confident/ }));
      await user.click(
        screen.getByRole("button", { name: /show expected concepts/i }),
      );
      await user.click(screen.getByRole("button", { name: /i got it wrong/i }));

      await waitFor(() => {
        expect(onSubmitted).toHaveBeenCalledTimes(1);
      });

      expect(onSubmitted.mock.calls[0]?.[0]).toMatchObject({
        type: "SHORT_ANSWER",
        text: "It stores objects durably.",
        selfAssessment: false,
      });
    });

    it("submits a correct verdict from the other button", async () => {
      const onSubmitted = vi.fn();

      renderAnswerForm({
        content: shortAnswerContent(),
        action: answerAction(onSubmitted),
      });

      const user = userEvent.setup();

      await user.type(screen.getByLabelText(/your answer/i), "Objects.");
      await user.click(screen.getByRole("radio", { name: /Guessed/ }));
      await user.click(
        screen.getByRole("button", { name: /show expected concepts/i }),
      );
      await user.click(screen.getByRole("button", { name: /i got it right/i }));

      await waitFor(() => {
        expect(onSubmitted).toHaveBeenCalledTimes(1);
      });

      expect(onSubmitted.mock.calls[0]?.[0]).toMatchObject({
        selfAssessment: true,
        confidence: "GUESS",
      });
    });
  });
});
