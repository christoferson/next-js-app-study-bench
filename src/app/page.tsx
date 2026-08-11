import { getStudyCatalog } from "@/modules/study-catalog/composition";
import { StudyTrackCard } from "@/modules/study-catalog/ui/study-track-card";

export default async function HomePage() {
  const tracks = await getStudyCatalog().listTracks();

  return (
    <main className="page">
      <header className="page-header">
        <p className="eyebrow">StudyBench</p>
        <h1>Build your study bank. Learn anywhere.</h1>
        <p className="lede">
          A personal, single-user workbench for building and reviewing your own
          study material for technical certifications and language examinations.
        </p>
      </header>

      <section aria-labelledby="study-tracks-heading" className="section">
        <div className="section-heading">
          <h2 id="study-tracks-heading">Study tracks</h2>
          <p className="section-note">
            The tracks below are demo content included with this early build.
            Nothing here is saved yet, and no progress has been recorded.
          </p>
        </div>
        <ul className="card-list">
          {tracks.map((track) => (
            <StudyTrackCard key={track.id} track={track} />
          ))}
        </ul>
      </section>
    </main>
  );
}
