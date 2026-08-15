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

    // The controls are glyphs now, so the accessible name is the whole name: it says the
    // action *and* which objective it acts on, because six unlabelled repeats of "Edit"
    // on a 117-row tree name nothing.
    expect(
      screen.getByRole("link", { name: "Edit Root objective" }),
    ).toHaveAttribute("href", "/study-tracks/demo/objectives/root/edit");
    expect(
      screen.getByRole("link", {
        name: "Add a child objective under Root objective",
      }),
    ).toHaveAttribute("href", "/study-tracks/demo/objectives/new?parent=root");
  });

  it("gives every glyph control an accessible name and a pointer tooltip", () => {
    // The property that makes an icon-only row usable at all. A glyph button with no name
    // is an unlabelled control, and this is the row where that regression would land — so
    // it is asserted over *every* control rather than the ones that happen to be checked
    // by the tests above.
    renderTree();

    for (const control of [
      ...screen.getAllByRole("button"),
      ...screen.getAllByRole("link"),
    ]) {
      const name = control.getAttribute("aria-label");

      expect(name).toBeTruthy();
      // `title` repeats the name for a sighted pointer user who cannot place the glyph.
      expect(control).toHaveAttribute("title", name as string);
    }
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

    expect(
      screen.queryByRole("link", {
        name: "Add a child objective under Archived",
      }),
    ).toBeNull();
  });

  it("folds each root objective into a group that starts open", () => {
    // Open by default: a tree that starts collapsed hides the content the page exists to
    // show. The fold is there for the 117-objective case, where the owner acts to *hide*.
    renderTree();

    const groups = screen.getAllByRole("group");

    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group).toHaveAttribute("open");
    }
  });

  it("names each group by its reference and title, so a shut group is still readable", () => {
    renderTree();

    // Everything else about the objective is hidden when the group is shut, so the summary
    // has to carry both. The second root has no code, so its title stands alone rather than
    // the summary reading as an unlabelled disclosure.
    expect(screen.getByText("Domain 1 — Root objective")).toBeVisible();
    expect(screen.getAllByText("Second root").length).toBeGreaterThanOrEqual(1);
  });

  it("counts what is inside a group, so it can be judged unopened", () => {
    renderTree();

    expect(screen.getByText("1 nested objective")).toBeVisible();
  });

  it("shows no count on a root with nothing under it", () => {
    // "0 nested objectives" is a fact about a leaf that reads as a problem.
    renderTree([objectiveFixture({ id: "only", title: "Only root" })]);

    expect(screen.queryByText(/nested objective/)).toBeNull();
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
