import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppHeader } from "./app-header";

/**
 * The bar the root layout renders above every page.
 *
 * The nav and the stepper have their own tests; what belongs here is that the header
 * assembles all three parts. It is rendered once for the whole application, so a part that
 * silently stopped rendering would take navigation off every page at once.
 */
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("@/modules/appearance/ui/actions", () => ({
  setTextSizeAction: vi.fn(),
}));

describe("AppHeader", () => {
  it("carries the wordmark, the nav, and the text-size control", () => {
    render(<AppHeader textSize={16} />);

    expect(screen.getByRole("link", { name: "StudyBench" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(
      screen.getByRole("navigation", { name: "Primary" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Larger text" }),
    ).toBeInTheDocument();
  });

  it("is a banner landmark, so it can be skipped", () => {
    render(<AppHeader textSize={16} />);

    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("opens the stepper at the size the request rendered at", () => {
    // Threaded down from the layout rather than read here, so the cookie is read once per
    // request — and so a header showing 16 while the page renders at 21 is impossible.
    render(<AppHeader textSize={21} />);

    expect(screen.getByText("21px")).toBeVisible();
  });
});
