import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE } from "@/shared/ui/form-state";
import { findPersonaTemplate } from "@/modules/ai-generation/domain/persona-templates";
import { storedPersonaFixture } from "@/modules/ai-generation/infrastructure/persona-test-support";
import { PersonaForm } from "./persona-form";

/**
 * The persona form.
 *
 * What matters here is prefill and the one-per-line convention: a blank form is the
 * reason a feature like this goes unused, and a list that does not survive a round trip
 * through the textarea would silently truncate the owner's guidance.
 */
const action = vi.fn<(state: FormState, form: FormData) => Promise<FormState>>(
  async () => IDLE_FORM_STATE,
);

function textarea(name: string): HTMLTextAreaElement {
  const field = document.querySelector(`textarea[name="${name}"]`);

  if (!(field instanceof HTMLTextAreaElement)) {
    throw new Error(`No textarea named ${name}`);
  }

  return field;
}

describe("PersonaForm", () => {
  it("prefills every field from a template", () => {
    const template = findPersonaTemplate("jlpt-japanese");

    if (template === null) {
      throw new Error("The JLPT template is missing.");
    }

    render(
      <PersonaForm
        action={action}
        submitLabel="Create persona"
        cancelHref="/settings/personas"
        draft={template.draft}
        archetype={template.archetype}
        templateKey={template.key}
      />,
    );

    expect(screen.getByLabelText("Name")).toHaveValue(template.draft.label);
    expect(screen.getByLabelText("Role")).toHaveValue(template.draft.role);
    expect(screen.getByLabelText("Language instruction")).toHaveValue(
      template.draft.languageInstruction,
    );
    expect(screen.getByLabelText("Content language")).toHaveValue("ja");
  });

  it("renders each list as one entry per line, so it parses back unchanged", () => {
    const template = findPersonaTemplate("jlpt-japanese");

    if (template === null) {
      throw new Error("The JLPT template is missing.");
    }

    render(
      <PersonaForm
        action={action}
        submitLabel="Create persona"
        cancelHref="/settings/personas"
        draft={template.draft}
        archetype={template.archetype}
        templateKey={template.key}
      />,
    );

    // The round trip the schema performs: split on newlines, trim, drop blanks.
    const roundTrip = (value: string): readonly string[] =>
      value
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    expect(roundTrip(textarea("guidance").value)).toEqual(
      template.draft.guidance,
    );
    expect(roundTrip(textarea("cardGuidance").value)).toEqual(
      template.draft.cardGuidance,
    );
    expect(roundTrip(textarea("prohibitions").value)).toEqual(
      template.draft.prohibitions,
    );
  });

  it("ticks the template's default content types and no others", () => {
    const template = findPersonaTemplate("hsk-chinese");

    if (template === null) {
      throw new Error("The HSK template is missing.");
    }

    render(
      <PersonaForm
        action={action}
        submitLabel="Create persona"
        cancelHref="/settings/personas"
        draft={template.draft}
        archetype={template.archetype}
        templateKey={template.key}
      />,
    );

    expect(screen.getByLabelText("Single choice")).toBeChecked();
    expect(screen.getByLabelText("Short answer")).toBeChecked();
    expect(screen.getByLabelText("Multiple response")).not.toBeChecked();
    expect(screen.getByLabelText(/^Vocabulary/)).toBeChecked();
    expect(screen.getByLabelText(/^Basic/)).not.toBeChecked();
  });

  it("carries the template key so the persona records its archetype", () => {
    const template = findPersonaTemplate("aws-professional");

    render(
      <PersonaForm
        action={action}
        submitLabel="Create persona"
        cancelHref="/settings/personas"
        draft={template?.draft ?? storedPersonaFixture()}
        archetype="TECHNICAL"
        templateKey="aws-professional"
      />,
    );

    expect(document.querySelector('input[name="templateKey"]')).toHaveValue(
      "aws-professional",
    );
    // On create there is no version yet, so the form says what saving produces.
    expect(screen.getByText(/Saved as version 1/)).toBeInTheDocument();
  });

  it("prefills from an existing persona and names the version it will write", () => {
    const persona = storedPersonaFixture({ version: 4 });

    render(
      <PersonaForm
        action={action}
        submitLabel="Save new version"
        cancelHref="/settings/personas"
        draft={persona}
        archetype={persona.archetype}
        personaId={persona.id}
        version={persona.version}
      />,
    );

    expect(screen.getByLabelText("Name")).toHaveValue(persona.label);
    expect(textarea("guidance")).toHaveValue(persona.guidance.join("\n"));
    expect(document.querySelector('input[name="personaId"]')).toHaveValue(
      "persona-1",
    );
    expect(document.querySelector('input[name="templateKey"]')).toBeNull();
    expect(
      screen.getByText(/Currently version 4; saving makes it version 5/),
    ).toBeInTheDocument();
  });

  it("shows the archetype without offering to change it", () => {
    // It decides which machinery a later slice applies, so it is stated, not editable.
    const persona = storedPersonaFixture({ archetype: "LANGUAGE" });

    render(
      <PersonaForm
        action={action}
        submitLabel="Save new version"
        cancelHref="/settings/personas"
        draft={persona}
        archetype={persona.archetype}
        personaId={persona.id}
        version={persona.version}
      />,
    );

    expect(screen.getByText(/Language persona/)).toBeInTheDocument();
    expect(document.querySelector('[name="archetype"]')).toBeNull();
  });
});
