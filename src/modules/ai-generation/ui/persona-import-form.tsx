"use client";

import { useActionState, useRef, useState } from "react";
import type { DragEvent } from "react";
import Link from "next/link";
import { FieldErrors } from "@/shared/ui/field-errors";
import { fieldErrors, formLevelErrors } from "@/shared/ui/form-state";
import { genericTemplateForArchetype } from "@/modules/ai-generation/domain/persona-templates";
import { describePersonaArchetype } from "@/modules/ai-generation/domain/stored-persona";
import { createPersonaAction } from "./persona-actions";
import { IDLE_PERSONA_IMPORT_STATE } from "./persona-import-state";
import type { PersonaImportState } from "./persona-import-state";
import { PersonaForm } from "./persona-form";

interface PersonaImportFormProps {
  readonly action: (
    state: PersonaImportState,
    form: FormData,
  ) => Promise<PersonaImportState>;
}

/**
 * Import a persona from a file, then review it before saving.
 *
 * Two steps in one component, because the second is the reason the first is safe: reading
 * the file produces a *draft*, and the draft is rendered in the same `PersonaForm` a
 * template opens, so a file — possibly one somebody else wrote — is read, shown, and
 * edited before anything is written. An import that saved directly would be one click
 * from a persona in the list the owner had never read.
 *
 * The two ways in are the upload form's, for the same reasons and with the same drop-zone
 * pattern (`objective-import-form.tsx`): a file is the quick path when the owner has the
 * export, a paste is the reliable path for JSON in a message or a gist. Both are read by
 * the same schema.
 */
export function PersonaImportForm({ action }: PersonaImportFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_PERSONA_IMPORT_STATE,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setDragOver] = useState(false);
  const [chosenName, setChosenName] = useState<string | null>(null);

  // A dropped file is assigned to the real <input type="file"> so the ordinary form
  // submission carries it — the drop zone is a bigger target for the same input, not a
  // separate upload path.
  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files.item(0);
    const input = fileInputRef.current;

    if (file === null || input === null) {
      return;
    }

    const transfer = new DataTransfer();

    transfer.items.add(file);
    input.files = transfer.files;
    setChosenName(file.name);
  }

  if (state.imported !== null) {
    const { archetype, draft } = state.imported;

    return (
      <>
        <p className="field-hint" role="status">
          Read as a {describePersonaArchetype(archetype).toLowerCase()} persona.
          Nothing has been saved yet — review the fields below and save to
          create it. Its name may already be taken by one of yours; that is
          fine, the stored key gets a suffix.
        </p>

        <PersonaForm
          action={createPersonaAction}
          submitLabel="Create persona"
          cancelHref="/settings/personas"
          draft={draft}
          archetype={archetype}
          templateKey={genericTemplateForArchetype(archetype).key}
        />

        <p className="field-hint">
          Wrong file? <Link href="/settings/personas">Reload this page</Link>{" "}
          and import another.
        </p>
      </>
    );
  }

  const formErrors = formLevelErrors(state);
  const fileErrors = fieldErrors(state, "personaFile");
  const pastedErrors = fieldErrors(state, "pastedJson");
  // Every message the envelope schema produces, whichever field it names. They are
  // rendered together beneath the inputs because the failing "field" is a key inside the
  // file — `guidance.2` — and there is no input on this form to attach it to; naming the
  // path is what makes it fixable.
  const contentErrors = Object.entries(state.fieldErrors)
    .filter(
      ([field]) =>
        field !== "" && field !== "personaFile" && field !== "pastedJson",
    )
    .flatMap(([field, messages]) => messages.map((m) => `${field}: ${m}`));

  return (
    <form action={formAction} className="form" noValidate>
      {formErrors.length > 0 ? (
        <FieldErrors id="persona-import-form-errors" messages={formErrors} />
      ) : null}

      <div className="field">
        <label htmlFor="personaFile">Persona file</label>
        <p className="field-hint" id="personaFile-hint">
          A <code>.json</code> file exported from a persona&apos;s page, here or
          on somebody else&apos;s StudyBench. Nothing is saved by choosing it:
          you will see the persona in an editable form first.
        </p>
        <div
          className={`file-drop-zone${isDragOver ? " file-drop-zone-active" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <input
            id="personaFile"
            name="personaFile"
            type="file"
            ref={fileInputRef}
            accept=".json,application/json"
            aria-describedby={
              fileErrors === undefined
                ? "personaFile-hint"
                : "personaFile-hint personaFile-errors"
            }
            aria-invalid={fileErrors !== undefined}
            onChange={(event) =>
              setChosenName(event.currentTarget.files?.item(0)?.name ?? null)
            }
          />
          <p aria-live="polite" className="file-drop-hint">
            {chosenName === null
              ? "…or drag a file anywhere in this box."
              : `Ready: ${chosenName}`}
          </p>
        </div>
        <FieldErrors id="personaFile-errors" messages={fileErrors} />
      </div>

      <div className="field">
        <label htmlFor="pastedJson">Or paste the JSON</label>
        <p className="field-hint" id="pastedJson-hint">
          Used only when you have chosen no file. Handy when the persona arrived
          in a message rather than as a download.
        </p>
        <textarea
          id="pastedJson"
          name="pastedJson"
          rows={6}
          aria-describedby={
            pastedErrors === undefined
              ? "pastedJson-hint"
              : "pastedJson-hint pastedJson-errors"
          }
          aria-invalid={pastedErrors !== undefined}
          defaultValue={state.values.pastedJson ?? ""}
        />
        <FieldErrors id="pastedJson-errors" messages={pastedErrors} />
      </div>

      {contentErrors.length > 0 ? (
        <FieldErrors
          id="persona-import-content-errors"
          messages={contentErrors}
        />
      ) : null}

      <div className="form-actions">
        <button type="submit" className="button-quiet" disabled={isPending}>
          {isPending ? "Reading…" : "Read persona file"}
        </button>
      </div>
    </form>
  );
}
