import Link from "next/link";
import { notFound } from "next/navigation";
import { getStudyFacade } from "@/modules/study-sessions/composition";
import { SessionSummary } from "@/modules/study-sessions/ui/session-summary";

interface SessionSummaryPageProps {
  readonly params: Promise<{ readonly sessionId: string }>;
}

/**
 * What one session amounted to.
 *
 * Its own route rather than a state of the study screen, so the summary has a URL the
 * owner can return to and a session that has ended keeps a page that reads as history
 * rather than as a study screen with nothing left to do.
 */
export default async function SessionSummaryPage({
  params,
}: SessionSummaryPageProps) {
  const { sessionId } = await params;
  const view = await getStudyFacade().findSummary(sessionId);

  if (view === null) {
    notFound();
  }

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href="/">Back to the study tracks</Link>
      </nav>

      <header className="page-header">
        <p className="eyebrow">Session</p>
        <h1>
          {view.session.status === "IN_PROGRESS"
            ? "This session is still running"
            : "How that session went"}
        </h1>
      </header>

      {view.session.status === "IN_PROGRESS" ? (
        <section className="section">
          <p className="section-note">
            These are the figures so far. Nothing is final until you finish it.
          </p>
          <div className="section-actions">
            <Link className="button" href={`/study/sessions/${sessionId}`}>
              Carry on studying
            </Link>
          </div>
        </section>
      ) : null}

      <SessionSummary view={view} />
    </main>
  );
}
