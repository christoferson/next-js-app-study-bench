import Link from "next/link";
import { notFound } from "next/navigation";
import { getCertificationFacade } from "@/modules/certifications/composition";
import {
  archiveCertificationAction,
  restoreCertificationAction,
} from "@/modules/certifications/ui/actions";
import { CertificationMeta } from "@/modules/certifications/ui/certification-meta";
import { ObjectiveTree } from "@/modules/certifications/ui/objective-tree";
import { OriginBadge } from "@/modules/certifications/ui/origin-badge";
import { getQuestionBankFacade } from "@/modules/question-bank/composition";
import { getFlashcardFacade } from "@/modules/flashcards/composition";

interface StudyTrackPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

export default async function StudyTrackPage({ params }: StudyTrackPageProps) {
  const { slug } = await params;
  const view = await getCertificationFacade().findDetailBySlug(slug);

  if (view === null) {
    notFound();
  }

  const { certification } = view;
  const isArchived = certification.status === "ARCHIVED";
  // Counts, not the whole bank: the track page summarises each bank and links to
  // it (`spec/ARCHITECTURE.md` section 8).
  const [bank, cards] = await Promise.all([
    getQuestionBankFacade().countBank(certification.id),
    getFlashcardFacade().countBank(certification.id),
  ]);

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href="/">Back to study tracks</Link>
      </nav>

      <header className="page-header">
        <div className="card-heading">
          <h1>{certification.name}</h1>
          {isArchived ? <span className="badge">Archived</span> : null}
          <OriginBadge origin={certification.origin} />
        </div>
        <CertificationMeta certification={certification} detailed />
        {certification.description.length > 0 ? (
          <p className="lede">{certification.description}</p>
        ) : null}
        <div className="section-actions">
          {isArchived ? null : (
            // Preselects this track, so studying one track is one tap from its page
            // rather than a mode-and-track decision on a separate screen.
            <Link
              className="button"
              href={`/study/new?track=${certification.slug}`}
            >
              Start session
            </Link>
          )}
          <Link
            className="button-quiet"
            href={`/study-tracks/${certification.slug}/edit`}
          >
            Edit track
          </Link>
          <form
            action={
              isArchived
                ? restoreCertificationAction
                : archiveCertificationAction
            }
            className="inline-form"
          >
            <input
              type="hidden"
              name="certificationId"
              value={certification.id}
              readOnly
            />
            <button type="submit" className="button-quiet">
              {isArchived ? "Restore track" : "Archive track"}
            </button>
          </form>
        </div>
      </header>

      <section aria-labelledby="objectives-heading" className="section">
        <div className="section-heading">
          <h2 id="objectives-heading">Objectives</h2>
          <p className="section-note">
            {view.activeObjectiveCount} active
            {view.archivedObjectiveCount > 0
              ? `, ${view.archivedObjectiveCount} archived`
              : ""}
            . Objectives outline study focus only.
          </p>
          <div className="section-actions">
            <Link
              className="button"
              href={`/study-tracks/${certification.slug}/objectives/new`}
            >
              Add root objective
            </Link>
          </div>
        </div>
        <ObjectiveTree slug={certification.slug} nodes={view.objectiveTree} />
      </section>

      <section aria-labelledby="questions-heading" className="section">
        <div className="section-heading">
          <h2 id="questions-heading">Question bank</h2>
          <p className="section-note">
            {bank.total === 0
              ? "No questions yet. The bank is where you write and keep them."
              : `${bank.active} active of ${bank.total} question${bank.total === 1 ? "" : "s"}.`}
          </p>
          <div className="section-actions">
            <Link
              className="button"
              href={`/study-tracks/${certification.slug}/questions`}
            >
              Open question bank
            </Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="flashcards-heading" className="section">
        <div className="section-heading">
          <h2 id="flashcards-heading">Flashcards</h2>
          <p className="section-note">
            {cards.total === 0
              ? "No flashcards yet. Cards are for short recall practice between question sessions."
              : `${cards.active} active of ${cards.total} card${cards.total === 1 ? "" : "s"}.${cards.due > 0 ? ` ${cards.due} due now.` : " Nothing due right now."}`}
          </p>
          <div className="section-actions">
            {cards.due > 0 ? (
              <Link
                className="button"
                href={`/study-tracks/${certification.slug}/review`}
              >
                Review {cards.due} due
              </Link>
            ) : null}
            <Link
              className={cards.due > 0 ? "button-quiet" : "button"}
              href={`/study-tracks/${certification.slug}/flashcards`}
            >
              Open flashcards
            </Link>
          </div>
        </div>
      </section>

      {/* Generation is offered for a live track only, like starting a session: an
          archived track is one the owner has put down, and filling its bank is not
          what they are doing. The generate page itself remains reachable, so this
          hides an unhelpful invitation rather than a capability. */}
      {isArchived ? null : (
        <section aria-labelledby="generate-heading" className="section">
          <div className="section-heading">
            <h2 id="generate-heading">Generate with AI</h2>
            <p className="section-note">
              A model can write a small batch of questions or cards from its own
              knowledge. Everything it writes lands as a draft for you to review
              — it is never official exam material.
            </p>
            <div className="section-actions">
              <Link
                className="button"
                href={`/study-tracks/${certification.slug}/generate`}
              >
                Generate with AI
              </Link>
              <Link
                className="button-quiet"
                href={`/study-tracks/${certification.slug}/generation-runs`}
              >
                Past runs
              </Link>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
