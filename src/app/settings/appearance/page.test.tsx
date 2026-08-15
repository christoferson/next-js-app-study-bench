import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TextSize } from "@/modules/appearance/domain/text-size";
import AppearanceSettingsPage from "@/app/settings/appearance/page";

/**
 * The appearance route.
 *
 * The control itself is covered by the `TextSizeForm` test; what belongs here is that the
 * page reads the size currently in force and hands it to the form. Getting that wrong would
 * leave the setting always showing 16 — a page that looks like it forgot what the owner
 * chose, whatever the rest of the application is rendering at.
 */
const readTextSizeCookie = vi.fn<() => Promise<TextSize>>();

vi.mock("@/modules/appearance/infrastructure/text-size-cookie", () => ({
  readTextSizeCookie: () => readTextSizeCookie(),
}));

vi.mock("@/modules/appearance/ui/actions", () => ({
  saveTextSizeAction: vi.fn(),
}));

describe("Appearance settings page", () => {
  beforeEach(() => {
    readTextSizeCookie.mockReset();
    readTextSizeCookie.mockResolvedValue(16);
  });

  it("offers the granular size control", async () => {
    render(await AppearanceSettingsPage());

    expect(
      screen.getByRole("heading", { name: "Appearance", level: 1 }),
    ).toBeVisible();
    expect(screen.getByLabelText(/text size in pixels/i)).toBeVisible();
  });

  it("shows the size the application is currently rendering at", async () => {
    readTextSizeCookie.mockResolvedValue(21);

    render(await AppearanceSettingsPage());

    expect(
      (screen.getByLabelText(/text size in pixels/i) as HTMLInputElement).value,
    ).toBe("21");
  });

  it("says the preference belongs to the browser rather than the study bank", async () => {
    // Why there is no migration and no row: the value is per-browser, and the page says
    // so rather than leaving the owner to wonder why another device differs.
    render(await AppearanceSettingsPage());

    expect(screen.getByText(/saved in this browser/i)).toBeVisible();
  });

  it("points at the same control on the header, so the page is not the only way in", async () => {
    render(await AppearanceSettingsPage());

    expect(screen.getByText(/header of every screen/i)).toBeVisible();
  });

  it("puts itself in a trail back to the settings index and the dashboard", async () => {
    // The three settings screens used to cross-link each other because there was no index.
    // There is one now, and the trail is the way to it.
    render(await AppearanceSettingsPage());

    expect(screen.getByRole("link", { name: "Tracks" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });
});
