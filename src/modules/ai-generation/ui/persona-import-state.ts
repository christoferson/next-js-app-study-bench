import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE } from "@/shared/ui/form-state";
import type { ImportedPersona } from "@/modules/ai-generation/domain/persona-export";

/**
 * The import form's state, in its own module.
 *
 * Separate from the action rather than beside it because a `"use server"` file may export
 * only async functions — a constant there is a build failure, not a lint preference. So
 * the shape and the initial value live here, and `persona-import-actions.ts` holds nothing
 * but the action.
 *
 * The draft rides in the action's result rather than in a redirect or a session: it is too
 * large for a query string, and there is nothing to store it in — the review form is on
 * the same page, prefilled from what came back.
 */
export interface PersonaImportState extends FormState {
  /** The draft an accepted file produced, or `null` before and after a failure. */
  readonly imported: ImportedPersona | null;
}

export const IDLE_PERSONA_IMPORT_STATE: PersonaImportState = {
  ...IDLE_FORM_STATE,
  imported: null,
};
