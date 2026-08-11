import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isDomainError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { toInvalidFormState } from "@/shared/ui/form-state";
import { questionInputSchema } from "@/modules/question-bank/application/schemas";
import {
  assertValidContent,
  choiceId,
} from "@/modules/question-bank/domain/question-content";
import type { QuestionType } from "@/modules/question-bank/domain/question";
import { revisionFixture } from "@/modules/question-bank/infrastructure/test-support";
import { QuestionForm } from "./question-form";

/**
 * The form is exercised against the real schema plus the real domain assertion,
 * because that pair is what an action runs. A stubbed action would prove only
 * that the markup renders.
 */
function validatingAction(
  onValid: (values: Record<string, unknown>) => void = () => undefined,
) {
  return async (_state: FormState, form: FormData): Promise<FormState> => {
    const questionType = String(form.get("questionType"));
    const submitted =
      questionType === "SHORT_ANSWER"
        ? {
            questionType,
            stem: String(form.get("stem") ?? ""),
            instructions: String(form.get("instructions") ?? ""),
            explanation: String(form.get("explanation") ?? ""),
            difficulty: String(form.get("difficulty") ?? ""),
            tags: String(form.get("tags") ?? ""),
            language: String(form.get("language") ?? ""),
            expectedConcepts: String(form.get("expectedConcepts") ?? ""),
          }
        : {
            questionType,
            stem: String(form.get("stem") ?? ""),
            instructions: String(form.get("instructions") ?? ""),
            explanation: String(form.get("explanation") ?? ""),
            difficulty: String(form.get("difficulty") ?? ""),
            tags: String(form.get("tags") ?? ""),
            language: String(form.get("language") ?? ""),
            choiceTexts: form.getAll("choiceText").map(String),
            correctChoiceIndexes: form.getAll("correctChoiceIndex").map(String),
          };

    try {
      const input = parseInput(questionInputSchema, submitted);

      if (input.questionType === "SHORT_ANSWER") {
        assertValidContent({
          type: "SHORT_ANSWER",
          expectedConcepts: input.expectedConcepts,
        });
      } else {
        const choices = input.choiceTexts
          .map((text, index) => ({ id: choiceId(index), text }))
          .filter((choice) => choice.text.length > 0);
        const marked = input.correctChoiceIndexes.map(choiceId);

        assertValidContent(
          input.questionType === "SINGLE_CHOICE"
            ? {
                type: "SINGLE_CHOICE",
                choices,
                correctChoiceId: marked[0] ?? "",
              }
            : {
                type: "MULTIPLE_RESPONSE",
                choices,
                correctChoiceIds: marked,
              },
        );
      }

      onValid(input);
    } catch (error) {
      if (isDomainError(error)) {
        return toInvalidFormState(error, form);
      }
      throw error;
    }

    return { status: "idle", fieldErrors: {}, values: {} };
  };
}

function renderForm(options: {
  readonly questionType?: QuestionType;
  readonly action?: ReturnType<typeof validatingAction>;
  readonly revision?: ReturnType<typeof revisionFixture>;
}): void {
  render(
    <QuestionForm
      action={options.action ?? validatingAction()}
      submitLabel="Save as draft"
      cancelHref="/study-tracks/demo/questions"
      slug="demo"
      questionType={options.questionType ?? "SINGLE_CHOICE"}
      certificationId="certification-1"
      {...(options.revision === undefined
        ? {}
        : { revision: options.revision, questionId: "question-1" })}
    />,
  );
}

describe("QuestionForm", () => {
  it("labels every field of a single-choice question", () => {
    renderForm({});

    expect(screen.getByLabelText(/question text/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/instructions/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Choice 1")).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /choice 1 is correct/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/explanation/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/difficulty/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^tags$/i)).toBeInTheDocument();
  });

  it("uses radios for single choice and checkboxes for multiple response", () => {
    renderForm({ questionType: "SINGLE_CHOICE" });
    expect(screen.getAllByRole("radio").length).toBeGreaterThan(1);

    renderForm({ questionType: "MULTIPLE_RESPONSE" });
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(1);
  });

  it("shows expected concepts instead of choices for short answer", () => {
    renderForm({ questionType: "SHORT_ANSWER" });

    expect(screen.getByLabelText(/expected concepts/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Choice 1")).not.toBeInTheDocument();
  });

  it("submits a valid single-choice question", async () => {
    const onValid = vi.fn();

    renderForm({ action: validatingAction(onValid) });

    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText(/question text/i),
      "Which service stores objects?",
    );
    await user.type(screen.getByLabelText("Choice 1"), "Amazon S3");
    await user.type(screen.getByLabelText("Choice 2"), "Amazon EBS");
    await user.click(
      screen.getByRole("radio", { name: /choice 1 is correct/i }),
    );
    await user.click(screen.getByRole("button", { name: /save as draft/i }));

    await waitFor(() => {
      expect(onValid).toHaveBeenCalledTimes(1);
    });

    expect(onValid.mock.calls[0]?.[0]).toMatchObject({
      questionType: "SINGLE_CHOICE",
      stem: "Which service stores objects?",
      correctChoiceIndexes: [0],
    });
  });

  it("reports a missing correct answer next to the choices", async () => {
    renderForm({});

    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/question text/i), "A question?");
    await user.type(screen.getByLabelText("Choice 1"), "First");
    await user.type(screen.getByLabelText("Choice 2"), "Second");
    await user.click(screen.getByRole("button", { name: /save as draft/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /mark exactly one of the choices/i,
    );
  });

  it("reports too few choices", async () => {
    renderForm({});

    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/question text/i), "A question?");
    await user.type(screen.getByLabelText("Choice 1"), "Only one");
    await user.click(
      screen.getByRole("radio", { name: /choice 1 is correct/i }),
    );
    await user.click(screen.getByRole("button", { name: /save as draft/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /at least 2 choices/i,
    );
  });

  it("reports missing question text", async () => {
    renderForm({});

    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Choice 1"), "First");
    await user.type(screen.getByLabelText("Choice 2"), "Second");
    await user.click(
      screen.getByRole("radio", { name: /choice 1 is correct/i }),
    );
    await user.click(screen.getByRole("button", { name: /save as draft/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /question text is required/i,
    );
  });

  it("reports missing expected concepts for a short answer", async () => {
    renderForm({ questionType: "SHORT_ANSWER" });

    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/question text/i), "Describe it.");
    await user.click(screen.getByRole("button", { name: /save as draft/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /at least one concept/i,
    );
  });

  it("prefills the fields and the marked answer when editing", () => {
    renderForm({
      revision: revisionFixture({
        stem: "Existing wording?",
        instructions: "Choose one.",
        explanation: "Because S3.",
        difficulty: 4,
        tags: ["storage", "s3"],
        language: "en",
      }),
    });

    expect(screen.getByLabelText(/question text/i)).toHaveValue(
      "Existing wording?",
    );
    expect(screen.getByLabelText(/instructions/i)).toHaveValue("Choose one.");
    expect(screen.getByLabelText("Choice 1")).toHaveValue("Amazon S3");
    expect(screen.getByLabelText("Choice 2")).toHaveValue("Amazon EBS");
    expect(
      screen.getByRole("radio", { name: /choice 1 is correct/i }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: /choice 2 is correct/i }),
    ).not.toBeChecked();
    expect(screen.getByLabelText(/explanation/i)).toHaveValue("Because S3.");
    expect(screen.getByLabelText(/difficulty/i)).toHaveValue("4");
    expect(screen.getByLabelText(/^tags$/i)).toHaveValue("storage, s3");
    expect(screen.getByLabelText(/language/i)).toHaveValue("en");
  });

  it("prefills short-answer concepts one per line", () => {
    renderForm({
      questionType: "SHORT_ANSWER",
      revision: revisionFixture({
        questionType: "SHORT_ANSWER",
        content: {
          type: "SHORT_ANSWER",
          expectedConcepts: ["object storage", "eleven nines"],
        },
      }),
    });

    expect(screen.getByLabelText(/expected concepts/i)).toHaveValue(
      "object storage\neleven nines",
    );
  });

  it("adds a choice row up to the maximum", async () => {
    renderForm({});

    const user = userEvent.setup();
    const addRow = (): HTMLElement =>
      screen.getByRole("button", { name: /add another choice/i });

    expect(screen.queryByLabelText("Choice 5")).not.toBeInTheDocument();

    await user.click(addRow());

    expect(screen.getByLabelText("Choice 5")).toBeInTheDocument();

    // MAX_CHOICES rows, then the control stops offering more.
    await user.click(addRow());
    await user.click(addRow());
    await user.click(addRow());

    expect(screen.getByLabelText("Choice 8")).toBeInTheDocument();
    expect(screen.queryByLabelText("Choice 9")).not.toBeInTheDocument();
    expect(addRow()).toBeDisabled();
  });
});
