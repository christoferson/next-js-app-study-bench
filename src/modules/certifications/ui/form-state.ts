/**
 * Form state for the certification module.
 *
 * The implementation moved to `@/shared/ui/form-state` in D3 so the
 * question-bank module reuses one `useActionState` contract. Re-exported here
 * because the certification forms and their tests import it from this path.
 */
export type { FormState } from "@/shared/ui/form-state";
export {
  IDLE_FORM_STATE,
  fieldErrors,
  formLevelErrors,
  toInvalidFormState,
} from "@/shared/ui/form-state";
