import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isDomainError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE, toInvalidFormState } from "@/shared/ui/form-state";
import {
  MAX_SYLLABUS_CHARACTERS,
  MAX_SYLLABUS_FILE_BYTES,
  objectiveImportRequestSchema,
} from "@/modules/ai-generation/application/schemas";
import type { ObjectiveImportRequestInput } from "@/modules/ai-generation/application/schemas";
import { SyllabusUnreadableError } from "@/modules/ai-generation/domain/errors";
import {
  MAX_IMPORT_STRATEGY_FILES,
  defaultImportStrategy,
  importStrategiesFor,
} from "@/modules/ai-generation/domain/import-strategy";
import type { ImportStrategyArchetype } from "@/modules/ai-generation/domain/import-strategy";
import { personaForStudyType } from "@/modules/ai-generation/domain/personas";
import { ObjectiveImportForm } from "./objective-import-form";

/**
 * The upload form, driven through the real request schema.
 *
 * The action here does what the Server Action does — parse, then report — so a paste the
 * schema refuses lands on the paste field and an accepted one is asserted as the value
 * the facade would receive. The file itself is not part of that schema (bytes are not a
 * zod concern), so what the file input is tested for is what it offers the owner and that
 * its bytes actually reach the submitted form.
 */
function validatingAction(
  onValid: (input: ObjectiveImportRequestInput, form: FormData) => void = () =>
    undefined,
) {
  return async (_state: FormState, form: FormData): Promise<FormState> => {
    try {
      onValid(
        parseInput(objectiveImportRequestSchema, {
          strategyKey: String(form.get("strategyKey") ?? ""),
          pastedText: String(form.get("pastedText") ?? ""),
          additionalInstructions: String(
            form.get("additionalInstructions") ?? "",
          ),
          personaId: String(form.get("personaId") ?? ""),
        }),
        form,
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

const PERSONA = personaForStudyType("TECHNICAL_CERTIFICATION");

const SYNTHETIC_OUTLINE = [
  "1. Demo Foundations (40%)",
  "1.1 Describe demo components",
  "2. Demo Operations (60%)",
].join("\n");

function renderForm(
  options: {
    readonly action?: ReturnType<typeof validatingAction>;
    readonly existingObjectiveCount?: number;
    readonly archetype?: ImportStrategyArchetype;
  } = {},
): void {
  const archetype = options.archetype ?? "TECHNICAL";

  render(
    <ObjectiveImportForm
      action={options.action ?? validatingAction()}
      slug="demo-track"
      persona={PERSONA}
      modelProvider="fake"
      modelId="fake-deterministic"
      maxFileBytes={MAX_SYLLABUS_FILE_BYTES}
      maxCharacters={MAX_SYLLABUS_CHARACTERS}
      existingObjectiveCount={options.existingObjectiveCount ?? 0}
      strategies={importStrategiesFor(archetype)}
      defaultStrategyKey={defaultImportStrategy(archetype).key}
      maxFiles={MAX_IMPORT_STRATEGY_FILES}
    />,
  );
}

function submit(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  return user.click(screen.getByRole("button", { name: "Extract outline" }));
}

describe("ObjectiveImportForm", () => {
  describe("what it offers", () => {
    it("offers a file and a paste box as equal alternatives", () => {
      renderForm();

      expect(screen.getByLabelText(/syllabus file/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/paste the outline/i)).toBeInTheDocument();
    });

    it("accepts only the file types the extractor can read", () => {
      // A .docx or an image would fail at extraction, after the upload. Saying so in
      // `accept` puts the refusal in the file picker instead.
      renderForm();

      const accept = screen
        .getByLabelText(/syllabus file/i)
        .getAttribute("accept");

      expect(accept).toContain(".pdf");
      expect(accept).toContain(".txt");
      expect(accept).not.toContain(".docx");
    });

    it("leaves the encoding to React rather than setting it twice", () => {
      // A form carrying a file needs `multipart/form-data` or the server receives a
      // filename and no content — which looks like an unreadable PDF rather than a
      // coding mistake. React sets it itself for a function action, and setting it here
      // as well is overridden *and* warned about at runtime, so the correct thing for
      // this component to do is nothing.
      //
      // Which is why this asserts the absence. The attribute only appears in
      // server-rendered markup, so a client render cannot see it either way; that the
      // real page carries it is verified against the running server.
      renderForm();

      expect(
        screen.getByRole("button", { name: "Extract outline" }).closest("form"),
      ).not.toHaveAttribute("enctype");
    });

    it("says the file is not kept", () => {
      // The owner is uploading somebody else's copyrighted exam guide. That it is read
      // once and discarded is the thing worth stating on the screen that asks for it.
      renderForm();

      expect(screen.getByText(/read once and is not stored/i)).toBeVisible();
    });

    it("promises a preview rather than an import", () => {
      renderForm();

      expect(
        screen.getByText(/Nothing is added to your track yet/),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Extract outline" }),
      ).toBeEnabled();
    });

    it("states the size and character limits it will enforce", () => {
      renderForm();

      expect(screen.getByText(/up to 10 MB/)).toBeVisible();
      expect(screen.getByText(/120,000 characters/)).toBeVisible();
    });

    it("names the persona and the model that will be billed", () => {
      renderForm();

      expect(screen.getByText(/Persona: .+, version 1\./)).toBeVisible();
      expect(screen.getByText("fake-deterministic")).toBeVisible();
    });

    it("says notes cannot change the instructions", () => {
      renderForm();

      expect(
        screen.getByText(/cannot change what the model is instructed to do/i),
      ).toBeVisible();
    });

    it("promises existing objectives are left alone, and counts them", () => {
      renderForm({ existingObjectiveCount: 5 });

      expect(
        screen.getByText(/5 existing objectives are left exactly as they are/),
      ).toBeVisible();
    });

    it("says so plainly when the track has no objectives yet", () => {
      renderForm();

      expect(
        screen.getByText(/This track has no objectives yet\./),
      ).toBeVisible();
    });
  });

  describe("choosing how the documents are read", () => {
    it("offers every strategy, whatever the track is", () => {
      // Ordering rather than filtering: a language track may hold a prose syllabus for
      // some other examination, and the owner is the one holding the document.
      renderForm({ archetype: "LANGUAGE" });

      expect(
        screen.getByRole("radio", { name: /Read it with AI/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("radio", { name: /HSK examination syllabus/ }),
      ).toBeInTheDocument();
    });

    it("preselects the AI reader for a technical track", () => {
      renderForm({ archetype: "TECHNICAL" });

      expect(
        screen.getByRole("radio", { name: /Read it with AI/ }),
      ).toBeChecked();
    });

    it("preselects the HSK reader for a language track", () => {
      renderForm({ archetype: "LANGUAGE" });

      expect(
        screen.getByRole("radio", { name: /HSK examination syllabus/ }),
      ).toBeChecked();
    });

    it("says which strategies spend a model call and which do not", () => {
      renderForm();

      expect(screen.getByText(/Calls the model\./)).toBeVisible();
      expect(screen.getByText(/Calls no model at all\./)).toBeVisible();
    });

    it("submits the chosen strategy key", async () => {
      const onValid = vi.fn();

      renderForm({ action: validatingAction(onValid), archetype: "LANGUAGE" });

      const user = userEvent.setup();

      await user.click(screen.getByRole("radio", { name: /Read it with AI/ }));
      await user.click(screen.getByLabelText(/paste the outline/i));
      await user.paste(SYNTHETIC_OUTLINE);
      await submit(user);

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });

      expect(onValid.mock.calls[0]?.[0]?.strategyKey).toBe("GENERIC_OUTLINE");
    });
  });

  describe("the multi-file path", () => {
    it("takes several files and accepts JSON for the deterministic reader", () => {
      renderForm({ archetype: "LANGUAGE" });

      const input = screen.getByLabelText(/syllabus files/i);

      expect(input).toHaveAttribute("multiple");
      expect(input.getAttribute("accept")).toContain(".json");
    });

    it("takes one file and no JSON for the AI reader", async () => {
      renderForm({ archetype: "LANGUAGE" });

      const user = userEvent.setup();

      await user.click(screen.getByRole("radio", { name: /Read it with AI/ }));

      const input = screen.getByLabelText(/syllabus file/i);

      expect(input).not.toHaveAttribute("multiple");
      expect(input.getAttribute("accept")).not.toContain(".json");
    });

    it("says any subset of the syllabus documents is a complete import", () => {
      renderForm({ archetype: "LANGUAGE" });

      expect(
        screen.getByText(
          /the grammar appendix on its own is a complete import/,
        ),
      ).toBeVisible();
    });

    it("offers no paste box for a reader that parses files", () => {
      // Pasted text has no role and no filename, so there is nothing a parser could be
      // chosen for it — a box that could never be used is a dead control.
      renderForm({ archetype: "LANGUAGE" });

      expect(screen.queryByLabelText(/paste the outline/i)).toBeNull();
    });

    it("offers a role select per chosen file, defaulting to automatic", async () => {
      renderForm({ archetype: "LANGUAGE" });

      const user = userEvent.setup();

      // No files chosen yet, so there is nothing to assign a role to.
      expect(screen.queryByText("What is each file?")).toBeNull();

      await user.upload(screen.getByLabelText(/syllabus files/i), [
        new File(["structure"], "syllabus.txt", { type: "text/plain" }),
        new File(["[]"], "grammar.json", { type: "application/json" }),
      ]);

      expect(screen.getByText("What is each file?")).toBeVisible();
      expect(screen.getByText("syllabus.txt")).toBeVisible();
      expect(screen.getByText("grammar.json")).toBeVisible();

      const selects = screen.getAllByRole("combobox");

      expect(selects).toHaveLength(2);
      expect(selects[0]).toHaveValue("");
    });

    it("submits an overridden role alongside its file, in order", async () => {
      const onValid = vi.fn();

      renderForm({ action: validatingAction(onValid), archetype: "LANGUAGE" });

      const user = userEvent.setup();

      const input = screen.getByLabelText(/syllabus files/i);

      await user.upload(input, [
        new File(["structure"], "syllabus.txt", { type: "text/plain" }),
        new File(["notes"], "notes.md", { type: "text/markdown" }),
      ]);
      await user.selectOptions(
        screen.getAllByRole("combobox")[1] as HTMLElement,
        "THEME_NOTES",
      );
      await submit(user);

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });

      const form = onValid.mock.calls[0]?.[1] as FormData;

      // Positional pairing is the contract the Server Action reads: a blank first role
      // means "classify it", and the second names what the owner chose. The roles are
      // asserted on the submitted `FormData` and the filenames on the input, because
      // jsdom's `FormData` copies a file entry as an empty blob — see the single-file
      // upload test above.
      expect(form.getAll("documentRole")).toEqual(["", "THEME_NOTES"]);
      expect(
        [...((input as HTMLInputElement).files ?? [])].map((file) => file.name),
      ).toEqual(["syllabus.txt", "notes.md"]);
      expect(onValid.mock.calls[0]?.[0]?.strategyKey).toBe("HSK_EXAMINATION");
    });

    it("clears a selection made for the other strategy", async () => {
      // The accepted types and the file count differ per strategy, so a file chosen for
      // one must not silently ride along into the other and be rejected server-side.
      renderForm({ archetype: "LANGUAGE" });

      const user = userEvent.setup();

      await user.upload(screen.getByLabelText(/syllabus files/i), [
        new File(["[]"], "grammar.json", { type: "application/json" }),
      ]);

      expect(screen.getByText("grammar.json")).toBeVisible();

      await user.click(screen.getByRole("radio", { name: /Read it with AI/ }));

      expect(screen.queryByText("What is each file?")).toBeNull();
      expect(screen.getByLabelText(/syllabus file/i)).toHaveValue("");
    });
  });

  describe("what it submits", () => {
    it("submits a pasted outline as the facade will receive it", async () => {
      const onValid = vi.fn();

      renderForm({ action: validatingAction(onValid) });

      const user = userEvent.setup();

      await user.click(screen.getByLabelText(/paste the outline/i));
      await user.paste(SYNTHETIC_OUTLINE);
      await user.type(
        screen.getByLabelText(/your notes/i),
        "only the content outline",
      );
      await submit(user);

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });

      expect(onValid.mock.calls[0]?.[0]).toEqual({
        // A technical track offers the AI reader first and it is checked by default, so
        // an owner who changes nothing gets the behaviour this form has always had.
        strategyKey: "GENERIC_OUTLINE",
        pastedText: SYNTHETIC_OUTLINE,
        additionalInstructions: "only the content outline",
        // No persona select is rendered when the owner has stored none, so the field
        // arrives blank and the facade decides from the track and its study type.
        personaId: null,
      });
    });

    it("takes the chosen file, and submits without needing a paste as well", async () => {
      // The file's *bytes* are asserted on the input rather than on the submitted
      // `FormData`, because jsdom's `FormData` constructor copies a file entry as an
      // empty blob — the name and size come back "" and 0 whatever the input holds. So
      // what a component test can establish is that the file reaches the field the action
      // reads; that its bytes then survive to the extractor is covered by the facade test
      // and by manual verification against a real PDF.
      const onValid = vi.fn();

      renderForm({ action: validatingAction(onValid) });

      const user = userEvent.setup();
      const file = new File([SYNTHETIC_OUTLINE], "demo-guide.txt", {
        type: "text/plain",
      });
      const input = screen.getByLabelText(/syllabus file/i);

      await user.upload(input, file);
      await submit(user);

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });

      const chosen = (input as HTMLInputElement).files?.[0];

      expect(chosen?.name).toBe("demo-guide.txt");
      await expect(chosen?.text()).resolves.toBe(SYNTHETIC_OUTLINE);
      // Both routes are optional on their own, so a file with no paste submits a null.
      expect(onValid.mock.calls[0]?.[0]).toEqual({
        strategyKey: "GENERIC_OUTLINE",
        pastedText: null,
        additionalInstructions: null,
        personaId: null,
      });
    });

    it("submits nothing but empty fields when the owner supplies neither", async () => {
      // The facade refuses this, not the form: "you gave me no document" is one message
      // whether it arrives from here, from a scan with no text, or from a blank paste.
      const onValid = vi.fn();

      renderForm({ action: validatingAction(onValid) });

      await submit(userEvent.setup());

      await waitFor(() => {
        expect(onValid).toHaveBeenCalledTimes(1);
      });

      expect(onValid.mock.calls[0]?.[0]).toEqual({
        strategyKey: "GENERIC_OUTLINE",
        pastedText: null,
        additionalInstructions: null,
        personaId: null,
      });
    });
  });

  describe("what it refuses", () => {
    it("reports an unreadable document on the file field", async () => {
      // The facade's `SyllabusUnreadableError` is keyed to `document`, so the message
      // about a scan or a corrupt PDF appears beside the input that caused it.
      renderForm({
        action: validatingAction(() => {
          throw new SyllabusUnreadableError("That PDF could not be read.");
        }),
      });

      await submit(userEvent.setup());

      await waitFor(() => {
        expect(screen.getByText("That PDF could not be read.")).toBeVisible();
      });

      expect(screen.getByLabelText(/syllabus file/i)).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });

    it("reports an over-long paste on the paste field, and keeps it", async () => {
      // Re-pasting 120,000 characters is not something to ask of anybody, so the text
      // survives the refusal.
      const onValid = vi.fn();

      renderForm({ action: validatingAction(onValid) });

      const user = userEvent.setup();
      const paste = screen.getByLabelText(/paste the outline/i);

      await user.click(paste);
      await user.paste("x".repeat(MAX_SYLLABUS_CHARACTERS + 1));
      await submit(user);

      await waitFor(() => {
        expect(
          screen.getByText(
            `Use ${MAX_SYLLABUS_CHARACTERS} characters or fewer.`,
          ),
        ).toBeVisible();
      });

      expect(onValid).not.toHaveBeenCalled();
      expect(paste).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByLabelText(/paste the outline/i)).toHaveValue(
        "x".repeat(MAX_SYLLABUS_CHARACTERS + 1),
      );
    });

    it("reports over-long notes on the notes field", async () => {
      renderForm();

      const user = userEvent.setup();

      await user.click(screen.getByLabelText(/your notes/i));
      await user.paste("x".repeat(1001));
      await submit(user);

      await waitFor(() => {
        expect(screen.getByText("Use 1000 characters or fewer.")).toBeVisible();
      });
    });
  });
});
