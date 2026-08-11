import type {
  QuestionLifecycleStatus,
  QuestionQualityStatus,
  QuestionType,
} from "@/modules/question-bank/domain/question";
import {
  describeLifecycleStatus,
  describeQualityStatus,
  describeQuestionType,
} from "@/modules/question-bank/domain/question";

/**
 * Status badges for a question.
 *
 * Lifecycle and quality are shown as two separate badges because they are two
 * independent dimensions (`spec/DOMAIN-RULES.md` section 1.2) — a retired
 * question can be approved, and an active one can be disputed. Each badge carries
 * its own word, so the state is never communicated by colour alone
 * (`spec/UI-GUIDELINES.md`).
 */

export function LifecycleBadge({
  status,
}: {
  readonly status: QuestionLifecycleStatus;
}) {
  return (
    <span className="badge">Status: {describeLifecycleStatus(status)}</span>
  );
}

export function QualityBadge({
  status,
}: {
  readonly status: QuestionQualityStatus;
}) {
  return (
    <span className={status === "DISPUTED" ? "badge badge-alert" : "badge"}>
      Review: {describeQualityStatus(status)}
    </span>
  );
}

export function QuestionTypeBadge({ type }: { readonly type: QuestionType }) {
  return <span className="badge">{describeQuestionType(type)}</span>;
}
