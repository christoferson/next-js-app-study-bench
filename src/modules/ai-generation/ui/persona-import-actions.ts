"use server";

import { isDomainError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import { IDLE_FORM_STATE, toInvalidFormState } from "@/shared/ui/form-state";
import {
  personaEnvelopeSchema,
  toImportedPersona,
} from "@/modules/ai-generation/application/persona-envelope-schema";
import { PersonaFileUnreadableError } from "@/modules/ai-generation/domain/errors";
import { MAX_PERSONA_FILE_BYTES } from "@/modules/ai-generation/domain/persona-export";
import type { PersonaImportState } from "./persona-import-state";

/**
 * Server Action for importing a persona file.
 *
 * **It does not write anything.** The action reads the file, validates it, and hands back
 * a draft; the persona is created only when the owner submits the ordinary create form
 * that draft prefills. That is the whole safety design of the feature: a file is
 * somebody's text, possibly a stranger's, and it lands in the same review-then-save flow a
 * template does rather than appearing in the list as a fait accompli. It also means no
 * second write path exists — `createFromTemplate` remains the only way a persona is
 * created, so key allocation, versioning, and the label-collision suffix all still apply.
 *
 * No model is called. Importing a persona is free.
 *
 * The state type and its initial value live in `persona-import-state.ts`, because a
 * `"use server"` file may export only async functions.
 */
export async function importPersonaAction(
  _state: PersonaImportState,
  form: FormData,
): Promise<PersonaImportState> {
  try {
    const source = await readSource(form);
    const parsed = parseInput(personaEnvelopeSchema, source.json);

    return {
      ...IDLE_FORM_STATE,
      imported: toImportedPersona(parsed),
    };
  } catch (error) {
    if (isDomainError(error)) {
      return { ...toInvalidFormState(error, form), imported: null };
    }
    throw error;
  }
}

/** Where the JSON came from, kept so a message can name the input that failed. */
interface PersonaSource {
  readonly field: "personaFile" | "pastedJson";
  readonly json: unknown;
}

/**
 * The JSON to validate, from the file if there is one and the textarea otherwise.
 *
 * The file wins when both are given rather than refusing the submission: a leftover
 * paste with a freshly chosen file is far more likely to be "use the file" than a mistake
 * worth an error message, and the hint on the form says which one is read.
 */
async function readSource(form: FormData): Promise<PersonaSource> {
  const file = form.get("personaFile");

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_PERSONA_FILE_BYTES) {
      throw new PersonaFileUnreadableError(
        "personaFile",
        `That file is larger than ${Math.floor(MAX_PERSONA_FILE_BYTES / 1024)} KB, so it is not a persona export. Choose the file you downloaded from a persona's page.`,
      );
    }

    return {
      field: "personaFile",
      json: parseJson(await file.text(), "personaFile"),
    };
  }

  const pasted = form.get("pastedJson");
  const text = typeof pasted === "string" ? pasted.trim() : "";

  if (text.length === 0) {
    throw new PersonaFileUnreadableError(
      "personaFile",
      "Choose a persona file, or paste its contents into the box below.",
    );
  }

  if (text.length > MAX_PERSONA_FILE_BYTES) {
    throw new PersonaFileUnreadableError(
      "pastedJson",
      `That is longer than ${Math.floor(MAX_PERSONA_FILE_BYTES / 1024)} KB, so it is not a persona export.`,
    );
  }

  return { field: "pastedJson", json: parseJson(text, "pastedJson") };
}

function parseJson(text: string, field: "personaFile" | "pastedJson"): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PersonaFileUnreadableError(
      field,
      "That is not readable JSON. A persona export is a single JSON object; check the whole file was copied, and that you chose the right file.",
    );
  }
}
