import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isDomainError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE, toInvalidFormState } from "@/shared/ui/form-state";
import { objectiveFixture } from "@/modules/certifications/infrastructure/test-support";
import type { Objective } from "@/modules/certifications/domain/objective";
import { generationRequestSchema } from "@/modules/ai-generation/application/schemas";
import type { GenerationRequestInput } from "@/modules/ai-generation/application/schemas";
import { MAX_BATCH_ITEMS } from "@/modules/ai-generation/domain/generation-limits";
import { personaForStudyType } from "@/modules/ai-generation/domain/personas";
import type { Persona } from "@/modules/ai-generation/domain/personas";
import type { StoredPersona } from "@/modules/ai-generation/domain/stored-persona";
import { storedPersonaFixture } from "@/modules/ai-generation/infrastructure/persona-test-support";
import { GenerationForm } from "./generation-form";

/**
 * The generate form, driven through the real request schema.
 *
 * The action here is the same pair a Server Action runs — `parseInput` with
 * `generationRequestSchema`, then `toInvalidFormState` — so a request the schema
 * refuses is reported next to the field that caused it, and a request it accepts is
 * asserted as the parsed value the facade would receive. A stubbed action would prove
 * only that the markup renders.
 */
function validatingAction(
  onValid: (input: GenerationRequestInput) => void = () => undefined,
) {
  return async (_state: FormState, form: FormData): Promise<FormState> => {
    const read = (field: string): string => String(form.get(field) ?? "");
    const readAll = (field: string): string[] =>
      form.getAll(field).map((value) => String(value));

    try {
      onValid(
        parseInput(generationRequestSchema, {
          itemKind: read("itemKind"),
          itemCount: read("itemCount"),
          difficulty: read("difficulty"),
          objectiveIds: readAll("objectiveIds"),
          additionalInstructions: read("additionalInstructions"),
          questionTypes: readAll("questionTypes"),
          cardTypes: readAll("cardTypes"),
          personaId: read("personaId"),
          generateAnyway: read("generateAnyway"),
        }),
      );
    } catch (error) {
      if (isDomainError(error)) {
        return toInvalidFormState(error, form);
      }
      throw error;
    }

    return IDLE_FORM_STATE;
  };
}

const TECHNICAL = personaForStudyType("TECHNICAL_CERTIFICATION");
const HSK = personaForStudyType("LANGUAGE_PROFICIENCY");

const OBJECTIVES: readonly Objective[] = [
  objectiveFixture({ id: "objective-1", code: "D1", title: "Demo storage" }),
  objectiveFixture({ id: "objective-2", code: null, title: "Demo networking" }),
];

const STORED_PERSONAS: readonly StoredPersona[] = [
  storedPersonaFixture({ id: "persona-1", label: "My AWS instructor" }),
  storedPersonaFixture({
    id: "persona-2",
    personaKey: "my-second",
    label: "My second instructor",
  }),
];

function renderForm(
  options: {
    readonly action?: ReturnType<typeof validatingAction>;
    readonly persona?: Persona;
    readonly objectives?: readonly Objective[];
    readonly generateAnyway?: boolean;
    readonly personaChoices?: readonly StoredPersona[];
    readonly assignedPersonaId?: string | null;
  } = {},
): void {
  render(
    <GenerationForm
      action={options.action ?? validatingAction()}
      slug="demo"
      persona={options.persona ?? TECHNICAL}
      objectives={options.objectives ?? OBJECTIVES}
      maxItemCount={MAX_BATCH_ITEMS}
      modelProvider="fake"
      modelId="fake-deterministic"
      {...(options.personaChoices === undefined
        ? {}
        : { personaChoices: options.personaChoices })}
      {...(options.assignedPersonaId === undefined
        ? {}
        : { assignedPersonaId: options.assignedPersonaId })}
      {...(options.generateAnyway === undefined
        ? {}
        : { generateAnyway: options.generateAnyway })}
    />,
  );
}

describe("GenerationForm", () => {
  describe("what it offers", () => {
    it("asks for the one decision that changes the rest of the form", () => {
      renderForm();

      expect(
        screen.getByRole("radio", { name: "Questions" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("radio", { name: "Flashcards" }),
      ).toBeInTheDocument();
      // Questions is the default, so the form is usable without touching it.
      expect(screen.getByRole("radio", { name: "Questions" })).toBeChecked();
    });

    it("shows question controls for a question batch and no card controls", () => {
      renderForm();

      expect(screen.getByLabelText("Difficulty")).toBeInTheDocument();
      expect(
        screen.getByRole("checkbox", { name: "Single choice" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("checkbox", { name: /^Vocabulary/ }),
      ).toBeNull();
    });

    it("swaps to card controls when the owner switches kind, with nothing disabled", async () => {
      renderForm();

      const user = userEvent.setup();

      await user.click(screen.getByRole("radio", { name: "Flashcards" }));

      expect(
        screen.getByRole("checkbox", {
          name: "Vocabulary (term / reading / meaning)",
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("checkbox", { name: "Cloze (fill in the blank)" }),
      ).toBeInTheDocument();
      // The irrelevant controls are absent rather than disabled
      // (`spec/UI-GUIDELINES.md`: no dead controls).
      expect(screen.queryByLabelText("Difficulty")).toBeNull();
      expect(
        screen.queryByRole("checkbox", { name: "Single choice" }),
      ).toBeNull();
    });

    it("states the batch bounds and says where a large batch begins", () => {
      renderForm();

      expect(screen.getByText(/Between 1 and 10\./)).toBeVisible();
      expect(screen.getByText(/more than 5 is a large batch/)).toBeVisible();
    });

    it("names what the persona writes when the owner ticks no type", () => {
      // Ticking none has a defined meaning, so it is stated rather than left to be
      // guessed at.
      renderForm();

      expect(
        screen.getByText(/writes Single choice and Multiple response/),
      ).toBeVisible();
    });

    it("names the HSK persona's own defaults for the same control", async () => {
      renderForm({ persona: HSK });

      expect(
        screen.getByText(/writes Single choice and Short answer/),
      ).toBeVisible();

      const user = userEvent.setup();

      await user.click(screen.getByRole("radio", { name: "Flashcards" }));

      expect(screen.getByText(/writes Vocabulary and Cloze/)).toBeVisible();
    });

    it("offers the track's objectives with their codes", () => {
      renderForm();

      expect(
        screen.getByRole("checkbox", { name: "D1 — Demo storage" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("checkbox", { name: "Demo networking" }),
      ).toBeInTheDocument();
    });

    it("says so plainly when the track has no objective to target", () => {
      renderForm({ objectives: [] });

      expect(
        screen.getByText(/no active objectives yet, so nothing generated here/),
      ).toBeVisible();
      expect(screen.queryByRole("checkbox", { name: /Demo/ })).toBeNull();
    });

    it("names the persona and model that will be billed", () => {
      renderForm();

      expect(
        screen.getByText(/Persona: Technical certification, version 1\./),
      ).toBeVisible();
      expect(screen.getByText("fake-deterministic")).toBeVisible();
    });

    it("promises a draft and refuses the word official", () => {
      renderForm();

      const note = screen.getByText(/saved as a draft for you to review/);

      expect(note).toHaveTextContent("never as official exam material");
    });

    it("offers the duplicate confirmation only when there is a duplicate", () => {
      renderForm();

      expect(
        screen.queryByRole("checkbox", { name: /again anyway/ }),
      ).toBeNull();
    });

    it("pre-ticks the confirmation when the owner has just seen the notice", () => {
      // Pre-ticked because pressing Generate again is what the notice offered; the
      // owner should not have to find a control to repeat themselves.
      renderForm({ generateAnyway: true });

      expect(
        screen.getByRole("checkbox", { name: /again anyway/ }),
      ).toBeChecked();
    });
  });

  describe("what it submits", () => {
    it("submits a question batch as the facade will receive it", async () => {
      const onValid = vi.fn();

      renderForm({ action: validatingAction(onValid) });

      const user = userEvent.setup();
      const count = screen.getByLabelText(/how many/i);

      await user.clear(count);
      await user.type(count, "4");
      await user.selectOptions(screen.getByLabelText("Difficulty"), "5");
      await user.click(screen.getByRole("checkbox", { name: "Single choice" }));
      await user.click(
        screen.getByRole("checkbox", { name: "D1 — Demo storage" }),
      );
      await user.type(
        screen.getByLabelText(/your notes/i),
        "focus on cost trade-offs",
      );
      await user.click(screen.getByRole("button", { name: "Generate" }));

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });

      expect(onValid.mock.calls[0]?.[0]).toEqual({
        itemKind: "QUESTION",
        itemCount: 4,
        difficulty: 5,
        objectiveIds: ["objective-1"],
        additionalInstructions: "focus on cost trade-offs",
        questionTypes: ["SINGLE_CHOICE"],
        cardTypes: [],
        // No select is rendered when the owner has stored no persona, so the request
        // carries nothing and the facade falls back to the track's own assignment.
        personaId: null,
        generateAnyway: false,
      });
    });

    it("submits a flashcard batch with no question fields at all", async () => {
      const onValid = vi.fn();

      renderForm({ action: validatingAction(onValid), persona: HSK });

      const user = userEvent.setup();

      await user.click(screen.getByRole("radio", { name: "Flashcards" }));
      await user.click(screen.getByRole("checkbox", { name: /^Vocabulary/ }));
      await user.click(screen.getByRole("button", { name: "Generate" }));

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });

      expect(onValid.mock.calls[0]?.[0]).toMatchObject({
        itemKind: "FLASHCARD",
        itemCount: 3,
        // Absent from the form for this kind, so absent from the request.
        difficulty: null,
        questionTypes: [],
        cardTypes: ["VOCABULARY"],
      });
    });

    it("submits the confirmation the notice asked for", async () => {
      const onValid = vi.fn();

      renderForm({
        action: validatingAction(onValid),
        generateAnyway: true,
      });

      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Generate" }));

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });

      expect(onValid.mock.calls[0]?.[0]?.generateAnyway).toBe(true);
    });

    it("leaves the confirmation off when the owner unticks it", async () => {
      const onValid = vi.fn();

      renderForm({
        action: validatingAction(onValid),
        generateAnyway: true,
      });

      const user = userEvent.setup();

      await user.click(screen.getByRole("checkbox", { name: /again anyway/ }));
      await user.click(screen.getByRole("button", { name: "Generate" }));

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });

      expect(onValid.mock.calls[0]?.[0]?.generateAnyway).toBe(false);
    });
  });

  describe("the persona choice", () => {
    it("offers no select at all when the owner has stored no persona", () => {
      // A select whose only option is "automatic" is a dead control.
      renderForm();

      expect(screen.queryByLabelText("Persona")).toBeNull();
    });

    it("offers automatic plus every persona that suits the track", () => {
      renderForm({ personaChoices: STORED_PERSONAS });

      const options = [
        ...screen.getByLabelText("Persona").querySelectorAll("option"),
      ].map((option) => option.textContent);

      expect(options).toEqual([
        "Automatic (by study type)",
        "My AWS instructor",
        "My second instructor",
      ]);
    });

    it("opens on the track's own assignment", () => {
      renderForm({
        personaChoices: STORED_PERSONAS,
        assignedPersonaId: "persona-2",
      });

      expect(screen.getByLabelText("Persona")).toHaveValue("persona-2");
    });

    it("says the choice applies to this batch and not to the track", async () => {
      renderForm({ personaChoices: STORED_PERSONAS });

      expect(screen.getByText(/does not change the track/)).toBeInTheDocument();
    });

    it("submits the chosen persona", async () => {
      const user = userEvent.setup();
      const onValid = vi.fn();

      renderForm({
        action: validatingAction(onValid),
        personaChoices: STORED_PERSONAS,
      });

      await user.selectOptions(
        screen.getByLabelText("Persona"),
        "My second instructor",
      );
      await user.click(screen.getByRole("button", { name: "Generate" }));

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });
      expect(onValid.mock.calls[0]?.[0]?.personaId).toBe("persona-2");
    });

    it("submits nothing when the owner leaves it automatic", async () => {
      const user = userEvent.setup();
      const onValid = vi.fn();

      renderForm({
        action: validatingAction(onValid),
        personaChoices: STORED_PERSONAS,
        assignedPersonaId: null,
      });

      await user.click(screen.getByRole("button", { name: "Generate" }));

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });
      expect(onValid.mock.calls[0]?.[0]?.personaId).toBeNull();
    });
  });

  describe("what it refuses", () => {
    it("reports a batch over the limit on the count field", async () => {
      const onValid = vi.fn();

      renderForm({ action: validatingAction(onValid) });

      const user = userEvent.setup();
      const count = screen.getByLabelText(/how many/i);

      await user.clear(count);
      await user.type(count, "40");
      await user.click(screen.getByRole("button", { name: "Generate" }));

      await waitFor(() => {
        expect(
          screen.getByText("Ask for between 1 and 10 items."),
        ).toBeVisible();
      });

      expect(onValid).not.toHaveBeenCalled();
      expect(count).toHaveAttribute("aria-invalid", "true");
    });

    it("reports an empty count rather than assuming a batch size", async () => {
      renderForm();

      const user = userEvent.setup();

      await user.clear(screen.getByLabelText(/how many/i));
      await user.click(screen.getByRole("button", { name: "Generate" }));

      await waitFor(() => {
        expect(
          screen.getByText("Ask for between 1 and 10 items."),
        ).toBeVisible();
      });
    });

    it("keeps what the owner typed when the request is refused", async () => {
      // The values come back through `toInvalidFormState`, so a rejected request does
      // not cost the owner their notes.
      renderForm();

      const user = userEvent.setup();
      const count = screen.getByLabelText(/how many/i);

      await user.clear(count);
      await user.type(count, "99");
      await user.type(
        screen.getByLabelText(/your notes/i),
        "cover VPC peering",
      );
      await user.click(screen.getByRole("button", { name: "Generate" }));

      await waitFor(() => {
        expect(
          screen.getByText("Ask for between 1 and 10 items."),
        ).toBeVisible();
      });

      expect(screen.getByLabelText(/your notes/i)).toHaveValue(
        "cover VPC peering",
      );
    });

    it("reports over-long notes on the notes field", async () => {
      renderForm();

      const user = userEvent.setup();

      // Typing a thousand characters through the keyboard would be slow; the value is
      // set directly and the form submitted, which is what a paste does.
      const notes = screen.getByLabelText(/your notes/i);

      await user.click(notes);
      await user.paste("x".repeat(1001));
      await user.click(screen.getByRole("button", { name: "Generate" }));

      await waitFor(() => {
        expect(screen.getByText("Use 1000 characters or fewer.")).toBeVisible();
      });
    });
  });
});
