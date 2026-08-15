import Link from "next/link";
import { getAudioFacade } from "@/modules/audio/composition";
import { AudioLibrary } from "@/modules/audio/ui/audio-library";

/**
 * Rendered per request, never prerendered.
 *
 * The page takes no route or search parameters, so Next.js would otherwise read the
 * database at build time and serve the build machine's empty list until something
 * happened to revalidate it — the same reason `/progress` says so.
 */
export const dynamic = "force-dynamic";

/**
 * What audio StudyBench is storing, and how to remove it.
 *
 * This page exists because of how the cache is keyed. A clip belongs to the text that
 * was spoken rather than to the card that asked for it, so nothing deletes audio
 * implicitly: editing a term, retiring a card, or deleting the card leaves the clip in
 * place — correctly, since the same phrase may appear on another card. An explicit list
 * is therefore the only place that can answer "what am I storing, and how much", and it
 * is where the deletion the milestone requires lives (`SPEC.md` section 28.3).
 */
export default async function AudioSettingsPage() {
  const view = await getAudioFacade().findLibrary();

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href="/">Back to the study tracks</Link>
      </nav>

      {/* There is no settings landing page: two screens do not need an index, and one
          more page between the home nav and the thing being configured is a click that
          explains nothing. They cross-link instead. */}
      <nav aria-label="Settings" className="section-actions">
        <Link className="button-quiet" href="/settings/personas">
          Personas
        </Link>
      </nav>

      <header className="page-header">
        <p className="eyebrow">Settings</p>
        <h1>Audio</h1>
        <p className="lede">
          Every clip is made once, the first time you press play, and kept — so
          hearing it again costs nothing. Removing a clip deletes the file; the
          next time you press play on that phrase it is made again.
        </p>
      </header>

      <AudioLibrary view={view} />
    </main>
  );
}
