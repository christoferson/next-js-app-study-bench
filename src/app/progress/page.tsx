import Link from "next/link";
import { getProgressFacade } from "@/modules/study-sessions/composition";
import { ProgressDashboard } from "@/modules/study-sessions/ui/progress-dashboard";

/**
 * Rendered per request, never prerendered.
 *
 * The page takes no route or search parameters, so Next.js would otherwise treat it
 * as static and read the database at build time — serving every visitor the build
 * machine's empty dashboard until a Server Action happened to revalidate it. Every
 * other database-backed page is dynamic already by virtue of its parameters; this one
 * has to say so.
 */
export const dynamic = "force-dynamic";

/**
 * The progress dashboard (`SPEC.md` section 6.8).
 *
 * Nothing here is cached and nothing is estimated. Every figure is an aggregate over
 * recorded attempts, so the page can disagree with the owner's impression but not with
 * the bank.
 */
export default async function ProgressPage() {
  const view = await getProgressFacade().findProgress();

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href="/">Back to the study tracks</Link>
      </nav>

      <header className="page-header">
        <p className="eyebrow">Progress</p>
        <h1>What you have actually done</h1>
        <p className="lede">
          Counted from your recorded answers. StudyBench does not predict
          whether you will pass an exam, so nothing here pretends to.
        </p>
      </header>

      <div className="section-actions">
        <Link className="button" href="/study/new">
          Start a session
        </Link>
      </div>

      <ProgressDashboard view={view} />
    </main>
  );
}
