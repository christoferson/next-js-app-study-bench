import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildObjectiveTree } from "@/modules/certifications/domain/objective";
import { objectiveFixture } from "@/modules/certifications/infrastructure/test-support";
import { ObjectiveTree } from "./objective-tree";

// The tree renders Server Action references into `form action`; the actions
// themselves are exercised through the facade tests.
vi.mock("./actions", () => ({
  archiveObjectiveAction: vi.fn(),
  restoreObjectiveAction: vi.fn(),
  moveObjectiveAction: vi.fn(),
}));

const HIERARCHY = [
  objectiveFixture({
    id: "root",
    code: "Domain 1",
    title: "Root objective",
    weight: 40,
    description: "Root focus.",
    displayOrder: 1,
  }),
  objectiveFixture({
    id: "child",
    parentObjectiveId: "root",
    code: "Task 1.1",
    title: "Child objective",
    displayOrder: 1,
  }),
  objectiveFixture({
    id: "second-root",
    code: null,
    title: "Second root",
    displayOrder: 2,
  }),
];

function renderTree(
  objectives: readonly ReturnType<typeof objectiveFixture>[] = HIERARCHY,
): void {
  render(<ObjectiveTree slug="demo" nodes={buildObjectiveTree(objectives)} />);
}

describe("ObjectiveTree", () => {
  it("shows an empty state when a track has no objectives", () => {
    renderTree([]);

    expect(screen.getByText(/no objectives yet/i)).toBeVisible();
  });

  it("renders code, title, weight, and description", () => {
    renderTree();

    expect(screen.getByText("Domain 1")).toBeVisible();
    expect(screen.getByText("Root objective")).toBeVisible();
    expect(screen.getByText("Weight 40%")).toBeVisible();
    expect(screen.getByText("Root focus.")).toBeVisible();
  });

  it("nests a child inside its parent list item", () => {
    renderTree();

    const child = screen.getByText("Child objective");
    const rootItem = screen.getByText("Root objective").closest("li");

    expect(rootItem).not.toBeNull();
    expect(rootItem?.contains(child)).toBe(true);
  });

  it("links each node to its edit form and an add-child form", () => {
    renderTree();

    const editLinks = screen.getAllByRole("link", { name: "Edit" });
    const addChildLinks = screen.getAllByRole("link", { name: "Add child" });

    expect(editLinks[0]).toHaveAttribute(
      "href",
      "/study-tracks/demo/objectives/root/edit",
    );
    expect(addChildLinks[0]).toHaveAttribute(
      "href",
      "/study-tracks/demo/objectives/new?parent=root",
    );
  });

  it("disables move up on the first sibling and move down on the last", () => {
    renderTree();

    expect(
      screen.getByRole("button", { name: "Move up Root objective" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move down Root objective" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Move up Second root" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Move down Second root" }),
    ).toBeDisabled();
  });

  it("omits move controls for an only child", () => {
    renderTree();

    expect(
      screen.queryByRole("button", { name: "Move up Child objective" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Move down Child objective" }),
    ).toBeNull();
  });

  it("offers archive for an active objective", () => {
    renderTree();

    expect(
      screen.getByRole("button", { name: "Archive Root objective" }),
    ).toBeInTheDocument();
  });

  it("labels an archived objective and offers restore instead of archive", () => {
    renderTree([
      objectiveFixture({
        id: "archived",
        title: "Archived objective",
        status: "ARCHIVED",
      }),
    ]);

    expect(screen.getByText("Archived")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Restore Archived objective" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Archive Archived objective" }),
    ).toBeNull();
  });

  it("does not offer add-child on an archived objective", () => {
    renderTree([
      objectiveFixture({
        id: "archived",
        title: "Archived",
        status: "ARCHIVED",
      }),
    ]);

    expect(screen.queryByRole("link", { name: "Add child" })).toBeNull();
  });

  it("labels an official objective map as official", () => {
    renderTree([
      objectiveFixture({
        id: "official",
        title: "Official objective",
        sourceType: "OFFICIAL_SYLLABUS",
      }),
    ]);

    expect(screen.getByText("Official syllabus")).toBeVisible();
  });

  it("does not label a user-defined objective as official", () => {
    renderTree();

    expect(screen.queryByText("Official")).toBeNull();
    expect(screen.queryByText("User defined")).toBeNull();
  });
});
