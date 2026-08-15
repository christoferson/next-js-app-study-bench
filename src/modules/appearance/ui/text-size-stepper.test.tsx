import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
} from "@/modules/appearance/domain/text-size";
import { TextSizeStepper } from "./text-size-stepper";

/**
 * The "Aa" control in the header.
 *
 * The behaviour worth pinning is the optimistic write: the press has to change the document
 * immediately, because the owner discovers the text is too small mid-sentence and will press
 * the button repeatedly. Waiting for the server would make each press feel broken. So the
 * test checks both halves — the document changed, *and* the server was told.
 */
const action = vi.fn<(size: number) => Promise<void>>();

describe("TextSizeStepper", () => {
  beforeEach(() => {
    action.mockReset();
    action.mockResolvedValue(undefined);
    document.documentElement.style.fontSize = "";
  });

  it("shows the size the request rendered at", () => {
    render(<TextSizeStepper action={action} current={18} />);

    expect(screen.getByText("18px")).toBeVisible();
  });

  it("names both buttons, which are glyphs with no text", () => {
    render(<TextSizeStepper action={action} current={16} />);

    expect(
      screen.getByRole("button", { name: "Larger text" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Smaller text" }),
    ).toBeInTheDocument();
  });

  it("applies a larger size to the document and stores it", async () => {
    render(<TextSizeStepper action={action} current={16} />);
    await userEvent.click(screen.getByRole("button", { name: "Larger text" }));

    // Both halves: the page is already bigger, and the cookie is being written.
    expect(document.documentElement.style.fontSize).toBe("17px");
    expect(action).toHaveBeenCalledWith(17);
    expect(screen.getByText("17px")).toBeVisible();
  });

  it("applies a smaller size to the document and stores it", async () => {
    render(<TextSizeStepper action={action} current={16} />);
    await userEvent.click(screen.getByRole("button", { name: "Smaller text" }));

    expect(document.documentElement.style.fontSize).toBe("15px");
    expect(action).toHaveBeenCalledWith(15);
  });

  it("keeps stepping from where the last press left off", async () => {
    // Three presses is three pixels, not the same pixel three times: the control steps from
    // the size it is showing, which after a press is the optimistic one.
    render(<TextSizeStepper action={action} current={16} />);
    const larger = screen.getByRole("button", { name: "Larger text" });

    await userEvent.click(larger);
    await userEvent.click(larger);
    await userEvent.click(larger);

    expect(screen.getByText("19px")).toBeVisible();
    expect(action).toHaveBeenLastCalledWith(19);
  });

  it("disables the larger button at the top of the range", async () => {
    render(<TextSizeStepper action={action} current={MAX_TEXT_SIZE} />);

    expect(screen.getByRole("button", { name: "Larger text" })).toBeDisabled();
    // Disabled rather than silently ignoring the press: a control that accepts a tap and
    // does nothing is worse than one that says it has run out of room.
    await userEvent.click(screen.getByRole("button", { name: "Larger text" }));
    expect(action).not.toHaveBeenCalled();
  });

  it("disables the smaller button at the bottom of the range", () => {
    render(<TextSizeStepper action={action} current={MIN_TEXT_SIZE} />);

    expect(screen.getByRole("button", { name: "Smaller text" })).toBeDisabled();
  });

  it("announces the new size, for a press that cannot be seen", () => {
    // The owner stepping from the keyboard gets the same feedback as the one watching the
    // page reflow.
    render(<TextSizeStepper action={action} current={16} />);

    expect(screen.getByText("16px")).toHaveAttribute("aria-live", "polite");
  });

  it("shows the stored size again when the layout re-renders with a new one", () => {
    // The cookie is the truth and the optimistic value is a guess. A navigation re-renders
    // this with the stored size, and that has to win — otherwise a save that failed would go
    // on showing a size the application is not rendering at.
    const view = render(<TextSizeStepper action={action} current={16} />);

    view.rerender(<TextSizeStepper action={action} current={20} />);

    expect(screen.getByText("20px")).toBeVisible();
  });
});
