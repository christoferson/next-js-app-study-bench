import { InvalidFlashcardContentError } from "./errors";
import type { CardType, FlashcardContent } from "./flashcard";

/**
 * Content invariants, cloze parsing, and face derivation for each card type.
 *
 * These are the rules that make a card studiable at all, so they live in the
 * domain and run on every create and every edit — not only in a form schema. The
 * switches are exhaustive over `FlashcardContent`, so adding a sixth card type
 * fails to compile until its rules, its faces, and its search text are written
 * (`spec/CODING-STANDARDS.md` section 1.4).
 */

export const MAX_CLOZE_DELETIONS = 8;

/** What a cloze blank looks like once the deletion is hidden. */
export const CLOZE_BLANK = "[…]";

/** The markers that delimit a cloze deletion in the owner's text. */
export const CLOZE_OPEN = "{{";
export const CLOZE_CLOSE = "}}";

/** One piece of a parsed cloze sentence. */
export type ClozeSegment =
  | { readonly kind: "TEXT"; readonly text: string }
  | { readonly kind: "DELETION"; readonly text: string };

/**
 * Splits a cloze sentence into literal text and deleted sections.
 *
 * Parsing is deliberately permissive about what is *inside* a deletion and
 * strict about the markers: an unclosed `{{` is reported by
 * `assertValidContent`, and here it is simply left as literal text so a renderer
 * never throws while displaying a stored card.
 */
export function parseCloze(text: string): readonly ClozeSegment[] {
  const segments: ClozeSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const open = text.indexOf(CLOZE_OPEN, cursor);

    if (open === -1) {
      break;
    }

    const close = text.indexOf(CLOZE_CLOSE, open + CLOZE_OPEN.length);

    if (close === -1) {
      break;
    }

    if (open > cursor) {
      segments.push({ kind: "TEXT", text: text.slice(cursor, open) });
    }

    segments.push({
      kind: "DELETION",
      text: text.slice(open + CLOZE_OPEN.length, close),
    });
    cursor = close + CLOZE_CLOSE.length;
  }

  if (cursor < text.length) {
    segments.push({ kind: "TEXT", text: text.slice(cursor) });
  }

  return segments;
}

/** The deleted sections of a cloze sentence, in the order they appear. */
export function clozeDeletions(text: string): readonly string[] {
  return parseCloze(text)
    .filter((segment) => segment.kind === "DELETION")
    .map((segment) => segment.text);
}

/** The sentence with every deletion replaced by a blank. */
export function clozePrompt(text: string): string {
  return parseCloze(text)
    .map((segment) => (segment.kind === "TEXT" ? segment.text : CLOZE_BLANK))
    .join("");
}

/** The sentence with the markers removed, reading as ordinary prose. */
export function clozeAnswerText(text: string): string {
  return parseCloze(text)
    .map((segment) => segment.text)
    .join("");
}

/**
 * Asserts that `content` is a studiable card of its declared type.
 *
 * Every failure names the field the owner can correct so the form can render the
 * message next to its cause.
 */
export function assertValidContent(content: FlashcardContent): void {
  switch (content.type) {
    case "BASIC":
    case "REVERSED": {
      requireText(content.front, "front", "Write the front of the card.");
      requireText(content.back, "back", "Write the back of the card.");

      return;
    }
    case "CLOZE": {
      requireText(
        content.text,
        "text",
        "Write the sentence this card is built from.",
      );

      const deletions = clozeDeletions(content.text);

      if (deletions.length === 0) {
        throw new InvalidFlashcardContentError(
          "text",
          `Mark at least one part to blank out by wrapping it in ${CLOZE_OPEN} and ${CLOZE_CLOSE}.`,
        );
      }

      if (deletions.length > MAX_CLOZE_DELETIONS) {
        throw new InvalidFlashcardContentError(
          "text",
          `Blank out ${MAX_CLOZE_DELETIONS} parts or fewer in one card.`,
        );
      }

      if (deletions.some((deletion) => deletion.trim().length === 0)) {
        throw new InvalidFlashcardContentError(
          "text",
          "A blanked-out part cannot be empty.",
        );
      }

      if (hasUnbalancedMarkers(content.text)) {
        throw new InvalidFlashcardContentError(
          "text",
          `Every ${CLOZE_OPEN} needs a matching ${CLOZE_CLOSE}.`,
        );
      }

      return;
    }
    case "VOCABULARY": {
      requireText(content.term, "term", "Write the term this card teaches.");
      requireText(
        content.meaning,
        "meaning",
        "Write what the term means. A vocabulary card without a meaning cannot be answered.",
      );

      if (content.reading !== null && content.reading.trim().length === 0) {
        throw new InvalidFlashcardContentError(
          "reading",
          "Leave the reading empty or write one; blank spaces are not a reading.",
        );
      }

      if (
        content.exampleSentence !== null &&
        content.exampleSentence.trim().length === 0
      ) {
        throw new InvalidFlashcardContentError(
          "exampleSentence",
          "Leave the example empty or write one; blank spaces are not an example.",
        );
      }

      return;
    }
    case "SCENARIO": {
      requireText(
        content.scenario,
        "scenario",
        "Describe the situation this card is set in.",
      );
      requireText(
        content.question,
        "question",
        "Write the question the scenario leads to.",
      );
      requireText(content.answer, "answer", "Write the answer.");

      return;
    }
  }
}

/** One labelled line of a rendered card face. */
export interface CardFaceLine {
  /** Field name such as `Reading`, or `null` for an unlabelled line. */
  readonly label: string | null;
  readonly text: string;
}

/**
 * The two faces of a card: what prompts, and what is revealed.
 *
 * Derived in the domain rather than in the review component, so the review
 * screen, the bank preview, and the revision view cannot disagree about which
 * side of a `REVERSED` card is shown first.
 */
export interface CardFaces {
  readonly promptLabel: string;
  readonly prompt: readonly CardFaceLine[];
  readonly answerLabel: string;
  readonly answer: readonly CardFaceLine[];
}

export function cardFaces(content: FlashcardContent): CardFaces {
  switch (content.type) {
    case "BASIC":
      return {
        promptLabel: "Front",
        prompt: [{ label: null, text: content.front }],
        answerLabel: "Back",
        answer: [{ label: null, text: content.back }],
      };
    case "REVERSED":
      // The stored pair is the same as a basic card's; only the prompting order
      // differs, which is exactly what makes this a separate type.
      return {
        promptLabel: "Back",
        prompt: [{ label: null, text: content.back }],
        answerLabel: "Front",
        answer: [{ label: null, text: content.front }],
      };
    case "CLOZE":
      return {
        promptLabel: "Sentence with blanks",
        prompt: [{ label: null, text: clozePrompt(content.text) }],
        answerLabel: "Filled in",
        answer: [
          { label: null, text: clozeAnswerText(content.text) },
          ...clozeDeletions(content.text).map((deletion, index) => ({
            label: `Blank ${index + 1}`,
            text: deletion,
          })),
        ],
      };
    case "VOCABULARY":
      return {
        promptLabel: "Term",
        prompt: [{ label: null, text: content.term }],
        answerLabel: "Reading and meaning",
        answer: [
          ...(content.reading === null
            ? []
            : [{ label: "Reading", text: content.reading }]),
          { label: "Meaning", text: content.meaning },
          ...(content.exampleSentence === null
            ? []
            : [{ label: "Example", text: content.exampleSentence }]),
        ],
      };
    case "SCENARIO":
      return {
        promptLabel: "Scenario",
        prompt: [
          { label: "Situation", text: content.scenario },
          { label: "Question", text: content.question },
        ],
        answerLabel: "Answer",
        answer: [{ label: null, text: content.answer }],
      };
  }
}

/** One-line summary of a card for bank rows, taken from its prompt face. */
export function cardSummary(content: FlashcardContent): string {
  return cardFaces(content)
    .prompt.map((line) => line.text)
    .join(" — ");
}

/**
 * Every searchable text field of a card, flattened.
 *
 * Persisted alongside the JSON payload so the bank can search card text with a
 * `LIKE` over one column instead of matching JSON keys or adding a full-text
 * index.
 */
export function searchableText(content: FlashcardContent): string {
  switch (content.type) {
    case "BASIC":
    case "REVERSED":
      return [content.front, content.back].join(" \n ");
    case "CLOZE":
      return clozeAnswerText(content.text);
    case "VOCABULARY":
      return [
        content.term,
        content.reading ?? "",
        content.meaning,
        content.exampleSentence ?? "",
      ].join(" \n ");
    case "SCENARIO":
      return [content.scenario, content.question, content.answer].join(" \n ");
  }
}

/** Whether the type stores one text with cloze markers rather than two sides. */
export function isClozeType(cardType: CardType): boolean {
  switch (cardType) {
    case "BASIC":
      return false;
    case "REVERSED":
      return false;
    case "CLOZE":
      return true;
    case "VOCABULARY":
      return false;
    case "SCENARIO":
      return false;
  }
}

function requireText(value: string, field: string, reason: string): void {
  if (value.trim().length === 0) {
    throw new InvalidFlashcardContentError(field, reason);
  }
}

/**
 * Whether the text contains a marker that never pairs up.
 *
 * Counting is enough: `parseCloze` consumes markers in order, so a leftover
 * `{{` or a `}}` that no deletion produced means the owner mistyped one.
 */
function hasUnbalancedMarkers(text: string): boolean {
  const opens = countOccurrences(text, CLOZE_OPEN);
  const closes = countOccurrences(text, CLOZE_CLOSE);

  return opens !== closes || opens !== clozeDeletions(text).length;
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let cursor = text.indexOf(needle);

  while (cursor !== -1) {
    count += 1;
    cursor = text.indexOf(needle, cursor + needle.length);
  }

  return count;
}
