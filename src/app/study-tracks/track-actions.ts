"use server";

import { isDomainError } from "@/shared/domain-error";
import type { FormState } from "@/shared/ui/form-state";
import { toInvalidFormState } from "@/shared/ui/form-state";
import { STUDY_TYPES } from "@/modules/certifications/domain/certification";
import type { StudyType } from "@/modules/certifications/domain/certification";
import {
  createCertificationAction,
  updateCertificationAction,
} from "@/modules/certifications/ui/actions";
import { getPersonaFacade } from "@/modules/ai-generation/composition";

/**
 * Track save, with the persona assignment validated first.
 *
 * This file exists because of a dependency direction. A track stores which persona
 * generates its material, but the certifications module must not know that the
 * ai-generation module exists (`spec/ARCHITECTURE.md` section 7, pinned by a boundary
 * test): the arrow runs certifications ← ai-generation. So `certifications` holds the
 * identifier as opaque text and never resolves it, and the check that it names a real
 * persona of a suitable archetype happens here — at the composition layer, which is
 * allowed to know both modules and is the layer the pages already live in.
 *
 * Each action does one extra thing and then delegates: resolve the submitted persona
 * choice through `PersonaFacade`, write the result back onto the form, and hand the form
 * to the certifications action unchanged in every other respect. Slug allocation,
 * validation, revalidation, and the redirect all stay where they were.
 */

function readString(form: FormData, field: string): string {
  const value = form.get(field);

  return typeof value === "string" ? value : "";
}

/**
 * The submitted study type, when it is one.
 *
 * `null` for anything else, and the persona check is then skipped: the study type
 * decides which personas are allowed, so an unusable one has nothing to check against
 * and the delegate is about to reject the submission for that field anyway.
 */
function readStudyType(form: FormData): StudyType | null {
  const submitted = readString(form, "studyType");

  return STUDY_TYPES.find((candidate) => candidate === submitted) ?? null;
}

/**
 * Replaces `personaId` with the identifier the track may store.
 *
 * Returns an invalid form state when the choice is refused — an unknown persona, or one
 * for a different kind of study — so the message lands on the select rather than
 * becoming a foreign-key error from the database.
 */
async function resolvePersonaField(form: FormData): Promise<FormState | null> {
  const studyType = readStudyType(form);

  if (studyType === null) {
    return null;
  }

  const submitted = readString(form, "personaId").trim();

  try {
    const resolved = await getPersonaFacade().resolveAssignment(
      submitted.length === 0 ? null : submitted,
      studyType,
    );

    form.set("personaId", resolved ?? "");
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  return null;
}

export async function createStudyTrackAction(
  state: FormState,
  form: FormData,
): Promise<FormState> {
  return (
    (await resolvePersonaField(form)) ??
    (await createCertificationAction(state, form))
  );
}

export async function updateStudyTrackAction(
  state: FormState,
  form: FormData,
): Promise<FormState> {
  return (
    (await resolvePersonaField(form)) ??
    (await updateCertificationAction(state, form))
  );
}
