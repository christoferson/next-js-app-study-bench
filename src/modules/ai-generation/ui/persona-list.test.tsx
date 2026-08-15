import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { storedPersonaFixture } from "@/modules/ai-generation/infrastructure/persona-test-support";
import { PersonaList } from "./persona-list";

vi.mock("./persona-actions", () => ({
  deletePersonaAction: vi.fn(),
}));

describe("PersonaList", () => {
  it("explains an empty list rather than looking broken", () => {
    // Empty is the correct state of a fresh installation: nothing is seeded, and the
    // built-in personas are still what generation uses.
    render(<PersonaList personas={[]} />);

    expect(screen.getByText(/No personas yet/)).toBeInTheDocument();
    expect(screen.getByText(/built-in personas/)).toBeInTheDocument();
  });

  it("shows a persona's name, archetype, version, and key", () => {
    render(
      <PersonaList
        personas={[
          storedPersonaFixture({
            version: 3,
            updatedAt: "2026-05-04T09:00:00.000Z",
          }),
        ]}
      />,
    );

    expect(
      screen.getByRole("link", { name: "AWS associate level" }),
    ).toHaveAttribute("href", "/settings/personas/persona-1");
    expect(screen.getByText("Technical")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2026-05-04")).toBeInTheDocument();
    expect(screen.getByText("aws-associate-level")).toBeInTheDocument();
  });

  it("offers each persona as a JSON download", () => {
    // A plain anchor with `download`, not a client-side navigation: the target answers
    // with a file attachment rather than a page.
    render(<PersonaList personas={[storedPersonaFixture()]} />);

    const link = screen.getByRole("link", { name: "Download JSON" });

    expect(link).toHaveAttribute("href", "/settings/personas/persona-1/export");
    expect(link).toHaveAttribute("download");
  });

  it("names the persona on each delete button", () => {
    // Two rows of identical "Delete" buttons is what a screen reader announcing
    // controls out of context would otherwise hear.
    render(
      <PersonaList
        personas={[
          storedPersonaFixture({ id: "a", personaKey: "a", label: "First" }),
          storedPersonaFixture({ id: "b", personaKey: "b", label: "Second" }),
        ]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Delete First" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete Second" }),
    ).toBeInTheDocument();
  });
});
