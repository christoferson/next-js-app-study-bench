"use client";

import { useActionState, useRef, useState } from "react";
import type { DragEvent } from "react";
import { FieldErrors } from "@/shared/ui/field-errors";
import type { FormState } from "@/shared/ui/form-state";
import {
  IDLE_FORM_STATE,
  fieldErrors,
  formLevelErrors,
} from "@/shared/ui/form-state";
import { SOURCE_AUTHORITIES } from "@/modules/sources/domain/source";
import { describeSourceAuthority } from "./source-badges";

/** Which of the three ways in this form is. */
export type SourceImportKind = "PASTE" | "FILE" | "URL";

interface SourceImportFormProps {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly kind: SourceImportKind;
  readonly slug: string;
  readonly maxCharacters: number;
  readonly maxFileBytes: number;
}

/**
 * One of the three ways to bring a document in.
 *
 * Three forms rather than one form with a mode select, because the three take genuinely
 * different input and fail in genuinely different ways — a refused address is not a
 * refused upload — and a single form would have to guess which route the owner meant from
 * which fields they happened to fill in. Rendering them as three sections side by side
 * also states the choice without hiding two thirds of it behind a tab the owner has to
 * discover.
 *
 * The shared half is real, though: every kind needs a title and an authority, and those
 * two fields must behave identically everywhere or the same document imported two ways
 * would carry different metadata. So the shape is one component parameterised by kind
 * rather than three components that drift.
 *
 * The title is optional for a file and a URL and required for a paste. That asymmetry is
 * not an oversight: a filename and an address both contain a usable name, and the facade
 * derives one when the field is blank. Pasted text contains nothing to name it by.
 */
export function SourceImportForm({
  action,
  kind,
  slug,
  maxCharacters,
  maxFileBytes,
}: SourceImportFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const formErrors = formLevelErrors(state);
  const titleErrors = fieldErrors(state, "title");
  const authorityErrors = fieldErrors(state, "authority");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setDragOver] = useState(false);
  const [chosenName, setChosenName] = useState<string | null>(null);
  const prefix = kind.toLowerCase();

  // The dropped file is assigned to the real <input type="file"> so ordinary form
  // submission carries it. The drop zone is a larger target for that one input, not a
  // second upload path — the same arrangement the objective import uses.
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

  return (
    <form action={formAction} className="form" noValidate>
      <input type="hidden" name="slug" value={slug} readOnly />

      {formErrors.length > 0 ? (
        <FieldErrors id={`${prefix}-form-errors`} messages={formErrors} />
      ) : null}

      {kind === "PASTE" ? (
        <div className="field">
          <label htmlFor="paste-text">The text</label>
          <p className="field-hint" id="paste-text-hint">
            Up to {maxCharacters.toLocaleString("en-GB")} characters. Paste is
            the reliable route: it works for a page a fetch cannot reach, for a
            PDF whose text comes out garbled, and for your own notes.
          </p>
          <textarea
            id="paste-text"
            name="text"
            rows={10}
            aria-describedby={
              fieldErrors(state, "text") === undefined
                ? "paste-text-hint"
                : "paste-text-hint paste-text-errors"
            }
            aria-invalid={fieldErrors(state, "text") !== undefined}
            defaultValue={state.values.text ?? ""}
          />
          <FieldErrors
            id="paste-text-errors"
            messages={fieldErrors(state, "text")}
          />
          <ul className="choice-list">
            <li className="choice-row">
              <label className="choice-label">
                <input
                  name="isMarkdown"
                  type="checkbox"
                  defaultChecked={state.values.isMarkdown === "on"}
                />
                {/* Markdown and plain text are the same characters downstream. The
                    distinction is recorded because the owner can see at a glance which
                    of their sources were written as documents, and because heading
                    structure is a hint a later chunker may legitimately use. */}
                <span>This text is markdown</span>
              </label>
            </li>
          </ul>
        </div>
      ) : null}

      {kind === "FILE" ? (
        <div className="field">
          <label htmlFor="file-document">The file</label>
          <p className="field-hint" id="file-document-hint">
            A PDF, plain-text, or markdown file, up to{" "}
            {Math.floor(maxFileBytes / (1024 * 1024))} MB. Only the text is
            kept; the file itself is read once and discarded. A PDF that is a
            scan has no text layer to read, and the import will say so rather
            than store an empty document — paste the text instead.
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
              id="file-document"
              name="document"
              type="file"
              ref={fileInputRef}
              accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
              aria-describedby={
                fieldErrors(state, "document") === undefined
                  ? "file-document-hint"
                  : "file-document-hint file-document-errors"
              }
              aria-invalid={fieldErrors(state, "document") !== undefined}
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
          <FieldErrors
            id="file-document-errors"
            messages={fieldErrors(state, "document")}
          />
        </div>
      ) : null}

      {kind === "URL" ? (
        <div className="field">
          <label htmlFor="url-url">The address</label>
          <p className="field-hint" id="url-url-hint">
            An <code>http://</code> or <code>https://</code> address. The page
            is fetched once and its text stored, and this is the only kind of
            source that can be read again later to see whether it changed.
            Addresses inside a private network are refused, and a page built
            entirely by JavaScript will come back empty — paste it instead.
          </p>
          <input
            id="url-url"
            name="url"
            type="url"
            inputMode="url"
            aria-describedby={
              fieldErrors(state, "url") === undefined
                ? "url-url-hint"
                : "url-url-hint url-url-errors"
            }
            aria-invalid={fieldErrors(state, "url") !== undefined}
            defaultValue={state.values.url ?? ""}
          />
          <FieldErrors
            id="url-url-errors"
            messages={fieldErrors(state, "url")}
          />
        </div>
      ) : null}

      <div className="field">
        <label htmlFor={`${prefix}-title`}>
          Title
          {/*
            Required for a paste and optional otherwise, because a paste is the one kind
            with nothing to derive a title from — no filename, no address. Marked and
            `required` only in that case, so the browser refuses a blank title before a
            submission that the schema would reject anyway.
          */}
          {kind === "PASTE" ? (
            <span className="field-required"> (required)</span>
          ) : null}
        </label>
        <p className="field-hint" id={`${prefix}-title-hint`}>
          {kind === "PASTE"
            ? "What this document is, in the words you will recognise it by in a list."
            : kind === "FILE"
              ? "Optional. Left blank, the filename becomes the title."
              : "Optional. Left blank, the address becomes the title."}
        </p>
        <input
          id={`${prefix}-title`}
          name="title"
          type="text"
          required={kind === "PASTE"}
          aria-describedby={
            titleErrors === undefined
              ? `${prefix}-title-hint`
              : `${prefix}-title-hint ${prefix}-title-errors`
          }
          aria-invalid={titleErrors !== undefined}
          defaultValue={state.values.title ?? ""}
        />
        <FieldErrors id={`${prefix}-title-errors`} messages={titleErrors} />
      </div>

      <div className="field">
        <label htmlFor={`${prefix}-authority`}>Authority</label>
        <p className="field-hint" id={`${prefix}-authority-hint`}>
          How much weight this document carries. Nothing about a file or an
          address reveals this — the same PDF shape covers an official exam
          guide and a stranger&apos;s revision notes — so it is your judgement
          that is recorded, and questions written from this source will later
          cite it.
        </p>
        <select
          id={`${prefix}-authority`}
          name="authority"
          defaultValue={state.values.authority ?? "OFFICIAL"}
          aria-describedby={
            authorityErrors === undefined
              ? `${prefix}-authority-hint`
              : `${prefix}-authority-hint ${prefix}-authority-errors`
          }
          aria-invalid={authorityErrors !== undefined}
        >
          {SOURCE_AUTHORITIES.map((authority) => (
            <option key={authority} value={authority}>
              {describeSourceAuthority(authority)}
            </option>
          ))}
        </select>
        <FieldErrors
          id={`${prefix}-authority-errors`}
          messages={authorityErrors}
        />
      </div>

      <div className="form-actions">
        <button type="submit" className="button" disabled={isPending}>
          {isPending ? SUBMIT_PENDING[kind] : SUBMIT_LABELS[kind]}
        </button>
      </div>
    </form>
  );
}

const SUBMIT_LABELS: Readonly<Record<SourceImportKind, string>> = {
  PASTE: "Import pasted text",
  FILE: "Import file",
  URL: "Fetch and import",
};

const SUBMIT_PENDING: Readonly<Record<SourceImportKind, string>> = {
  PASTE: "Importing…",
  FILE: "Reading…",
  URL: "Fetching…",
};
