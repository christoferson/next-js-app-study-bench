import { notFound } from "next/navigation";
import { Breadcrumbs, TRACKS_CRUMB, trackCrumb } from "@/shared/ui/breadcrumbs";
import { getObjectiveImportFacade } from "@/modules/ai-generation/composition";
import { MAX_IMPORT_NODES } from "@/modules/ai-generation/domain/objective-import";
import { MAX_DETERMINISTIC_IMPORT_NODES } from "@/modules/ai-generation/domain/import-strategy";
import { extractObjectivesAction } from "@/modules/ai-generation/ui/objective-import-actions";
import { FakeProviderNotice } from "@/modules/ai-generation/ui/fake-provider-notice";
import { ObjectiveImportForm } from "@/modules/ai-generation/ui/objective-import-form";

interface ImportObjectivesPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

/**
 * Upload a syllabus and have a model read its outline.
 *
 * The page states the two things an owner needs to trust before uploading somebody
 * else's document: the file is not kept, and nothing reaches the track until they say
 * so. Both are true of the implementation rather than reassurances — see
 * `objective-import-facade.ts`.
 */
export default async function ImportObjectivesPage({
  params,
}: ImportObjectivesPageProps) {
  const { slug } = await params;
  const view = await getObjectiveImportFacade().findImportForm(slug);

  if (view === null) {
    notFound();
  }

  return (
    <main className="page">
      <Breadcrumbs
        trail={[TRACKS_CRUMB, trackCrumb(view.certification)]}
        current="Import objectives"
      />

      <header className="page-header">
        <p className="eyebrow">Import objectives</p>
        <h1>{view.certification.name}</h1>
        <p className="lede">
          Upload the exam guide or syllabus and have its outline read out —
          domains, tasks, and their weights — as a tree you can check before
          anything is added. Choose how it should be read: a model, for a guide
          written as headings and prose, or a reader written for a particular
          examination&apos;s own documents. Nested three levels deep, up to{" "}
          {MAX_IMPORT_NODES} objectives from a model and{" "}
          {MAX_DETERMINISTIC_IMPORT_NODES} from a document reader. The files
          themselves are read once and not stored.
        </p>
        <FakeProviderNotice provider={view.modelProvider} subject="upcoming" />
      </header>

      <section aria-labelledby="upload-heading" className="section">
        <div className="section-heading">
          <h2 id="upload-heading">The documents</h2>
          <p className="section-note">
            Give it a file, several files, pasted text, or both. Importing
            copies what the documents say; it does not add objectives they leave
            out. A root your track already has is shown and skipped rather than
            added twice, so uploading one more file later is safe.
          </p>
        </div>
        <ObjectiveImportForm
          action={extractObjectivesAction}
          defaultStrategyKey={view.defaultStrategyKey}
          existingObjectiveCount={view.existingObjectiveCount}
          maxCharacters={view.maxCharacters}
          maxFileBytes={view.maxFileBytes}
          maxFiles={view.maxFiles}
          modelId={view.modelId}
          modelProvider={view.modelProvider}
          persona={view.persona}
          personaChoices={view.personaChoices}
          assignedPersonaId={view.assignedPersonaId}
          slug={view.certification.slug}
          strategies={view.strategies}
        />
      </section>
    </main>
  );
}
