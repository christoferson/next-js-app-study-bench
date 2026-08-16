import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, TRACKS_CRUMB, trackCrumb } from "@/shared/ui/breadcrumbs";
import {
  MAX_PASTED_CHARS,
  MAX_SOURCE_FILE_BYTES,
} from "@/modules/sources/application/schemas";
import { getSourceFacade } from "@/modules/sources/composition";
import {
  importFileSourceAction,
  importPastedSourceAction,
  importUrlSourceAction,
} from "@/modules/sources/ui/source-actions";
import { SourceImportForm } from "@/modules/sources/ui/source-import-form";

interface NewSourcePageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

/**
 * Bringing a document in, by any of the three routes.
 *
 * All three are on one page and none is presented as the fallback, because which one works
 * is a property of the document rather than of the owner's preference: an exam guide is a
 * file, a documentation page is an address, and a syllabus in an email is a paste. Ranking
 * them would only teach the owner to try the wrong one first.
 *
 * Only the URL route can be refreshed later, and the page says so where the choice is made
 * rather than after the import, since it is the one difference that affects which route to
 * pick when two would both work.
 */
export default async function NewSourcePage({ params }: NewSourcePageProps) {
  const { slug } = await params;
  // The library view rather than a bare track lookup, because this page needs the track's
  // name for its heading and its trail and nothing else — and the source facade is the one
  // this page is allowed to talk to. A track's source list is small enough that reading it
  // to render a form is cheaper than a second facade in the import path.
  const view = await getSourceFacade().findLibraryBySlug(slug);

  if (view === null) {
    notFound();
  }

  const { certification } = view;

  return (
    <main className="page">
      <Breadcrumbs
        trail={[
          TRACKS_CRUMB,
          trackCrumb(certification),
          {
            label: "Sources",
            href: `/study-tracks/${certification.slug}/sources`,
          },
        ]}
        current="Add source"
      />

      <header className="page-header">
        <p className="eyebrow">Add source</p>
        <h1>{certification.name}</h1>
        <p className="lede">
          Three ways in, and the document decides which. Whichever you use, the
          text is normalised, stored, and split into passages, and you say how
          authoritative it is — that judgement travels with every question later
          written from it.
        </p>
      </header>

      <section aria-labelledby="paste-heading" className="section">
        <div className="section-heading">
          <h2 id="paste-heading">Paste text</h2>
          <p className="section-note">
            For a syllabus in an email, a page a fetch cannot reach, or your own
            notes.
          </p>
        </div>
        <SourceImportForm
          action={importPastedSourceAction}
          kind="PASTE"
          slug={certification.slug}
          maxCharacters={MAX_PASTED_CHARS}
          maxFileBytes={MAX_SOURCE_FILE_BYTES}
        />
      </section>

      <section aria-labelledby="file-heading" className="section">
        <div className="section-heading">
          <h2 id="file-heading">Upload a file</h2>
          <p className="section-note">
            For an exam guide or a study document you already have as a PDF,
            markdown, or text file.
          </p>
        </div>
        <SourceImportForm
          action={importFileSourceAction}
          kind="FILE"
          slug={certification.slug}
          maxCharacters={MAX_PASTED_CHARS}
          maxFileBytes={MAX_SOURCE_FILE_BYTES}
        />
      </section>

      <section aria-labelledby="url-heading" className="section">
        <div className="section-heading">
          <h2 id="url-heading">Fetch a web page</h2>
          <p className="section-note">
            For official documentation. This is the only kind of source that can
            be read again later to see whether it has changed.
          </p>
        </div>
        <SourceImportForm
          action={importUrlSourceAction}
          kind="URL"
          slug={certification.slug}
          maxCharacters={MAX_PASTED_CHARS}
          maxFileBytes={MAX_SOURCE_FILE_BYTES}
        />
      </section>

      <p className="field-hint">
        <Link href={`/study-tracks/${certification.slug}/sources`}>
          Back to the source library
        </Link>
      </p>
    </main>
  );
}
