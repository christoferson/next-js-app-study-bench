import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/shared/ui/breadcrumbs";
import { getProgressFacade } from "@/modules/study-sessions/composition";
import { TrackProgress } from "@/modules/study-sessions/ui/track-progress";

interface TrackProgressPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

/**
 * One track's progress in detail (`SPEC.md` section 6.8).
 *
 * Split out of `/progress`, which now carries one compact card per track: everything
 * that needs a scroll — domains, calibration, mistakes, session history — belongs to a
 * single track and is read one track at a time.
 *
 * A track addressed here is reported whether or not it is archived, so a track put
 * aside can still be reviewed; only an unknown slug is a 404.
 */
export default async function TrackProgressPage({
  params,
}: TrackProgressPageProps) {
  const { slug } = await params;
  const view = await getProgressFacade().findTrackProgressBySlug(slug);

  if (view === null) {
    notFound();
  }

  return (
    <main className="page">
      <Breadcrumbs
        current={view.track.name}
        trail={[{ label: "Progress", href: "/progress" }]}
      />

      <header className="page-header">
        <p className="eyebrow">Progress</p>
        <div className="card-heading">
          <h1>{view.track.name}</h1>
          {view.track.status === "ARCHIVED" ? (
            <span className="badge">Archived</span>
          ) : null}
        </div>
        <p className="lede">
          Counted from your recorded answers and card reviews for this track.
        </p>
      </header>

      <TrackProgress view={view} />
    </main>
  );
}
