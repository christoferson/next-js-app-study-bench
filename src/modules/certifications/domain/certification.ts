import type { IsoTimestamp } from "@/platform/clock";

/**
 * Certification (study track) domain model.
 *
 * Domain code is framework-free: no React, Next.js, database driver, or
 * environment access.
 *
 * `personaId` from `SPEC.md` section 6.1 is deliberately absent. Personas are
 * introduced in D6; adding a column or field for them now would be placeholder
 * structure for an unauthorized milestone.
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
