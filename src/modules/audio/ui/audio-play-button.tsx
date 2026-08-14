"use client";

import { useRef, useState } from "react";
import type {
  AudioClipPlayback,
  SpeechClip,
} from "@/modules/audio/domain/speech-clip";
import {
  audioSourcePath,
  clipControlName,
} from "@/modules/audio/domain/speech-clip";
import type { SpeechRequestFormInput } from "@/modules/audio/application/schemas";
import { DEFAULT_SPEECH_RATE } from "@/modules/audio/domain/speech-request";

interface AudioPlayButtonProps {
  readonly clip: SpeechClip;
  /**
   * Resolves the clip to something playable, synthesizing it if it does not exist.
   *
   * A Server Action, passed in by the server component that renders this, so this file
   * never imports the composition root (`spec/ARCHITECTURE.md` section 6.3).
   */
  readonly playAction: (
    input: SpeechRequestFormInput,
  ) => Promise<AudioClipPlayback>;
  /**
   * Prefix for the one element id this control generates.
   *
   * More than one control can appear on a page, and the review screen and the card page
   * use different prefixes, so a failure message is described by the button it belongs to
   * and no id is ever duplicated.
   */
  readonly idPrefix: string;
}

/** What the control is doing right now. */
type PlayState = "idle" | "pending" | "playing" | "unavailable";

/**
 * One tap, and the phrase is spoken.
 *
 * This replaces a two-step control — "Generate audio", then a native `<audio controls>`
 * bar — and both halves of that were wrong for a study screen. The first named an
 * implementation detail the owner has no reason to think about: pronunciation either
 * plays or it does not, and whether a clip has to be made first is StudyBench's
 * problem, not something to ask permission for. The second put a full transport bar,
 * timeline, and volume slider next to a two-character word, four times over on one card.
 *
 * So: a small speaker glyph beside the text, and nothing else on screen.
 *
 * **The gesture chain, which is the part that has to be right.** A browser only lets a
 * page start audio from within a user gesture. The click handler therefore never hands
 * off and comes back later: it awaits the action and then calls `play()` on an element
 * that already exists in the tree, all inside the same handler, so playback happens
 * under the activation the click granted. (An `await` is fine — activation is transient
 * rather than synchronous, and one round trip to synthesize a short phrase is well
 * inside it.) What is *not* fine, and is what the previous control did, is finishing the
 * gesture by re-rendering the page and requiring a second tap on a player that then
 * appears; on iOS that second tap is the only one that would have counted.
 *
 * **The source is assigned imperatively**, not through a React prop, for the same
 * reason: the element must be pointing at the clip before `play()` is called, and a
 * state update would not have committed yet. React never manages `src` here, so there
 * is no second render that could reload the media.
 *
 * **The element is always in the tree**, `preload="none"`, so nothing is fetched until a
 * tap. A card with four clips is four idle elements and no requests.
 *
 * **A clip already on screen is instant.** When the page found the asset in the cache
 * while rendering, the source is known before the first tap and no action runs at all.
 * Once resolved it is kept, so replaying never asks the server again.
 *
 * **Failure says one thing.** "Audio unavailable", quietly, next to the button — never a
 * provider name, a variable, a category, or an AWS concept. A missing configuration is
 * explained once, on `/settings/audio`, and this control is not rendered at all when
 * speech is unconfigured, so silence is not a state it can reach.
 */
export function AudioPlayButton({
  clip,
  playAction,
  idPrefix,
}: AudioPlayButtonProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [source, setSource] = useState<string | null>(
    clip.assetId === null ? null : audioSourcePath(clip.assetId),
  );
  const [state, setState] = useState<PlayState>("idle");
  const name = clipControlName(clip);
  const statusId = `${idPrefix}-audio-status`;

  async function start(src: string): Promise<void> {
    const element = audioRef.current;

    if (element === null) {
      return;
    }

    if (element.getAttribute("src") !== src) {
      element.setAttribute("src", src);
    }

    setState("playing");

    try {
      // `play()` resets a finished clip to its start itself, so replaying needs no
      // seek — which is just as well, since seeking a clip this short is meaningless.
      await element.play();
    } catch {
      // The browser refused. Nothing here can say why in terms the owner could act on,
      // and the honest report is the same as any other failure to produce sound.
      setState("unavailable");
    }
  }

  async function handleClick(): Promise<void> {
    if (state === "playing") {
      audioRef.current?.pause();
      setState("idle");

      return;
    }

    if (source !== null) {
      await start(source);

      return;
    }

    setState("pending");

    const playback = await playAction({
      text: clip.text,
      language: clip.language,
      rate: clip.rate ?? DEFAULT_SPEECH_RATE,
    });

    if (playback.status !== "ready") {
      setState("unavailable");

      return;
    }

    setSource(playback.src);
    await start(playback.src);
  }

  return (
    <span className="audio-play">
      <button
        type="button"
        className="audio-play-button"
        // The name says what will be heard — "Play 学习" — because a card holds several
        // of these and a screen reader listing controls out of context would otherwise
        // hear identical ones.
        aria-label={`${state === "playing" ? "Pause" : "Play"} ${name}`}
        aria-busy={state === "pending"}
        aria-describedby={state === "unavailable" ? statusId : undefined}
        disabled={state === "pending"}
        onClick={() => {
          void handleClick();
        }}
      >
        <PlayGlyph state={state} />
      </button>
      {state === "unavailable" ? (
        <span className="audio-play-error" id={statusId} role="status">
          Audio unavailable
        </span>
      ) : null}
      {/* No `controls`: the button above is the whole interface. No caption track
          either — a caption would be the text this was made from, which is on screen
          beside it. */}
      <audio
        className="audio-play-media"
        preload="none"
        ref={audioRef}
        onEnded={() => setState("idle")}
      />
    </span>
  );
}

/**
 * The glyph, which carries no accessible name of its own.
 *
 * `aria-hidden`, because the button already has one and a screen reader announcing
 * "speaker" before "Play 学习" is noise. Three shapes rather than three words, so the
 * control stays the size of a word beside a word.
 */
function PlayGlyph({ state }: { readonly state: PlayState }) {
  if (state === "pending") {
    return <span aria-hidden="true" className="audio-play-spinner" />;
  }

  return (
    <svg
      aria-hidden="true"
      className="audio-play-glyph"
      focusable="false"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      {state === "playing" ? (
        // Two bars: the control's job while sound is coming out is to stop it.
        <path d="M5 3h2.2v10H5V3zm3.8 0H11v10H8.8V3z" fill="currentColor" />
      ) : (
        // A speaker with two waves, rather than a bare triangle: this plays a
        // pronunciation, and a play triangle reads as "start a video".
        <>
          <path
            d="M2 6.2h2L7.1 3.4c.35-.32.9-.07.9.4v8.4c0 .47-.55.72-.9.4L4 9.8H2a.8.8 0 0 1-.8-.8V7a.8.8 0 0 1 .8-.8z"
            fill="currentColor"
          />
          <path
            d="M10.4 5.1a.75.75 0 0 1 1.05.15 4.6 4.6 0 0 1 0 5.5.75.75 0 0 1-1.2-.9 3.1 3.1 0 0 0 0-3.7.75.75 0 0 1 .15-1.05z"
            fill="currentColor"
          />
          <path
            d="M12.7 2.9a.75.75 0 0 1 1.05.13 7.9 7.9 0 0 1 0 9.94.75.75 0 0 1-1.18-.93 6.4 6.4 0 0 0 0-8.08.75.75 0 0 1 .13-1.06z"
            fill="currentColor"
          />
        </>
      )}
    </svg>
  );
}
