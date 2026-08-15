import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Breadcrumbs,
  SETTINGS_CRUMB,
  TRACKS_CRUMB,
  trackCrumb,
} from "./breadcrumbs";

/**
 * The trail on every nested page.
 *
 * This replaced thirty hand-written "Back to X" links, so what is worth pinning is the
 * behaviour those links did not have consistently: the current page is named but not
 * linkable, the ancestors are all reachable, and the whole thing is announced as a
 * breadcrumb rather than as an anonymous list of links.
 */
describe("Breadcrumbs", () => {
  it("links every ancestor, in the order they nest", () => {
    render(
      <Breadcrumbs
        trail={[
          TRACKS_CRUMB,
          trackCrumb({ name: "HSK 4", slug: "hsk-4" }),
          { label: "Question bank", href: "/study-tracks/hsk-4/questions" },
        ]}
        current="Question"
      />,
    );

    const links = screen.getAllByRole("link");

    expect(links.map((link) => link.textContent)).toEqual([
      "Tracks",
      "HSK 4",
      "Question bank",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/",
      "/study-tracks/hsk-4",
      "/study-tracks/hsk-4/questions",
    ]);
  });

  it("names the current page without linking it to itself", () => {
    // A link to the page you are already on is a control that does nothing, and the owner
    // pressing it to find that out is a cost with no return.
    render(<Breadcrumbs trail={[TRACKS_CRUMB]} current="Progress" />);

    expect(screen.queryByRole("link", { name: "Progress" })).toBeNull();
    expect(screen.getByText("Progress")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("announces itself as a breadcrumb", () => {
    render(<Breadcrumbs trail={[TRACKS_CRUMB]} current="Settings" />);

    expect(
      screen.getByRole("navigation", { name: "Breadcrumb" }),
    ).toBeInTheDocument();
  });

  it("is an ordered list, because the order is the meaning", () => {
    const { container } = render(
      <Breadcrumbs trail={[TRACKS_CRUMB, SETTINGS_CRUMB]} current="Audio" />,
    );

    // `Tracks / Settings / Audio` is a path, not a set. An `ol` says so; a `div` of links
    // leaves a screen reader to infer it from the separators, which are `aria-hidden`.
    expect(container.querySelector("ol")).not.toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("renders a trail of one when the page hangs off the dashboard", () => {
    render(<Breadcrumbs trail={[TRACKS_CRUMB]} current="New study track" />);

    expect(screen.getByRole("link", { name: "Tracks" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByText("New study track")).toBeVisible();
  });

  it("renders just the current page when there is nothing above it", () => {
    render(<Breadcrumbs trail={[]} current="Somewhere" />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("Somewhere")).toBeVisible();
  });
});

describe("trackCrumb", () => {
  it("labels the crumb with the track's name and addresses it by slug", () => {
    // The two have to come from the same track: a crumb reading one name and going to
    // another track's page is worse than no crumb.
    expect(
      trackCrumb({ name: "AWS Solutions Architect", slug: "aws-saa" }),
    ).toEqual({
      label: "AWS Solutions Architect",
      href: "/study-tracks/aws-saa",
    });
  });
});

describe("shared crumbs", () => {
  it("points the dashboard and settings crumbs at their routes", () => {
    expect(TRACKS_CRUMB).toEqual({ label: "Tracks", href: "/" });
    expect(SETTINGS_CRUMB).toEqual({ label: "Settings", href: "/settings" });
  });
});
