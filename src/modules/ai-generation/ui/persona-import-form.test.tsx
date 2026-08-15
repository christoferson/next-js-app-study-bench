import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IDLE_FORM_STATE } from "@/shared/ui/form-state";
import {
  PERSONA_ENVELOPE_KEY,
  toPersonaEnvelope,
} from "@/modules/ai-generation/domain/persona-export";
import { storedPersonaFixture } from "@/modules/ai-generation/infrastructure/persona-test-support";
import { PersonaImportForm } from "./persona-import-form";
import { importPersonaAction } from "./persona-import-actions";

/**
 * The import form, driven through the real Server Action.
 *
 * The action is the real one — it reads a form, validates, and returns a draft, and it
 * calls no facade and writes nothing, so there is nothing to stub. What is asserted is the
 * two outcomes the owner sees: a valid file becomes the *prefilled create form* rather
 * than a saved persona, and an invalid one becomes a message beside the input that failed.
 *
 * The content cases go through the paste box rather than the file input, and deliberately:
 * jsdom's `FormData` copies a file entry as an empty blob, so a file's bytes never reach
 * an action from a rendered form in a component test (`objective-import-form.test.tsx`
 * documents the same limitation). The file path is covered where the bytes are real, in
 * `persona-import-actions.test.ts`; what this file asserts about the file input is what it
 * offers the owner.
 */
vi.mock("./persona-actions", () => ({
  createPersonaAction: async () => IDLE_FORM_STATE,
}));

const ENVELOPE = toPersonaEnvelope(
  storedPersonaFixture({ label: "Imported persona" }),
);

async function paste(text: string): Promise<void> {
  const user = userEvent.setup();

  // `type` would interpret the braces of a JSON object as key descriptors.
  await user.click(screen.getByLabelText("Or paste the JSON"));
  await user.paste(text);
  await user.click(screen.getByRole("button", { name: "Read persona file" }));
}

describe("PersonaImportForm", () => {
  it("offers a file input restricted to JSON, and a paste box", () => {
    render(<PersonaImportForm action={importPersonaAction} />);

    const input = screen.getByLabelText("Persona file");

    expect(input).toHaveAttribute("type", "file");
    expect(input.getAttribute("accept")).toContain(".json");
    expect(screen.getByLabelText("Or paste the JSON")).toBeInTheDocument();
  });

  it("says nothing is saved by choosing a file", () => {
    // The promise the flow keeps: a file is read, reviewed, then saved.
    render(<PersonaImportForm action={importPersonaAction} />);

    expect(
      screen.getByText(/Nothing is saved by choosing it/i),
    ).toBeInTheDocument();
  });

  it("shows the chosen file's name once one is chosen", async () => {
    render(<PersonaImportForm action={importPersonaAction} />);

    await userEvent.upload(
      screen.getByLabelText("Persona file"),
      new File([JSON.stringify(ENVELOPE)], "downloaded.json", {
        type: "application/json",
      }),
    );

    expect(screen.getByText(/Ready: downloaded.json/)).toBeInTheDocument();
  });

  it("opens the prefilled create form for a valid persona, saving nothing", async () => {
    render(<PersonaImportForm action={importPersonaAction} />);

    await paste(JSON.stringify(ENVELOPE));

    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toHaveValue("Imported persona");
    });
    expect(screen.getByLabelText("Role")).toHaveValue(ENVELOPE.role);
    expect(screen.getByText(/Nothing has been saved yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create persona" }),
    ).toBeInTheDocument();
  });

  it("renders each imported list one entry per line, so nothing is lost", async () => {
    render(<PersonaImportForm action={importPersonaAction} />);

    await paste(JSON.stringify(ENVELOPE));

    await waitFor(() => {
      expect(screen.getByLabelText("Question guidance")).toHaveValue(
        ENVELOPE.guidance.join("\n"),
      );
    });
  });

  it("states the archetype the file was read as", async () => {
    // Not editable afterwards, so the owner has to be told what they are about to create.
    render(<PersonaImportForm action={importPersonaAction} />);

    await paste(JSON.stringify({ ...ENVELOPE, archetype: "LANGUAGE" }));

    await waitFor(() => {
      expect(
        screen.getByText(/Read as a language persona/i),
      ).toBeInTheDocument();
    });
  });

  it("reports unreadable JSON beside the paste box", async () => {
    render(<PersonaImportForm action={importPersonaAction} />);

    await paste("{ not json at all");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/not readable JSON/i);
    });
    expect(screen.getByLabelText("Or paste the JSON")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("asks for one of the two inputs when both are empty", async () => {
    render(<PersonaImportForm action={importPersonaAction} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Read persona file" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Choose a persona file, or paste/i,
      );
    });
    expect(screen.getByLabelText("Persona file")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("names the field inside the file when its content is wrong", async () => {
    // A persona file is often hand-edited, so "invalid" alone is not actionable: the
    // message has to say which key to fix.
    render(<PersonaImportForm action={importPersonaAction} />);

    await paste(
      JSON.stringify({ ...ENVELOPE, defaultQuestionTypes: ["ESSAY"] }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /defaultQuestionTypes.*ESSAY/,
      );
    });
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("refuses a file from a newer format version", async () => {
    render(<PersonaImportForm action={importPersonaAction} />);

    await paste(JSON.stringify({ ...ENVELOPE, [PERSONA_ENVELOPE_KEY]: 99 }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/newer release/i);
    });
  });

  it("keeps a rejected paste in the box", async () => {
    render(<PersonaImportForm action={importPersonaAction} />);

    await paste("broken");

    await waitFor(() => {
      expect(screen.getByLabelText("Or paste the JSON")).toHaveValue("broken");
    });
  });

  it("renders the file input inside a drop zone", () => {
    // The drop zone is a bigger target for the real file input, not a second upload path,
    // so the input stays inside it and the ordinary submission carries the file.
    render(<PersonaImportForm action={importPersonaAction} />);

    const zone = document.querySelector(".file-drop-zone");

    expect(zone).not.toBeNull();
    expect(
      zone?.querySelector('input[type="file"][name="personaFile"]'),
    ).not.toBeNull();
  });
});
