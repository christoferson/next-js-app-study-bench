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
import { SyllabusUnreadableError } from "@/modules/ai-generation/domain/errors";
import type { DocumentKind } from "@/modules/ai-generation/ports/document-text-extractor";

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
      pastedText: readString(form, "pastedText"),
      additionalInstructions: readString(form, "additionalInstructions"),
      personaId: readString(form, "personaId"),
    });
    const document = await readDocument(form);
    const result = await getObjectiveImportFacade().extractObjectives(
      slug,
      input,
      document,
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
    });

    await getObjectiveImportFacade().applyImport(
      slug,
      input.runId,
      input.sourceType,
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
 * The uploaded file, or `null` when the owner pasted text instead.
 *
 * Both checks here are cheap and specific. The size check runs before the bytes are
 * read into memory, so a huge upload is refused by reading its declared size rather
 * than by buffering it. The kind is decided by extension *and* media type, and only
 * two kinds are accepted, so a `.docx` gets a message that says what to do rather than
 * reaching a PDF parser that would fail obscurely.
 */
async function readDocument(form: FormData): Promise<UploadedDocument | null> {
  const value = form.get("document");

  if (!(value instanceof File) || value.size === 0) {
    return null;
  }

  if (value.size > MAX_SYLLABUS_FILE_BYTES) {
    throw new SyllabusUnreadableError(
      `That file is larger than ${Math.floor(MAX_SYLLABUS_FILE_BYTES / (1024 * 1024))} MB. Upload the syllabus on its own rather than a whole course bundle, or paste the outline instead.`,
    );
  }

  return {
    filename: value.name,
    bytes: new Uint8Array(await value.arrayBuffer()),
    kind: documentKind(value),
  };
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
  if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    file.type === "text/plain" ||
    file.type === "text/markdown"
  ) {
    return "PLAIN_TEXT";
  }

  throw new SyllabusUnreadableError(
    "Only PDF and plain-text files can be read. For anything else — a Word document, a web page, a spreadsheet — copy the outline and paste it into the box below.",
  );
}
