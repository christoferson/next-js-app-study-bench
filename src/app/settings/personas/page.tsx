import Link from "next/link";
import { getPersonaFacade } from "@/modules/ai-generation/composition";
import { PersonaList } from "@/modules/ai-generation/ui/persona-list";
import { PersonaTemplatePicker } from "@/modules/ai-generation/ui/persona-template-picker";

/**
 * Rendered per request, never prerendered.
 *
 * The page takes no route or search parameters, so Next.js would otherwise read the
 * database at build time and serve the build machine's empty list until something
 * happened to revalidate it — the same reason `/settings/audio` and `/progress` say so.
 */
export const dynamic = "force-dynamic";

/**
 * The owner's personas, and the starting points a new one is copied from.
 *
 * A persona is the instructions a model generates under: who it is, what a good
 * question looks like, what it must refuse. Until now those were two constants in the
 * source, which is right for a fixed registry and wrong as soon as one track wants
 * associate-level questions and another wants professional-level ones.
 *
 * **A persona saved here is offered on a track.** Each study track chooses one, or
 * leaves it automatic and takes the built-in persona for its study type; the generate
 * and import forms then offer the same choice for one batch. The page says where the
 * choice is made, because a management screen that does not say what its contents affect
 * is hard to tell from one that is broken.
 */
export default async function PersonasSettingsPage() {
  const view = await getPersonaFacade().findLibrary();

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href="/">Back to the study tracks</Link>
      </nav>

      <header className="page-header">
        <p className="eyebrow">Settings</p>
        <h1>Personas</h1>
        <p className="lede">
          A persona is the instructions generation writes under — who the model
          is, what a good question looks like for the subject, and what it must
          refuse. Start from one of the prepared starting points, then edit it
          freely; every edit saves a new version.
        </p>
      </header>

      <section aria-labelledby="your-personas-heading" className="section">
        <div className="section-heading">
          <h2 id="your-personas-heading">Your personas</h2>
          <p className="section-note">
            Assign one to a study track on that track&apos;s edit form, or pick
            one for a single batch when you generate. A track left automatic
            uses the built-in persona for its study type. A persona a track is
            using cannot be deleted until you change that track.
          </p>
        </div>
        <PersonaList personas={view.personas} />
      </section>

      <section aria-labelledby="new-persona-heading" className="section">
        <div className="section-heading">
          <h2 id="new-persona-heading">New persona</h2>
          <p className="section-note">
            Each starting point is a complete persona you can save unchanged and
            improve later. Nothing links back to it once saved, so editing your
            persona never affects anyone else&apos;s starting point.
          </p>
        </div>
        <PersonaTemplatePicker templates={view.templates} />
      </section>
    </main>
  );
}
