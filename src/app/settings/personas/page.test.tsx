import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PersonaLibraryView } from "@/modules/ai-generation/application/persona-facade";
import { PERSONA_TEMPLATES } from "@/modules/ai-generation/domain/persona-templates";
import { storedPersonaFixture } from "@/modules/ai-generation/infrastructure/persona-test-support";
import PersonasSettingsPage from "@/app/settings/personas/page";

/**
 * The personas settings route.
 *
 * The list and the picker have their own component tests; what belongs here is that the
 * page reads the library from the facade and says the one thing a page can get wrong
 * that a component cannot — that nothing generated changes yet.
 */
const findLibrary = vi.fn<() => Promise<PersonaLibraryView>>();

vi.mock("@/modules/ai-generation/composition", () => ({
  getPersonaFacade: () => ({ findLibrary }),
}));

vi.mock("@/modules/ai-generation/ui/persona-actions", () => ({
  createPersonaAction: vi.fn(),
  updatePersonaAction: vi.fn(),
  deletePersonaAction: vi.fn(),
}));

describe("Personas settings page", () => {
  beforeEach(() => {
    findLibrary.mockReset();
    findLibrary.mockResolvedValue({
      personas: [],
      templates: PERSONA_TEMPLATES,
    });
  });

  it("lists the templates a new persona can start from", async () => {
    render(await PersonasSettingsPage());

    for (const template of PERSONA_TEMPLATES) {
      expect(
        screen.getByRole("link", { name: template.draft.label }),
      ).toBeInTheDocument();
    }
  });

  it("says that a persona is not chosen on a track yet", async () => {
    // The management screen's contents have no effect on generation in this slice, and
    // a screen that does not say so is indistinguishable from a broken one.
    render(await PersonasSettingsPage());

    expect(
      screen.getByText(/still uses the built-in personas/),
    ).toBeInTheDocument();
  });

  it("lists the owner's personas when there are some", async () => {
    findLibrary.mockResolvedValue({
      personas: [storedPersonaFixture({ label: "My persona" })],
      templates: PERSONA_TEMPLATES,
    });

    render(await PersonasSettingsPage());

    expect(
      screen.getByRole("link", { name: "My persona" }),
    ).toBeInTheDocument();
  });
});
