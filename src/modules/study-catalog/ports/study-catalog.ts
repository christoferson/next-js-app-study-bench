import type {
  StudyTrackDetail,
  StudyTrackSlug,
  StudyTrackSummary,
} from "@/modules/study-catalog/domain/study-track";

/**
 * Read access to the study catalog.
 *
 * The port is intentionally narrow: D1 requires exactly list and detail
 * retrieval. Creation, updating, searching, and transaction methods belong to
 * the milestones that introduce them.
 */
export interface StudyCatalog {
  listTracks(): Promise<StudyTrackSummary[]>;
  findTrackBySlug(slug: StudyTrackSlug): Promise<StudyTrackDetail | null>;
}
