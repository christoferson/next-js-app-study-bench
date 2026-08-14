import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AudioLibraryView } from "@/modules/audio/application/audio-facade";
import { mediaAssetFixture } from "@/modules/audio/infrastructure/test-support";
import { AudioLibrary } from "./audio-library";

// The list renders a Server Action into each row's delete form; the action is exercised
// through the facade tests, and `DeleteAudioForm` has its own.
vi.mock("./actions", () => ({ deleteAudioAction: vi.fn() }));

/**
 * `polly` by default, because that is the state in which this page is a *library*. With
 * the placeholder provider it is a setup page instead, which the last block covers.
 */
function libraryView(
  overrides: Partial<AudioLibraryView> = {},
): AudioLibraryView {
  return {
    assets: [],
    totalCount: 0,
    totalByteSize: 0,
    provider: "polly",
    voiceIdZh: "Zhiyu",
    voiceIdEn: "Joanna",
    engine: "neural",
    ...overrides,
  };
}

describe("AudioLibrary", () => {
  it("says what a new clip would use, so a wrong voice is visible before it is paid for", () => {
    render(<AudioLibrary view={libraryView()} />);

    expect(screen.getByText("Zhiyu")).toBeVisible();
    expect(screen.getByText("Joanna")).toBeVisible();
    expect(screen.getByText("neural")).toBeVisible();
    expect(screen.getByText("polly")).toBeVisible();
  });

  it("reports how much disk the clips are using", () => {
    render(
      <AudioLibrary
        view={libraryView({
          assets: [mediaAssetFixture()],
          totalCount: 3,
          totalByteSize: 2048,
        })}
      />,
    );

    expect(screen.getByText("3")).toBeVisible();
    expect(screen.getByText("2 KB")).toBeVisible();
  });

  it("says how to get a clip when there are none", () => {
    // The empty state names the action rather than only the absence: audio is made from a
    // card, and nothing on this page can create one.
    render(<AudioLibrary view={libraryView()} />);

    expect(screen.getByText(/Open a vocabulary card/)).toBeVisible();
    expect(screen.getByText(/press play/)).toBeVisible();
  });

  it("identifies a clip by its voice, language, and size rather than its text", () => {
    // The text is not stored — the row holds a hash — and that is deliberate: a filename
    // or a listing never carries the owner's content.
    render(
      <AudioLibrary
        view={libraryView({
          assets: [mediaAssetFixture({ byteSize: 4096 })],
          totalCount: 1,
          totalByteSize: 4096,
        })}
      />,
    );

    expect(screen.getByText("Mandarin")).toBeVisible();
    // Twice: once as the voice a new clip would use, once as this clip's own.
    expect(screen.getAllByText("Zhiyu")).toHaveLength(2);
    // Twice for the same reason: the total and this one row are the same size.
    expect(screen.getAllByText("4 KB")).toHaveLength(2);
  });

  it("names an English clip's language in words", () => {
    render(
      <AudioLibrary
        view={libraryView({
          assets: [mediaAssetFixture({ language: "en", voiceId: "Joanna" })],
          totalCount: 1,
        })}
      />,
    );

    expect(screen.getByText("English")).toBeVisible();
  });

  it("badges a non-standard rate and stays quiet about the normal one", () => {
    render(
      <AudioLibrary
        view={libraryView({
          assets: [mediaAssetFixture({ speechRate: "slow" })],
          totalCount: 1,
        })}
      />,
    );

    expect(screen.getByText("slow")).toBeVisible();

    render(
      <AudioLibrary
        view={libraryView({
          assets: [mediaAssetFixture({ speechRate: "medium" })],
          totalCount: 1,
        })}
      />,
    );

    expect(screen.queryByText("medium")).toBeNull();
  });

  it("lets a clip be identified by ear before it is removed", () => {
    // The only way to tell what a clip holds, since the text is not stored.
    render(
      <AudioLibrary
        view={libraryView({
          assets: [mediaAssetFixture({ id: "asset-9" })],
          totalCount: 1,
        })}
      />,
    );

    expect(document.querySelector("audio")?.getAttribute("src")).toBe(
      "/api/audio/asset-9",
    );
  });

  it("offers removal for every clip", () => {
    render(
      <AudioLibrary
        view={libraryView({
          assets: [
            mediaAssetFixture({ id: "asset-1" }),
            mediaAssetFixture({ id: "asset-2", cacheKey: "b".repeat(64) }),
          ],
          totalCount: 2,
        })}
      />,
    );

    expect(
      screen.getAllByRole("button", { name: /remove audio/i }),
    ).toHaveLength(2);
  });

  it("submits the asset that its own row holds", () => {
    render(
      <AudioLibrary
        view={libraryView({
          assets: [
            mediaAssetFixture({ id: "asset-1" }),
            mediaAssetFixture({ id: "asset-2", cacheKey: "b".repeat(64) }),
          ],
          totalCount: 2,
        })}
      />,
    );

    expect(
      [
        ...document.querySelectorAll<HTMLInputElement>('input[name="assetId"]'),
      ].map((input) => input.value),
    ).toEqual(["asset-1", "asset-2"]);
  });

  describe("when no speech provider is configured", () => {
    /**
     * The other half of the fix. Study screens render no audio control at all in this
     * state, which leaves exactly one thing to explain — and this is the surface allowed
     * to explain it, because a settings page may name a variable.
     */
    function unconfigured(
      overrides: Partial<AudioLibraryView> = {},
    ): AudioLibraryView {
      return libraryView({ provider: "fake", ...overrides });
    }

    it("says that audio is not configured", () => {
      render(<AudioLibrary view={unconfigured()} />);

      expect(screen.getByText(/Audio is not configured/)).toBeVisible();
    });

    it("names the variable to set and the file to set it in", () => {
      render(<AudioLibrary view={unconfigured()} />);

      expect(screen.getByText("SPEECH_PROVIDER=polly")).toBeVisible();
      expect(screen.getByText(".env.local")).toBeVisible();
      expect(
        screen.getByText(/AWS credentials via your profile/),
      ).toBeVisible();
    });

    it("explains why nothing on a card offers to be read aloud", () => {
      // Otherwise the missing controls are a second mystery on top of the first.
      render(<AudioLibrary view={unconfigured()} />);

      expect(
        screen.getByText(/no card or question offers to be read aloud/i),
      ).toBeVisible();
    });

    it("lists no voice or engine, because none of them would speak", () => {
      render(<AudioLibrary view={unconfigured()} />);

      expect(screen.queryByText("Zhiyu")).toBeNull();
      expect(screen.queryByText("Joanna")).toBeNull();
      expect(screen.queryByText("Mandarin voice")).toBeNull();
    });

    it("never puts the word fake in front of the owner", () => {
      // `fake` is a wiring value. It tells the owner nothing and reads like a verdict on
      // their content.
      const { container } = render(<AudioLibrary view={unconfigured()} />);

      expect(container.textContent ?? "").not.toMatch(/fake/i);
    });

    it("still lists and still removes anything already stored", () => {
      // Reconfiguring must not make a clip undeletable — and a silent clip the
      // placeholder provider made is exactly what an owner wants gone.
      render(
        <AudioLibrary
          view={unconfigured({
            assets: [mediaAssetFixture({ id: "asset-1" })],
            totalCount: 1,
            totalByteSize: 768,
          })}
        />,
      );

      expect(document.querySelector("audio")?.getAttribute("src")).toBe(
        "/api/audio/asset-1",
      );
      expect(
        screen.getByRole("button", { name: /remove audio/i }),
      ).toBeInTheDocument();
    });
  });
});
