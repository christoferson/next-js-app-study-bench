import type { DomainError } from "@/modules/certifications/domain/errors";

/**
 * Shared shape for `useActionState` form results.
 *
 * `fieldErrors` is keyed by input `name`, and the empty-string key holds
 * form-level messages. Submitted values are echoed back so a rejected form can
 * be re-rendered without the owner retyping it.
 */
export interface FormState {
  readonly status: "idle" | "invalid";
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
  readonly values: Readonly<Record<string, string>>;
}

export const IDLE_FORM_STATE: FormState = {
  status: "idle",
  fieldErrors: {},
  values: {},
};

export function toInvalidFormState(
  error: DomainError,
  submitted: FormData,
): FormState {
  return {
    status: "invalid",
    fieldErrors: error.fieldMessages(),
    values: collectValues(submitted),
  };
}

function collectValues(submitted: FormData): Record<string, string> {
  const values: Record<string, string> = {};

  for (const [key, value] of submitted.entries()) {
    if (typeof value === "string") {
      values[key] = value;
    }
  }

  return values;
}

/** Field errors for one input, or `undefined` when the field is valid. */
export function fieldErrors(
  state: FormState,
  field: string,
): readonly string[] | undefined {
  const messages = state.fieldErrors[field];

  return messages !== undefined && messages.length > 0 ? messages : undefined;
}

export function formLevelErrors(state: FormState): readonly string[] {
  return state.fieldErrors[""] ?? [];
}
