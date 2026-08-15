import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteNav } from "./site-nav";

/**
 * The header's primary navigation.
 *
 * Two properties matter. Every destination is reachable from every page — this is the only
 * navigation the application has now that the per-page "Back to X" links are gone, so a
 * missing entry is a route that can only be reached by typing its address. And the current
 * section is marked with `aria-current`, not only with a colour: gold on navy is invisible to
 * a screen reader and to anyone who cannot distinguish it.
 */
const usePathname = vi.fn<() => string | null>();

vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
}));

function renderNav(pathname: string): void {
  usePathname.mockReturnValue(pathname);
  render(<SiteNav />);
}

describe("SiteNav", () => {
  beforeEach(() => {
    usePathname.mockReset();
    usePathname.mockReturnValue("/");
  });

  it("offers every destination the header is responsible for", () => {
    renderNav("/");

    const links = screen.getAllByRole("link");

    expect(
      links.map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Tracks", "/"],
      ["Study", "/study/new"],
      ["Progress", "/progress"],
      ["Settings", "/settings"],
    ]);
  });

  it("announces itself as the primary navigation", () => {
    // Distinguishable from the breadcrumb nav on the page below it: two unlabelled `nav`
    // landmarks are two things a screen reader user has to open to tell apart.
    renderNav("/");

    expect(
      screen.getByRole("navigation", { name: "Primary" }),
    ).toBeInTheDocument();
  });

  it.each([
    ["/", "Tracks"],
    ["/study-tracks/hsk-4", "Tracks"],
    ["/study-tracks/hsk-4/questions/abc", "Tracks"],
    ["/study/new", "Study"],
    ["/study/sessions/abc", "Study"],
    ["/progress", "Progress"],
    ["/settings", "Settings"],
    ["/settings/appearance", "Settings"],
  ])("marks %s as being in the %s section", (pathname, expected) => {
    renderNav(pathname);

    expect(screen.getByRole("link", { name: expected })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks exactly one section at a time", () => {
    renderNav("/study-tracks/hsk-4/flashcards");

    const marked = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");

    expect(marked).toHaveLength(1);
  });

  it("does not read a track page as the Study section", () => {
    // `/study-tracks/hsk-4` starts with `/study`, so a prefix test marks both Tracks and
    // Study. Matching on segment boundaries is what keeps the header from claiming the owner
    // is in two sections at once.
    renderNav("/study-tracks/hsk-4");

    expect(screen.getByRole("link", { name: "Study" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: "Tracks" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks nothing on a route no nav entry owns", () => {
    // `/health` is a route with no home in the nav, and inventing one for it would be worse
    // than the header saying nothing about where the owner is.
    renderNav("/health");

    const marked = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");

    expect(marked).toHaveLength(0);
  });

  it("renders without a current section when the pathname is unavailable", () => {
    // `usePathname` is typed as returning a string, but it returns null outside a router in
    // practice, and a header that throws would take every page down with it.
    usePathname.mockReturnValue(null);
    render(<SiteNav />);

    expect(screen.getAllByRole("link")).toHaveLength(4);
  });
});
