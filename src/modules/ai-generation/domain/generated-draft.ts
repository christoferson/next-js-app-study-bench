import type { ObjectiveId } from "@/modules/certifications/domain/objective";
import type {
  QuestionContent,
  QuestionType,
} from "@/modules/question-bank/domain/question";
import type {
  CardType,
  FlashcardContent,
} from "@/modules/flashcards/domain/flashcard";
import type { VocabularyContent } from "@/modules/flashcards/domain/flashcard-content";

/**
 * What the model is asked to produce and what it produced.
 *
 * A draft is the shape between the gateway and persistence: already parsed out of
 * the provider's response, not yet checked, not yet stored. Keeping it separate
 * from `QuestionRevision` and `FlashcardRevision` means an unchecked model output
 * can never be mistaken for a stored revision — it has no identifiers, no
 * revision number, and no timestamps, because the application assigns those only
 * after the deterministic checks pass.
 */

/** What the owner asked for in one batch. */
export interface GenerationRequestSpec {
  readonly itemCount: number;
  /** Objectives the batch should cover; may be empty. */
  readonly objectiveIds: readonly ObjectiveId[];
  readonly difficulty: number | null;
  /**
   * Free text from the owner.
   *
   * Carried into the user message, never into the system instructions
   * (`spec/AI-GUIDELINES.md` sections 1.6 and 1.7): system instructions state who
   * the model is and what shape to answer in, and owner text must not be able to
   * rewrite either.
   */
  readonly additionalInstructions: string | null;
  /** Question types allowed in this batch; empty means the persona decides. */
  readonly questionTypes: readonly QuestionType[];
  /** Card types allowed in this batch; empty means the persona decides. */
  readonly cardTypes: readonly CardType[];
}

/**
 * One generated question, before any check has run.
 *
 * `objectiveIds` is what the model claimed the item covers, expressed with the
 * identifiers it was given. A claimed identifier that does not exist is rejected
 * by the deterministic checks rather than silently dropped.
 */
export interface GeneratedQuestionDraft {
  readonly stem: string;
  readonly instructions: string | null;
  readonly questionType: QuestionType;
  readonly content: QuestionContent;
  readonly explanation: string | null;
  readonly difficulty: number | null;
  readonly tags: readonly string[];
  readonly language: string | null;
  readonly objectiveIds: readonly ObjectiveId[];
  /**
   * Which excerpts the model says support this question, as the 1-based indexes it was
   * shown (`domain/source-grounding.ts`).
   *
   * Always present and empty for a model-knowledge batch, where no excerpt was sent, so
   * there is no optional field for a caller to forget. What an empty list *means* depends
   * on the mode and is decided by the deterministic checks: for `SOURCE_GROUNDED` a
   * question supported by nothing is not grounded and is rejected, and for `HYBRID` it is
   * a legitimate question whose framing came from the model's own knowledge.
   *
   * Indexes rather than chunk identifiers because the identifiers are never sent. A model
   * that invents an index can only name a passage that was in front of it or a number out
   * of range; it cannot make its output cite a document it was never shown.
   */
  readonly supportingChunkIndexes: readonly number[];
}

/** One generated flashcard, before any check has run. */
export interface GeneratedFlashcardDraft {
  readonly cardType: CardType;
  readonly content: FlashcardContent;
  readonly notes: string | null;
  readonly tags: readonly string[];
  readonly language: string | null;
  readonly objectiveIds: readonly ObjectiveId[];
}

/**
 * One card offered to an enrichment run.
 *
 * The whole current content rather than a copy of the three fields the prompt
 * shows, because the same target is used twice: to describe the word to the model,
 * and to merge an accepted answer into what the card already says. Copying the
 * fields out would let the described word and the merged card drift apart.
 *
 * The identifier is deliberately *not* sent to the model — it echoes the term back
 * and the application matches on that, so a model that invents an identifier cannot
 * make its output land on a different card.
 */
export interface VocabularyEnrichmentTarget {
  readonly flashcardId: string;
  readonly content: VocabularyContent;
}

/**
 * One enriched word, before any check has run.
 *
 * Deliberately not a `GeneratedFlashcardDraft`: this is not a card, it is the extra
 * fields for a card that already exists. `term` is the model's echo of the word it
 * was given, which is what the deterministic checks match against a target before
 * anything is written — an enrichment that drifted onto another word is rejected
 * rather than merged into the wrong card.
 */
export interface VocabularyEnrichmentDraft {
  readonly term: string;
  readonly meanings: readonly string[];
  readonly synonyms: readonly string[];
  readonly antonyms: readonly string[];
  readonly examples: readonly {
    readonly text: string;
    readonly reading: string | null;
    readonly translation: string | null;
  }[];
  readonly usageNotes: string | null;
}

/** An enrichment matched to the card it belongs to, ready to be written. */
export interface MatchedEnrichment {
  readonly target: VocabularyEnrichmentTarget;
  readonly draft: VocabularyEnrichmentDraft;
}

/** A draft that failed a check, with the reason the owner is shown. */
export interface RejectedDraft {
  /** 1-based position in the model's output, so the owner can count along. */
  readonly position: number;
  readonly reason: string;
}

/** The outcome of checking one batch: what may be stored and what was refused. */
export interface CheckedBatch<Draft> {
  readonly accepted: readonly Draft[];
  readonly rejected: readonly RejectedDraft[];
}
