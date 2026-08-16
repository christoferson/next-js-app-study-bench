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
import type { VocabularyExample } from "@/modules/flashcards/domain/flashcard";
import { assertValidContent as assertValidCardContent } from "@/modules/flashcards/domain/flashcard-content";
import type { VocabularyContent } from "@/modules/flashcards/domain/flashcard-content";
import { isDomainError } from "@/shared/domain-error";
import type {
  CheckedBatch,
  GeneratedFlashcardDraft,
  GeneratedQuestionDraft,
  MatchedEnrichment,
  RejectedDraft,
  VocabularyEnrichmentDraft,
  VocabularyEnrichmentTarget,
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
  /**
   * The grounding the batch was given, when it was given any.
   *
   * Omitted for a model-knowledge batch, which is not the same as present-and-empty: a
   * grounded batch with no excerpts is a request that should never have been made, and the
   * facade refuses it before a model is called. Here, absence means "no excerpt claim is
   * meaningful", so a claimed index is treated as a fabricated citation.
   */
  readonly grounding?: GroundingCheckContext;
}

/**
 * What a grounded or hybrid batch may cite, and how strictly.
 *
 * `mode` rather than a boolean, because the two grounded modes differ in exactly one rule
 * and it is the rule that defines them: a `SOURCE_GROUNDED` question must name at least one
 * supporting excerpt, and a `HYBRID` question need not. Everything else — indexes must be
 * in range — is shared.
 */
export interface GroundingCheckContext {
  readonly mode: "SOURCE_GROUNDED" | "HYBRID";
  /** How many excerpts were sent, so `1..excerptCount` are the citable indexes. */
  readonly excerptCount: number;
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
    const reason = questionRejection(draft, known, context.grounding);

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
  grounding: GroundingCheckContext | undefined,
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

  const groundingProblem = groundingRejection(
    draft.supportingChunkIndexes,
    grounding,
  );

  if (groundingProblem !== null) {
    return groundingProblem;
  }

  return assertNoFabricatedSources(draft.tags);
}

/**
 * Whether this question's excerpt citations are usable.
 *
 * The `SPEC.md` section 11.3 rule "source IDs exist when provided", now that there is a
 * mode in which they are provided. Three refusals, and each is a different mistake:
 *
 * - **A citation with no grounding.** A model-knowledge batch was shown no excerpts, so an
 *   index cannot refer to anything; a draft that claims one has fabricated a citation,
 *   which is the failure `assertNoFabricatedSources` exists to prevent in the tags.
 * - **An index out of range.** The model was shown four excerpts and named the seventh.
 *   The claim is discarded with the draft rather than narrowed, because a question whose
 *   stated evidence does not exist is a question whose evidence is unknown — and an
 *   evidence panel built by dropping the bad index would show the owner support the model
 *   never actually claimed.
 * - **A grounded question supported by nothing.** This is the mode's whole promise. A
 *   `SOURCE_GROUNDED` question that names no excerpt was written from the model's own
 *   knowledge with a source library in the room, which is a hybrid question mislabelled —
 *   and the label is what the owner would trust. `HYBRID` is exempt by design: naming no
 *   excerpt there is the honest answer for a question whose framing is the model's own.
 */
function groundingRejection(
  claimed: readonly number[],
  grounding: GroundingCheckContext | undefined,
): string | null {
  if (grounding === undefined) {
    return claimed.length === 0
      ? null
      : "The question cites source excerpts, but this request sent none.";
  }

  for (const index of claimed) {
    if (
      !Number.isInteger(index) ||
      index < 1 ||
      index > grounding.excerptCount
    ) {
      return `The question cites excerpt ${String(index)}, which was not one of the ${grounding.excerptCount} sent.`;
    }
  }

  if (grounding.mode === "SOURCE_GROUNDED" && claimed.length === 0) {
    return "The question names no supporting excerpt, so it is not grounded in the chosen sources.";
  }

  return null;
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
 * Matches enrichment answers to the cards they were asked about.
 *
 * The model is given no identifiers, so the join key is the term it echoes back.
 * That makes drift a per-card failure instead of a corruption: an answer whose term
 * matches no target is rejected, and a target no answer matched is reported as a
 * card the run left alone rather than silently skipped.
 *
 * Matching is exact on the trimmed term. Not case-insensitive and not
 * whitespace-normalised: for the language this exists for, a differing character *is*
 * a different word, and a lenient match would be a way for a wrong answer to land on
 * a real card. Two targets that share a term are a duplicate the bank should not
 * hold, so the first unmatched one wins and the second is reported unmatched.
 */
export function matchEnrichments(
  targets: readonly VocabularyEnrichmentTarget[],
  drafts: readonly VocabularyEnrichmentDraft[],
): EnrichmentMatchResult {
  const matched: MatchedEnrichment[] = [];
  const rejected: RejectedDraft[] = [];
  const claimed = new Set<string>();

  for (const [index, draft] of drafts.entries()) {
    const position = index + 1;
    const term = draft.term.trim();
    const target = targets.find(
      (candidate) =>
        candidate.content.term.trim() === term &&
        !claimed.has(candidate.flashcardId),
    );

    if (target === undefined) {
      rejected.push({
        position,
        reason: `The answer names "${term}", which is not one of the words this run asked about.`,
      });

      continue;
    }

    const reason = enrichmentRejection(target, draft);

    if (reason === null) {
      claimed.add(target.flashcardId);
      matched.push({ target, draft });
    } else {
      rejected.push({ position, reason });
    }
  }

  return {
    matched,
    rejected,
    unmatched: targets.filter((target) => !claimed.has(target.flashcardId)),
  };
}

/** What one enrichment batch produced: what to write, what to refuse, what was missed. */
export interface EnrichmentMatchResult {
  readonly matched: readonly MatchedEnrichment[];
  readonly rejected: readonly RejectedDraft[];
  /** Cards no accepted answer covered. Left exactly as they were. */
  readonly unmatched: readonly VocabularyEnrichmentTarget[];
}

/**
 * The first reason this enrichment may not be written, or `null` if it may.
 *
 * The merged content is checked with the flashcard domain's own assertion rather
 * than with rules restated here, so an enriched card clears exactly the bar a
 * hand-edited one does — including the list bounds and the no-blank-entry rules.
 */
function enrichmentRejection(
  target: VocabularyEnrichmentTarget,
  draft: VocabularyEnrichmentDraft,
): string | null {
  if (draft.meanings.length === 0) {
    return "It lists no meanings, so there is nothing to add to the card.";
  }

  if (draft.examples.length < MIN_ENRICHED_EXAMPLES) {
    return `It gives fewer than ${MIN_ENRICHED_EXAMPLES} example sentences.`;
  }

  // An example that does not contain the word teaches the word nothing. Checked
  // here rather than in the schema because it is a question about this word, not
  // about the shape of the answer.
  const term = target.content.term.trim();

  if (!draft.examples.some((example) => example.text.includes(term))) {
    return "No example sentence uses the word it is meant to illustrate.";
  }

  const merged = mergeEnrichment(target.content, draft);

  const contentProblem = domainContentProblem(() =>
    assertValidCardContent(merged),
  );

  if (contentProblem !== null) {
    return contentProblem;
  }

  const officialProblem = assertNotClaimedOfficial(
    cardTexts({
      cardType: "VOCABULARY",
      content: merged,
      notes: null,
      tags: [],
      language: null,
      objectiveIds: [],
    }),
  );

  if (officialProblem !== null) {
    return officialProblem;
  }

  return null;
}

/** The fewest example sentences an accepted enrichment must carry. */
export const MIN_ENRICHED_EXAMPLES = 2;

/**
 * The card's content with the enrichment added.
 *
 * Additive, never destructive: `term`, `reading`, `meaning`, and `exampleSentence`
 * are carried through untouched, because they are what the owner or the importer
 * put there and enrichment is not an editor. The model's senses go into `meanings`
 * beside the existing gloss, and its sentences into `examples` beside the existing
 * one — `vocabularySenses` and `vocabularyExamples` are what read the two together,
 * and they already drop a repeat, so a model that echoes the original back does not
 * double it.
 *
 * Lists the model left empty are omitted rather than stored empty, because the
 * domain refuses an empty list: "this word has no antonym" is expressed by the field
 * being absent, which is also what an unenriched card looks like for that field.
 */
export function mergeEnrichment(
  content: VocabularyContent,
  draft: VocabularyEnrichmentDraft,
): VocabularyContent {
  return {
    type: "VOCABULARY",
    term: content.term,
    reading: content.reading,
    meaning: content.meaning,
    exampleSentence: content.exampleSentence,
    ...optionalList("meanings", mergedList(content.meanings, draft.meanings)),
    ...optionalList("synonyms", mergedList(content.synonyms, draft.synonyms)),
    ...optionalList("antonyms", mergedList(content.antonyms, draft.antonyms)),
    ...optionalList("examples", mergedExamples(content, draft)),
    ...(draft.usageNotes === null
      ? content.usageNotes === undefined
        ? {}
        : { usageNotes: content.usageNotes }
      : { usageNotes: draft.usageNotes }),
  };
}

/**
 * A field that exists only when it has entries.
 *
 * Written as a spread helper because `exactOptionalPropertyTypes` makes
 * `field: undefined` a different thing from an absent field, and the domain's list
 * rules reject a present-but-empty list.
 */
function optionalList<Field extends string, Entry>(
  field: Field,
  entries: readonly Entry[],
): { readonly [K in Field]?: readonly Entry[] } {
  return entries.length === 0
    ? ({} as { readonly [K in Field]?: readonly Entry[] })
    : ({ [field]: entries } as { readonly [K in Field]?: readonly Entry[] });
}

/** Existing entries first, then new ones the card does not already have. */
function mergedList(
  existing: readonly string[] | undefined,
  added: readonly string[],
): readonly string[] {
  const seen = new Set(
    (existing ?? []).map((entry) => entry.trim().toLowerCase()),
  );
  const kept: string[] = [...(existing ?? [])];

  for (const entry of added) {
    const key = entry.trim().toLowerCase();

    if (key.length === 0 || seen.has(key)) {
      continue;
    }

    seen.add(key);
    kept.push(entry);
  }

  return kept;
}

/**
 * Existing examples first, then the model's, without repeating a sentence.
 *
 * The card's own `exampleSentence` counts as already present, so an enrichment that
 * quotes it back adds nothing rather than storing the same sentence twice under two
 * fields.
 */
function mergedExamples(
  content: VocabularyContent,
  draft: VocabularyEnrichmentDraft,
): readonly VocabularyExample[] {
  const seen = new Set(
    [
      content.exampleSentence ?? "",
      ...(content.examples ?? []).map((example) => example.text),
    ]
      .map((text) => text.trim().toLowerCase())
      .filter((text) => text.length > 0),
  );
  const kept: VocabularyExample[] = [...(content.examples ?? [])];

  for (const example of draft.examples) {
    const key = example.text.trim().toLowerCase();

    if (key.length === 0 || seen.has(key)) {
      continue;
    }

    seen.add(key);
    kept.push({
      text: example.text,
      // `null` from the model means "not provided", and the domain expresses that
      // as an absent field rather than a null one.
      ...(example.reading === null ? {} : { reading: example.reading }),
      ...(example.translation === null
        ? {}
        : { translation: example.translation }),
    });
  }

  return kept;
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
      // Every optional field is included too: an enrichment run writes most of
      // its text into them, so a claim of officialness would slip through a
      // check that only read the four original fields.
      return [
        content.term,
        content.reading ?? "",
        content.meaning,
        content.exampleSentence ?? "",
        ...(content.meanings ?? []),
        ...(content.synonyms ?? []),
        ...(content.antonyms ?? []),
        ...(content.examples ?? []).flatMap((example) => [
          example.text,
          example.reading ?? "",
          example.translation ?? "",
        ]),
        content.usageNotes ?? "",
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
