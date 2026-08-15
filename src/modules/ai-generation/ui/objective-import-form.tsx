"use client";

import { useActionState, useRef, useState } from "react";
import type { DragEvent } from "react";
import Link from "next/link";
import { FieldErrors } from "@/shared/ui/field-errors";
import type { FormState } from "@/shared/ui/form-state";
import {
  IDLE_FORM_STATE,
  fieldErrors,
  formLevelErrors,
} from "@/shared/ui/form-state";
import { MAX_IMPORT_DEPTH } from "@/modules/ai-generation/domain/objective-import";
import type { EffectivePersona } from "@/modules/ai-generation/domain/personas";
import type { StoredPersona } from "@/modules/ai-generation/domain/stored-persona";

interface ObjectiveImportFormProps {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly slug: string;
  /** The persona this import uses when the owner chooses none. */
  readonly persona: EffectivePersona;
  /** The owner's personas that suit this track. Empty renders no select. */
  readonly personaChoices?: readonly StoredPersona[];
  readonly assignedPersonaId?: string | null;
  readonly modelProvider: string;
  readonly modelId: string;
  readonly maxFileBytes: number;
  readonly maxCharacters: number;
  readonly existingObjectiveCount: number;
}

/**
 * The syllabus upload form.
 *
 * Two ways in, side by side rather than as a primary and a fallback. A file is the
 * quick path when the owner has the exam guide as a PDF; a paste is the reliable path
 * for a syllabus on a web page, in an email, or in a PDF whose text layer is a mess.
 * Neither is presented as the lesser option, because which one works depends entirely
 * on the document.
 *
 * The encoding is *not* stated here, deliberately. A form carrying a file needs
 * `multipart/form-data` or the bytes never arrive — but React sets it itself when the
 * action is a function, and setting it as well is both ignored and warned about. The
 * rendered form is asserted to carry it, so the requirement is pinned without this
 * component being the thing that states it.
 *
 * The submit button says what happens next — a preview, not an import — because the
 * confirm step is the reason this feature is safe to use on a track that already has
 * objectives.
 */
export function ObjectiveImportForm({
  action,
  slug,
  persona,
  personaChoices = [],
  assignedPersonaId = null,
  modelProvider,
  modelId,
  maxFileBytes,
  maxCharacters,
  existingObjectiveCount,
}: ObjectiveImportFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const formErrors = formLevelErrors(state);
  const documentErrors = fieldErrors(state, "document");
  const pastedErrors = fieldErrors(state, "pastedText");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setDragOver] = useState(false);
  const [droppedName, setDroppedName] = useState<string | null>(null);

  // A dropped file is assigned to the real <input type="file"> so the ordinary
  // form submission carries it — the drop zone is a bigger target for the same
  // input, not a separate upload path.
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
    setDroppedName(file.name);
  }

  return (
    <form action={formAction} className="form" noValidate>
      <input type="hidden" name="slug" value={slug} readOnly />

      {formErrors.length > 0 ? (
        <FieldErrors id="import-form-errors" messages={formErrors} />
      ) : null}

      <div className="field">
        <label htmlFor="document">Syllabus file</label>
        <p className="field-hint" id="document-hint">
          A PDF or plain-text file, up to{" "}
          {Math.floor(maxFileBytes / (1024 * 1024))} MB. The file is read once
          and is not stored — only the outline you confirm is kept. A PDF that
          is a scan has no text to read, so paste the outline instead.
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
            id="document"
            name="document"
            type="file"
            ref={fileInputRef}
            accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            aria-describedby={
              documentErrors === undefined
                ? "document-hint"
                : "document-hint document-errors"
            }
            aria-invalid={documentErrors !== undefined}
            onChange={(event) =>
              setDroppedName(event.currentTarget.files?.item(0)?.name ?? null)
            }
          />
          <p aria-live="polite" className="file-drop-hint">
            {droppedName === null
              ? "…or drag a file anywhere in this box."
              : `Ready: ${droppedName}`}
          </p>
        </div>
        <FieldErrors id="document-errors" messages={documentErrors} />
      </div>

      <div className="field">
        <label htmlFor="pastedText">Or paste the outline</label>
        <p className="field-hint" id="pastedText-hint">
          Optional if you chose a file. Up to{" "}
          {maxCharacters.toLocaleString("en-GB")} characters. Pasting works well
          when the syllabus is on a web page, and it is worth trying when a PDF
          comes out garbled.
        </p>
        <textarea
          id="pastedText"
          name="pastedText"
          rows={8}
          aria-describedby={
            pastedErrors === undefined
              ? "pastedText-hint"
              : "pastedText-hint pastedText-errors"
          }
          aria-invalid={pastedErrors !== undefined}
          defaultValue={state.values.pastedText ?? ""}
        />
        <FieldErrors id="pastedText-errors" messages={pastedErrors} />
      </div>

      <div className="field">
        <label htmlFor="additionalInstructions">Your notes</label>
        <p className="field-hint" id="additionalInstructions-hint">
          Optional. For example{" "}
          <q>only the content outline, not the sample questions</q>. Notes
          describe what to extract; they cannot change what the model is
          instructed to do.
        </p>
        <textarea
          id="additionalInstructions"
          name="additionalInstructions"
          rows={2}
          aria-describedby={
            fieldErrors(state, "additionalInstructions") === undefined
              ? "additionalInstructions-hint"
              : "additionalInstructions-hint additionalInstructions-errors"
          }
          aria-invalid={
            fieldErrors(state, "additionalInstructions") !== undefined
          }
          defaultValue={state.values.additionalInstructions ?? ""}
        />
        <FieldErrors
          id="additionalInstructions-errors"
          messages={fieldErrors(state, "additionalInstructions")}
        />
      </div>

      {personaChoices.length > 0 ? (
        <div className="field">
          <label htmlFor="personaId">Persona</label>
          <p className="field-hint" id="personaId-hint">
            Which voice reads the document. Automatic uses the built-in persona
            for this track&apos;s study type. This applies to this import only.
          </p>
          <select
            id="personaId"
            name="personaId"
            aria-describedby={
              fieldErrors(state, "personaId") === undefined
                ? "personaId-hint"
                : "personaId-hint personaId-errors"
            }
            aria-invalid={fieldErrors(state, "personaId") !== undefined}
            defaultValue={state.values.personaId ?? assignedPersonaId ?? ""}
          >
            <option value="">Automatic (by study type)</option>
            {personaChoices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
          <FieldErrors
            id="personaId-errors"
            messages={fieldErrors(state, "personaId")}
          />
        </div>
      ) : null}

      <p className="field-hint">
        Persona: {persona.label}, version {persona.version}. Model:{" "}
        <code>{modelId}</code> via {modelProvider}. The model copies what the
        document says, nests it up to {MAX_IMPORT_DEPTH} levels deep, and adds
        nothing of its own.{" "}
        {existingObjectiveCount === 0
          ? "This track has no objectives yet."
          : `This track's ${existingObjectiveCount} existing ${
              existingObjectiveCount === 1 ? "objective" : "objectives"
            } are left exactly as they are; anything you apply is added after them.`}
      </p>

      <div className="form-actions">
        <button type="submit" className="button" disabled={isPending}>
          {isPending ? "Reading…" : "Extract outline"}
        </button>
        <Link className="button-quiet" href={`/study-tracks/${slug}`}>
          Cancel
        </Link>
      </div>

      <p className="field-hint" role="status">
        {isPending
          ? "Reading the document and waiting for the model. A long exam guide takes longer than a pasted outline."
          : "Nothing is added to your track yet. You will see the proposed outline first and choose whether to keep it."}
      </p>
    </form>
  );
}
