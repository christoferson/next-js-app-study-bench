import type { IsoTimestamp } from "@/platform/clock";

/**
 * Certification (study track) domain model.
 *
 * Domain code is framework-free: no React, Next.js, database driver, or
 * environment access.
 */

export type CertificationId = string;
export type CertificationSlug = string;

/** Study types from `SPEC.md` section 6.1. */
export type StudyType =
  "TECHNICAL_CERTIFICATION" | "LANGUAGE_PROFICIENCY" | "GENERAL";

export const STUDY_TYPES: readonly StudyType[] = [
  "TECHNICAL_CERTIFICATION",
  "LANGUAGE_PROFICIENCY",
  "GENERAL",
];

/** Archival is reversible; D2 has no hard deletion. */
export type LifecycleStatus = "ACTIVE" | "ARCHIVED";

/**
 * Whether the record was authored by the owner or inserted by `npm run seed`.
 *
 * Demo content must stay visibly labelled so the owner never mistakes it for
 * their own study material.
 */
export type ContentOrigin = "OWNER" | "DEMO";

/** 1 is the highest study priority, 5 the lowest. */
export const MIN_PRIORITY = 1;
export const MAX_PRIORITY = 5;
export const DEFAULT_PRIORITY = 3;

export const MIN_SESSION_MINUTES = 5;
export const MAX_SESSION_MINUTES = 240;
export const DEFAULT_SESSION_MINUTES = 20;

export interface Certification {
  readonly id: CertificationId;
  readonly slug: CertificationSlug;
  readonly name: string;
  readonly provider: string;
  readonly examCode: string | null;
  readonly version: string | null;
  readonly studyType: StudyType;
  readonly description: string;
  /** Calendar date as `YYYY-MM-DD`; no time component is meaningful. */
  readonly targetDate: string | null;
  readonly priority: number;
  readonly defaultSessionMinutes: number;
  readonly status: LifecycleStatus;
  readonly origin: ContentOrigin;
  /**
   * The persona generation applies to this track (`SPEC.md` section 6.1).
   *
   * An opaque identifier, deliberately. This module stores it and hands it back; it
   * never resolves it, because a persona belongs to the ai-generation module and the
   * dependency runs the other way — certifications must not learn that generation
   * exists (`spec/ARCHITECTURE.md` section 7, pinned by a boundary test). Validating
   * that the identifier names a real persona of a compatible archetype therefore
   * happens at the edge that does know personas: `PersonaFacade.resolveAssignment`,
   * called by the track actions in `src/app/study-tracks/track-actions.ts` before this
   * module's facade is reached.
   *
   * `null` means "decide from the study type", which is what the built-in persona
   * registry has always done and remains the default for every track.
   */
  readonly personaId: string | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/** Owner-facing label for a study type. */
export function describeStudyType(studyType: StudyType): string {
  switch (studyType) {
    case "TECHNICAL_CERTIFICATION":
      return "Technical certification";
    case "LANGUAGE_PROFICIENCY":
      return "Language proficiency";
    case "GENERAL":
      return "General";
  }
}

/**
 * How study material for a track is built.
 *
 * A language track is built from words: the bank starts as a word list, and the work
 * is deepening those cards and drilling the patterns of the syllabus. A technical
 * certification is built from questions: there is no word list to deepen, and the work
 * is writing applied items. The two want different first actions on a track page.
 *
 * Derived from the study type through an exhaustive switch, for the same reason the
 * persona registry is (`spec/AI-GUIDELINES.md` section 2.1): behaviour must never be
 * chosen by looking at a track's provider, name, or slug for "HSK". A new study type
 * has to decide here rather than falling into a default.
 */
export type StudyMaterialStyle = "VOCABULARY_FIRST" | "QUESTION_FIRST";

export function studyMaterialStyleFor(
  studyType: StudyType,
): StudyMaterialStyle {
  switch (studyType) {
    case "LANGUAGE_PROFICIENCY":
      return "VOCABULARY_FIRST";
    case "TECHNICAL_CERTIFICATION":
      return "QUESTION_FIRST";
    case "GENERAL":
      return "QUESTION_FIRST";
  }
}

/** Owner-facing label for a lifecycle status. */
export function describeLifecycleStatus(status: LifecycleStatus): string {
  switch (status) {
    case "ACTIVE":
      return "Active";
    case "ARCHIVED":
      return "Archived";
  }
}

/** Owner-facing label for a priority value. */
export function describePriority(priority: number): string {
  switch (priority) {
    case 1:
      return "1 — highest";
    case 5:
      return "5 — lowest";
    default:
      return String(priority);
  }
}

/**
 * Derives a kebab-case slug from a track name.
 *
 * Non-alphanumeric characters become separators, so non-Latin names (for
 * example Chinese characters) can reduce to an empty string. Callers must
 * handle that case; `SLUG_FALLBACK` is the neutral stem used then.
 */
export const SLUG_FALLBACK = "study-track";

export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");

  return slug.length > 0 ? slug : SLUG_FALLBACK;
}

/**
 * Appends a numeric discriminator to a slug stem.
 *
 * Used to resolve collisions deterministically: `aws-track`, `aws-track-2`, ...
 */
export function slugWithSuffix(stem: string, attempt: number): string {
  return attempt <= 1 ? stem : `${stem}-${attempt}`;
}

/**
 * Slugs that would collide with a static route segment under `/study-tracks`.
 *
 * A track named "New" must not claim the address of the create form.
 */
export const RESERVED_SLUGS: readonly string[] = ["new"];

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.includes(slug);
}
