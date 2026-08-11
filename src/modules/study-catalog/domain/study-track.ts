/**
 * Study-catalog domain types.
 *
 * Domain code is framework-free: it must not import React, Next.js, AWS SDKs,
 * database drivers, or read environment variables.
 */

/** Stable identifier for a study track. */
export type StudyTrackId = string;

/** URL-safe identifier used in study-track routes. */
export type StudyTrackSlug = string;

/** Stable identifier for a study objective. */
export type ObjectiveId = string;

/**
 * The kind of learning goal a track represents. Closed union so that adding a
 * new study type forces deliberate handling at every presentation site.
 */
export type StudyType = "CERTIFICATION" | "LANGUAGE_EXAMINATION";

/**
 * Origin of the content behind a track.
 *
 * D1 ships only deterministic demo content, so `DEMO` is currently the single
 * member. It exists because the UI must label demo content explicitly rather
 * than implying that the catalog is owner-authored.
 */
export type StudyContentOrigin = "DEMO";

/** A track as shown in a list, such as the dashboard. */
export interface StudyTrackSummary {
  readonly id: StudyTrackId;
  readonly slug: StudyTrackSlug;
  readonly name: string;
  /** Certifying body or examination family, for example "AWS" or "HSK". */
  readonly provider: string;
  readonly studyType: StudyType;
  readonly origin: StudyContentOrigin;
  readonly shortDescription: string;
}

/** A single objective shown read-only on a track detail view. */
export interface StudyObjectiveSummary {
  readonly id: ObjectiveId;
  /** Owner-facing reference such as "Domain 1" or "Unit 2". */
  readonly reference: string;
  readonly title: string;
  readonly focus: string;
}

/** A track as shown on its own detail view. */
export interface StudyTrackDetail extends StudyTrackSummary {
  readonly objectives: readonly StudyObjectiveSummary[];
}

/** Owner-facing label for a study type. */
export function describeStudyType(studyType: StudyType): string {
  switch (studyType) {
    case "CERTIFICATION":
      return "Certification";
    case "LANGUAGE_EXAMINATION":
      return "Language examination";
  }
}

/** Owner-facing label for a content origin. */
export function describeContentOrigin(origin: StudyContentOrigin): string {
  switch (origin) {
    case "DEMO":
      return "Demo";
  }
}
