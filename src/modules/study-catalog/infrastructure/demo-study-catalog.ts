import type {
  StudyTrackDetail,
  StudyTrackSlug,
  StudyTrackSummary,
} from "@/modules/study-catalog/domain/study-track";
import type { StudyCatalog } from "@/modules/study-catalog/ports/study-catalog";
import { DEMO_STUDY_TRACKS } from "@/modules/study-catalog/infrastructure/demo-study-tracks";

/**
 * In-memory read-only catalog backed by fixed demo content.
 *
 * Ordering is the declaration order of the demo data, so repeated calls return
 * identical results. There is no persistence, clock, or network access.
 */
export class DemoStudyCatalog implements StudyCatalog {
  private readonly tracks: readonly StudyTrackDetail[];

  constructor(tracks: readonly StudyTrackDetail[] = DEMO_STUDY_TRACKS) {
    this.tracks = tracks;
  }

  async listTracks(): Promise<StudyTrackSummary[]> {
    return this.tracks.map((track) => toSummary(track));
  }

  async findTrackBySlug(
    slug: StudyTrackSlug,
  ): Promise<StudyTrackDetail | null> {
    return this.tracks.find((track) => track.slug === slug) ?? null;
  }
}

function toSummary(track: StudyTrackDetail): StudyTrackSummary {
  return {
    id: track.id,
    slug: track.slug,
    name: track.name,
    provider: track.provider,
    studyType: track.studyType,
    origin: track.origin,
    shortDescription: track.shortDescription,
  };
}
