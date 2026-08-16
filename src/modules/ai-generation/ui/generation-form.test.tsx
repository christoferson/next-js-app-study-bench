import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
import {
  MAX_GROUNDING_CHARACTERS,
  MAX_GROUNDING_CHUNKS,
} from "@/modules/ai-generation/domain/source-grounding";
import type { GroundingSourceSummary } from "@/modules/ai-generation/ports/source-grounding-repository";
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
          generationMode: read("generationMode"),
          sourceIds: readAll("sourceIds"),
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

const SOURCES: readonly GroundingSourceSummary[] = [
  { id: "source-1", title: "Official exam guide", sourceType: "EXAM_GUIDE" },
  { id: "source-2", title: "My VPC notes", sourceType: "NOTE" },
];

function renderForm(
  options: {
    readonly action?: ReturnType<typeof validatingAction>;
    readonly persona?: Persona;
    readonly objectives?: readonly Objective[];
    readonly generateAnyway?: boolean;
    readonly personaChoices?: readonly StoredPersona[];
    readonly assignedPersonaId?: string | null;
    readonly sources?: readonly GroundingSourceSummary[];
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
      {...(options.sources === undefined ? {} : { sources: options.sources })}
      maxGroundingChunks={MAX_GROUNDING_CHUNKS}
      maxGroundingCharacters={MAX_GROUNDING_CHARACTERS}
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
        // The mode that claims the least, chosen by nobody touching the radio.
        generationMode: "MODEL_KNOWLEDGE",
        sourceIds: [],
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

  describe("what it writes from", () => {
    const MODEL_KNOWLEDGE = "From the model's own knowledge";
    const GROUNDED = "From my sources only";
    const HYBRID_MODE =
      "Hybrid — facts from my sources, scenarios from the model";

    /** The hidden field, for the kind that has no radio to read. */
    function submittedMode(): string | null {
      return (
        document.querySelector<HTMLInputElement>(
          'input[type="hidden"][name="generationMode"]',
        )?.value ?? null
      );
    }

    it("offers the three modes for a question batch", () => {
      renderForm({ sources: SOURCES });

      for (const name of [MODEL_KNOWLEDGE, GROUNDED, HYBRID_MODE]) {
        expect(screen.getByRole("radio", { name })).toBeInTheDocument();
      }
      // The mode that claims the least is the one the form opens on.
      expect(
        screen.getByRole("radio", { name: MODEL_KNOWLEDGE }),
      ).toBeChecked();
    });

    it("offers no mode at all for a flashcard batch and posts model knowledge", async () => {
      // A card carries no evidence panel and the link table points at questions, so
      // grounding is a question-only choice. The hidden field keeps the submitted mode
      // honest rather than leaving the facade to infer it.
      renderForm({ sources: SOURCES });

      const user = userEvent.setup();

      await user.click(screen.getByRole("radio", { name: "Flashcards" }));

      expect(screen.queryByRole("radio", { name: GROUNDED })).toBeNull();
      expect(screen.queryByRole("radio", { name: HYBRID_MODE })).toBeNull();
      expect(submittedMode()).toBe("MODEL_KNOWLEDGE");
    });

    it("offers no source picker until a grounded mode is chosen", () => {
      renderForm({ sources: SOURCES });

      expect(
        screen.queryByRole("checkbox", { name: "Official exam guide" }),
      ).toBeNull();
    });

    it("points at the sources page when the track has nothing to ground on", async () => {
      // The choice is still offered and then explained, rather than hidden: a form that
      // silently lacked the option would never tell the owner grounded generation exists.
      renderForm({ sources: [] });

      const user = userEvent.setup();

      await user.click(screen.getByRole("radio", { name: GROUNDED }));

      expect(screen.getByText(/This track has no sources yet\./)).toBeVisible();
      expect(
        screen.getByRole("link", { name: "import a source" }),
      ).toHaveAttribute("href", "/study-tracks/demo/sources");
      // The empty state instead of an empty list of boxes, not as well as one.
      expect(
        within(
          screen.getByRole("group", { name: /Which sources\?/ }),
        ).queryAllByRole("checkbox"),
      ).toEqual([]);
    });

    it("blocks the submit while a grounded mode has no source ticked", async () => {
      renderForm({ sources: SOURCES });

      const user = userEvent.setup();
      const generate = screen.getByRole("button", { name: "Generate" });

      expect(generate).toBeEnabled();

      await user.click(screen.getByRole("radio", { name: GROUNDED }));

      expect(generate).toBeDisabled();
      // Said in words next to the blocked button, because a disabled control that does
      // not explain itself is a dead end (`spec/UI-GUIDELINES.md`).
      expect(screen.getByRole("status")).toHaveTextContent(
        "Tick at least one source to generate from.",
      );

      await user.click(
        screen.getByRole("checkbox", { name: "Official exam guide" }),
      );

      expect(generate).toBeEnabled();
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("tells the owner to import instead when there is no source to tick", async () => {
      renderForm({ sources: [] });

      const user = userEvent.setup();

      await user.click(screen.getByRole("radio", { name: HYBRID_MODE }));

      expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
      expect(screen.getByRole("status")).toHaveTextContent(
        "Import a source, or switch back to the model's own knowledge, to generate.",
      );
    });

    it("states the passage and character caps that will be sent", async () => {
      // The owner is told that a large document contributes its most relevant parts,
      // not all of it, so a short batch from a long guide is not a surprise.
      renderForm({ sources: SOURCES });

      const user = userEvent.setup();

      await user.click(screen.getByRole("radio", { name: GROUNDED }));

      expect(
        screen.getByText(
          new RegExp(
            `At most ${MAX_GROUNDING_CHUNKS} passages and ${MAX_GROUNDING_CHARACTERS.toLocaleString(
              "en-GB",
            )} characters are sent`,
          ),
        ),
      ).toBeVisible();
    });

    it("promises evidence rather than the model's own knowledge while grounded", async () => {
      renderForm({ sources: SOURCES });

      const user = userEvent.setup();

      await user.click(screen.getByRole("radio", { name: GROUNDED }));

      const note = screen.getByText(/saved as a draft for you to review/);

      expect(note).toHaveTextContent("built from passages of your own sources");
      expect(note).toHaveTextContent("never as official exam material");
    });

    it("posts every ticked source under the one name", async () => {
      // One name for all the boxes, so a batch can be grounded on several documents.
      const onValid = vi.fn();

      renderForm({ action: validatingAction(onValid), sources: SOURCES });

      const user = userEvent.setup();

      await user.click(screen.getByRole("radio", { name: HYBRID_MODE }));
      await user.click(
        screen.getByRole("checkbox", { name: "Official exam guide" }),
      );
      await user.click(screen.getByRole("checkbox", { name: "My VPC notes" }));
      await user.click(screen.getByRole("button", { name: "Generate" }));

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });

      expect(onValid.mock.calls[0]?.[0]).toMatchObject({
        generationMode: "HYBRID",
        sourceIds: ["source-1", "source-2"],
      });
    });
  });
});
