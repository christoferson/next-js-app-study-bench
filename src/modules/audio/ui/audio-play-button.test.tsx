import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseInput } from "@/shared/parse-input";
import type { SpeechRequestFormInput } from "@/modules/audio/application/schemas";
import { speechRequestSchema } from "@/modules/audio/application/schemas";
import type {
  AudioClipPlayback,
  SpeechClip,
} from "@/modules/audio/domain/speech-clip";
import { AudioPlayButton } from "./audio-play-button";

/**
 * The one control a study screen offers: press it, hear the phrase.
 *
 * The action is driven through the *real* schema the Server Action parses, so a control
 * that sent an unparseable language or omitted the rate would fail here rather than at
 * runtime. Nothing touches AWS: the contract is "call the action, then play what it
 * returns", and both halves are asserted against the DOM.
 *
 * `play()` and `pause()` are not implemented by jsdom, so they are replaced with spies.
 * That is the point of the assertions rather than a limitation of them: what has to be
 * true is that playback is *started from inside the click handler*, on an element already
 * pointing at the right source. A test cannot hear sound, and the browser policy this
 * design exists for is about when `play()` is called, not about what comes out.
 */

const CLIP: SpeechClip = {
  key: "term",
  label: "Term",
  text: "学习",
  language: "zh",
  assetId: null,
};

const play = vi.fn<() => Promise<void>>();
const pause = vi.fn<() => void>();

/** An action that parses its input exactly as the Server Action does. */
function playAction(
  result: AudioClipPlayback,
  onCall: (input: SpeechRequestFormInput) => void = () => undefined,
) {
  return async (input: SpeechRequestFormInput): Promise<AudioClipPlayback> => {
    onCall(parseInput(speechRequestSchema, input));

    return result;
  };
}

function renderButton(
  options: {
    readonly clip?: Partial<SpeechClip>;
    readonly result?: AudioClipPlayback;
    readonly onCall?: (input: SpeechRequestFormInput) => void;
    readonly action?: (
      input: SpeechRequestFormInput,
    ) => Promise<AudioClipPlayback>;
  } = {},
): void {
  render(
    <AudioPlayButton
      clip={{ ...CLIP, ...options.clip }}
      playAction={
        options.action ??
        playAction(
          options.result ?? { status: "ready", src: "/api/audio/asset-1" },
          options.onCall,
        )
      }
      idPrefix="card-audio-term"
    />,
  );
}

function media(): HTMLAudioElement {
  const element = document.querySelector("audio");

  if (element === null) {
    throw new Error("no audio element was rendered");
  }

  return element;
}

describe("AudioPlayButton", () => {
  beforeEach(() => {
    play.mockReset();
    play.mockResolvedValue(undefined);
    pause.mockReset();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
  });

  describe("what it says it is", () => {
    it("names the phrase it will speak, not how audio is made", () => {
      // The failure this replaces: a button reading "Generate audio". Whether a clip has
      // to be made first is StudyBench's problem, and a study screen must not use the
      // vocabulary of the implementation.
      renderButton();

      expect(
        screen.getByRole("button", { name: "Play 学习" }),
      ).toBeInTheDocument();
    });

    it("names the part it belongs to when the phrase is a whole sentence", () => {
      // A screen reader would otherwise read the whole stem before saying what the button
      // does.
      renderButton({
        clip: {
          key: "stem",
          label: "Question",
          text: "Which service stores objects?",
        },
      });

      expect(
        screen.getByRole("button", { name: "Play the question" }),
      ).toBeInTheDocument();
    });

    it("offers no visible words about generating, caching, or a provider", () => {
      const { container } = render(
        <AudioPlayButton
          clip={CLIP}
          playAction={playAction({ status: "ready", src: "/api/audio/a" })}
          idPrefix="card-audio-term"
        />,
      );

      expect(container.textContent ?? "").not.toMatch(
        /generat|synthes|cache|provider|asset|polly/i,
      );
    });

    it("renders no native transport bar", () => {
      // The owner's complaint about the shipped version: a full player next to a
      // two-character word. The element exists to hold bytes, not to be an interface.
      renderButton({ clip: { assetId: "asset-1" } });

      expect(media().hasAttribute("controls")).toBe(false);
    });

    it("fetches nothing before it is pressed", () => {
      renderButton({ clip: { assetId: "asset-1" } });

      expect(media().getAttribute("preload")).toBe("none");
      expect(media().getAttribute("src")).toBeNull();
    });
  });

  describe("the first press, when no clip exists yet", () => {
    it("asks for the clip and plays it, with no second press", async () => {
      // The whole fix. One gesture: the action resolves the source and `play()` is called
      // inside the same handler, so the activation the click granted still applies.
      const onCall = vi.fn();

      renderButton({
        result: { status: "ready", src: "/api/audio/asset-7" },
        onCall,
      });

      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Play 学习" }));

      await waitFor(() => {
        expect(play).toHaveBeenCalledTimes(1);
      });

      expect(onCall).toHaveBeenCalledTimes(1);
      expect(onCall.mock.calls[0]?.[0]).toEqual({
        text: "学习",
        language: "zh",
        rate: "medium",
      });
    });

    it("points the element at the clip before starting it", async () => {
      renderButton({ result: { status: "ready", src: "/api/audio/asset-7" } });

      const user = userEvent.setup();

      await user.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(play).toHaveBeenCalled();
      });

      expect(media().getAttribute("src")).toBe("/api/audio/asset-7");
    });

    it("sends the clip's own rate when it has one", async () => {
      const onCall = vi.fn();

      renderButton({ clip: { rate: "slow" }, onCall });

      const user = userEvent.setup();

      await user.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(onCall).toHaveBeenCalledTimes(1);
      });

      expect(onCall.mock.calls[0]?.[0]).toMatchObject({ rate: "slow" });
    });

    it("sends English for an English clip", async () => {
      const onCall = vi.fn();

      renderButton({
        clip: {
          key: "stem",
          label: "Question",
          text: "Which service stores objects?",
          language: "en",
        },
        onCall,
      });

      const user = userEvent.setup();

      await user.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(onCall).toHaveBeenCalledTimes(1);
      });

      expect(onCall.mock.calls[0]?.[0]).toMatchObject({ language: "en" });
    });

    it("reports that it is working while the clip is being made", async () => {
      let release: (playback: AudioClipPlayback) => void = () => undefined;
      const pending = new Promise<AudioClipPlayback>((resolve) => {
        release = resolve;
      });

      renderButton({ action: async () => await pending });

      const user = userEvent.setup();
      const button = screen.getByRole("button");

      await user.click(button);

      await waitFor(() => {
        expect(button).toHaveAttribute("aria-busy", "true");
      });
      expect(button).toBeDisabled();

      release({ status: "ready", src: "/api/audio/asset-7" });

      await waitFor(() => {
        expect(play).toHaveBeenCalledTimes(1);
      });
      expect(button).not.toBeDisabled();
    });
  });

  describe("a clip that already exists", () => {
    it("plays without asking the server at all", async () => {
      // The page found the asset in the cache while rendering, so the source is known
      // before the first press: no round trip, and nothing billable.
      const onCall = vi.fn();

      renderButton({ clip: { assetId: "asset-1" }, onCall });

      const user = userEvent.setup();

      await user.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(play).toHaveBeenCalledTimes(1);
      });

      expect(onCall).not.toHaveBeenCalled();
      expect(media().getAttribute("src")).toBe("/api/audio/asset-1");
    });

    it("replays without asking again", async () => {
      const onCall = vi.fn();

      renderButton({
        result: { status: "ready", src: "/api/audio/asset-7" },
        onCall,
      });

      const user = userEvent.setup();
      const button = screen.getByRole("button");

      await user.click(button);
      await waitFor(() => {
        expect(play).toHaveBeenCalledTimes(1);
      });

      // Stop, then start again: the source is remembered, so the second start is local.
      await user.click(button);
      await user.click(button);

      await waitFor(() => {
        expect(play).toHaveBeenCalledTimes(2);
      });
      expect(onCall).toHaveBeenCalledTimes(1);
    });
  });

  describe("while it is playing", () => {
    it("becomes a way to stop", async () => {
      renderButton({ clip: { assetId: "asset-1" } });

      const user = userEvent.setup();

      await user.click(screen.getByRole("button"));

      const stop = await screen.findByRole("button", { name: "Pause 学习" });

      await user.click(stop);

      expect(pause).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole("button", { name: "Play 学习" }),
      ).toBeInTheDocument();
    });

    it("offers to play again once the clip ends", async () => {
      renderButton({ clip: { assetId: "asset-1" } });

      const user = userEvent.setup();

      await user.click(screen.getByRole("button"));
      await screen.findByRole("button", { name: "Pause 学习" });

      media().dispatchEvent(new Event("ended"));

      expect(
        await screen.findByRole("button", { name: "Play 学习" }),
      ).toBeInTheDocument();
    });
  });

  describe("when there is no sound to be had", () => {
    it("says so in words the owner can read, and no others", async () => {
      // Every failure the action can have — an unreachable provider, credentials without
      // permission, an unsupported engine — arrives here as the same one answer. A study
      // screen never shows a variable name or an AWS concept.
      renderButton({ result: { status: "unavailable" } });

      const user = userEvent.setup();

      await user.click(screen.getByRole("button"));

      const message = await screen.findByText("Audio unavailable");

      expect(message).toBeVisible();
      expect(screen.getByRole("button")).toHaveAttribute(
        "aria-describedby",
        "card-audio-term-audio-status",
      );
      expect(play).not.toHaveBeenCalled();
    });

    it("says the same thing when the browser refuses to start playback", async () => {
      play.mockRejectedValue(new Error("NotAllowedError"));

      renderButton({ clip: { assetId: "asset-1" } });

      const user = userEvent.setup();

      await user.click(screen.getByRole("button"));

      expect(await screen.findByText("Audio unavailable")).toBeVisible();
    });
  });
});
