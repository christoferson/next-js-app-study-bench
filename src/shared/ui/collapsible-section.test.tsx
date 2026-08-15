import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  CollapsibleSection,
  SHORT_HISTORY_LENGTH,
  openWhenShort,
} from "./collapsible-section";

/**
 * A foldable page section.
 *
 * The property worth protecting is the accessibility arrangement, because it is the part a
 * later edit would plausibly undo: the heading sits inside the `<summary>`, and it has to stay
 * a real heading so the section is still reachable by heading navigation when it is shut. A
 * collapsed section whose heading vanished from the outline is a section a screen reader user
 * cannot find at all.
 */
describe("CollapsibleSection", () => {
  it("keeps the title a real heading, inside the disclosure control", () => {
    render(
      <CollapsibleSection id="attempts" title="Attempt history" open={false}>
        <p>Body</p>
      </CollapsibleSection>,
    );

    const heading = screen.getByRole("heading", {
      name: "Attempt history",
      level: 2,
    });

    // Both at once: a heading in the outline, and the whole summary line as the control.
    expect(heading.closest("summary")).not.toBeNull();
  });

  it("names the section landmark even while collapsed", () => {
    render(
      <CollapsibleSection id="attempts" title="Attempt history" open={false}>
        <p>Body</p>
      </CollapsibleSection>,
    );

    expect(
      screen.getByRole("region", { name: "Attempt history" }),
    ).toBeInTheDocument();
  });

  it("hides the body when it starts collapsed", () => {
    render(
      <CollapsibleSection id="history" title="Revision history" open={false}>
        <p>Revision one</p>
      </CollapsibleSection>,
    );

    // Still in the document — `<details>` hides it rather than unmounting it, which is what
    // lets the browser open it with no JavaScript.
    expect(screen.getByText("Revision one")).not.toBeVisible();
  });

  it("shows the body when it starts open", () => {
    render(
      <CollapsibleSection id="filters" title="Filters" open>
        <p>Lifecycle</p>
      </CollapsibleSection>,
    );

    expect(screen.getByText("Lifecycle")).toBeVisible();
  });

  it("shows how much is inside, so it can be judged unopened", () => {
    // The count is the reason collapsing is acceptable: "12 attempts" answers the question
    // most opens were asking.
    render(
      <CollapsibleSection
        id="attempts"
        title="Attempt history"
        open={false}
        count="12 attempts"
      >
        <p>Body</p>
      </CollapsibleSection>,
    );

    expect(screen.getByText("12 attempts")).toBeInTheDocument();
  });

  it("omits the count when the caller has nothing to say", () => {
    const { container } = render(
      <CollapsibleSection id="filters" title="Filters" open>
        <p>Body</p>
      </CollapsibleSection>,
    );

    expect(container.querySelector(".collapsible-count")).toBeNull();
  });

  it("keeps the explanatory note with the body it explains", () => {
    // Inside the details, not beside the summary: a collapsed section should be one line.
    render(
      <CollapsibleSection
        id="history"
        title="Revision history"
        open={false}
        note="Editing adds a revision."
      >
        <p>Body</p>
      </CollapsibleSection>,
    );

    expect(screen.getByText("Editing adds a revision.")).not.toBeVisible();
  });
});

describe("openWhenShort", () => {
  it("opens a history short enough to read in passing", () => {
    expect(openWhenShort(0)).toBe(true);
    expect(openWhenShort(SHORT_HISTORY_LENGTH)).toBe(true);
  });

  it("folds a history long enough to bury the page", () => {
    expect(openWhenShort(SHORT_HISTORY_LENGTH + 1)).toBe(false);
    expect(openWhenShort(40)).toBe(false);
  });
});
