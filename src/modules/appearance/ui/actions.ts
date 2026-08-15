"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { isDomainError } from "@/shared/domain-error";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE, toInvalidFormState } from "@/shared/ui/form-state";
import { textSizeFormSchema } from "@/modules/appearance/application/schemas";
import {
  TEXT_SIZE_COOKIE_NAME,
  TEXT_SIZE_COOKIE_OPTIONS,
} from "@/modules/appearance/infrastructure/text-size-cookie";

/**
 * Server Action for the appearance setting.
 *
 * There is no facade and no repository, because there is nothing to coordinate: the
 * preference is one word, it lives in the request's own cookie jar, and the only rules
 * about it — which values exist, what an unknown one means — are in the domain. Adding a
 * facade over `cookies().set` would be a layer that forwards one call
 * (`spec/ARCHITECTURE.md` section 5.2 asks for facades per capability, not per write).
 *
 * The action still does the two things every other action here does: it parses the
 * submission with the authoritative schema rather than trusting the rendered form, and
 * it maps a refusal back to a field message instead of throwing at the owner.
 *
 * **Why the whole layout is revalidated.** The size lives on the `<html>` element, which
 * the root layout renders, so every cached page in this application was rendered with
 * the previous value. Revalidating `/` with `"layout"` invalidates that whole tree in
 * one call — without it the appearance page would come back at the new size while a
 * cached page the owner navigated to next would still be at the old one.
 */
export async function saveTextSizeAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    const input = parseInput(textSizeFormSchema, {
      textSize: readString(form, "textSize"),
    });

    const store = await cookies();

    store.set(TEXT_SIZE_COOKIE_NAME, String(input.textSize), {
      ...TEXT_SIZE_COOKIE_OPTIONS,
      // Follows the deployment rather than being hardcoded: a `secure` cookie is
      // dropped over plain HTTP, which would make the setting silently fail to save
      // during local development.
      secure: process.env.NODE_ENV === "production",
    });
  } catch (error) {
    if (isDomainError(error)) {
      return toInvalidFormState(error, form);
    }
    throw error;
  }

  revalidatePath("/", "layout");

  return IDLE_FORM_STATE;
}

/**
 * Server Action for the header stepper.
 *
 * A separate entry point from the form action because the two have genuinely different
 * shapes, not because the logic differs: the form posts a `FormData` and needs a
 * `FormState` back to render a message beside the field, while the stepper calls this with
 * a number and has nowhere to put a message — the header is not a form and has no error
 * area. A single action serving both would have to invent one of those two contracts for
 * the caller that does not want it.
 *
 * **It still validates.** The argument arrives from the client, so "it is typed `number`"
 * is a compile-time claim about this repository's own code and not a fact about the request
 * — a Server Action is a POST endpoint that anything can call with anything. The value goes
 * through the same schema the form uses, and a value the schema rejects writes nothing and
 * returns quietly: there is no field to attach a message to, and the header re-renders at
 * the stored size on the next navigation, which is the honest outcome. Nothing unvalidated
 * reaches the cookie.
 */
export async function setTextSizeAction(size: number): Promise<void> {
  try {
    const input = parseInput(textSizeFormSchema, { textSize: String(size) });

    const store = await cookies();

    store.set(TEXT_SIZE_COOKIE_NAME, String(input.textSize), {
      ...TEXT_SIZE_COOKIE_OPTIONS,
      secure: process.env.NODE_ENV === "production",
    });
  } catch (error) {
    if (isDomainError(error)) {
      return;
    }
    throw error;
  }

  revalidatePath("/", "layout");
}

function readString(form: FormData, field: string): string {
  const value = form.get(field);

  return typeof value === "string" ? value : "";
}
