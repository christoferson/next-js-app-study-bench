import type { ObjectiveId } from "@/modules/certifications/domain/objective";
import type {
  QuestionContent,
  QuestionType,
} from "@/modules/question-bank/domain/question";
import type {
  CardType,
  FlashcardContent,
} from "@/modules/flashcards/domain/flashcard";

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
