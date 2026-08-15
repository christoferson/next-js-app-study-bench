import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AudioLibraryView } from "@/modules/audio/application/audio-facade";
import { mediaAssetFixture } from "@/modules/audio/infrastructure/test-support";
import AudioSettingsPage from "@/app/settings/audio/page";

/**
 * The audio settings route.
 *
 * The list itself is covered by the `AudioLibrary` component test; what belongs here is
 * that the page reads the library from the facade and explains what deletion means — the
 * one thing a page can get wrong that a component cannot.
 */
const findLibrary = vi.fn<() => Promise<AudioLibraryView>>();

vi.mock("@/modules/audio/composition", () => ({
  getAudioFacade: () => ({ findLibrary }),
}));

vi.mock("@/modules/audio/ui/actions", () => ({
  deleteAudioAction: vi.fn(),
  playAudioClipAction: vi.fn(),
}));

function stubLibrary(overrides: Partial<AudioLibraryView> = {}): void {
  findLibrary.mockResolvedValue({
    assets: [],
    totalCount: 0,
    totalByteSize: 0,
    // `polly`, so the page renders the library. The setup panel it shows instead when
    // nothing is configured is the `AudioLibrary` test's subject.
    provider: "polly",
    voiceIdZh: "Zhiyu",
    voiceIdEn: "Joanna",
    engine: "neural",
    ...overrides,
  });
}

describe("Audio settings page", () => {
  beforeEach(() => {
    findLibrary.mockReset();
  });

  it("lists what is stored", async () => {
    stubLibrary({
      assets: [mediaAssetFixture({ id: "asset-1" })],
      totalCount: 1,
      totalByteSize: 768,
    });

    render(await AudioSettingsPage());

    expect(
      screen.getByRole("heading", { name: "Audio", level: 1 }),
    ).toBeVisible();
    expect(document.querySelector("audio")?.getAttribute("src")).toBe(
      "/api/audio/asset-1",
    );
    expect(
      screen.getByRole("button", { name: /remove audio/i }),
    ).toBeInTheDocument();
  });

  it("says that a clip is made once and then costs nothing", async () => {
    stubLibrary();

    render(await AudioSettingsPage());

    expect(screen.getByText(/made once/)).toBeVisible();
  });

  it("says that removing a clip is not permanent, because regenerating it works", async () => {
    // The reason there is no confirmation step, stated where the owner reads it.
    stubLibrary();

    render(await AudioSettingsPage());

    expect(screen.getByText(/it is made again/)).toBeVisible();
  });

  it("offers a way back to the tracks", async () => {
    stubLibrary();

    render(await AudioSettingsPage());

    // Reached through the breadcrumb trail now, which also exposes the Settings index above
    // this page.
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
