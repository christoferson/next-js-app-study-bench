import type { FlashcardContent } from "@/modules/flashcards/domain/flashcard";
import type { QuestionRevision } from "@/modules/question-bank/domain/question";
import type { SpeechClipRequest } from "./speech-clip";
import { isOfferableClip, TERM_CLIP_KEY } from "./speech-clip";
import type { SpeechLanguage } from "./speech-request";

/**
 * Which parts of a piece of content can be listened to.
 *
 * Pure functions over stored content, in the domain, so what gets spoken is one rule
 * rather than a decision each page makes. Audio depends on the banks and neither bank
 * depends on audio: the dependency direction is
 * `question-bank ← flashcards ← audio ← study-sessions`, asserted in
 * `module-boundaries.test.ts`.
 *
 * **What is deliberately never spoken.**
 *
 * - *A reading.* `xuéxí` is a romanisation for the eye. Reading it aloud with a
 *   Mandarin voice produces something between nonsense and a mispronunciation, and it
 *   would teach the wrong sound for the one card type this feature exists for
 *   (`SPEC.md` section 28.1 read together with the owner's HSK track).
 * - *A meaning or a translation.* It is the answer. Speaking it would hand over what
 *   the card is testing, and it is in a different language from the voice reading it.
 * - *An example sentence.* The owner's decision, after using it: a vocabulary card is
 *   for learning one word, and a row of buttons down the answer face invites pressing
 *   all of them. An example sentence is also where the characters cost the most — a
 *   dozen each against two or three for a term — for the part of the card that is
 *   read, not memorised. Nothing about the cache or the port assumes this, so
 *   returning example clips again is a change to this one function.
 * - *An example's reading or translation.* Same reasons, and they are in a different
 *   language from the voice that would read them.
 */

/**
 * The listenable part of one flashcard: a vocabulary term.
 *
 * Vocabulary only, and that is a scope decision rather than an oversight: a
 * vocabulary card has a term whose pronunciation *is* the thing being learned, while
 * the front of a basic card, a cloze sentence with a blank read out as "[…]", and a
 * scenario paragraph are all text the owner reads. The switch is exhaustive, so a
 * sixth card type has to decide.
 *
 * At most one clip, therefore. This is the single place that decides it, so the card
 * page, the review screen, and a card inside a session cannot disagree about what a
 * card offers — none of them filters, and none of them can.
 */
export function flashcardClipRequests(
  content: FlashcardContent,
  language: SpeechLanguage,
): readonly SpeechClipRequest[] {
  switch (content.type) {
    case "VOCABULARY":
      return offerable([
        { key: TERM_CLIP_KEY, label: "Term", text: content.term, language },
      ]);
    case "BASIC":
    case "REVERSED":
    case "CLOZE":
    case "SCENARIO":
      return [];
  }
}

/**
 * The listenable parts of one question revision: its stem.
 *
 * The stem only. The choices are not offered, and the reason is cost against value:
 * reading a five-choice question means five more clips per question — six times the
 * characters for a bank of hundreds — and the owner's use for this is hearing the
 * question while away from the screen, which the stem gives them. A single clip
 * combining the stem and every choice would be one call, but it would also be a
 * fixed reading order for an answer set the study screen shuffles, so what was heard
 * would not match what is shown.
 *
 * Choices become worth synthesizing when a listening-comprehension question type
 * exists, which is the part of D10 that waits for its question type.
 */
export function questionClipRequests(
  revision: Pick<QuestionRevision, "stem">,
  language: SpeechLanguage,
): readonly SpeechClipRequest[] {
  return offerable([
    { key: "stem", label: "Question", text: revision.stem, language },
  ]);
}

/** Drops anything with no speakable text, so no page renders a dead control. */
function offerable(
  requests: readonly SpeechClipRequest[],
): readonly SpeechClipRequest[] {
  return requests.filter(isOfferableClip);
}
