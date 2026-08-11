import Link from "next/link";
import type { StudyTrackSummary } from "@/modules/study-catalog/domain/study-track";
import { describeStudyType } from "@/modules/study-catalog/domain/study-track";
import { DemoBadge } from "@/modules/study-catalog/ui/demo-badge";

interface StudyTrackCardProps {
  readonly track: StudyTrackSummary;
}

/** Dashboard list entry for one study track. */
export function StudyTrackCard({ track }: StudyTrackCardProps) {
  return (
    <li className="card">
      <div className="card-heading">
        <h3 className="card-title">
          <Link href={`/study-tracks/${track.slug}`}>{track.name}</Link>
        </h3>
        <DemoBadge origin={track.origin} />
      </div>
      <dl className="meta">
        <div className="meta-item">
          <dt>Provider</dt>
          <dd>{track.provider}</dd>
        </div>
        <div className="meta-item">
          <dt>Study type</dt>
          <dd>{describeStudyType(track.studyType)}</dd>
        </div>
      </dl>
      <p className="card-text">{track.shortDescription}</p>
    </li>
  );
}
