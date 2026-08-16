import Link from "next/link";
import type {
  GenerationMode,
  QuestionLifecycleStatus,
  QuestionQualityStatus,
  QuestionType,
} from "@/modules/question-bank/domain/question";
import {
  describeGenerationMode,
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

interface ProvenanceBadgeProps {
  readonly slug: string;
  readonly generationMode: GenerationMode;
  readonly generationRunId: string | null;
  /**
   * Renders the mode even when the owner wrote the item.
   *
   * Set on a detail page, where every field of one item is on show, and left unset in
   * a bank list, where a "Manual" badge on every hand-written row is noise.
   */
  readonly alwaysShow?: boolean;
}

/**
 * Provenance for one item, where there is provenance to show.
 *
 * Renders nothing for content the owner wrote: a "Manual" badge on every hand-written
 * item is noise, and the point of this badge is to make model-written content stand
 * out from it (`spec/AI-GUIDELINES.md` section 1.9).
 *
 * The wording is deliberate. It says the *model's own knowledge* wrote the item,
 * because that is the strongest claim `MODEL_KNOWLEDGE` supports — no source was
 * consulted and nothing was verified. It never says official, exam, or real, since
 * StudyBench does not publish official exam material (`SPEC.md` section 3).
 *
 * The badge is a link when the run is still known, so provenance is inspectable
 * rather than a label: the run page names the model, the persona, and the prompt
 * template that produced the item. The href is built from the slug rather than
 * imported from the generation module, because both banks are read by that module and
 * importing back would make the dependency circular.
 *
 * It lives here, next to the question bank's other badges, rather than in the
 * generation module, for the same reason: `generationMode` and `generationRunId` are
 * fields of the bank aggregates, and the flashcard module already reuses this
 * module's `GenerationMode`.
 */
export function ProvenanceBadge({
  slug,
  generationMode,
  generationRunId,
  alwaysShow = false,
}: ProvenanceBadgeProps) {
  const label = modelWrittenLabel(generationMode);

  if (label === null) {
    return alwaysShow ? (
      <span className="badge">{describeGenerationMode(generationMode)}</span>
    ) : null;
  }

  if (generationRunId === null) {
    return <span className="badge">{label}</span>;
  }

  return (
    <Link
      className="badge"
      href={`/study-tracks/${slug}/generation-runs/${generationRunId}`}
    >
      {label}
    </Link>
  );
}

/**
 * What a model-written item says about itself, or `null` when a model did not write it.
 *
 * Three modes are model-written, and they make three *different* claims — which is the
 * reason this is a function rather than one label with the mode appended:
 *
 * - `MODEL_KNOWLEDGE` — nothing was consulted, so the badge says so.
 * - `SOURCE_GROUNDED` — written from passages of the owner's own imported documents,
 *   which the question's evidence section quotes. It says *your sources*, never
 *   "verified" and never "official": a source the owner imported is only as good as the
 *   document it came from, and StudyBench publishes no exam material (`SPEC.md`
 *   section 3).
 * - `HYBRID` — part grounded, part not, and the badge has to say the second half or it
 *   would let the grounded half vouch for the ungrounded one.
 *
 * The remaining modes fall through to `null` and are rendered as a plain mode name on a
 * detail page. `MANUAL` is the owner's own writing; the other three are set by
 * milestones that do not exist yet, and inventing a claim for them now would be a claim
 * nothing has earned.
 */
function modelWrittenLabel(mode: GenerationMode): string | null {
  switch (mode) {
    case "MODEL_KNOWLEDGE":
      return "AI generated — model knowledge";
    case "SOURCE_GROUNDED":
      return "AI generated — from your sources";
    case "HYBRID":
      return "AI generated — hybrid, part from your sources";
    case "MANUAL":
    case "IMPORTED":
    case "VARIANT":
    case "WEB_RESEARCH":
      return null;
  }
}
