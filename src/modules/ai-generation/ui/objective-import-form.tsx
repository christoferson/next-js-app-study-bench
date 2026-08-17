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
import type {
  ImportStrategy,
  ImportStrategyKey,
} from "@/modules/ai-generation/domain/import-strategy";
import {
  HSK_SELECTABLE_FILE_ROLES,
  describeHskFileRole,
} from "@/modules/ai-generation/application/hsk-import/hsk-import-strategy";
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
  /** Every strategy, ordered for this track. */
  readonly strategies: readonly ImportStrategy[];
  readonly defaultStrategyKey: ImportStrategyKey;
  readonly maxFiles: number;
}

/**
 * The syllabus upload form: which reader, then the documents.
 *
 * **The strategy choice comes first**, because it changes what the rest of the form
 * means. An AI extraction takes one document, a persona, and notes; the HSK reader takes
 * several files and a role for each, and no persona or notes at all because it calls no
 * model. So the panel below the radios is swapped rather than always shown — a persona
 * select on a deterministic import would be a control with no effect, which is worse than
 * no control.
 *
 * Both strategies are always offered, ordered by what the track is likely to need. A
 * language track sees the HSK reader first; a technical track sees the AI extractor
 * first. Neither is hidden, because the track's study type is a hint about the document
 * and not a fact about it.
 *
 * **The file list is rendered from the chosen files, in order.** The role selects are a
 * parallel list, which is what the action pairs positionally — an `<input multiple>` gives
 * the server no per-file identity, so the order is the only link there is, and rendering
 * both from the same state is what keeps them in step.
 *
 * The encoding is *not* stated here, deliberately. A form carrying a file needs
 * `multipart/form-data` or the bytes never arrive — but React sets it itself when the
 * action is a function, and setting it as well is both ignored and warned about.
 *
 * The submit button says what happens next — a preview, not an import — because the
 * confirm step is the reason this feature is safe to use on a track that already has
 * objectives.
 */
/**
 * The exact system and user messages the AI extraction would send, in copyable
 * textareas (owner request, 2026-08-17: run the prompt manually on another LLM).
 */
function PromptPreview({ payload }: { readonly payload: string }) {
  const prompt = JSON.parse(payload) as { system: string; user: string };

  return (
    <div className="field">
      <h3>Exact prompt that would be sent</h3>
      <label htmlFor="prompt-preview-system">System message</label>
      <textarea
        id="prompt-preview-system"
        readOnly
        rows={8}
        value={prompt.system}
      />
      <label htmlFor="prompt-preview-user">User message</label>
      <textarea
        id="prompt-preview-user"
        readOnly
        rows={12}
        value={prompt.user}
      />
    </div>
  );
}

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
  strategies,
  defaultStrategyKey,
  maxFiles,
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
  const [chosenNames, setChosenNames] = useState<readonly string[]>([]);
  const [strategyKey, setStrategyKey] = useState<ImportStrategyKey>(
    (state.values.strategyKey as ImportStrategyKey | undefined) ??
      defaultStrategyKey,
  );
  const strategy =
    strategies.find((candidate) => candidate.key === strategyKey) ??
    strategies[0];
  const multiFile = strategy?.multiFile === true;

  // Dropped files are assigned to the real <input type="file"> so the ordinary form
  // submission carries them — the drop zone is a bigger target for the same input, not a
  // separate upload path. All of them for a multi-file strategy, the first for the others.
  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragOver(false);

    const dropped = [...event.dataTransfer.files].slice(
      0,
      multiFile ? maxFiles : 1,
    );
    const input = fileInputRef.current;

    if (dropped.length === 0 || input === null) {
      return;
    }

    const transfer = new DataTransfer();

    for (const file of dropped) {
      transfer.items.add(file);
    }

    input.files = transfer.files;
    setChosenNames(dropped.map((file) => file.name));
  }

  return (
    <form action={formAction} className="form" noValidate>
      <input type="hidden" name="slug" value={slug} readOnly />

      {formErrors.length > 0 ? (
        <FieldErrors id="import-form-errors" messages={formErrors} />
      ) : null}

      <fieldset className="field">
        <legend>
          How should the documents be read?
          <span className="field-required"> (required)</span>
        </legend>
        <p className="field-hint" id="strategyKey-hint">
          Both readers are always available. The first one is the usual choice
          for this kind of track.
        </p>
        <ul className="choice-list">
          {strategies.map((candidate) => (
            <li key={candidate.key} className="choice-row">
              <label className="choice-label">
                <input
                  type="radio"
                  name="strategyKey"
                  value={candidate.key}
                  checked={candidate.key === strategyKey}
                  aria-describedby="strategyKey-hint"
                  onChange={() => {
                    setStrategyKey(candidate.key);
                    setChosenNames([]);

                    if (fileInputRef.current !== null) {
                      // The accepted types and the file count differ per strategy, so a
                      // selection made for the other one is cleared rather than carried
                      // over and rejected on the server.
                      fileInputRef.current.value = "";
                    }
                  }}
                />
                <span>
                  <strong>{candidate.label}</strong> — {candidate.description}{" "}
                  {candidate.callsModel
                    ? "Calls the model."
                    : "Calls no model at all."}{" "}
                  <span className="field-hint">{candidate.acceptedInputs}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <FieldErrors
          id="strategyKey-errors"
          messages={fieldErrors(state, "strategyKey")}
        />
      </fieldset>

      <div className="field">
        <label htmlFor="document">
          {multiFile ? "Syllabus files" : "Syllabus file"}
        </label>
        <p className="field-hint" id="document-hint">
          {multiFile
            ? `Choose up to ${maxFiles} files at once — PDF, text, Markdown, or JSON, each up to ${Math.floor(maxFileBytes / (1024 * 1024))} MB. Any subset works: the grammar appendix on its own is a complete import.`
            : `A PDF or plain-text file, up to ${Math.floor(maxFileBytes / (1024 * 1024))} MB.`}{" "}
          Each file is read once and is not stored — only the outline you
          confirm is kept. A PDF that is a scan has no text to read.
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
            multiple={multiFile}
            accept={
              multiFile
                ? ".pdf,.txt,.md,.json,application/pdf,text/plain,text/markdown,application/json"
                : ".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            }
            aria-describedby={
              documentErrors === undefined
                ? "document-hint"
                : "document-hint document-errors"
            }
            aria-invalid={documentErrors !== undefined}
            onChange={(event) =>
              setChosenNames(
                [...(event.currentTarget.files ?? [])].map((file) => file.name),
              )
            }
          />
          <p aria-live="polite" className="file-drop-hint">
            {chosenNames.length === 0
              ? multiFile
                ? "…or drag the files anywhere in this box."
                : "…or drag a file anywhere in this box."
              : `Ready: ${chosenNames.join(", ")}`}
          </p>
        </div>
        <FieldErrors id="document-errors" messages={documentErrors} />
      </div>

      {multiFile && chosenNames.length > 0 ? (
        <fieldset className="field">
          <legend>What is each file?</legend>
          <p className="field-hint" id="documentRole-hint">
            Left on automatic, each file is recognised by its own contents — a
            JSON grammar table, the examination structure, or topic notes. Set
            one explicitly if a file is not recognised or is read as the wrong
            thing.
          </p>
          <ul className="choice-list">
            {chosenNames.map((name, index) => (
              // Position is the key because position is the identity: the server pairs
              // the roles with the files by order, and this list is never reordered or
              // filtered — it is replaced wholesale whenever the selection changes.
              <li key={`${index}-${name}`} className="choice-row">
                <label className="choice-label">
                  <span>{name}</span>
                  <select name="documentRole" defaultValue="">
                    <option value="">Automatic (by contents)</option>
                    {HSK_SELECTABLE_FILE_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {describeHskFileRole(role)}
                      </option>
                    ))}
                  </select>
                </label>
              </li>
            ))}
          </ul>
          <FieldErrors
            id="documentRole-errors"
            messages={fieldErrors(state, "documentRole")}
          />
        </fieldset>
      ) : null}

      {multiFile ? null : (
        <div className="field">
          <label htmlFor="pastedText">Or paste the outline</label>
          <p className="field-hint" id="pastedText-hint">
            Optional if you chose a file. Up to{" "}
            {maxCharacters.toLocaleString("en-GB")} characters. Pasting works
            well when the syllabus is on a web page, and it is worth trying when
            a PDF comes out garbled.
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
      )}

      {strategy?.callsModel === false ? null : (
        <>
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
                Which voice reads the document. Automatic uses the built-in
                persona for this track&apos;s study type. This applies to this
                import only.
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
        </>
      )}

      <p className="field-hint">
        {strategy?.callsModel === false
          ? "No model is called: the files are read by parsers written for these documents, and nothing is inferred, reworded, or invented."
          : `Persona: ${persona.label}, version ${persona.version}. Model: `}
        {strategy?.callsModel === false ? null : (
          <>
            <code>{modelId}</code> via {modelProvider}. The model copies what
            the document says, nests it up to {MAX_IMPORT_DEPTH} levels deep,
            and adds nothing of its own.
          </>
        )}{" "}
        {existingObjectiveCount === 0
          ? "This track has no objectives yet."
          : `This track's ${existingObjectiveCount} existing ${
              existingObjectiveCount === 1 ? "objective" : "objectives"
            } are left exactly as they are; anything you apply is added after them, and anything you already have is skipped rather than duplicated.`}
      </p>

      {/* Extraction checkpoint: after a file upload the action returns the
          extracted text here instead of calling anything. The owner reads it,
          then the continue submit carries this exact text forward. */}
      {typeof state.values.extractedPreview === "string" &&
      state.values.extractedPreview.length > 0 ? (
        <div className="field">
          <h3>Extracted text — read before continuing</h3>
          {(
            JSON.parse(state.values.extractedPreview) as readonly {
              filename: string;
              characterCount: number;
              text: string;
            }[]
          ).map((preview) => (
            <div key={preview.filename}>
              <p className="field-hint">
                {preview.filename} —{" "}
                {preview.characterCount.toLocaleString("en-GB")} characters.
                This exact text is what the import will read.
              </p>
              <pre className="extraction-preview-text">{preview.text}</pre>
            </div>
          ))}
          {typeof state.values.promptPreview === "string" ? (
            <PromptPreview payload={state.values.promptPreview} />
          ) : null}
          <input
            type="hidden"
            name="extractedPreview"
            value={state.values.extractedPreview}
            readOnly
          />
          <input type="hidden" name="confirmedExtraction" value="1" readOnly />
        </div>
      ) : null}

      <div className="form-actions">
        <button type="submit" className="button" disabled={isPending}>
          {isPending
            ? "Reading…"
            : typeof state.values.extractedPreview === "string" &&
                state.values.extractedPreview.length > 0
              ? "Looks right — continue the import"
              : "Extract outline"}
        </button>
        <Link className="button-quiet" href={`/study-tracks/${slug}`}>
          Cancel
        </Link>
      </div>

      <p className="field-hint" role="status">
        {isPending
          ? strategy?.callsModel === false
            ? "Reading the files. This is local parsing, so it is quick."
            : "Reading the document and waiting for the model. A long exam guide takes longer than a pasted outline."
          : "Nothing is added to your track yet. You will see the proposed outline first and choose whether to keep it."}
      </p>
    </form>
  );
}
