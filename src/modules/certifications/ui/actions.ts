"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCertificationFacade } from "@/modules/certifications/composition";
import {
  certificationInputSchema,
  moveDirectionSchema,
  objectiveInputSchema,
  parseInput,
} from "@/modules/certifications/application/schemas";
import { isDomainError } from "@/modules/certifications/domain/errors";
import type { FormState } from "./form-state";
import { toInvalidFormState } from "./form-state";

/**
 * Server Actions for certification and objective management.
 *
 * Each action stays thin: read the form, parse it with the authoritative schema,
 * call the facade, map a domain error to field messages, then revalidate or
 * redirect. Business rules — slug allocation, hierarchy validity, cycle
 * detection, sibling ordering — belong to the domain and the facade.
 */

const TRACKS_PATH = "/";

function trackPath(slug: string): string {
  return `/study-tracks/${slug}`;
}

function readString(form: FormData, field: string): string {
  const value = form.get(field);

  return typeof value === "string" ? value : "";
}

function readCertificationInput(form: FormData): unknown {
  return {
    name: readString(form, "name"),
    provider: readString(form, "provider"),
    examCode: readString(form, "examCode"),
    version: readString(form, "version"),
    studyType: readString(form, "studyType"),
    description: readString(form, "description"),
    targetDate: readString(form, "targetDate"),
    priority: readString(form, "priority"),
    defaultSessionMinutes: readString(form, "defaultSessionMinutes"),
  };
}

function readObjectiveInput(form: FormData): unknown {
  return {
    parentObjectiveId: readString(form, "parentObjectiveId"),
    code: readString(form, "code"),
    title: readString(form, "title"),
    description: readString(form, "description"),
    weight: readString(form, "weight"),
    sourceType: readString(form, "sourceType"),
  };
}

export async function createCertificationAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  let slug: string;

  try {
    const input = parseInput(
      certificationInputSchema,
      readCertificationInput(form),
    );
    const created = await getCertificationFacade().createCertification(input);
    slug = created.slug;
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidatePath(TRACKS_PATH);
  redirect(trackPath(slug));
}

export async function updateCertificationAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const certificationId = readString(form, "certificationId");
  let slug: string;

  try {
    const input = parseInput(
      certificationInputSchema,
      readCertificationInput(form),
    );
    const updated = await getCertificationFacade().updateCertification(
      certificationId,
      input,
    );
    slug = updated.slug;
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidatePath(TRACKS_PATH);
  revalidatePath(trackPath(slug));
  redirect(trackPath(slug));
}

export async function archiveCertificationAction(
  form: FormData,
): Promise<void> {
  const certification = await getCertificationFacade().archiveCertification(
    readString(form, "certificationId"),
  );

  revalidatePath(TRACKS_PATH);
  revalidatePath(trackPath(certification.slug));
}

export async function restoreCertificationAction(
  form: FormData,
): Promise<void> {
  const certification = await getCertificationFacade().restoreCertification(
    readString(form, "certificationId"),
  );

  revalidatePath(TRACKS_PATH);
  revalidatePath(trackPath(certification.slug));
}

export async function createObjectiveAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const certificationId = readString(form, "certificationId");
  const slug = readString(form, "slug");

  try {
    const input = parseInput(objectiveInputSchema, readObjectiveInput(form));
    await getCertificationFacade().addObjective(certificationId, input);
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidatePath(trackPath(slug));
  redirect(trackPath(slug));
}

export async function updateObjectiveAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const objectiveId = readString(form, "objectiveId");
  const slug = readString(form, "slug");

  try {
    const input = parseInput(objectiveInputSchema, readObjectiveInput(form));
    await getCertificationFacade().updateObjective(objectiveId, input);
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidatePath(trackPath(slug));
  redirect(trackPath(slug));
}

export async function moveObjectiveAction(form: FormData): Promise<void> {
  const direction = parseInput(
    moveDirectionSchema,
    readString(form, "direction"),
  );

  await getCertificationFacade().moveObjective(
    readString(form, "objectiveId"),
    direction,
  );

  revalidatePath(trackPath(readString(form, "slug")));
}

export async function archiveObjectiveAction(form: FormData): Promise<void> {
  await getCertificationFacade().archiveObjective(
    readString(form, "objectiveId"),
  );

  revalidatePath(trackPath(readString(form, "slug")));
}

export async function restoreObjectiveAction(form: FormData): Promise<void> {
  await getCertificationFacade().restoreObjective(
    readString(form, "objectiveId"),
  );

  revalidatePath(trackPath(readString(form, "slug")));
}
