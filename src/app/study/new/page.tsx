import Link from "next/link";
import { Breadcrumbs, TRACKS_CRUMB } from "@/shared/ui/breadcrumbs";
import { getStudyFacade } from "@/modules/study-sessions/composition";
import { startSessionAction } from "@/modules/study-sessions/ui/actions";
import { StartSessionForm } from "@/modules/study-sessions/ui/start-session-form";

interface NewSessionPageProps {
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
}

/**
 * Choosing what to study.
 *
 * `?track=slug` preselects one track, which is how the "Start session" link on a
 * track page carries its context without a second decision from the owner.
 *
 * The form is built from counts, not from a trial composition: the page never creates
 * a session to find out whether it could. That is also why nothing here calls a model
 * — starting a session is a bounded set of queries and a deterministic selection
 * (`spec/ARCHITECTURE.md` section 8).
 */
export default async function NewSessionPage({
  searchParams,
}: NewSessionPageProps) {
  const resolved = (await searchParams) ?? {};
  const requested = resolved.track;
  const slug = typeof requested === "string" ? requested : null;
  const view = await getStudyFacade().findStartForm(slug);

  return (
    <main className="page">
      <Breadcrumbs trail={[TRACKS_CRUMB]} current="Start a session" />

      <header className="page-header">
        <p className="eyebrow">Study</p>
        <h1>Start a session</h1>
        <p className="lede">
          {view.activeQuestionCount} question
          {view.activeQuestionCount === 1 ? "" : "s"} ready and{" "}
          {view.dueCardCount} card{view.dueCardCount === 1 ? "" : "s"} due.
        </p>
      </header>

      {view.inProgressId === null ? null : (
        <section aria-labelledby="resume-heading" className="section">
          <div className="section-heading">
            <h2 id="resume-heading">You have a session in progress</h2>
          </div>
          <p className="section-note">
            Starting a new one ends it. Everything you already answered in it is
            kept.
          </p>
          <div className="section-actions">
            <Link
              className="button"
              href={`/study/sessions/${view.inProgressId}`}
            >
              Resume that session
            </Link>
          </div>
        </section>
      )}

      <section aria-labelledby="start-heading" className="section">
        <div className="section-heading">
          <h2 id="start-heading">What are you studying?</h2>
        </div>
        <StartSessionForm action={startSessionAction} view={view} />
      </section>
    </main>
  );
}
