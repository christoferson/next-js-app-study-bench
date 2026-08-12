import type { ObjectiveId } from "@/modules/certifications/domain/objective";
import {
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  QUESTION_TYPES,
  contentChoices,
  correctChoiceIds,
} from "@/modules/question-bank/domain/question";
import type { QuestionContent } from "@/modules/question-bank/domain/question";
import {
  MAX_CHOICES,
  MIN_CHOICES,
} from "@/modules/question-bank/domain/question-content";
import { assertValidContent as assertValidQuestionContent } from "@/modules/question-bank/domain/question-content";
import { CARD_TYPES } from "@/modules/flashcards/domain/flashcard";
import { assertValidContent as assertValidCardContent } from "@/modules/flashcards/domain/flashcard-content";
import { isDomainError } from "@/shared/domain-error";
import type {
  CheckedBatch,
  GeneratedFlashcardDraft,
  GeneratedQuestionDraft,
  RejectedDraft,
} from "./generated-draft";

/**
 * Deterministic checks on generated output (`SPEC.md` section 11.3,
 * `spec/AI-GUIDELINES.md` section 1.8).
 *
 * These run after schema validation and before anything is persisted. Schema
 * validation answers "is this the right shape"; these answer "is this an
 * answerable item that refers to things that exist". They are pure functions over
 * plain data — no database, no clock, no model — so every rule is unit tested
 * without persistence, and a rule can never be skipped by a caller that forgot to
 * await something.
 *
 * The generator is never trusted as the authority on its own output
 * (`spec/AI-GUIDELINES.md` section 1.5). A draft that fails any rule is counted
 * as a failed item and never stored.
 *
 * Two rules from `SPEC.md` section 11.3 are structural rather than checked here,
 * and are noted where they are enforced instead:
 *
 * - *Lifecycle defaults to DRAFT* — the facade constructs every generated item
 *   with `DRAFT`/`UNREVIEWED` and offers no parameter to change it, so there is no
 *   value to check.
 * - *Generated questions are not labeled official* — no generated field feeds an
 *   official-source marker; objective `sourceType` is owner-managed and untouched
 *   by generation. `assertNotClaimedOfficial` below rejects a draft that tries to
 *   claim officialness in its text, which is the part a model can influence.
 * - *Source IDs exist when provided* — D6 generates from model knowledge only and
 *   the draft type has no source field, so a source reference is impossible to
 *   express. `assertNoFabricatedSources` states that as a check over the tags a
 *   model could otherwise use to fake a citation.
 */

/** What the drafts are allowed to refer to. */
export interface CheckContext {
  /** Objective identifiers that exist in the target track. */
  readonly objectiveIds: readonly ObjectiveId[];
}

const STEM_MIN_LENGTH = 10;

/**
 * Phrases that would present generated content as official exam material.
 *
 * `spec/AI-GUIDELINES.md` section 2.2 forbids claiming generated content is
 * official, and `SPEC.md` section 3 forbids exam-dump behavior. A model that
 * writes "this is an actual exam question" has produced something the owner
 * would be wrong to trust, so it is refused rather than stored with a caveat.
 */
const OFFICIAL_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bactual exam question\b/i,
  /\breal exam question\b/i,
  /\bofficial exam question\b/i,
  /\bofficial (?:aws|hsk|certification) question\b/i,
  /\bfrom the (?:actual|real|official) exam\b/i,
  /\bexam dump\b/i,
  /\bverbatim from the exam\b/i,
];

/** Tag shapes that would fake a citation for ungrounded output. */
const FABRICATED_SOURCE_PATTERNS: readonly RegExp[] = [
  /^https?:\/\//i,
  /^source:/i,
  /^doi:/i,
];

/**
 * Checks a batch of generated questions.
 *
 * Every draft is checked independently and failures are collected rather than
 * thrown: one unusable item out of ten must not discard the other nine, and the
 * owner is told how many were refused and why.
 */
export function checkQuestionDrafts(
  drafts: readonly GeneratedQuestionDraft[],
  context: CheckContext,
): CheckedBatch<GeneratedQuestionDraft> {
  const accepted: GeneratedQuestionDraft[] = [];
  const rejected: RejectedDraft[] = [];
  const known = new Set(context.objectiveIds);

  for (const [index, draft] of drafts.entries()) {
    const reason = questionRejection(draft, known);

    if (reason === null) {
      accepted.push(draft);
    } else {
      rejected.push({ position: index + 1, reason });
    }
  }

  return { accepted, rejected };
}

/** Checks a batch of generated flashcards. */
export function checkFlashcardDrafts(
  drafts: readonly GeneratedFlashcardDraft[],
  context: CheckContext,
): CheckedBatch<GeneratedFlashcardDraft> {
  const accepted: GeneratedFlashcardDraft[] = [];
  const rejected: RejectedDraft[] = [];
  const known = new Set(context.objectiveIds);

  for (const [index, draft] of drafts.entries()) {
    const reason = flashcardRejection(draft, known);

    if (reason === null) {
      accepted.push(draft);
    } else {
      rejected.push({ position: index + 1, reason });
    }
  }

  return { accepted, rejected };
}

/**
 * The first reason this question may not be stored, or `null` if it may.
 *
 * One reason rather than all of them: a rejected draft is discarded, not
 * corrected, so the owner needs to know why it went, not a list of everything
 * wrong with it.
 */
function questionRejection(
  draft: GeneratedQuestionDraft,
  known: ReadonlySet<ObjectiveId>,
): string | null {
  // Required fields.
  if (draft.stem.trim().length === 0) {
    return "The question has no text.";
  }

  if (draft.stem.trim().length < STEM_MIN_LENGTH) {
    return "The question text is too short to be answerable.";
  }

  // Recognized question type, and a content payload that matches it. The union's
  // discriminator and the declared type are two separate fields in the model's
  // output, so they can disagree.
  if (!QUESTION_TYPES.includes(draft.questionType)) {
    return `Unrecognised question type "${String(draft.questionType)}".`;
  }

  if (draft.content.type !== draft.questionType) {
    return `The question says it is ${draft.questionType} but its content is ${draft.content.type}.`;
  }

  const choiceProblem = choiceRejection(draft.content);

  if (choiceProblem !== null) {
    return choiceProblem;
  }

  // Answer references and counts, plus the type-specific rules the bank already
  // enforces for hand-written questions. Reusing the domain's own assertion is
  // deliberate: a generated question must clear exactly the bar a manual one
  // does, and duplicating the rules here would let the two drift.
  const contentProblem = domainContentProblem(() =>
    assertValidQuestionContent(draft.content),
  );

  if (contentProblem !== null) {
    return contentProblem;
  }

  const answerCountProblem = answerCountRejection(draft.content);

  if (answerCountProblem !== null) {
    return answerCountProblem;
  }

  // Recognized difficulty.
  if (draft.difficulty !== null) {
    if (
      !Number.isInteger(draft.difficulty) ||
      draft.difficulty < MIN_DIFFICULTY ||
      draft.difficulty > MAX_DIFFICULTY
    ) {
      return `Difficulty must be a whole number from ${MIN_DIFFICULTY} to ${MAX_DIFFICULTY}.`;
    }
  }

  // Objective identifiers must exist in the target track.
  const objectiveProblem = objectiveRejection(draft.objectiveIds, known);

  if (objectiveProblem !== null) {
    return objectiveProblem;
  }

  const officialProblem = assertNotClaimedOfficial([
    draft.stem,
    draft.instructions ?? "",
    draft.explanation ?? "",
    ...contentChoices(draft.content).map((choice) => choice.text),
  ]);

  if (officialProblem !== null) {
    return officialProblem;
  }

  return assertNoFabricatedSources(draft.tags);
}

function flashcardRejection(
  draft: GeneratedFlashcardDraft,
  known: ReadonlySet<ObjectiveId>,
): string | null {
  if (!CARD_TYPES.includes(draft.cardType)) {
    return `Unrecognised card type "${String(draft.cardType)}".`;
  }

  if (draft.content.type !== draft.cardType) {
    return `The card says it is ${draft.cardType} but its content is ${draft.content.type}.`;
  }

  const contentProblem = domainContentProblem(() =>
    assertValidCardContent(draft.content),
  );

  if (contentProblem !== null) {
    return contentProblem;
  }

  const objectiveProblem = objectiveRejection(draft.objectiveIds, known);

  if (objectiveProblem !== null) {
    return objectiveProblem;
  }

  const officialProblem = assertNotClaimedOfficial(cardTexts(draft));

  if (officialProblem !== null) {
    return officialProblem;
  }

  return assertNoFabricatedSources(draft.tags);
}

/**
 * Choice-level rules: unique identifiers and non-duplicate text.
 *
 * The bank's own `assertValidContent` checks identifier uniqueness but not
 * duplicate *text*, because a person writing two identical choices notices. A
 * model does not, and two identical choices make a question unanswerable, so the
 * rule is added here where generated output is checked.
 */
function choiceRejection(content: QuestionContent): string | null {
  const choices = contentChoices(content);

  if (choices.length === 0) {
    return null;
  }

  if (choices.length < MIN_CHOICES) {
    return `A choice question needs at least ${MIN_CHOICES} choices.`;
  }

  if (choices.length > MAX_CHOICES) {
    return `A choice question may have at most ${MAX_CHOICES} choices.`;
  }

  const ids = choices.map((choice) => choice.id);

  if (new Set(ids).size !== ids.length) {
    return "Two choices share the same identifier.";
  }

  if (ids.some((id) => id.trim().length === 0)) {
    return "A choice has no identifier.";
  }

  const texts = choices.map((choice) => normalizeChoiceText(choice.text));

  if (texts.some((text) => text.length === 0)) {
    return "A choice has no text.";
  }

  if (new Set(texts).size !== texts.length) {
    return "Two choices have the same text, so the question has no single answer.";
  }

  return null;
}

/**
 * Answer counts per type.
 *
 * `SPEC.md` section 11.3 states these as their own rules: single choice has
 * exactly one answer, multiple response has at least two. The bank's content
 * assertion requires at least one correct answer for multiple response, which is
 * right for a hand-written question mid-edit but wrong for generated output — a
 * multiple-response question with one answer is a single-choice question the
 * model mislabelled.
 */
function answerCountRejection(content: QuestionContent): string | null {
  switch (content.type) {
    case "SINGLE_CHOICE":
      // Exactly one by construction: the union holds a single identifier, and
      // `assertValidContent` has already checked it names a real choice.
      return null;
    case "MULTIPLE_RESPONSE": {
      const correct = correctChoiceIds(content);

      if (correct.length < 2) {
        return "A multiple-response question needs at least two correct answers.";
      }

      if (correct.length === content.choices.length) {
        return "Every choice is marked correct, so the question tests nothing.";
      }

      return null;
    }
    case "SHORT_ANSWER":
      return null;
  }
}

function objectiveRejection(
  claimed: readonly ObjectiveId[],
  known: ReadonlySet<ObjectiveId>,
): string | null {
  const unknown = claimed.filter((id) => !known.has(id));

  if (unknown.length > 0) {
    return `It refers to objectives that do not exist in this track: ${unknown.join(", ")}.`;
  }

  if (new Set(claimed).size !== claimed.length) {
    return "It maps the same objective twice.";
  }

  return null;
}

/** Refuses text that presents generated content as official exam material. */
function assertNotClaimedOfficial(texts: readonly string[]): string | null {
  for (const text of texts) {
    if (OFFICIAL_CLAIM_PATTERNS.some((pattern) => pattern.test(text))) {
      return "It presents itself as official or real exam material, which generated content is not.";
    }
  }

  return null;
}

/**
 * Refuses a citation-shaped tag on ungrounded output.
 *
 * `spec/AI-GUIDELINES.md` section 1.2: do not fabricate source references for
 * model-knowledge output. A tag reading like a URL or a citation would appear in
 * the bank as evidence that does not exist.
 */
function assertNoFabricatedSources(tags: readonly string[]): string | null {
  for (const tag of tags) {
    if (
      FABRICATED_SOURCE_PATTERNS.some((pattern) => pattern.test(tag.trim()))
    ) {
      return "It cites a source, but this batch was generated from model knowledge with no sources.";
    }
  }

  return null;
}

/** Every text field of a card, for the official-claim check. */
function cardTexts(draft: GeneratedFlashcardDraft): readonly string[] {
  const content = draft.content;
  const notes = draft.notes ?? "";

  switch (content.type) {
    case "BASIC":
    case "REVERSED":
      return [content.front, content.back, notes];
    case "CLOZE":
      return [content.text, notes];
    case "VOCABULARY":
      return [
        content.term,
        content.reading ?? "",
        content.meaning,
        content.exampleSentence ?? "",
        notes,
      ];
    case "SCENARIO":
      return [content.scenario, content.question, content.answer, notes];
  }
}

/**
 * Runs a domain content assertion and returns its message instead of throwing.
 *
 * The bank and flashcard modules express content invariants as thrown domain
 * errors, which suits a form that renders one message next to a field. Generated
 * output is checked in bulk, so the throw is converted into a reason string here
 * rather than either duplicating the rules or letting one bad draft abort the
 * batch.
 */
function domainContentProblem(assertion: () => void): string | null {
  try {
    assertion();

    return null;
  } catch (error) {
    if (isDomainError(error)) {
      return error.message;
    }

    throw error;
  }
}

/** Case- and whitespace-insensitive, so "AWS Lambda" and "aws lambda" clash. */
function normalizeChoiceText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}
