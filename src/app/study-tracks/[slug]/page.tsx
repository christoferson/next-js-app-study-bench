import Link from "next/link";
import { notFound } from "next/navigation";
import { getStudyCatalog } from "@/modules/study-catalog/composition";
import { describeStudyType } from "@/modules/study-catalog/domain/study-track";
import { DemoBadge } from "@/modules/study-catalog/ui/demo-badge";
import { StudyObjectiveList } from "@/modules/study-catalog/ui/study-objective-list";

interface StudyTrackPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

export default async function StudyTrackPage({ params }: StudyTrackPageProps) {
  const { slug } = await params;
  const track = await getStudyCatalog().findTrackBySlug(slug);

  if (track === null) {
    notFound();
  }

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href="/">Back to study tracks</Link>
      </nav>

      <header className="page-header">
        <div className="card-heading">
          <h1>{track.name}</h1>
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
        <p className="lede">{track.shortDescription}</p>
      </header>

      <section aria-labelledby="objectives-heading" className="section">
        <div className="section-heading">
          <h2 id="objectives-heading">Objectives</h2>
          <p className="section-note">
            Read-only demo objectives. They outline study focus only and are not
            official examination content.
          </p>
        </div>
        <StudyObjectiveList objectives={track.objectives} />
      </section>
    </main>
  );
}
