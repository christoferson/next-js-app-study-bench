import type { StudyContentOrigin } from "@/modules/study-catalog/domain/study-track";
import { describeContentOrigin } from "@/modules/study-catalog/domain/study-track";

interface DemoBadgeProps {
  readonly origin: StudyContentOrigin;
}

/**
 * Content-origin label. The status is carried by the visible text so that it is
 * not communicated by colour alone.
 */
export function DemoBadge({ origin }: DemoBadgeProps) {
  return <span className="badge">{describeContentOrigin(origin)}</span>;
}
