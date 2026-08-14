import type { SpeechClip } from "@/modules/audio/domain/speech-clip";
import { AudioPlayButton } from "./audio-play-button";
import { playAudioClipAction } from "./actions";

interface AudioClipListProps {
  readonly clips: readonly SpeechClip[];
  /** Distinguishes this list's element ids from another list on the same page. */
  readonly idPrefix: string;
  /** Heading for the group, e.g. `Listen`. Omitted inside a card face. */
  readonly heading?: string;
}

/**
 * Every listenable part of one piece of content, as text with a play button beside it.
 *
 * A server component that wires the Server Action, so the pages that render it never
 * import it and the client component never imports the composition root
 * (`spec/ARCHITECTURE.md` section 6.3). It renders nothing at all when there is nothing
 * to listen to — no empty "Listen" section over a card that offers no audio — and a page
 * renders it only when speech is configured, so an unconfigured install shows no control
 * anywhere on a study screen.
 *
 * A list rather than a single control, though every surface currently passes one clip:
 * what a piece of content offers is `content-clips.ts`'s decision, and a
 * listening-comprehension question will pass several.
 *
 * **The layout is a phrase with a button after it**, not a labelled row holding a
 * player. What the owner is looking at is the text; the button is punctuation. The row
 * this replaces was a label, the phrase, a native transport bar, and a delete button —
 * four pieces of furniture around a two-character word. Deletion in particular does not
 * belong beside a control the owner came here to press; it lives on `/settings/audio`
 * with the rest of what is stored.
 *
 * No visible label per row: the button's accessible name quotes the term or names the
 * part it belongs to, which is what a screen reader needs, and a sighted owner can
 * already see which line the button is on.
 */
export function AudioClipList({
  clips,
  idPrefix,
  heading,
}: AudioClipListProps) {
  if (clips.length === 0) {
    return null;
  }

  return (
    <div className="audio-clips">
      {heading === undefined ? null : (
        <h3 className="audio-clips-heading">{heading}</h3>
      )}
      <ul className="audio-clip-rows">
        {clips.map((clip) => (
          <li className="audio-clip-row" key={clip.key}>
            <span className="audio-clip-phrase">{clip.text}</span>
            <AudioPlayButton
              clip={clip}
              playAction={playAudioClipAction}
              idPrefix={`${idPrefix}-${clip.key}`}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
