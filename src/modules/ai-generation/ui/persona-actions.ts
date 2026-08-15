"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDomainError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE, toInvalidFormState } from "@/shared/ui/form-state";
import { getPersonaFacade } from "@/modules/ai-generation/composition";
import {
  createPersonaSchema,
  personaIdSchema,
  updatePersonaSchema,
} from "@/modules/ai-generation/application/persona-schemas";
import type { PersonaDraft } from "@/modules/ai-generation/domain/stored-persona";

/**
 * Server Actions for persona management.
 *
 * Each action reads the form, parses it with the authoritative schema, calls the
 * facade, and maps a domain error back to field messages. Nothing here decides how a
 * key is derived, what a version bump means, or which template a persona came from —
 * those are the facade's, so they hold for the seed script and for a future import as
 * well as for this form.
 *
 * No model is called by any of them. Managing a persona is free; generating with one
 * is not, and the two stay separate flows.
 */

const PERSONAS_PATH = "/settings/personas";

function readString(form: FormData, field: string): string {
  const value = form.get(field);

  return typeof value === "string" ? value : "";
}

/** Every submitted value for one checkbox group. */
function readStrings(form: FormData, field: string): readonly string[] {
  return form
    .getAll(field)
    .filter((value): value is string => typeof value === "string");
}

function readDraft(form: FormData): Record<string, unknown> {
  return {
    label: readString(form, "label"),
    role: readString(form, "role"),
    guidance: readString(form, "guidance"),
    cardGuidance: readString(form, "cardGuidance"),
    prohibitions: readString(form, "prohibitions"),
    defaultQuestionTypes: readStrings(form, "defaultQuestionTypes"),
    defaultCardTypes: readStrings(form, "defaultCardTypes"),
    languageInstruction: readString(form, "languageInstruction"),
    contentLanguage: readString(form, "contentLanguage"),
  };
}

/** The parsed draft, as the facade takes it. */
function toDraft(parsed: {
  readonly label: string;
  readonly role: string;
  readonly guidance: readonly string[];
  readonly cardGuidance: readonly string[];
  readonly prohibitions: readonly string[];
  readonly defaultQuestionTypes: PersonaDraft["defaultQuestionTypes"];
  readonly defaultCardTypes: PersonaDraft["defaultCardTypes"];
  readonly languageInstruction: string;
  readonly contentLanguage: string | null;
}): PersonaDraft {
  return {
    label: parsed.label,
    role: parsed.role,
    guidance: parsed.guidance,
    cardGuidance: parsed.cardGuidance,
    prohibitions: parsed.prohibitions,
    defaultQuestionTypes: parsed.defaultQuestionTypes,
    defaultCardTypes: parsed.defaultCardTypes,
    languageInstruction: parsed.languageInstruction,
    contentLanguage: parsed.contentLanguage,
  };
}

/**
 * Creates a persona from the template the owner chose, as they edited it.
 *
 * Redirects to the list rather than staying on the form: the list is where a persona is
 * used from, and there is nothing further to do to a new one.
 */
export async function createPersonaAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    const input = parseInput(createPersonaSchema, {
      ...readDraft(form),
      templateKey: readString(form, "templateKey"),
    });

    await getPersonaFacade().createFromTemplate(
      input.templateKey,
      toDraft(input),
    );
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidatePath(PERSONAS_PATH);
  redirect(PERSONAS_PATH);
}

/** Saves an edited persona as its next version. */
export async function updatePersonaAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    const input = parseInput(updatePersonaSchema, {
      ...readDraft(form),
      personaId: readString(form, "personaId"),
    });

    await getPersonaFacade().updatePersona(input.personaId, toDraft(input));
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidatePath(PERSONAS_PATH);
  redirect(PERSONAS_PATH);
}

/**
 * Deletes a persona.
 *
 * No confirmation step, and no cascade either: the facade refuses while a study track is
 * assigned the persona and names the tracks, so the outcome of pressing delete is either
 * "gone" or a sentence saying which track to change first. Recorded runs are not a
 * reason to refuse — they store the persona's key and version as text, so a run stays
 * readable after its persona is deleted.
 */
export async function deletePersonaAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    const input = parseInput(personaIdSchema, {
      personaId: readString(form, "personaId"),
    });

    await getPersonaFacade().deletePersona(input.personaId);
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidatePath(PERSONAS_PATH);

  return IDLE_FORM_STATE;
}
