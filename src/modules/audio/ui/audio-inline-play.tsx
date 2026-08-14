import type { SpeechClip } from "@/modules/audio/domain/speech-clip";
import { AudioPlayButton } from "./audio-play-button";
import { playAudioClipAction } from "./actions";

interface AudioInlinePlayProps {
  readonly clip: SpeechClip;
  /** Distinguishes this control's element ids from others on the same page. */
  readonly idPrefix: string;
}

/**
 * Just the play button, for a surface that already shows the text.
 *
 * The bank list's row title *is* the term, so `AudioClipList` — a phrase followed by a
 * button — would print the term twice. This wires the same Server Action to the same
 * button with none of the furniture. A server component for the same reason as the
 * list: the client button never imports the composition root
 * (`spec/ARCHITECTURE.md` section 6.3).
 */
export function AudioInlinePlay({ clip, idPrefix }: AudioInlinePlayProps) {
  return (
    <AudioPlayButton
      clip={clip}
      playAction={playAudioClipAction}
      idPrefix={idPrefix}
    />
  );
}
