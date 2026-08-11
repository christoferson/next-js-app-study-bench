import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isDomainError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { toInvalidFormState } from "@/shared/ui/form-state";
import { flashcardInputSchema } from "@/modules/flashcards/application/schemas";
import type { FlashcardInput } from "@/modules/flashcards/application/schemas";
import type {
  CardType,
  FlashcardRevision,
} from "@/modules/flashcards/domain/flashcard";
import { assertValidContent } from "@/modules/flashcards/domain/flashcard-content";
import {
  cardRevisionFixture,
  clozeContent,
  scenarioContent,
  vocabularyContent,
} from "@/modules/flashcards/infrastructure/test-support";
import { FlashcardForm } from "./flashcard-form";

/**
 * The form is exercised against the real schema plus the real content invariant,
 * because that pair is what a Server Action runs. A stubbed action would prove only
 * that the markup renders, not that a card the domain refuses is reported next to
 * the field that caused it.
 */
function validatingAction(
  onValid: (input: FlashcardInput) => void = () => undefined,
) {
  return async (_state: FormState, form: FormData): Promise<FormState> => {
    const cardType = String(form.get("cardType") ?? "");
    const read = (field: string): string => String(form.get(field) ?? "");
    const common = {
      cardType,
      notes: read("notes"),
      tags: read("tags"),
      language: read("language"),
    };
    const submitted =
      cardType === "CLOZE"
        ? { ...common, text: read("text") }
        : cardType === "VOCABULARY"
          ? {
              ...common,
              term: read("term"),
              reading: read("reading"),
              meaning: read("meaning"),
              exampleSentence: read("exampleSentence"),
            }
          : cardType === "SCENARIO"
            ? {
                ...common,
                scenario: read("scenario"),
                question: read("question"),
                answer: read("answer"),
              }
            : { ...common, front: read("front"), back: read("back") };

    try {
      const input = parseInput(flashcardInputSchema, submitted);

      // The same content check the facade runs, so a card the domain rejects is
      // reported here exactly as it would be in the application.
      assertValidContent(toContent(input));
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

/** Mirrors the facade's mapping from parsed input to card content. */
function toContent(input: FlashcardInput) {
  switch (input.cardType) {
    case "BASIC":
      return { type: "BASIC" as const, front: input.front, back: input.back };
    case "REVERSED":
      return {
        type: "REVERSED" as const,
        front: input.front,
        back: input.back,
      };
    case "CLOZE":
      return { type: "CLOZE" as const, text: input.text };
    case "VOCABULARY":
      return {
        type: "VOCABULARY" as const,
        term: input.term,
        reading: input.reading,
        meaning: input.meaning,
        exampleSentence: input.exampleSentence,
      };
    case "SCENARIO":
      return {
        type: "SCENARIO" as const,
        scenario: input.scenario,
        question: input.question,
        answer: input.answer,
      };
  }
}

function renderForm(
  options: {
    readonly cardType?: CardType;
    readonly action?: ReturnType<typeof validatingAction>;
    readonly revision?: FlashcardRevision;
  } = {},
): void {
  render(
    <FlashcardForm
      action={options.action ?? validatingAction()}
      submitLabel="Save as draft"
      cancelHref="/study-tracks/demo/flashcards"
      slug="demo"
      cardType={options.cardType ?? "BASIC"}
      certificationId="certification-1"
      {...(options.revision === undefined
        ? {}
        : { revision: options.revision, flashcardId: "flashcard-1" })}
    />,
  );
}

describe("FlashcardForm", () => {
  it("renders the two faces of a basic card", () => {
    renderForm();

    expect(screen.getByLabelText(/^front/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^back/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/your note/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^tags$/i)).toBeInTheDocument();
  });

  it("says which side prompts for a reversed card, since the fields look the same", () => {
    renderForm({ cardType: "REVERSED" });

    expect(
      screen.getByText(/This side prompts you when the card comes up/),
    ).toBeVisible();
  });

  it("renders one sentence field for a cloze card, not two faces", () => {
    renderForm({ cardType: "CLOZE" });

    expect(screen.getByLabelText(/^sentence/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^front/i)).toBeNull();
  });

  it("renders the vocabulary fields, marking the optional ones", () => {
    renderForm({ cardType: "VOCABULARY" });

    expect(screen.getByLabelText(/^term \(required\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^meaning \(required\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Reading")).toBeInTheDocument();
    expect(screen.getByLabelText("Example sentence")).toBeInTheDocument();
  });

  it("renders the three parts of a scenario card", () => {
    renderForm({ cardType: "SCENARIO" });

    expect(screen.getByLabelText(/^situation/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^question/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^answer/i)).toBeInTheDocument();
  });

  it("submits a valid basic card", async () => {
    const onValid = vi.fn();

    renderForm({ action: validatingAction(onValid) });

    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText(/^front/i),
      "What does S3 stand for?",
    );
    await user.type(screen.getByLabelText(/^back/i), "Simple Storage Service");
    await user.type(screen.getByLabelText(/^tags$/i), "storage, storage, s3");
    await user.click(screen.getByRole("button", { name: /save as draft/i }));

    await waitFor(() => {
      expect(onValid).toHaveBeenCalledTimes(1);
    });

    expect(onValid.mock.calls[0]?.[0]).toMatchObject({
      cardType: "BASIC",
      front: "What does S3 stand for?",
      back: "Simple Storage Service",
      // Duplicates collapse rather than blocking the save.
      tags: ["storage", "s3"],
    });
  });

  it("submits a valid vocabulary card with its optional fields empty", async () => {
    const onValid = vi.fn();

    renderForm({ cardType: "VOCABULARY", action: validatingAction(onValid) });

    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^term/i), "AZ");
    await user.type(screen.getByLabelText(/^meaning/i), "Availability Zone");
    await user.click(screen.getByRole("button", { name: /save as draft/i }));

    await waitFor(() => {
      expect(onValid).toHaveBeenCalledTimes(1);
    });

    expect(onValid.mock.calls[0]?.[0]).toMatchObject({
      cardType: "VOCABULARY",
      term: "AZ",
      reading: null,
      exampleSentence: null,
    });
  });

  it("reports a missing front next to the field", async () => {
    renderForm();

    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^back/i), "Simple Storage Service");
    await user.click(screen.getByRole("button", { name: /save as draft/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /front of the card is required/i,
    );
    expect(screen.getByLabelText(/^front/i)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("reports a cloze sentence with no deletion, which the schema alone would accept", async () => {
    renderForm({ cardType: "CLOZE" });

    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText(/^sentence/i),
      "An S3 bucket name must be globally unique.",
    );
    await user.click(screen.getByRole("button", { name: /save as draft/i }));

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(/\{\{/);
    expect(screen.getByLabelText(/^sentence/i)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("keeps the typed text when a submission is rejected", async () => {
    renderForm({ cardType: "SCENARIO" });

    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/^situation/i), "A logs workload.");
    await user.click(screen.getByRole("button", { name: /save as draft/i }));

    // Both missing parts are reported at once, next to their own fields.
    const alerts = await screen.findAllByRole("alert");

    expect(alerts.map((alert) => alert.textContent)).toEqual([
      "A question is required.",
      "An answer is required.",
    ]);
    expect(screen.getByLabelText(/^situation/i)).toHaveValue(
      "A logs workload.",
    );
  });

  it("prefills every field when editing a card of the same type", () => {
    renderForm({
      cardType: "VOCABULARY",
      revision: cardRevisionFixture({
        content: vocabularyContent(),
        notes: "Comes up in every HSK 1 list.",
        tags: ["hsk1", "verbs"],
        language: "zh",
      }),
    });

    expect(screen.getByLabelText(/^term/i)).toHaveValue("学习");
    expect(screen.getByLabelText("Reading")).toHaveValue("xuéxí");
    expect(screen.getByLabelText(/^meaning/i)).toHaveValue(
      "to study; to learn",
    );
    expect(screen.getByLabelText("Example sentence")).toHaveValue(
      "我每天学习汉语。",
    );
    expect(screen.getByLabelText(/your note/i)).toHaveValue(
      "Comes up in every HSK 1 list.",
    );
    expect(screen.getByLabelText(/^tags$/i)).toHaveValue("hsk1, verbs");
    expect(screen.getByLabelText(/language/i)).toHaveValue("zh");
  });

  it("prefills a cloze sentence with its markers, so the deletions stay editable", () => {
    renderForm({
      cardType: "CLOZE",
      revision: cardRevisionFixture({ content: clozeContent() }),
    });

    expect(screen.getByLabelText(/^sentence/i)).toHaveValue(
      "An S3 bucket name must be {{globally unique}}.",
    );
  });

  it("starts the content fields empty when the type is being changed", () => {
    // A scenario card's situation is not a vocabulary term, so retyping a card
    // starts from empty content fields rather than mixing the two.
    renderForm({
      cardType: "VOCABULARY",
      revision: cardRevisionFixture({ content: scenarioContent() }),
    });

    expect(screen.getByLabelText(/^term/i)).toHaveValue("");
    expect(screen.getByLabelText(/^meaning/i)).toHaveValue("");
  });

  it("keeps the note, tags, and language through a type change", () => {
    // These belong to the revision rather than to the content union, so they are
    // still the owner's answer after retyping.
    renderForm({
      cardType: "BASIC",
      revision: cardRevisionFixture({
        content: vocabularyContent(),
        notes: "Keep me.",
        tags: ["hsk1"],
        language: "zh",
      }),
    });

    expect(screen.getByLabelText(/your note/i)).toHaveValue("Keep me.");
    expect(screen.getByLabelText(/^tags$/i)).toHaveValue("hsk1");
    expect(screen.getByLabelText(/language/i)).toHaveValue("zh");
  });

  it("offers a cancel link back to the bank rather than a reset button", () => {
    renderForm();

    expect(screen.getByRole("link", { name: /cancel/i })).toHaveAttribute(
      "href",
      "/study-tracks/demo/flashcards",
    );
  });
});
