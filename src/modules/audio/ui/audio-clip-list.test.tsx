import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SpeechClip } from "@/modules/audio/domain/speech-clip";
import { AudioClipList } from "./audio-clip-list";

// The list wires the Server Action into the controls it renders; the action itself is
// exercised through the facade tests, and the button's own test drives it against the
// real schema.
vi.mock("./actions", () => ({ playAudioClipAction: vi.fn() }));

function clip(overrides: Partial<SpeechClip> = {}): SpeechClip {
  return {
    key: "term",
    label: "Term",
    text: "学习",
    language: "zh",
    assetId: null,
    ...overrides,
  };
}

function renderList(
  clips: readonly SpeechClip[],
  options: { readonly heading?: string } = {},
): void {
  render(
    <AudioClipList
      clips={clips}
      idPrefix="card-audio"
      {...(options.heading === undefined ? {} : { heading: options.heading })}
    />,
  );
}

describe("AudioClipList", () => {
  it("shows the phrase with a play button beside it", () => {
    renderList([clip()]);

    expect(screen.getByText("学习")).toBeVisible();
    expect(screen.getAllByRole("button", { name: /^Play / })).toHaveLength(1);
  });

  it("names each button by what it plays, so two rows are distinguishable", () => {
    // A card passes one clip and a question passes one clip, so this is the component
    // keeping its promise rather than a page that renders two today.
    renderList([
      clip(),
      clip({ key: "stem", label: "Question", text: "Which service?" }),
    ]);

    expect(
      screen.getByRole("button", { name: "Play 学习" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Play the question" }),
    ).toBeInTheDocument();
  });

  it("renders nothing at all when there is nothing to listen to", () => {
    // A basic card, a vocabulary card with a blank term, or an install with no speech
    // provider configured: the page shows no empty "Listen" section rather than a heading
    // over nothing (`spec/UI-GUIDELINES.md` section 1.4).
    const { container } = render(
      <AudioClipList clips={[]} idPrefix="card-audio" heading="Listen" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the heading it is given", () => {
    renderList([clip()], { heading: "Listen" });

    expect(screen.getByRole("heading", { name: "Listen" })).toBeVisible();
  });

  it("omits the heading when the caller wants none", () => {
    renderList([clip()]);

    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("offers a play button whether or not the clip exists yet", () => {
    // One control, two states, and which one it is stays invisible: the owner presses
    // play either way, and a clip that already exists simply starts sooner.
    renderList([
      clip({ assetId: "asset-1" }),
      clip({ key: "stem", label: "Question", text: "Which service?" }),
    ]);

    expect(screen.getAllByRole("button", { name: /^Play / })).toHaveLength(2);
  });

  it("offers no removal beside a phrase", () => {
    // Deletion is management, and it lives on `/settings/audio`. Beside a control the
    // owner came here to press it was clutter — and a way to destroy something a moment
    // of Polly time paid for, one mis-tap away from the play button.
    renderList([clip({ assetId: "asset-1" })]);

    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });

  it("shows no native transport bar and submits no form", () => {
    // Both halves of what the owner objected to: a chunky default player, and a
    // "Generate audio" form standing between them and the sound.
    renderList([clip({ assetId: "asset-1" }), clip({ key: "stem" })]);

    expect(document.querySelectorAll("form")).toHaveLength(0);
    expect(
      [...document.querySelectorAll("audio")].every(
        (element) => !element.hasAttribute("controls"),
      ),
    ).toBe(true);
  });
});
