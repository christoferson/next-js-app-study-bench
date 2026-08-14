import type { IsoTimestamp } from "@/platform/clock";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import type { ObjectiveId } from "@/modules/certifications/domain/objective";
import type {
  GenerationMode,
  QuestionId,
} from "@/modules/question-bank/domain/question";

/**
 * Flashcard aggregate: a root that owns identity, lifecycle, and provenance,
 * plus immutable revisions that own the content.
 *
 * The shape deliberately mirrors the question aggregate
 * (`spec/DOMAIN-RULES.md` section 1.1): a root with a current-revision pointer,
 * append-only revisions, and content modelled as a discriminated union. A card
 * has no quality dimension — `SPEC.md` section 6.4 gives flashcards no review
 * state — so lifecycle is the only status a card carries.
 *
 * Domain code is framework-free: no React, Next.js, database driver, or
 * environment access.
 */

export type FlashcardId = string;
export type FlashcardRevisionId = string;

/** Flashcard types from `SPEC.md` section 6.4. */
export type CardType =
  "BASIC" | "REVERSED" | "CLOZE" | "VOCABULARY" | "SCENARIO";

export const CARD_TYPES: readonly CardType[] = [
  "BASIC",
  "REVERSED",
  "CLOZE",
  "VOCABULARY",
  "SCENARIO",
];

/**
 * Lifecycle status.
 *
 * The same four states as a question (`spec/DOMAIN-RULES.md` section 1.2), and
 * `ARCHIVED` is unproduced for the same reason it is unproduced for questions:
 * D4 offers retire (reversible), and archival becomes meaningful once a card
 * cannot be withdrawn from study by retirement alone.
 */
export type FlashcardLifecycleStatus =
  "DRAFT" | "ACTIVE" | "RETIRED" | "ARCHIVED";

export const FLASHCARD_LIFECYCLE_STATUSES: readonly FlashcardLifecycleStatus[] =
  ["DRAFT", "ACTIVE", "RETIRED", "ARCHIVED"];

/**
 * Variant card content, discriminated by `type`
 * (`spec/CODING-STANDARDS.md` section 1.3). The discriminator is persisted in
 * its own column as well as inside the JSON payload, so the bank can filter by
 * card type without parsing JSON.
 *
 * `REVERSED` is its own type rather than a flag on `BASIC`: which side is
 * prompted is part of what the card *is*, it must survive a round trip through
 * persistence, and the renderer must be forced to handle it. `SPEC.md`
 * section 6.4 lists it as a type alongside the others.
 *
 * `CLOZE` keeps one text containing `{{...}}` deletions rather than a separate
 * front and back: the two faces are derived from the same sentence, so storing
 * them apart would allow them to disagree. A deletion may carry a hint after a
 * `|`, as in `{{答案|the hint}}`, which is shown beside the blank.
 *
 * The richer `VOCABULARY` fields are **optional and additive**. A card written
 * before they existed carries `term`, `reading`, `meaning`, and
 * `exampleSentence` only, and stays valid unchanged: the new fields are absent
 * rather than empty, so nothing had to be migrated and no stored payload was
 * rewritten. `meaning` remains the primary gloss and the only required one.
 */
/**
 * One worked example on a vocabulary card.
 *
 * The fields are named for their role rather than for one language — `text`,
 * `reading`, `translation` rather than hanzi, pinyin, English — because the card
 * type is shared by every track. The HSK bank fills them with hanzi, pinyin, and
 * an English gloss; a card in another track fills the same three roles with its
 * own script. `reading` matches the name the card already uses for the term's
 * pronunciation, so the two cannot be confused for different concepts.
 */
export interface VocabularyExample {
  /** The sentence in the language being learned. */
  readonly text: string;
  /** Pronunciation of the sentence, when the language uses one. */
  readonly reading?: string;
  /** The sentence in the owner's own language. */
  readonly translation?: string;
}

export type FlashcardContent =
  | {
      readonly type: "BASIC";
      readonly front: string;
      readonly back: string;
    }
  | {
      readonly type: "REVERSED";
      /** Written the same way round as a basic card; prompted back first. */
      readonly front: string;
      readonly back: string;
    }
  | {
      readonly type: "CLOZE";
      /**
       * Sentence with one or more `{{deleted}}` sections.
       *
       * A deletion may name a hint after a `|`: `{{答案|the first character}}`
       * blanks out `答案` and offers "the first character" beside the blank.
       */
      readonly text: string;
    }
  | {
      readonly type: "VOCABULARY";
      readonly term: string;
      /** Pronunciation such as pinyin. Optional: not every language needs one. */
      readonly reading: string | null;
      /** The primary gloss, always present. */
      readonly meaning: string;
      /**
       * The first example, kept for cards written before `examples` existed.
       *
       * Still writable by hand, and still rendered. When both this and `examples`
       * are present both are shown, this one first: it is the example the owner
       * or the importer chose, and enrichment adds to a card rather than
       * replacing what was already there.
       */
      readonly exampleSentence: string | null;
      /**
       * Further senses beyond `meaning`, most common first.
       *
       * Separate from `meaning` rather than replacing it so a card enriched with
       * five senses still has one primary gloss for a list row and a card face.
       */
      readonly meanings?: readonly string[];
      readonly synonyms?: readonly string[];
      readonly antonyms?: readonly string[];
      /** Worked examples, each with its own reading and translation. */
      readonly examples?: readonly VocabularyExample[];
      /** Register, collocation, or usage warnings, as a short paragraph. */
      readonly usageNotes?: string;
    }
  | {
      readonly type: "SCENARIO";
      readonly scenario: string;
      readonly question: string;
      readonly answer: string;
    };

/**
 * Immutable card content.
 *
 * A revision is never updated once written: editing a card appends revision
 * `n + 1` and moves the root's `currentRevisionId`. The repository port has no
 * update-revision method, and every recorded review names the revision it was
 * answered against (`spec/DOMAIN-RULES.md` section 1.4), so a later edit can
 * never rewrite what was studied.
 */
export interface FlashcardRevision {
  readonly id: FlashcardRevisionId;
  readonly flashcardId: FlashcardId;
  /** 1 for the first revision, incrementing by one per edit. */
  readonly revisionNumber: number;
  readonly cardType: CardType;
  readonly content: FlashcardContent;
  /** Owner-only note; never shown while reviewing. */
  readonly notes: string | null;
  readonly tags: readonly string[];
  /** BCP-47-style tag such as `en` or `zh`, when the owner records one. */
  readonly language: string | null;
  /**
   * The generation run that wrote *this revision*, or `null` when the owner did.
   *
   * Distinct from `Flashcard.generationRunId`, which records what created the
   * card. The two answer different questions and a card can have both answers at
   * once: an enrichment run appends a revision to a card the owner wrote by hand,
   * so the card stays `MANUAL` with no run, while the revision names the run that
   * produced its text. Recording the run only on the root would have to overwrite
   * how the card came to exist, which is provenance that lies.
   */
  readonly generationRunId: string | null;
  readonly createdAt: IsoTimestamp;
}

/**
 * Flashcard root.
 *
 * `currentRevisionId` is typed non-nullable because a card without content is
 * not a valid aggregate. The column is nullable in SQLite only so the root row
 * can be inserted before the revision it points at (a circular foreign key).
 *
 * `sourceQuestionId` records that the card was converted from a question. The
 * card is independent from that moment on: editing either side never changes the
 * other, and the pointer is provenance only.
 */
export interface Flashcard {
  readonly id: FlashcardId;
  readonly certificationId: CertificationId;
  readonly currentRevisionId: FlashcardRevisionId;
  readonly lifecycleStatus: FlashcardLifecycleStatus;
  readonly sourceQuestionId: QuestionId | null;
  /**
   * How the card came to exist. `MANUAL` covers both a card the owner wrote and
   * one converted from a question: a conversion copies owner-authored content, so
   * calling it anything else would overstate the model's involvement.
   *
   * The enum is the question bank's, because provenance modes are a property of
   * generated content rather than of one content type
   * (`spec/AI-GUIDELINES.md` section 1.2).
   */
  readonly generationMode: GenerationMode;
  /** The generation run that produced this card, or `null` if none did. */
  readonly generationRunId: string | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/** A root together with its current revision, as list and detail views need. */
export interface FlashcardWithRevision {
  readonly flashcard: Flashcard;
  readonly revision: FlashcardRevision;
}

/** A root with its full revision history and mappings. */
export interface FlashcardWithHistory {
  readonly flashcard: Flashcard;
  readonly currentRevision: FlashcardRevision;
  readonly revisions: readonly FlashcardRevision[];
  readonly objectiveIds: readonly ObjectiveId[];
}

/**
 * The type's name on its own.
 *
 * One word, because this is what goes inside a sentence ("a basic card"), inside a
 * badge, and inside the rendered prompt that tells a model which types it may write.
 * Anything longer is a label rather than a name, which is what `describeCardShape`
 * and `describeCardTypeChoice` below are for.
 */
export function describeCardType(cardType: CardType): string {
  switch (cardType) {
    case "BASIC":
      return "Basic";
    case "REVERSED":
      return "Reversed";
    case "CLOZE":
      return "Cloze";
    case "VOCABULARY":
      return "Vocabulary";
    case "SCENARIO":
      return "Scenario";
  }
}

/**
 * What the card looks like, in a few words.
 *
 * "Reversed" and "Cloze" mean nothing on their own, and a name the owner has to
 * remember the meaning of is a name they will pick wrong from a dropdown. This is the
 * compact form that fits inside an option label, next to the name; it is deliberately
 * shorter than `describeCardPrompting`, which is a full sentence for a hint or a
 * chooser row where there is room to explain.
 *
 * The arrow reads as "prompts": front → back is asked front-first.
 */
export function describeCardShape(cardType: CardType): string {
  switch (cardType) {
    case "BASIC":
      return "front → back";
    case "REVERSED":
      return "back → front";
    case "CLOZE":
      return "fill in the blank";
    case "VOCABULARY":
      return "term / reading / meaning";
    case "SCENARIO":
      return "situation → response";
  }
}

/**
 * The type as an option to choose from: `Basic (front → back)`.
 *
 * The one label used by every select, checkbox list, and type chooser, so a card type
 * cannot be named one way in the bank filter and another in the generate form. Built
 * from the two helpers above rather than written out again, so there is a single
 * spelling of each name and each shape.
 */
export function describeCardTypeChoice(cardType: CardType): string {
  return `${describeCardType(cardType)} (${describeCardShape(cardType)})`;
}

/** Owner-facing description of how the type is studied, as a full sentence. */
export function describeCardPrompting(cardType: CardType): string {
  switch (cardType) {
    case "BASIC":
      return "Front prompts, back answers.";
    case "REVERSED":
      return "Back prompts, front answers — the same pair, studied the other way round.";
    case "CLOZE":
      return "A sentence with blanks to fill in.";
    case "VOCABULARY":
      return "A term prompts its reading, meaning, and example.";
    case "SCENARIO":
      return "A situation prompts a question and its answer.";
  }
}

export function describeFlashcardLifecycleStatus(
  status: FlashcardLifecycleStatus,
): string {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "ACTIVE":
      return "Active";
    case "RETIRED":
      return "Retired";
    case "ARCHIVED":
      return "Archived";
  }
}

/** Shortened text for list rows, cut on a word boundary where possible. */
export function textExcerpt(text: string, limit = 120): string {
  const collapsed = text.replace(/\s+/g, " ").trim();

  if (collapsed.length <= limit) {
    return collapsed;
  }

  const cut = collapsed.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");

  return `${(lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
