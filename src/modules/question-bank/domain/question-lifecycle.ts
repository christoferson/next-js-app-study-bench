import {
  InvalidLifecycleTransitionError,
  InvalidQualityTransitionError,
} from "./errors";
import type {
  Question,
  QuestionLifecycleStatus,
  QuestionQualityStatus,
} from "./question";

/**
 * Lifecycle and quality transition rules.
 *
 * Lifecycle and quality are independent dimensions
 * (`spec/DOMAIN-RULES.md` section 1.2): activating a question never changes its
 * review state, and approving or disputing one never changes whether it is in
 * the study pool. Each transition below therefore touches exactly one dimension.
 *
 * Editing is not a transition at all. A new revision may be appended in any
 * lifecycle state, including `RETIRED` and while `DISPUTED`, and leaves both
 * statuses untouched: correcting the text of a disputed question is the normal
 * way to prepare for resolving the dispute, and fixing a retired question is how
 * it becomes restorable. Existing revisions are never rewritten, so history stays
 * honest either way.
 */

/** Lifecycle moves the D3 interface offers, keyed by the current status. */
const ALLOWED_LIFECYCLE_TRANSITIONS: Readonly<
  Record<QuestionLifecycleStatus, readonly QuestionLifecycleStatus[]>
> = {
  // Activate a draft once it is answerable.
  DRAFT: ["ACTIVE"],
  // Retire an active question that is wrong or out of date.
  ACTIVE: ["RETIRED"],
  // Restore a retired question to the study pool.
  RETIRED: ["ACTIVE"],
  // `ARCHIVED` is terminal in the model and unreachable in D3: nothing yet makes
  // a question undeletable, so retirement plus deletion covers every D3 need.
  ARCHIVED: [],
};

export function canTransitionLifecycle(
  from: QuestionLifecycleStatus,
  to: QuestionLifecycleStatus,
): boolean {
  return ALLOWED_LIFECYCLE_TRANSITIONS[from].includes(to);
}

export function assertLifecycleTransition(
  from: QuestionLifecycleStatus,
  to: QuestionLifecycleStatus,
): void {
  if (!canTransitionLifecycle(from, to)) {
    throw new InvalidLifecycleTransitionError(from, to);
  }
}

/**
 * Quality states a dispute may be raised from.
 *
 * A draft is included deliberately: the owner may notice a problem in a question
 * they are still writing and want that doubt recorded before activating it, and
 * a dispute is a note about content rather than about availability. What a
 * dispute must not do is silently pull a question out of study — that is the
 * lifecycle's job, and `DISPUTED` questions are excluded from session selection
 * by `spec/DOMAIN-RULES.md` section 2.2 without any lifecycle change.
 */
export function canDispute(question: Question): boolean {
  return question.qualityStatus !== "DISPUTED";
}

export function assertCanDispute(question: Question): void {
  if (!canDispute(question)) {
    throw new InvalidQualityTransitionError(question.qualityStatus, "DISPUTED");
  }
}

/** Quality states a dispute can be resolved into. */
export const DISPUTE_RESOLUTIONS: readonly QuestionQualityStatus[] = [
  "UNREVIEWED",
  "USER_APPROVED",
];

export function isDisputeResolution(
  status: QuestionQualityStatus,
): status is "UNREVIEWED" | "USER_APPROVED" {
  return DISPUTE_RESOLUTIONS.includes(status);
}

export function assertCanResolveDispute(
  question: Question,
  resolution: QuestionQualityStatus,
): void {
  if (question.qualityStatus !== "DISPUTED") {
    throw new InvalidQualityTransitionError(question.qualityStatus, resolution);
  }

  if (!isDisputeResolution(resolution)) {
    throw new InvalidQualityTransitionError("DISPUTED", resolution);
  }
}

/**
 * Approval outside a dispute.
 *
 * A disputed question must be resolved rather than approved directly, so the
 * recorded reason is never dropped without the owner deciding what to do with it.
 */
export function assertCanApprove(question: Question): void {
  if (question.qualityStatus === "DISPUTED") {
    throw new InvalidQualityTransitionError("DISPUTED", "USER_APPROVED");
  }
}

/** Whether a question is available for study selection. */
export function isStudyEligible(question: Question): boolean {
  return (
    question.lifecycleStatus === "ACTIVE" &&
    question.qualityStatus !== "DISPUTED"
  );
}
