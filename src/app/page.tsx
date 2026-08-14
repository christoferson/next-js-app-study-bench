import Link from "next/link";
import { getCertificationFacade } from "@/modules/certifications/composition";
import {
  ArchivedCertificationCard,
  CertificationCard,
} from "@/modules/certifications/ui/certification-card";
import { getStudyFacade } from "@/modules/study-sessions/composition";
import { DEFAULT_QUICK_MINUTES } from "@/modules/study-sessions/application/study-facade";

interface HomePageProps {
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
}

/**
 * Study-track dashboard.
 *
 * Archived tracks are hidden by default and revealed through `?archived=1`, so
 * the visible list is the owner's active study plan.
 *
 * Studying is the primary action, above the track list: the product is a study
 * workbench, and the common case on opening it is wanting to study rather than wanting
 * to manage the bank (`spec/UI-GUIDELINES.md` section 1.2). A session still in progress
 * is offered as "resume" instead, so the owner is never asked to choose a mode for a
 * session they have already started.
 */
export default async function HomePage({ searchParams }: HomePageProps) {
  const resolved = (await searchParams) ?? {};
  const includeArchived = resolved.archived === "1";
  const [view, inProgressId] = await Promise.all([
    getCertificationFacade().listCertifications({ includeArchived }),
    getStudyFacade().findInProgressId(),
  ]);

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

      <section aria-labelledby="study-now-heading" className="section">
        <div className="section-heading">
          <h2 id="study-now-heading">Study</h2>
        </div>
        <div className="section-actions">
          {inProgressId === null ? (
            <Link className="button" href="/study/new">
              Start {DEFAULT_QUICK_MINUTES}-minute session
            </Link>
          ) : (
            <>
              <Link className="button" href={`/study/sessions/${inProgressId}`}>
                Resume your session
              </Link>
              <Link className="button-quiet" href="/study/new">
                Start a different session
              </Link>
            </>
          )}
          <Link className="button-quiet" href="/progress">
            Progress
          </Link>
          {/* Audio is generated from a card and listened to there; this is the one
              place that lists what is stored, so it needs a way in. */}
          <Link className="button-quiet" href="/settings/audio">
            Audio
          </Link>
        </div>
      </section>

      <section aria-labelledby="study-tracks-heading" className="section">
        <div className="section-heading">
          <h2 id="study-tracks-heading">Study tracks</h2>
          <div className="section-actions">
            <Link className="button" href="/study-tracks/new">
              New study track
            </Link>
            {view.archivedCount > 0 ? (
              <Link
                className="button-quiet"
                href={includeArchived ? "/" : "/?archived=1"}
              >
                {includeArchived
                  ? "Hide archived tracks"
                  : `Show archived tracks (${view.archivedCount})`}
              </Link>
            ) : null}
          </div>
        </div>

        {view.active.length === 0 ? (
          <p className="empty-state">
            No study tracks yet. Create your first track to start building a
            question bank, or run <code>npm run seed</code> to load the demo
            tracks.
          </p>
        ) : (
          <ul className="card-list">
            {view.active.map((certification) => (
              <CertificationCard
                key={certification.id}
                certification={certification}
              />
            ))}
          </ul>
        )}
      </section>

      {includeArchived ? (
        <section aria-labelledby="archived-tracks-heading" className="section">
          <div className="section-heading">
            <h2 id="archived-tracks-heading">Archived tracks</h2>
            <p className="section-note">
              Archived tracks stay out of the active list until you restore
              them. Nothing is deleted.
            </p>
          </div>
          {view.archived.length === 0 ? (
            <p className="empty-state">No archived tracks.</p>
          ) : (
            <ul className="card-list">
              {view.archived.map((certification) => (
                <ArchivedCertificationCard
                  key={certification.id}
                  certification={certification}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </main>
  );
}
