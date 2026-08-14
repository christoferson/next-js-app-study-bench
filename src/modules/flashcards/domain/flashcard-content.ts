import { InvalidFlashcardContentError } from "./errors";
import type {
  CardType,
  FlashcardContent,
  VocabularyExample,
} from "./flashcard";

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

/**
 * Separates a deletion's answer from its hint: `{{答案|the first character}}`.
 *
 * A separator *inside* the existing markers rather than a parallel array of
 * hints, for two reasons. A hint belongs to one blank, and an array would let the
 * two lists fall out of step — three hints for two blanks is a state the type
 * would permit and the renderer would have to invent a rule for. And the marker
 * counting `hasUnbalancedMarkers` relies on stays correct untouched, because a
 * hint adds no marker. The cost is that a literal `|` cannot appear inside a
 * deletion, which is documented in the form's hint; only the *first* separator
 * splits, so a hint may contain one.
 */
export const CLOZE_HINT_SEPARATOR = "|";

/** How long a hint may be. A hint is a nudge, not a second sentence. */
export const MAX_CLOZE_HINT_LENGTH = 120;

/** The most senses, synonyms, antonyms, and examples one card may carry. */
export const MAX_VOCABULARY_MEANINGS = 8;
export const MAX_VOCABULARY_SYNONYMS = 12;
export const MAX_VOCABULARY_ANTONYMS = 12;
export const MAX_VOCABULARY_EXAMPLES = 8;

/** One piece of a parsed cloze sentence. */
export type ClozeSegment =
  | { readonly kind: "TEXT"; readonly text: string }
  | {
      readonly kind: "DELETION";
      /** What is blanked out, with the hint removed. */
      readonly text: string;
      /** The hint offered beside the blank, or `null` when none was written. */
      readonly hint: string | null;
    };

/**
 * Splits a cloze sentence into literal text and deleted sections.
 *
 * Parsing is deliberately permissive about what is *inside* a deletion and
 * strict about the markers: an unclosed `{{` is reported by
 * `assertValidContent`, and here it is simply left as literal text so a renderer
 * never throws while displaying a stored card.
 *
 * A deletion's body is split on its first `|` into the answer and its hint. A
 * body with no separator has no hint, which is what every card written before
 * hints existed looks like.
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

    segments.push(toDeletion(text.slice(open + CLOZE_OPEN.length, close)));
    cursor = close + CLOZE_CLOSE.length;
  }

  if (cursor < text.length) {
    segments.push({ kind: "TEXT", text: text.slice(cursor) });
  }

  return segments;
}

/** Splits one deletion body into its answer and its hint. */
function toDeletion(body: string): ClozeSegment {
  const separator = body.indexOf(CLOZE_HINT_SEPARATOR);

  if (separator === -1) {
    return { kind: "DELETION", text: body, hint: null };
  }

  const hint = body.slice(separator + CLOZE_HINT_SEPARATOR.length).trim();

  return {
    kind: "DELETION",
    text: body.slice(0, separator),
    // A trailing separator with nothing after it is no hint at all, which is
    // kinder than showing an empty parenthesis on the prompt face.
    hint: hint.length === 0 ? null : hint,
  };
}

/** Every deletion of a cloze sentence, in the order they appear. */
export function clozeBlanks(
  text: string,
): readonly Extract<ClozeSegment, { kind: "DELETION" }>[] {
  return parseCloze(text).filter((segment) => segment.kind === "DELETION");
}

/** The deleted answers of a cloze sentence, hints excluded. */
export function clozeDeletions(text: string): readonly string[] {
  return clozeBlanks(text).map((segment) => segment.text);
}

/**
 * The sentence with every deletion replaced by a blank.
 *
 * A blank with a hint reads `[…] (hint: …)`, so the hint sits where the answer
 * would be rather than in a separate list the owner has to look up.
 */
export function clozePrompt(text: string): string {
  return parseCloze(text)
    .map((segment) =>
      segment.kind === "TEXT" ? segment.text : describeBlank(segment.hint),
    )
    .join("");
}

/** The sentence with the markers and hints removed, reading as ordinary prose. */
export function clozeAnswerText(text: string): string {
  return parseCloze(text)
    .map((segment) => segment.text)
    .join("");
}

function describeBlank(hint: string | null): string {
  return hint === null ? CLOZE_BLANK : `${CLOZE_BLANK} (hint: ${hint})`;
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

      if (
        clozeBlanks(content.text).some(
          (blank) => (blank.hint?.length ?? 0) > MAX_CLOZE_HINT_LENGTH,
        )
      ) {
        throw new InvalidFlashcardContentError(
          "text",
          `A hint after ${CLOZE_HINT_SEPARATOR} must be ${MAX_CLOZE_HINT_LENGTH} characters or fewer.`,
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

      // The optional richer fields. Each is absent or a list of real entries:
      // a present-but-empty list and a blank entry both mean "nothing here",
      // and storing either would put an empty row on the card's answer face.
      assertEntryList(content.meanings, {
        field: "meanings",
        name: "meaning",
        limit: MAX_VOCABULARY_MEANINGS,
      });
      assertEntryList(content.synonyms, {
        field: "synonyms",
        name: "synonym",
        limit: MAX_VOCABULARY_SYNONYMS,
      });
      assertEntryList(content.antonyms, {
        field: "antonyms",
        name: "antonym",
        limit: MAX_VOCABULARY_ANTONYMS,
      });
      assertExamples(content.examples);

      if (
        content.usageNotes !== undefined &&
        content.usageNotes.trim().length === 0
      ) {
        throw new InvalidFlashcardContentError(
          "usageNotes",
          "Leave the usage notes out or write them; blank spaces are not a note.",
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
    case "VOCABULARY": {
      const senses = vocabularySenses(content);
      const examples = vocabularyExamples(content);

      return {
        promptLabel: "Term",
        prompt: [{ label: null, text: content.term }],
        answerLabel: "Reading and meaning",
        // Every richer field is a labelled line that exists only when the card
        // carries it, so an unenriched card renders exactly as it always did.
        answer: [
          ...(content.reading === null
            ? []
            : [{ label: "Reading", text: content.reading }]),
          { label: "Meaning", text: content.meaning },
          ...(senses.length > 1
            ? [{ label: "Also means", text: senses.slice(1).join("; ") }]
            : []),
          ...labelledList("Synonyms", content.synonyms),
          ...labelledList("Antonyms", content.antonyms),
          ...examples.map((example, index) => ({
            label: examples.length > 1 ? `Example ${index + 1}` : "Example",
            text: describeExample(example),
          })),
          ...(content.usageNotes === undefined
            ? []
            : [{ label: "Usage", text: content.usageNotes }]),
        ],
      };
    }
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

/** Card content narrowed to the vocabulary variant. */
export type VocabularyContent = Extract<
  FlashcardContent,
  { type: "VOCABULARY" }
>;

/**
 * Whether a vocabulary card already carries the richer fields.
 *
 * `meanings` is the marker rather than "any richer field is present", because it is
 * the one field every enrichment produces: a word always has at least one sense,
 * while a synonym, an antonym, or a usage note may genuinely not exist. Using a
 * field that can legitimately be absent would make an enriched card look
 * unenriched and offer it again on the next run.
 *
 * A predicate in the domain rather than a condition written out at each call site,
 * so the card badge, the selection query, and the enrichment checks all agree on
 * what "enriched" means.
 */
export function isVocabularyEnriched(content: VocabularyContent): boolean {
  return (content.meanings?.length ?? 0) > 0;
}

/**
 * Every sense of the term, primary gloss first.
 *
 * `meaning` is the primary gloss and `meanings` is what enrichment adds, so the
 * two are read together rather than one replacing the other. A sense repeated in
 * both is shown once: an enrichment that restates the existing gloss as its first
 * sense is normal, and a card reading "to study; to study" would look broken.
 */
export function vocabularySenses(
  content: VocabularyContent,
): readonly string[] {
  const senses = [content.meaning, ...(content.meanings ?? [])];
  const seen = new Set<string>();

  return senses.filter((sense) => {
    const key = sense.trim().toLowerCase();

    if (key.length === 0 || seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
}

/**
 * Every example on the card, the original `exampleSentence` first.
 *
 * Precedence is additive rather than either-or: the older field is the example
 * the owner or the importer chose, and enrichment appends to a card instead of
 * overwriting what was there. An enriched example that repeats the original
 * sentence is dropped, so an enrichment that echoes it back does not double it.
 */
export function vocabularyExamples(
  content: VocabularyContent,
): readonly VocabularyExample[] {
  const original: readonly VocabularyExample[] =
    content.exampleSentence === null ? [] : [{ text: content.exampleSentence }];
  const seen = new Set(
    original.map((example) => example.text.trim().toLowerCase()),
  );

  return [
    ...original,
    ...(content.examples ?? []).filter((example) => {
      const key = example.text.trim().toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    }),
  ];
}

/** One example as a single line: sentence, reading, then translation. */
export function describeExample(example: VocabularyExample): string {
  return [example.text, example.reading, example.translation]
    .filter((part): part is string => part !== undefined)
    .join("\n");
}

/** A labelled comma-joined line, or nothing when the list is absent. */
function labelledList(
  label: string,
  entries: readonly string[] | undefined,
): readonly CardFaceLine[] {
  return entries === undefined || entries.length === 0
    ? []
    : [{ label, text: entries.join(", ") }];
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
      // The richer fields are searchable too: a card enriched with a synonym the
      // owner remembers is a card they should be able to find by that synonym.
      return [
        content.term,
        content.reading ?? "",
        ...vocabularySenses(content),
        ...(content.synonyms ?? []),
        ...(content.antonyms ?? []),
        ...vocabularyExamples(content).map(describeExample),
        content.usageNotes ?? "",
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
 * Rules shared by every optional list of short strings on a vocabulary card.
 *
 * A bounded list of non-blank, non-duplicate entries. The maximum is what stops
 * an enrichment run from turning one card into a thesaurus page; the duplicate
 * rule is here because a model listing the same synonym twice is a mistake a
 * person reading the card would notice and a schema would not.
 */
function assertEntryList(
  entries: readonly string[] | undefined,
  rules: {
    readonly field: string;
    readonly name: string;
    readonly limit: number;
  },
): void {
  if (entries === undefined) {
    return;
  }

  if (entries.length === 0) {
    throw new InvalidFlashcardContentError(
      rules.field,
      `Leave the ${rules.name} list out rather than storing an empty one.`,
    );
  }

  if (entries.length > rules.limit) {
    throw new InvalidFlashcardContentError(
      rules.field,
      `List ${rules.limit} ${rules.name}s or fewer on one card.`,
    );
  }

  if (entries.some((entry) => entry.trim().length === 0)) {
    throw new InvalidFlashcardContentError(
      rules.field,
      `A ${rules.name} cannot be blank.`,
    );
  }

  const seen = entries.map((entry) => entry.trim().toLowerCase());

  if (new Set(seen).size !== seen.length) {
    throw new InvalidFlashcardContentError(
      rules.field,
      `The same ${rules.name} is listed twice.`,
    );
  }
}

function assertExamples(
  examples: readonly VocabularyExample[] | undefined,
): void {
  if (examples === undefined) {
    return;
  }

  if (examples.length === 0) {
    throw new InvalidFlashcardContentError(
      "examples",
      "Leave the examples out rather than storing an empty list.",
    );
  }

  if (examples.length > MAX_VOCABULARY_EXAMPLES) {
    throw new InvalidFlashcardContentError(
      "examples",
      `Keep ${MAX_VOCABULARY_EXAMPLES} examples or fewer on one card.`,
    );
  }

  for (const example of examples) {
    // The sentence itself is the example. A reading or a translation with no
    // sentence to belong to would render as a labelled line under nothing.
    requireText(example.text, "examples", "An example needs its own sentence.");

    if (example.reading !== undefined && example.reading.trim().length === 0) {
      throw new InvalidFlashcardContentError(
        "examples",
        "Leave an example's reading out rather than storing a blank one.",
      );
    }

    if (
      example.translation !== undefined &&
      example.translation.trim().length === 0
    ) {
      throw new InvalidFlashcardContentError(
        "examples",
        "Leave an example's translation out rather than storing a blank one.",
      );
    }
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
