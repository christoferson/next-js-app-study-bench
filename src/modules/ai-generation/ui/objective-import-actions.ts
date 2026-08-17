"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDomainError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { toInvalidFormState } from "@/shared/ui/form-state";
import { getObjectiveImportFacade } from "@/modules/ai-generation/composition";
import {
  applyObjectiveImportSchema,
  objectiveImportRequestSchema,
  MAX_SYLLABUS_FILE_BYTES,
} from "@/modules/ai-generation/application/schemas";
import type { UploadedDocument } from "@/modules/ai-generation/application/objective-import-facade";
import { HSK_SELECTABLE_FILE_ROLES } from "@/modules/ai-generation/application/hsk-import/hsk-import-strategy";
import type { HskFileRole } from "@/modules/ai-generation/application/hsk-import/hsk-import-strategy";
import { MAX_IMPORT_STRATEGY_FILES } from "@/modules/ai-generation/domain/import-strategy";
import { MAX_MERGE_ITEMS } from "@/modules/ai-generation/domain/objective-merge";
import { SyllabusUnreadableError } from "@/modules/ai-generation/domain/errors";
import type { DocumentKind } from "@/platform/documents/document-text-extractor";

/**
 * Server Actions for the objective import.
 *
 * Separate from `actions.ts` for the reason the facade is separate: these two actions
 * do not produce bank content, and the middle of the flow is an owner decision rather
 * than a redirect to a review page.
 *
 * The extraction action is the only place in the application that reads an uploaded
 * file, and it does the minimum: size, then kind, then bytes. It never writes the file
 * anywhere — not to `./data`, not to a temp directory — because there is nothing that
 * would read it back (`objective-import-facade.ts` documents why).
 */

function trackPath(slug: string): string {
  return `/study-tracks/${slug}`;
}

function importPath(slug: string): string {
  return `${trackPath(slug)}/objectives/import`;
}

function readString(form: FormData, field: string): string {
  const value = form.get(field);

  return typeof value === "string" ? value : "";
}

/**
 * Extracts an outline from an upload and opens the confirm page.
 *
 * Nothing is added to the track here, which is the whole design: the redirect goes to
 * a page that shows what the model proposed and asks. A failed extraction redirects to
 * the same confirm page rather than back to the form, because a failed *run* is still a
 * recorded outcome the owner should be able to read and link to — the same reasoning
 * `actions.ts` states for generation. An unreadable *file* is different and does come
 * back to the form, because no run exists to read.
 */
export async function extractObjectivesAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const slug = readString(form, "slug");
  let destination: string;

  try {
    const input = parseInput(objectiveImportRequestSchema, {
      strategyKey: readString(form, "strategyKey"),
      pastedText: readString(form, "pastedText"),
      additionalInstructions: readString(form, "additionalInstructions"),
      personaId: readString(form, "personaId"),
    });
    const documents =
      readString(form, "confirmedExtraction") === "1"
        ? readConfirmedDocuments(form)
        : await readDocuments(form);

    // Troubleshooting checkpoint (owner request, 2026-08-17): uploaded files
    // STOP here on the first submit. The extracted text is returned to the form
    // for the owner to read; the continue submit carries that exact text back
    // (file inputs cannot be re-populated), so what the owner saw is
    // byte-for-byte what the strategy receives. Pasted-only submissions pass
    // straight through — pasted text is already visible.
    if (
      documents.length > 0 &&
      readString(form, "confirmedExtraction") !== "1"
    ) {
      const facade = getObjectiveImportFacade();
      const previews = await Promise.all(
        documents.map(async (document) => ({
          ...(await facade.previewUploadText(document)),
          role: document.role,
        })),
      );
      // The exact prompt the AI strategy would send, for the owner to run
      // manually elsewhere. Rendered through the same code path as the real
      // call. Deterministic strategies send no prompt; nothing is shown.
      const prompt =
        input.strategyKey === "GENERIC_OUTLINE"
          ? await facade.previewImportPrompt(
              slug,
              input,
              previews.map((preview) => preview.text).join("\n\n"),
            )
          : null;

      return {
        status: "invalid",
        fieldErrors: {},
        values: {
          strategyKey: input.strategyKey,
          additionalInstructions: input.additionalInstructions ?? "",
          personaId: input.personaId ?? "",
          extractedPreview: JSON.stringify(previews),
          ...(prompt === null ? {} : { promptPreview: JSON.stringify(prompt) }),
        },
      };
    }
    const result = await getObjectiveImportFacade().extractObjectives(
      slug,
      input,
      documents,
    );

    destination = `${importPath(slug)}/${encodeURIComponent(result.run.id)}${
      result.truncated ? "?truncated=1" : ""
    }`;
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidatePath(`${trackPath(slug)}/generation-runs`);
  redirect(destination);
}

/**
 * Adds a confirmed outline to the track.
 *
 * Redirects to the track page, which is where the objectives now are: the owner's next
 * question after "did that work" is "what does my outline look like", and the tree
 * there answers both at once.
 */
export async function applyObjectiveImportAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const slug = readString(form, "slug");

  try {
    const input = parseInput(applyObjectiveImportSchema, {
      runId: readString(form, "runId"),
      sourceType: readString(form, "sourceType"),
      itemKeys: readItemKeys(form),
    });

    await getObjectiveImportFacade().applyImport(
      slug,
      input.runId,
      input.sourceType,
      input.itemKeys,
    );
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  // Every page that renders the objective tree or offers objectives as options is now
  // stale: the track page, the objective forms, and both generate forms.
  revalidatePath(trackPath(slug));
  revalidatePath(`${trackPath(slug)}/generate`);
  revalidatePath(`${trackPath(slug)}/generation-runs`);
  // To the track itself rather than back to the confirm page with a success flag: the
  // objectives are the outcome, and the tree there is both the confirmation that it
  // worked and the thing the owner wanted.
  redirect(trackPath(slug));
}

/**
 * The merge items the owner left checked, or `null` when the form had no per-item choice.
 *
 * The `itemKeys` marker is what separates "a merge with everything unchecked" from "a plain
 * tree import", and it has to be a field of its own: an unchecked checkbox sends nothing, so
 * both cases arrive as an empty `getAll`. The confirm form renders the marker only when it
 * renders checkboxes, so the distinction is carried by the form that knows it.
 *
 * `slice` bounds the list before the schema sees it, so a hostile post with fifty thousand
 * keys is trimmed rather than validated and rejected — the extra keys would name nothing in
 * the plan anyway.
 */
function readItemKeys(form: FormData): readonly string[] | null {
  if (readString(form, "itemKeys") !== "1") {
    return null;
  }

  return form
    .getAll("itemKey")
    .filter((value): value is string => typeof value === "string")
    .slice(0, MAX_MERGE_ITEMS);
}

/**
 * The uploaded files, in the order the form sent them, with their chosen roles.
 *
 * `getAll` rather than `get`, because a multi-file strategy accepts several files in one
 * submission and a single-file one simply sends one. The roles arrive as a parallel
 * `documentRole` list — the form renders one select per chosen file, in the same order —
 * and a role that names nothing becomes `null`, meaning "classify it". Positional pairing
 * is what makes this work without inventing per-file identifiers that a `<input multiple>`
 * does not give the server anyway; a blank role is the safe fallback in the one case where
 * the lists could disagree.
 *
 * The size check runs on the declared size, before the bytes are read into memory, so a
 * huge upload is refused without buffering it. The kind is decided by extension *and*
 * media type.
 */
async function readDocuments(
  form: FormData,
): Promise<readonly UploadedDocument[]> {
  const files = form
    .getAll("document")
    .filter((value): value is File => value instanceof File)
    .filter((file) => file.size > 0);
  const chosenRoles = form
    .getAll("documentRole")
    .filter((value): value is string => typeof value === "string");

  return Promise.all(
    files.slice(0, MAX_IMPORT_STRATEGY_FILES).map(async (file, index) => {
      if (file.size > MAX_SYLLABUS_FILE_BYTES) {
        throw new SyllabusUnreadableError(
          `${file.name} is larger than ${Math.floor(MAX_SYLLABUS_FILE_BYTES / (1024 * 1024))} MB. Upload the syllabus on its own rather than a whole course bundle, or paste the outline instead.`,
        );
      }

      return {
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
        kind: documentKind(file),
        role: readRole(chosenRoles[index]),
      };
    }),
  );
}

/**
 * The continue step's documents: the extracted text the owner just read,
 * resubmitted as hidden fields. Encoded back to bytes so the rest of the
 * pipeline is unchanged; the kind is PLAIN_TEXT because extraction already
 * happened — running a PDF extractor on extracted text would be wrong.
 */
function readConfirmedDocuments(form: FormData): UploadedDocument[] {
  const raw = readString(form, "extractedPreview");

  if (raw.length === 0) {
    return [];
  }

  const parsed = JSON.parse(raw) as readonly {
    filename: string;
    text: string;
    role: string | null;
  }[];

  return parsed.map((entry) => ({
    filename: entry.filename,
    bytes: new TextEncoder().encode(entry.text),
    kind: "PLAIN_TEXT" as DocumentKind,
    role: readRole(entry.role ?? undefined),
  }));
}

/** A chosen role, or `null` when the owner left it on automatic. */
function readRole(value: string | undefined): HskFileRole | null {
  return value === undefined
    ? null
    : (HSK_SELECTABLE_FILE_ROLES.find((role) => role === value) ?? null);
}

function documentKind(file: File): DocumentKind {
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return "PDF";
  }

  // The media types are listed rather than matched on a `text/` prefix. A prefix would
  // quietly accept `text/html` and `text/csv` and send markup or comma-separated cells
  // to the model as though they were an outline — while the message below, and the
  // `accept` list on the form, both tell the owner to paste a web page instead. Two
  // answers to the same question is worse than the narrower one.
  //
  // `.json` is accepted for the deterministic strategies, whose appendix files are JSON
  // tables. It is read as text and handed to a parser that validates its columns, never
  // to a model: an unrecognised JSON file is classified `UNRECOGNIZED` rather than sent
  // anywhere.
  if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".json") ||
    file.type === "text/plain" ||
    file.type === "text/markdown" ||
    file.type === "application/json"
  ) {
    return "PLAIN_TEXT";
  }

  throw new SyllabusUnreadableError(
    "Only PDF, plain-text, and JSON files can be read. For anything else — a Word document, a web page, a spreadsheet — copy the outline and paste it into the box below.",
  );
}
