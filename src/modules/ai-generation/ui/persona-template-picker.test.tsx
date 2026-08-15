import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PERSONA_TEMPLATES } from "@/modules/ai-generation/domain/persona-templates";
import { PersonaTemplatePicker } from "./persona-template-picker";

describe("PersonaTemplatePicker", () => {
  it("offers every template, with its summary and its archetype", () => {
    render(<PersonaTemplatePicker templates={PERSONA_TEMPLATES} />);

    for (const template of PERSONA_TEMPLATES) {
      expect(
        screen.getByRole("link", { name: template.draft.label }),
      ).toHaveAttribute(
        "href",
        `/settings/personas/new?template=${template.key}`,
      );
      expect(screen.getByText(template.summary)).toBeInTheDocument();
    }

    expect(screen.getAllByRole("listitem")).toHaveLength(
      PERSONA_TEMPLATES.length,
    );
  });

  it("distinguishes the two AWS levels by name", () => {
    // The picker is where the choice is made, so the difference has to be readable
    // before the form opens.
    render(<PersonaTemplatePicker templates={PERSONA_TEMPLATES} />);

    expect(
      screen.getByRole("link", { name: "AWS associate level" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "AWS professional and specialty level",
      }),
    ).toBeInTheDocument();
  });
});
