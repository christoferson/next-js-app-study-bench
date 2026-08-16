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
  revisesExistingItems,
} from "@/modules/ai-generation/domain/generation-run";
import type { GeneratedItemKind } from "@/modules/ai-generation/domain/generation-run";
import type {
  GeneratedItemReview,
  GenerationRunDetailView,
} from "@/modules/ai-generation/application/generation-facade";
import { rejectDraftAction } from "./actions";
import { FakeProviderNotice } from "./fake-provider-notice";
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
  const revises = revisesExistingItems(run.itemKind);
  // A review and a tutor answer both produced no items at all, so the accept/reject half
  // of this screen has nothing to show for either. What they did produce — findings, an
  // explanation — belongs on the question, which is where it is read and where the actions
  // it argues for live. This screen keeps the provenance block, which is the part that is
  // the same for every model call.
  const subject = subjectRunKind(run.itemKind);

  return (
    <>
      <header className="page-header">
        <p className="eyebrow">{certification.name}</p>
        <div className="card-heading">
          <h1>
            {subject === null
              ? `${describeItemKind(run.itemKind)} from AI`
              : describeItemKind(run.itemKind)}
          </h1>
          <RunStatusBadge status={run.status} />
          <span className="badge">
            {subject === null
              ? "AI generated — model knowledge"
              : subject.provenance}
          </span>
        </div>
        <p className="lede">
          {subject !== null
            ? subject.lede
            : revises
              ? "Written from the model's own knowledge, with no source consulted and nothing verified. Each card below kept everything it already said and gained a new revision with the extra detail, so its previous text is still on its page."
              : "Written from the model's own knowledge, with no source consulted and nothing verified. Read each one before you activate it — none of it is official exam material."}
        </p>

        {run.failureReason === null ? null : (
          <p className="empty-state" role="status">
            {describeFailureCategory(run.failureReason)}
          </p>
        )}

        {/* The run's own recorded provider, not the current configuration: this run
            was written by whatever was wired in at the time, and switching to Bedrock
            later does not make these drafts real. */}
        <FakeProviderNotice provider={run.modelProvider} subject="past" />

        <dl className="meta">
          {subject !== null ? (
            <div className="meta-item">
              <dt>{subject.term}</dt>
              <dd>
                {run.subjectQuestionId === null ? (
                  // `ON DELETE SET NULL`: the question is gone, and the run stays because
                  // it records a model call that really happened.
                  "A question that has since been deleted"
                ) : (
                  <Link
                    href={`/study-tracks/${slug}/questions/${run.subjectQuestionId}${subject.anchor}`}
                  >
                    {subject.link}
                  </Link>
                )}
              </dd>
            </div>
          ) : (
            <>
              <div className="meta-item">
                <dt>Requested</dt>
                <dd>
                  {run.requestedItemCount}{" "}
                  {describeItemKindSingular(run.itemKind)}
                  {run.requestedItemCount === 1 ? "" : "s"}
                </dd>
              </div>
              <div className="meta-item">
                <dt>{revises ? "Enriched" : "Written"}</dt>
                <dd>{run.successfulItemCount}</dd>
              </div>
              <div className="meta-item">
                <dt>{revises ? "Left unchanged" : "Rejected by checks"}</dt>
                <dd>{run.failedItemCount}</dd>
              </div>
              <div className="meta-item">
                <dt>Still in the bank</dt>
                <dd>
                  {counts.total} ({counts.draft} draft, {counts.active} active)
                </dd>
              </div>
            </>
          )}
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
          {subject !== null ? null : (
            <Link
              className="button-quiet"
              href={
                revises
                  ? `/study-tracks/${slug}/enrich`
                  : `/study-tracks/${slug}/generate`
              }
            >
              {revises ? "Enrich more" : "Generate again"}
            </Link>
          )}
        </div>
      </header>

      {subject !== null ? (
        <section aria-labelledby="items-heading" className="section">
          <div className="section-heading">
            <h2 id="items-heading">{subject.itemsHeading}</h2>
            <p className="section-note">{subject.itemsNote}</p>
          </div>
        </section>
      ) : (
        <section aria-labelledby="items-heading" className="section">
          <div className="section-heading">
            <h2 id="items-heading">
              {revises ? "The cards it enriched" : "What the model wrote"}
            </h2>
            <p className="section-note">
              {revises
                ? "These cards were already yours, so they keep the lifecycle they had and there is nothing here to accept or reject. Open one to read the new detail, compare it with the revision before it, or edit it."
                : "Each one is saved as a draft, so nothing here can appear in a study session until you activate it. Open an item to edit or activate it; reject it to delete it."}
            </p>
          </div>

          {items.length === 0 ? (
            <p className="empty-state">
              {run.successfulItemCount === 0
                ? revises
                  ? "This run enriched nothing."
                  : "This run saved nothing."
                : revises
                  ? "Every card this run enriched has since been deleted."
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
      )}
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
        <span className="badge">{statusBadge(item)}</span>
        {item.changedSinceGeneration ? (
          <span className="badge">
            {item.kind === "ENRICH_VOCABULARY"
              ? "Edited since enrichment"
              : "Changed since generation"}
          </span>
        ) : null}
      </div>

      <h3 className="card-title">
        <Link href={href}>{title(item)}</Link>
      </h3>

      {item.changedSinceGeneration ? (
        <p className="card-text">
          {item.kind === "ENRICH_VOCABULARY"
            ? "This card has a newer revision than the one this run wrote, so what is shown below is that newer version. Its page has the full history."
            : "You have edited or activated this since it was generated, so what is shown below is your version, not the model's first draft. The revision history on its page has the original."}
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
          {item.kind === "ENRICH_VOCABULARY"
            ? "Open the card"
            : "Open to edit or activate"}
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
            {item.kind === "ENRICH_VOCABULARY"
              ? "This card was already yours before the run, so enrichment has nothing to take back. Its previous text is in its revision history."
              : "This is no longer a draft, so generation will not delete it. Retire or delete it from its own page."}
          </p>
        )}
      </div>
    </li>
  );
}

/** The lifecycle line for one row, in the terms its kind makes sense in. */
function statusBadge(item: GeneratedItemReview): string {
  switch (item.kind) {
    case "QUESTION":
      return `Status: ${item.item.question.lifecycleStatus === "DRAFT" ? "Draft" : "Not a draft any more"}`;
    case "FLASHCARD":
      return `Status: ${item.item.flashcard.lifecycleStatus === "DRAFT" ? "Draft" : "Not a draft any more"}`;
    // An enriched card was never a draft of this run, so "draft or not" is the
    // wrong question about it. What matters is the revision the run wrote.
    case "ENRICH_VOCABULARY":
      return `Revision ${item.item.revision.revisionNumber}`;
  }
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

/**
 * How a run that is *about* one question describes itself, or `null` for one that produced
 * bank items.
 *
 * The same shape as the run list's own version and for the same reason: the two subject
 * kinds share this whole screen and differ only in wording, and an exhaustive switch means a
 * third kind of run about a question has to say what it is rather than being described as
 * generated content until somebody notices.
 *
 * Every `lede` here states that nothing was looked up, because this page is where a model
 * call is inspected months later and the claim has to survive that long
 * (`spec/AI-GUIDELINES.md` section 1.2).
 */
function subjectRunKind(kind: GeneratedItemKind): {
  readonly provenance: string;
  readonly lede: string;
  readonly term: string;
  readonly link: string;
  readonly anchor: string;
  readonly itemsHeading: string;
  readonly itemsNote: string;
} | null {
  switch (kind) {
    case "QUESTION_REVIEW":
      return {
        provenance: "Judged from model knowledge",
        lede: "Judged from the model's own knowledge, with no source consulted and nothing verified. The review changed nothing about the question except, where it found nothing wrong, recording that it has been AI-reviewed.",
        term: "Reviewed",
        link: "One question — read the findings on it",
        anchor: "",
        itemsHeading: "What it judged",
        itemsNote:
          "A review writes nothing into the bank, so there is nothing here to accept or reject. Its verdict and findings are on the question it was about.",
      };
    case "TUTOR_EXPLANATION":
      return {
        provenance: "Explained from model knowledge",
        lede: "Answered from the model's own knowledge, with no source consulted, nothing verified, and nothing cited. The tutor changed nothing at all: it explained the question as it was stored, and any follow-up question it wrote was for reading rather than for keeping.",
        term: "Explained",
        link: "One question — read the answer on it",
        anchor: "#tutor",
        itemsHeading: "What it explained",
        itemsNote:
          "A tutor answer writes nothing into the bank — not even a follow-up question it wrote — so there is nothing here to accept or reject. The answer itself is on the question it was about.",
      };
    case "ANSWER_EVALUATION":
      return {
        provenance: "Marked from model knowledge",
        lede: "Marked from the model's own knowledge, against the concepts the question itself records, with no source consulted and nothing verified. It changed nothing: the attempt keeps the verdict you recorded yourself, and this run is what the model thought of it.",
        term: "Marked",
        link: "One question — open it",
        anchor: "",
        itemsHeading: "What it marked",
        itemsNote:
          "A grading writes nothing — not into the bank, and deliberately not onto the attempt either. It was advice on the feedback screen of one session.",
      };
    case "QUESTION_CHALLENGE":
      return {
        provenance: "Adjudicated from model knowledge",
        lede: "Judged from the model's own knowledge, with no source consulted, nothing verified, and nothing cited. It weighed one objection you raised against the answer as stored, and changed nothing: disputing the question or writing a new revision is your own action.",
        term: "Challenged",
        link: "One question — read the outcome on it",
        anchor: "#challenge",
        itemsHeading: "What it judged",
        itemsNote:
          "A challenge writes nothing into the bank, including any revision it suggested — that note is for you to act on. Its verdict is on the question it was about.",
      };
    case "QUESTION":
    case "FLASHCARD":
    case "ENRICH_VOCABULARY":
    case "OBJECTIVE_IMPORT":
      return null;
  }
}
