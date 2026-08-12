import Link from "next/link";
import { stemExcerpt } from "@/modules/question-bank/domain/question";
import { textExcerpt } from "@/modules/flashcards/domain/flashcard";
import { cardSummary } from "@/modules/flashcards/domain/flashcard-content";
import { QuestionPreview } from "@/modules/question-bank/ui/question-preview";
import { CardFace } from "@/modules/flashcards/ui/card-face";
import {
  describeFailureCategory,
  describeItemKind,
  describeItemKindSingular,
} from "@/modules/ai-generation/domain/generation-run";
import type {
  GeneratedItemReview,
  GenerationRunDetailView,
} from "@/modules/ai-generation/application/generation-facade";
import { rejectDraftAction } from "./actions";
import { RejectDraftForm } from "./reject-draft-form";
import { RunStatusBadge } from "./run-status-badge";

interface GenerationRunReviewProps {
  readonly view: GenerationRunDetailView;
}

/**
 * One run: what produced it, and what it produced.
 *
 * This is the accept/reject screen (`SPEC.md` section 24.2). *Reject* is here because
 * it is generation's own decision — throwing away something the model wrote, before it
 * became content. *Accept* is not: accepting is activating, which lives on the item's
 * own page with the rest of its lifecycle, so the row links there instead of offering
 * a second, competing path to the same transition.
 *
 * Every preview reuses the bank's own component, so what the owner reviews is what
 * study will show rather than a second rendering that can drift from it.
 *
 * The provenance block is deliberately complete — model, persona and version, prompt
 * template and version, token usage — because that is what makes a generated item
 * inspectable months later (`spec/AI-GUIDELINES.md` section 1.9), and because the
 * persona and template versions are the only record of *why* an old batch reads
 * differently from a new one.
 */
export function GenerationRunReview({ view }: GenerationRunReviewProps) {
  const { certification, run, counts, items, persona } = view;
  const slug = certification.slug;

  return (
    <>
      <header className="page-header">
        <p className="eyebrow">{certification.name}</p>
        <div className="card-heading">
          <h1>{describeItemKind(run.itemKind)} from AI</h1>
          <RunStatusBadge status={run.status} />
          <span className="badge">AI generated — model knowledge</span>
        </div>
        <p className="lede">
          Written from the model&apos;s own knowledge, with no source consulted
          and nothing verified. Read each one before you activate it — none of
          it is official exam material.
        </p>

        {run.failureReason === null ? null : (
          <p className="empty-state" role="status">
            {describeFailureCategory(run.failureReason)}
          </p>
        )}

        <dl className="meta">
          <div className="meta-item">
            <dt>Requested</dt>
            <dd>
              {run.requestedItemCount} {describeItemKindSingular(run.itemKind)}
              {run.requestedItemCount === 1 ? "" : "s"}
            </dd>
          </div>
          <div className="meta-item">
            <dt>Written</dt>
            <dd>{run.successfulItemCount}</dd>
          </div>
          <div className="meta-item">
            <dt>Rejected by checks</dt>
            <dd>{run.failedItemCount}</dd>
          </div>
          <div className="meta-item">
            <dt>Still in the bank</dt>
            <dd>
              {counts.total} ({counts.draft} draft, {counts.active} active)
            </dd>
          </div>
          <div className="meta-item">
            <dt>Model</dt>
            <dd>
              {run.modelId} via {run.modelProvider}
            </dd>
          </div>
          <div className="meta-item">
            <dt>Persona</dt>
            <dd>
              {persona === null ? run.personaId : persona.label} (
              {run.personaId} v{run.personaVersion})
            </dd>
          </div>
          <div className="meta-item">
            <dt>Prompt template</dt>
            <dd>
              {run.promptTemplateId} v{run.promptTemplateVersion}
            </dd>
          </div>
          <div className="meta-item">
            <dt>Tokens</dt>
            <dd>
              {run.usageMetadata === null
                ? "Not reported"
                : `${run.usageMetadata.inputTokens} in, ${run.usageMetadata.outputTokens} out, ${run.usageMetadata.totalTokens} total`}
            </dd>
          </div>
          <div className="meta-item">
            <dt>Started</dt>
            <dd>{run.startedAt.slice(0, 19).replace("T", " ")} UTC</dd>
          </div>
          <div className="meta-item">
            <dt>Finished</dt>
            <dd>
              {run.completedAt === null
                ? "Not finished"
                : `${run.completedAt.slice(0, 19).replace("T", " ")} UTC`}
            </dd>
          </div>
        </dl>

        <div className="section-actions">
          <Link
            className="button-quiet"
            href={`/study-tracks/${slug}/generation-runs`}
          >
            All runs
          </Link>
          <Link
            className="button-quiet"
            href={`/study-tracks/${slug}/generate`}
          >
            Generate again
          </Link>
        </div>
      </header>

      <section aria-labelledby="items-heading" className="section">
        <div className="section-heading">
          <h2 id="items-heading">What the model wrote</h2>
          <p className="section-note">
            Each one is saved as a draft, so nothing here can appear in a study
            session until you activate it. Open an item to edit or activate it;
            reject it to delete it.
          </p>
        </div>

        {items.length === 0 ? (
          <p className="empty-state">
            {run.successfulItemCount === 0
              ? "This run saved nothing."
              : "Everything this run produced has since been deleted."}
          </p>
        ) : (
          <ul className="card-list">
            {items.map((item) => (
              <ReviewRow
                item={item}
                key={itemId(item)}
                runId={run.id}
                slug={slug}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

interface ReviewRowProps {
  readonly slug: string;
  readonly runId: string;
  readonly item: GeneratedItemReview;
}

/**
 * One generated item, previewed as it will be studied.
 *
 * The answer sits behind a disclosure, as on the bank's detail pages: reviewing a
 * batch of questions should not spoil the ones the owner keeps.
 */
function ReviewRow({ slug, runId, item }: ReviewRowProps) {
  const id = itemId(item);
  const href =
    item.kind === "QUESTION"
      ? `/study-tracks/${slug}/questions/${id}`
      : `/study-tracks/${slug}/flashcards/${id}`;

  return (
    <li className="card">
      <div className="card-heading">
        <span className="badge">
          {item.kind === "QUESTION"
            ? `Status: ${item.item.question.lifecycleStatus === "DRAFT" ? "Draft" : "Not a draft any more"}`
            : `Status: ${item.item.flashcard.lifecycleStatus === "DRAFT" ? "Draft" : "Not a draft any more"}`}
        </span>
        {item.changedSinceGeneration ? (
          <span className="badge">Changed since generation</span>
        ) : null}
      </div>

      <h3 className="card-title">
        <Link href={href}>{title(item)}</Link>
      </h3>

      {item.changedSinceGeneration ? (
        <p className="card-text">
          You have edited or activated this since it was generated, so what is
          shown below is your version, not the model&apos;s first draft. The
          revision history on its page has the original.
        </p>
      ) : null}

      {item.kind === "QUESTION" ? (
        <>
          <QuestionPreview revision={item.item.revision} revealAnswer={false} />
          <details className="disclosure">
            <summary>Reveal the answer</summary>
            <QuestionPreview revision={item.item.revision} revealAnswer />
          </details>
        </>
      ) : (
        <>
          <CardFace content={item.item.revision.content} revealAnswer={false} />
          <details className="disclosure">
            <summary>Reveal the answer</summary>
            <CardFace content={item.item.revision.content} revealAnswer />
          </details>
        </>
      )}

      <div className="section-actions">
        <Link className="button-quiet" href={href}>
          Open to edit or activate
        </Link>
        {item.rejectable ? (
          <RejectDraftForm
            action={rejectDraftAction}
            itemId={id}
            label={title(item)}
            runId={runId}
            slug={slug}
          />
        ) : (
          <p className="field-hint">
            This is no longer a draft, so generation will not delete it. Retire
            or delete it from its own page.
          </p>
        )}
      </div>
    </li>
  );
}

function itemId(item: GeneratedItemReview): string {
  return item.kind === "QUESTION"
    ? item.item.question.id
    : item.item.flashcard.id;
}

function title(item: GeneratedItemReview): string {
  return item.kind === "QUESTION"
    ? stemExcerpt(item.item.revision.stem)
    : textExcerpt(cardSummary(item.item.revision.content));
}
