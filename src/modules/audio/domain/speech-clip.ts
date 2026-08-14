import type { SpeechLanguage, SpeechRate } from "./speech-request";
import { hasSpeakableText } from "./speech-request";

/**
 * One thing on a page that can be listened to.
 *
 * The unit the interface works in: a labelled piece of text, the language it is in,
 * and — once it exists — the asset that holds its audio. A card's term is one clip and
 * a question's stem is another. What a given surface offers is
 * `content-clips.ts`'s decision, not this type's: this stays general so a
 * listening-comprehension question can add clips without a new shape.
 *
 * Defined here, in the domain, because it is a plain value with no framework in it:
 * the same shape is produced by a server component, serialized into a Client
 * Component's props, and asserted in a test.
 */
export interface SpeechClipRequest {
  /**
   * Identifies the clip *within one page*, not globally.
   *
   * `term` or `stem`. It is a React key and a way for a component to find
   * the clip it wants to render; it is deliberately not part of the cache key, because
   * two cards that share a term must share the audio.
   */
  readonly key: string;
  /** What the control is called, e.g. `Term` or `Question`. */
  readonly label: string;
  readonly text: string;
  readonly language: SpeechLanguage;
  /** Omitted for the normal rate. */
  readonly rate?: SpeechRate;
}

/** A clip request together with the asset that already holds its audio. */
export interface SpeechClip extends SpeechClipRequest {
  /** `null` when nothing has been synthesized for this text yet. */
  readonly assetId: string | null;
}

/**
 * Whether a clip is worth offering a control for.
 *
 * A field holding only whitespace gets no control at all, rather than a button that
 * would fail on being pressed (`spec/UI-GUIDELINES.md` section 1.4).
 */
export function isOfferableClip(request: SpeechClipRequest): boolean {
  return hasSpeakableText(request.text);
}

/** Where the browser fetches one asset's bytes. */
export function audioSourcePath(assetId: string): string {
  return `/api/audio/${encodeURIComponent(assetId)}`;
}

/**
 * The clip key that identifies a card's headword.
 *
 * Assigned by `flashcardClipRequests`, and the one clip whose text is short enough — and
 * important enough — to be read out as the control's name.
 */
export const TERM_CLIP_KEY = "term";

/**
 * A defensive bound on a quoted name.
 *
 * A term is one to four characters, so this is not the rule that decides anything: it is
 * a guard against a card whose "term" field holds a sentence, which the bank permits.
 */
const MAX_QUOTED_LABEL_LENGTH = 24;

/**
 * What one play control is called, without saying how audio is made.
 *
 * The caller turns this into `Play …` or `Pause …`, because the verb belongs to the
 * control's state and this belongs to the content. Nothing here mentions generating,
 * synthesizing, caching, or a provider: a study screen offers pronunciation, and how that
 * pronunciation comes to exist is not the owner's problem
 * (`spec/UI-GUIDELINES.md` section 1).
 *
 * **A term is quoted; everything else is named by its part.** "Play 学习" is the most
 * identifying name a control can have, and a term is a word. A question stem is not: a
 * screen reader would read the whole sentence before saying what the button does, so it
 * becomes "Play the question".
 *
 * The test is the clip's key, not its length. A Mandarin sentence is only a handful of
 * characters, so a character count cannot tell a word from a sentence — the domain
 * already knows which clip is the headword, and this asks it.
 *
 * The fallback uses the clip's label, so several clips on one surface stay
 * distinguishable rather than sharing one name.
 */
export function clipControlName(clip: SpeechClipRequest): string {
  const text = clip.text.trim();
  const isQuotable =
    clip.key === TERM_CLIP_KEY &&
    text.length > 0 &&
    text.length <= MAX_QUOTED_LABEL_LENGTH &&
    !text.includes("\n");

  return isQuotable ? text : `the ${clip.label.toLowerCase()}`;
}

/**
 * The answer to "let me hear this".
 *
 * Returned by the Server Action the play control calls, and deliberately narrow: a
 * source to play, or nothing. No provider name, no category, no configuration detail
 * reaches a study screen — the interface either plays or says the audio is unavailable,
 * and `/settings/audio` is where a missing configuration is explained.
 */
export type AudioClipPlayback =
  | { readonly status: "ready"; readonly src: string }
  | { readonly status: "unavailable" };
