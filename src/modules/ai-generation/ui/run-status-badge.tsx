import type { GenerationRunStatus } from "@/modules/ai-generation/domain/generation-run";
import { describeRunStatus } from "@/modules/ai-generation/domain/generation-run";

/**
 * A run's outcome as a badge.
 *
 * Carries its own word, so the state is never communicated by colour alone
 * (`spec/UI-GUIDELINES.md` section 1.3). A failed run is marked with the alert
 * variant, since it is the one outcome the owner has to act on.
 */
export function RunStatusBadge({
  status,
}: {
  readonly status: GenerationRunStatus;
}) {
  return (
    <span className={status === "FAILED" ? "badge badge-alert" : "badge"}>
      {describeRunStatus(status)}
    </span>
  );
}
