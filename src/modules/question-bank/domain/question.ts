import type { IsoTimestamp } from "@/platform/clock";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import type { ObjectiveId } from "@/modules/certifications/domain/objective";

/**
 * Question aggregate: a root that owns identity, lifecycle, quality, and
 * provenance, plus immutable revisions that own the content
 * (`spec/DOMAIN-RULES.md` section 1.1).
 *
 * Domain code is framework-free: no React, Next.js, database driver, or
 * environment access.
 */

export type QuestionId = string;
export type QuestionRevisionId = string;

/** Question types from `SPEC.md` section 6.3. D3 implements the first three. */
export type QuestionType =
  "SINGLE_CHOICE" | "MULTIPLE_RESPONSE" | "SHORT_ANSWER";

export const QUESTION_TYPES: readonly QuestionType[] = [
  "SINGLE_CHOICE",
  "MULTIPLE_RESPONSE",
  "SHORT_ANSWER",
];

/**
 * Lifecycle status (`SPEC.md` section 6.3.1).
 *
 * Lifecycle, quality, and generation mode are three independent dimensions and
 * must never be collapsed into one field (`spec/DOMAIN-RULES.md` section 1.2).
 *
 * `ARCHIVED` exists in the enum because the specification defines it, but no D3
 * flow produces it: D3 offers retire (reversible) and eligible hard deletion,
 * and archival becomes meaningful once attempts and sessions exist and make a
 * question undeletable (D5).
 */
export type QuestionLifecycleStatus =
  "DRAFT" | "ACTIVE" | "RETIRED" | "ARCHIVED";

export const QUESTION_LIFECYCLE_STATUSES: readonly QuestionLifecycleStatus[] = [
  "DRAFT",
  "ACTIVE",
  "RETIRED",
  "ARCHIVED",
];

/** Quality status (`SPEC.md` section 6.3.1). */
export type QuestionQualityStatus =
  | "UNREVIEWED"
  | "AI_REVIEWED"
  | "SOURCE_CHECKED"
  | "USER_APPROVED"
  | "DISPUTED"
  | "OUTDATED";

export const QUESTION_QUALITY_STATUSES: readonly QuestionQualityStatus[] = [
  "UNREVIEWED",
  "AI_REVIEWED",
  "SOURCE_CHECKED",
  "USER_APPROVED",
  "DISPUTED",
  "OUTDATED",
];

/**
 * Generation mode (`SPEC.md` section 6.3.1).
 *
 * The full enum is modelled because provenance must be recorded from the start,
 * but only `MANUAL` is producible in D3: every other mode is set by a milestone
 * that does not exist yet (generation, import, variants), and offering one would
 * let the owner mislabel provenance.
 */
export type GenerationMode =
  | "MANUAL"
  | "MODEL_KNOWLEDGE"
  | "SOURCE_GROUNDED"
  | "HYBRID"
  | "IMPORTED"
  | "VARIANT"
  | "WEB_RESEARCH";

export const GENERATION_MODES: readonly GenerationMode[] = [
  "MANUAL",
  "MODEL_KNOWLEDGE",
  "SOURCE_GROUNDED",
  "HYBRID",
  "IMPORTED",
  "VARIANT",
  "WEB_RESEARCH",
];

/**
 * Difficulty as a 1-to-5 integer band.
 *
 * An integer scale is chosen over an `EASY`/`MEDIUM`/`HARD` union because D5
 * session composition will need to compare and order difficulty, and because it
 * matches the existing 1-to-5 track priority the owner already reads. It is
 * nullable: the owner is not forced to grade a question while drafting it.
 */
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 5;

/** One answer option of a choice-based question. */
export interface Choice {
  readonly id: string;
  readonly text: string;
}

/**
 * Variant content, discriminated by `type` (`spec/CODING-STANDARDS.md`
 * section 1.3). The discriminator is persisted in its own column as well as
 * inside the JSON payload, so a query can filter by type without parsing JSON.
 *
 * `choiceExplanations` from `SPEC.md` section 6.3 ("a revision *may* contain")
 * is deliberately out of D3: a single explanation per revision already covers
 * manual authoring, and per-choice rationale is most valuable once AI review
 * (D7) produces it. Adding empty per-choice fields now would be placeholder
 * structure.
 */
export type QuestionContent =
  | {
      readonly type: "SINGLE_CHOICE";
      readonly choices: readonly Choice[];
      readonly correctChoiceId: string;
    }
  | {
      readonly type: "MULTIPLE_RESPONSE";
      readonly choices: readonly Choice[];
      readonly correctChoiceIds: readonly string[];
    }
  | {
      readonly type: "SHORT_ANSWER";
      readonly expectedConcepts: readonly string[];
    };

/**
 * Immutable question content.
 *
 * A revision is never updated once written: editing a question appends revision
 * `n + 1` and moves the root's `currentRevisionId`
 * (`spec/DOMAIN-RULES.md` section 1.1). The repository port has no
 * update-revision method at all, so there is no way to mutate one.
 */
export interface QuestionRevision {
  readonly id: QuestionRevisionId;
  readonly questionId: QuestionId;
  /** 1 for the first revision, incrementing by one per edit. */
  readonly revisionNumber: number;
  readonly stem: string;
  readonly instructions: string | null;
  readonly questionType: QuestionType;
  readonly content: QuestionContent;
  readonly explanation: string | null;
  readonly difficulty: number | null;
  readonly tags: readonly string[];
  /** BCP-47-style tag such as `en` or `zh`, when the owner records one. */
  readonly language: string | null;
  readonly createdAt: IsoTimestamp;
}

/**
 * Question root.
 *
 * `currentRevisionId` is typed non-nullable because a question without a
 * revision is not a valid aggregate. The column is nullable in SQLite only so
 * the root row can be inserted before the revision it points at (a circular
 * foreign key); both rows are always written in one transaction, and the
 * repository rejects a root row that still has no revision on read.
 */
export interface Question {
  readonly id: QuestionId;
  readonly certificationId: CertificationId;
  readonly currentRevisionId: QuestionRevisionId;
  readonly lifecycleStatus: QuestionLifecycleStatus;
  readonly qualityStatus: QuestionQualityStatus;
  readonly generationMode: GenerationMode;
  /**
   * The generation run that produced this question, or `null` when the owner
   * wrote it.
   *
   * The run holds the rest of the provenance — model, persona, template, and
   * their versions (`SPEC.md` section 10.3) — so the question stores one
   * reference rather than a copy that could drift from it. Typed as a plain
   * string rather than imported from the ai-generation module: the bank does not
   * depend on the generator, and the generator already depends on the bank.
   */
  readonly generationRunId: string | null;
  /** Why the owner disputed the question; present only while `DISPUTED`. */
  readonly disputeReason: string | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/** A root together with its current revision, as list and detail views need. */
export interface QuestionWithRevision {
  readonly question: Question;
  readonly revision: QuestionRevision;
}

/** A root with its full revision history, newest revision number first. */
export interface QuestionWithHistory {
  readonly question: Question;
  readonly currentRevision: QuestionRevision;
  readonly revisions: readonly QuestionRevision[];
  readonly objectiveIds: readonly ObjectiveId[];
}

export function describeQuestionType(questionType: QuestionType): string {
  switch (questionType) {
    case "SINGLE_CHOICE":
      return "Single choice";
    case "MULTIPLE_RESPONSE":
      return "Multiple response";
    case "SHORT_ANSWER":
      return "Short answer";
  }
}

export function describeLifecycleStatus(
  status: QuestionLifecycleStatus,
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

export function describeQualityStatus(status: QuestionQualityStatus): string {
  switch (status) {
    case "UNREVIEWED":
      return "Unreviewed";
    case "AI_REVIEWED":
      return "AI reviewed";
    case "SOURCE_CHECKED":
      return "Source checked";
    case "USER_APPROVED":
      return "Approved";
    case "DISPUTED":
      return "Disputed";
    case "OUTDATED":
      return "Outdated";
  }
}

export function describeGenerationMode(mode: GenerationMode): string {
  switch (mode) {
    case "MANUAL":
      return "Manual";
    case "MODEL_KNOWLEDGE":
      return "Model knowledge";
    case "SOURCE_GROUNDED":
      return "Source grounded";
    case "HYBRID":
      return "Hybrid";
    case "IMPORTED":
      return "Imported";
    case "VARIANT":
      return "Variant";
    case "WEB_RESEARCH":
      return "Web research";
  }
}

export function describeDifficulty(difficulty: number): string {
  switch (difficulty) {
    case MIN_DIFFICULTY:
      return "1 — easiest";
    case MAX_DIFFICULTY:
      return "5 — hardest";
    default:
      return String(difficulty);
  }
}

/**
 * The choices of a choice-based question, or an empty list for short answer.
 *
 * Exhaustive over `QuestionContent`, so a new question type fails to compile
 * here until it is handled deliberately (`spec/CODING-STANDARDS.md`
 * section 1.4).
 */
export function contentChoices(content: QuestionContent): readonly Choice[] {
  switch (content.type) {
    case "SINGLE_CHOICE":
      return content.choices;
    case "MULTIPLE_RESPONSE":
      return content.choices;
    case "SHORT_ANSWER":
      return [];
  }
}

/** Choice ids the owner marked correct. Empty for short answer. */
export function correctChoiceIds(content: QuestionContent): readonly string[] {
  switch (content.type) {
    case "SINGLE_CHOICE":
      return [content.correctChoiceId];
    case "MULTIPLE_RESPONSE":
      return content.correctChoiceIds;
    case "SHORT_ANSWER":
      return [];
  }
}

/** Single-line summary of the expected answer, for the owner-only panel. */
export function describeExpectedAnswer(content: QuestionContent): string {
  switch (content.type) {
    case "SINGLE_CHOICE": {
      const correct = content.choices.find(
        (choice) => choice.id === content.correctChoiceId,
      );

      return correct === undefined ? "—" : correct.text;
    }
    case "MULTIPLE_RESPONSE": {
      const correct = content.choices.filter((choice) =>
        content.correctChoiceIds.includes(choice.id),
      );

      return correct.map((choice) => choice.text).join("; ");
    }
    case "SHORT_ANSWER":
      return content.expectedConcepts.join("; ");
  }
}

/** Shortened stem for list rows, cut on a word boundary where possible. */
export function stemExcerpt(stem: string, limit = 120): string {
  const collapsed = stem.replace(/\s+/g, " ").trim();

  if (collapsed.length <= limit) {
    return collapsed;
  }

  const cut = collapsed.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");

  return `${(lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
