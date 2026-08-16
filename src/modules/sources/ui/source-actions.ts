"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDomainError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { toInvalidFormState } from "@/shared/ui/form-state";
import { getSourceFacade } from "@/modules/sources/composition";
import {
  MAX_SOURCE_FILE_BYTES,
  editSourceSchema,
  importFileSourceSchema,
  importPastedSourceSchema,
  importUrlSourceSchema,
  linkSourceObjectiveSchema,
  sourceIdentitySchema,
} from "@/modules/sources/application/schemas";
import { SourceEmptyError, SourceTooLargeError } from "@/modules/sources/domain/errors";

/**
 * Server Actions for the source library.
 *
 * Every one of them follows the pattern the rest of the application uses: parse with a
 * schema, call the facade, turn a `DomainError` into field messages, and revalidate the
 * pages whose content just changed. Nothing here reads the database, hashes text, or
 * decides what a chunk is.
 *
 * The three import actions are separate rather than one action with a `mode` field. They
 * take different input, they fail in different ways — a rejected URL is not a rejected
 * upload — and a single action would have to re-derive which tab the owner used from
 * which fields happen to be filled in.
 */

function trackPath(slug: string): string {
  return `/study-tracks/${slug}`;
}

function libraryPath(slug: string): string {
  return `${trackPath(slug)}/sources`;
}

function sourcePath(slug: string, sourceId: string): string {
  return `${libraryPath(slug)}/${encodeURIComponent(sourceId)}`;
}

function readString(form: FormData, field: string): string {
  const value = form.get(field);

  return typeof value === "string" ? value : "";
}

/** The pages that show a source's content or counts, after any change to one. */
function revalidateSource(slug: string, sourceId: string): void {
  revalidatePath(libraryPath(slug));
  revalidatePath(sourcePath(slug, sourceId));
  revalidatePath(trackPath(slug));
}

export async function importPastedSourceAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const slug = readString(form, "slug");
  let destination: string;

  try {
    const input = parseInput(importPastedSourceSchema, {
      title: readString(form, "title"),
      authority: readString(form, "authority"),
      text: readString(form, "text"),
      isMarkdown: readString(form, "isMarkdown"),
    });
    const result = await getSourceFacade().importPastedText(slug, input);

    destination = sourcePath(slug, result.source.id);
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidatePath(libraryPath(slug));
  revalidatePath(trackPath(slug));
  // To the source's own page, because the owner's next question is "what did it
  // actually store" and the snapshot list, the chunk count, and the preview answer it.
  redirect(destination);
}

/**
 * Imports an uploaded file.
 *
 * The size is checked from the declared size before the bytes are read into memory, the
 * same way the objective import does it: buffering a 300 MB upload in order to reject it
 * would be the failure mode this check exists to prevent.
 */
export async function importFileSourceAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const slug = readString(form, "slug");
  let destination: string;

  try {
    const input = parseInput(importFileSourceSchema, {
      title: readString(form, "title"),
      authority: readString(form, "authority"),
    });
    const file = form.get("document");

    if (!(file instanceof File) || file.size === 0) {
      throw new SourceEmptyError(
        "document",
        "Choose a file to import, or paste the text instead.",
      );
    }

    if (file.size > MAX_SOURCE_FILE_BYTES) {
      throw new SourceTooLargeError(
        "document",
        `That file is larger than ${Math.floor(MAX_SOURCE_FILE_BYTES / (1024 * 1024))} MB, so it was not read. Import the relevant part instead.`,
      );
    }

    if (!isSupportedUpload(file.name)) {
      throw new SourceEmptyError(
        "document",
        "Only PDF, plain-text, and markdown files can be read. For anything else, copy the text and paste it instead.",
      );
    }

    const result = await getSourceFacade().importFile(slug, {
      title: input.title,
      authority: input.authority,
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });

    destination = sourcePath(slug, result.source.id);
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidatePath(libraryPath(slug));
  revalidatePath(trackPath(slug));
  redirect(destination);
}

export async function importUrlSourceAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const slug = readString(form, "slug");
  let destination: string;

  try {
    const input = parseInput(importUrlSourceSchema, {
      title: readString(form, "title"),
      authority: readString(form, "authority"),
      url: readString(form, "url"),
    });
    const result = await getSourceFacade().importUrl(slug, input);

    destination = sourcePath(slug, result.source.id);
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidatePath(libraryPath(slug));
  revalidatePath(trackPath(slug));
  redirect(destination);
}

/**
 * Reads a web source again.
 *
 * The outcome is carried back in the query string rather than in the returned state,
 * because "the page has not changed" is the answer to a question the owner asked about
 * this source and it should survive a reload of the source's page. `changed=0` and
 * `changed=1` are the two things this action can truthfully report.
 */
export async function refreshSourceAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const slug = readString(form, "slug");
  let destination: string;

  try {
    const input = parseInput(sourceIdentitySchema, {
      sourceId: readString(form, "sourceId"),
    });
    const result = await getSourceFacade().refresh(slug, input.sourceId);

    destination = `${sourcePath(slug, input.sourceId)}?refreshed=${result.changed ? "1" : "0"}`;
    revalidateSource(slug, input.sourceId);
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  redirect(destination);
}

export async function editSourceAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const slug = readString(form, "slug");

  try {
    const input = parseInput(editSourceSchema, {
      sourceId: readString(form, "sourceId"),
      title: readString(form, "title"),
      authority: readString(form, "authority"),
    });

    await getSourceFacade().editSource(slug, input.sourceId, {
      title: input.title,
      authority: input.authority,
    });
    revalidateSource(slug, input.sourceId);
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  return { status: "idle", fieldErrors: {}, values: {} };
}

export async function archiveSourceAction(form: FormData): Promise<void> {
  const slug = readString(form, "slug");
  const input = parseInput(sourceIdentitySchema, {
    sourceId: readString(form, "sourceId"),
  });

  await getSourceFacade().archive(slug, input.sourceId);
  revalidateSource(slug, input.sourceId);
}

export async function restoreSourceAction(form: FormData): Promise<void> {
  const slug = readString(form, "slug");
  const input = parseInput(sourceIdentitySchema, {
    sourceId: readString(form, "sourceId"),
  });

  await getSourceFacade().restore(slug, input.sourceId);
  revalidateSource(slug, input.sourceId);
}

export async function linkSourceObjectiveAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const slug = readString(form, "slug");

  try {
    const input = parseInput(linkSourceObjectiveSchema, {
      sourceId: readString(form, "sourceId"),
      objectiveId: readString(form, "objectiveId"),
    });

    await getSourceFacade().linkObjective(
      slug,
      input.sourceId,
      input.objectiveId,
    );
    revalidateSource(slug, input.sourceId);
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  return { status: "idle", fieldErrors: {}, values: {} };
}

export async function unlinkSourceObjectiveAction(
  form: FormData,
): Promise<void> {
  const slug = readString(form, "slug");
  const input = parseInput(linkSourceObjectiveSchema, {
    sourceId: readString(form, "sourceId"),
    objectiveId: readString(form, "objectiveId"),
  });

  await getSourceFacade().unlinkObjective(
    slug,
    input.sourceId,
    input.objectiveId,
  );
  revalidateSource(slug, input.sourceId);
}

/**
 * Whether a filename is one of the three kinds this importer reads.
 *
 * The extension decides, not the browser's media type, for the reason the objective
 * import states: the declared type is frequently wrong or absent, and the owner knows
 * what they uploaded.
 */
function isSupportedUpload(filename: string): boolean {
  const name = filename.toLowerCase();

  return (
    name.endsWith(".pdf") || name.endsWith(".txt") || name.endsWith(".md")
  );
}
