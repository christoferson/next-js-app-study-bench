import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import SettingsPage from "@/app/settings/page";

/**
 * The settings index.
 *
 * It exists because the header needs one Settings destination, and "whichever of the three
 * settings screens you saw last" is not one. So the only thing worth asserting is that it
 * actually reaches all three: an index that has lost an entry is a screen the owner can no
 * longer get to, since the cross-links that used to serve this purpose are gone.
 */
describe("Settings page", () => {
  it("links every settings screen there is", () => {
    render(<SettingsPage />);

    expect(screen.getByRole("link", { name: "Appearance" })).toHaveAttribute(
      "href",
      "/settings/appearance",
    );
    expect(screen.getByRole("link", { name: "Audio" })).toHaveAttribute(
      "href",
      "/settings/audio",
    );
    expect(screen.getByRole("link", { name: "Personas" })).toHaveAttribute(
      "href",
      "/settings/personas",
    );
  });

  it("says what each one decides, rather than only naming it", () => {
    render(<SettingsPage />);

    expect(screen.getByText(/how large the text is/i)).toBeVisible();
    expect(screen.getByText(/clips generated/i)).toBeVisible();
    expect(screen.getByText(/voices a model writes in/i)).toBeVisible();
  });

  it("is titled and reachable from the dashboard", () => {
    render(<SettingsPage />);

    expect(
      screen.getByRole("heading", { name: "Settings", level: 1 }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Tracks" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("does not claim to change study material", () => {
    // A settings index beside a question bank invites the fear that it edits it.
    render(<SettingsPage />);

    expect(
      screen.getByText(/nothing here changes your study material/i),
    ).toBeVisible();
  });
});
