import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, TRACKS_CRUMB, trackCrumb } from "@/shared/ui/breadcrumbs";
import { getSourceFacade } from "@/modules/sources/composition";
import { SourceList } from "@/modules/sources/ui/source-list";

interface SourceLibraryPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

/**
 * One track's source library.
 *
 * A source is a document the owner decided to trust, stored so that later work can be
 * grounded in what it actually says. This page is the whole inventory of that trust for one
 * track, which is why it shows authority beside every title rather than only the name: the
 * question the owner asks on arriving is not "what did I import" but "what am I willing to
 * be examined on".
 */
export default async function SourceLibraryPage({
  params,
}: SourceLibraryPageProps) {
  const { slug } = await params;
  const view = await getSourceFacade().findLibraryBySlug(slug);

  if (view === null) {
    notFound();
  }

  const { certification, entries } = view;
  const active = entries.filter(
    (entry) => entry.source.status === "ACTIVE",
  ).length;
  const archived = entries.length - active;

  return (
    <main className="page">
      <Breadcrumbs
        trail={[TRACKS_CRUMB, trackCrumb(certification)]}
        current="Sources"
      />

      <header className="page-header">
        <p className="eyebrow">Sources</p>
        <h1>{certification.name}</h1>
        <p className="lede">
          The documents this track&apos;s study material can be written from —
          an exam guide, a documentation page, your own notes. Importing one
          stores its text and splits it into passages, so a question can later
          cite the sentence it came from rather than a model&apos;s memory.
        </p>
        <div className="section-actions">
          <Link
            className="button"
            href={`/study-tracks/${certification.slug}/sources/new`}
          >
            Add source
          </Link>
        </div>
      </header>

      <section aria-labelledby="library-heading" className="section">
        <div className="section-heading">
          <h2 id="library-heading">Library</h2>
          <p className="section-note">
            {entries.length === 0
              ? "Nothing imported yet."
              : `${active} active${archived > 0 ? `, ${archived} archived` : ""}.`}
          </p>
        </div>
        <SourceList slug={certification.slug} entries={entries} />
      </section>
    </main>
  );
}
