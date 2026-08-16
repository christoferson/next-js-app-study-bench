import type { FormState } from "@/shared/ui/form-state";
import type { AnswerEvaluation } from "@/modules/ai-generation/domain/answer-evaluation";
import type { GenerationFailureCategory } from "@/modules/ai-generation/domain/generation-run";

/**
 * The grading action's result: a form state that also carries what came back.
 *
 * A wider state rather than the shared `FormState`, and it is the one place in this module
 * where an action returns model output instead of revalidating a page. The reason is that a
 * grading has no page to revalidate onto: it is about one attempt on one session's feedback
 * screen, the run row records it against the *question* rather than the attempt, and
 * revalidating the session would re-render the feedback with no way to find which run
 * belonged to which answer. So the panel that asked for it receives it.
 *
 * `failureCategory` is here for the same reason a failed run is a recorded outcome
 * everywhere else in this module: a provider outage is something the owner reads, not an
 * error screen. It is a category rather than a message, so nothing a provider said can reach
 * the interface (`spec/SECURITY.md`).
 *
 * Its own module rather than `actions.ts`, because that file is `"use server"` and may
 * export only async functions — a constant declared there would not compile.
 */
export interface AnswerGradingState extends FormState {
  readonly grading: AnswerEvaluation | null;
  readonly failureCategory: GenerationFailureCategory | null;
}

export const IDLE_GRADING_STATE: AnswerGradingState = {
  status: "idle",
  fieldErrors: {},
  values: {},
  grading: null,
  failureCategory: null,
};
