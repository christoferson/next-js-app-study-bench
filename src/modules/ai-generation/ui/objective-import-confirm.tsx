"use client";

import { useActionState } from "react";
import Link from "next/link";
import { FieldErrors } from "@/shared/ui/field-errors";
import type { FormState } from "@/shared/ui/form-state";
import {
  IDLE_FORM_STATE,
  fieldErrors,
  formLevelErrors,
} from "@/shared/ui/form-state";
import {
  IMPORT_SOURCE_CHOICES,
  describeImportSourceChoice,
} from "@/modules/ai-generation/domain/objective-import";
import type {
  ImportSourceChoice,
  ProposedObjective,
} from "@/modules/ai-generation/domain/objective-import";
import type {
  MergeItemView,
  ObjectiveMergeView,
} from "@/modules/ai-generation/application/objective-import-facade";

interface ObjectiveImportConfirmProps {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly slug: string;
  readonly runId: string;
  /** The extracted outline, rendered whole when no merge ran. */
  readonly roots: readonly ProposedObjective[];
  /** The reconciliation against what the track already had, or `null` if none ran. */
  readonly merge: ObjectiveMergeView | null;
  /** Everything in the proposal. */
  readonly nodeCount: number;
  /** What applying would actually add. */
  readonly addableCount: number;
  /** Whether a model produced this proposal, for the empty-state wording. */
  readonly calledModel: boolean;
}

/**
 * The proposed outline, and the decision about it.
 *
 * This screen is the point of the whole feature. A model reading a hundred-page PDF
 * will sometimes merge two domains, miss a subsection, or turn a table of weights into
 * nonsense, and none of that is detectable from a success message — only from reading
 * the tree. So the proposal is rendered in full, with codes and weights, *before*
 * anything is written, and the only way into the objective hierarchy is the button below
 * it.
 *
 * Two shapes, because there are two situations and they call for different decisions:
 *
 * - **No merge** — the track had no objectives when the import ran. There is nothing to
 *   reconcile against, so the whole tree is shown as a tree and applied whole. One
 *   decision, one button.
 * - **A merge** — the track already had objectives, and every extracted objective carries
 *   a verdict. The decision is then *per item*, because that is the granularity the
 *   mistakes happen at: a model that decides "Measure words" is the objective the owner
 *   already wrote is right about most of the outline and wrong about one row, and a single
 *   Apply/Discard would make the owner throw away the ninety correct verdicts to reject
 *   the one bad one.
 *
 * In the merge shape the tree is deliberately *not* rendered as a tree. Additions and
 * enrichments land in different places in a hierarchy the page cannot show — the existing
 * one — so grouping by verdict and naming the parent in words is the honest rendering.
 * The three groups say three different things, and the counts are in the headings so the
 * shape of the merge is readable before any row is.
 *
 * Skips are collapsed rather than hidden, and each carries its reason. They are usually
 * the largest group — re-uploading a syllabus is mostly duplicates — and they are also
 * where a wrong verdict is invisible, so they must be *reachable* without being in the
 * way. Nothing in the skip group is checkable: a skip has no action to take, and a
 * checkbox that did nothing would be a worse lie than no checkbox.
 *
 * The source-type choice is a radio rather than a default because it is a claim about
 * provenance that only the owner can make. `OFFICIAL_SYLLABUS` means "this came out of
 * the real exam guide"; `AI_PROPOSED` means "a model helped and I have not checked it
 * against an official source". Guessing on the owner's behalf would put an unverified
 * outline in the bank labelled as official, which is exactly the mislabelling
 * `SELECTABLE_OBJECTIVE_SOURCE_TYPES` exists to prevent elsewhere. It is recorded on
 * additions only: an enrichment does not change the objective's source type, because the
 * objective is still whatever the owner made it.
 *
 * Discard is a link, not a button, and it writes nothing. The run stays in the history
 * either way — it records a model call that really happened, and deleting it would make
 * the history a record of only the calls that worked.
 */
export function ObjectiveImportConfirm({
  action,
  slug,
  runId,
  roots,
  merge,
  nodeCount,
  addableCount,
  calledModel,
}: ObjectiveImportConfirmProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const formErrors = formLevelErrors(state);
  const sourceErrors = fieldErrors(state, "sourceType");
  const checkedByDefault = new Set(merge?.defaultCheckedKeys ?? []);
  const adds = merge?.items.filter((view) => view.item.kind === "ADD") ?? [];
  const enriches =
    merge?.items.filter((view) => view.item.kind === "ENRICH") ?? [];
  const skips = merge?.items.filter((view) => view.item.kind === "SKIP") ?? [];
  const actionable = adds.length + enriches.length;

  return (
    <form action={formAction} className="form" noValidate>
      <input type="hidden" name="slug" value={slug} readOnly />
      <input type="hidden" name="runId" value={runId} readOnly />
      {/* Present only when there are checkboxes to read, which is what lets the action
          tell "a merge with everything unticked" from "a plain tree import": an unchecked
          box sends nothing, so both would otherwise arrive as an empty list. */}
      {merge === null ? null : (
        <input type="hidden" name="itemKeys" value="1" readOnly />
      )}

      {formErrors.length > 0 ? (
        <FieldErrors id="apply-form-errors" messages={formErrors} />
      ) : null}

      {merge === null ? (
        roots.length === 0 ? (
          <p className="empty-state">
            {calledModel
              ? "The model found no objectives in that document."
              : "Nothing in those files could be read as a syllabus. Check that each file has the right role, or try the AI reader instead."}
          </p>
        ) : (
          <ProposedTree nodes={roots} />
        )
      ) : (
        <>
          <p className="field-hint">{merge.summary}</p>

          {merge.existingTruncated ? (
            <p className="empty-state" role="status">
              This track holds more objectives than one comparison can carry, so
              the match was made against the first {merge.existingConsidered} of
              them. Check the additions below for something you already have
              further down your outline.
            </p>
          ) : null}

          {adds.length > 0 ? (
            <section aria-labelledby="merge-adds-heading" className="section">
              <div className="section-heading">
                <h3 id="merge-adds-heading">Will add ({adds.length})</h3>
                <p className="section-note">
                  New objectives, each shown with where it will sit in your
                  outline. Unticking one takes anything nested under it with it.
                </p>
              </div>
              <ul className="choice-list">
                {adds.map((view) => (
                  <li className="choice-row" key={view.key}>
                    <MergeCheckbox
                      view={view}
                      defaultChecked={
                        view.key !== null && checkedByDefault.has(view.key)
                      }
                    >
                      <AddDetail view={view} />
                    </MergeCheckbox>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {enriches.length > 0 ? (
            <section aria-labelledby="merge-enrich-heading" className="section">
              <div className="section-heading">
                <h3 id="merge-enrich-heading">
                  Will enrich ({enriches.length})
                </h3>
                <p className="section-note">
                  Objectives you already have, whose description the new
                  material extends. Only the description changes — never the
                  title, the code, the weight, or where it sits.
                </p>
              </div>
              <ul className="choice-list">
                {enriches.map((view) => (
                  <li className="choice-row" key={view.key}>
                    <MergeCheckbox
                      view={view}
                      defaultChecked={
                        view.key !== null && checkedByDefault.has(view.key)
                      }
                    >
                      <EnrichDetail view={view} />
                    </MergeCheckbox>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {skips.length > 0 ? (
            <details className="section">
              <summary>
                Skipped ({skips.length}) — already covered by your outline
              </summary>
              <p className="field-hint">
                Nothing here is written or changed. If one of these is wrong,
                discard this import and add that objective yourself — a skip
                cannot be turned into an addition from this screen.
              </p>
              <ul className="objective-tree">
                {skips.map((view, index) => (
                  <li
                    className="objective-node objective-node-skipped"
                    key={`skip-${view.item.ref}-${index}`}
                  >
                    <div className="objective">
                      <p className="objective-title">
                        {view.source?.title ?? view.item.ref}
                      </p>
                      {view.existingTitle === null ? null : (
                        <p className="objective-reference">
                          Matched: {view.existingTitle}
                        </p>
                      )}
                      <p className="objective-focus">
                        {view.item.kind === "SKIP" ? view.item.reason : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {actionable === 0 ? (
            <p className="empty-state" role="status">
              Every objective in that document is already on this track, so
              there is nothing to add or extend.
            </p>
          ) : null}
        </>
      )}

      <fieldset className="field">
        <legend>
          Where did this come from?
          <span className="field-required"> (required)</span>
        </legend>
        <p className="field-hint" id="sourceType-hint">
          This is recorded on every objective the import adds. Choose{" "}
          <q>{describeImportSourceChoice("OFFICIAL_SYLLABUS")}</q> only if you
          uploaded the real published guide and the outline above matches it.
        </p>
        <ul className="choice-list">
          {IMPORT_SOURCE_CHOICES.map((choice) => (
            <li key={choice} className="choice-row">
              <label className="choice-label">
                <input
                  type="radio"
                  name="sourceType"
                  value={choice}
                  defaultChecked={state.values.sourceType === choice}
                  aria-describedby="sourceType-hint"
                />
                <span>
                  {describeImportSourceChoice(choice)} —{" "}
                  {sourceExplanation(choice)}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <FieldErrors id="sourceType-errors" messages={sourceErrors} />
      </fieldset>

      <div className="form-actions">
        <button
          type="submit"
          className="button"
          // Disabled when there is provably nothing to write: the apply would be refused
          // anyway (`ObjectiveImportNothingToApplyError`), and a button whose only outcome
          // is an error is worse than one that says there is nothing to do. Unticking every
          // box does *not* disable it — the boxes are uncontrolled, so the button cannot
          // know — and that apply is refused with a message instead.
          disabled={
            isPending ||
            (merge === null ? addableCount === 0 : actionable === 0)
          }
        >
          {isPending ? "Adding…" : applyLabel(merge, addableCount, actionable)}
        </button>
        <Link className="button-quiet" href={`/study-tracks/${slug}`}>
          Discard
        </Link>
      </div>

      <p className="field-hint">
        {merge === null
          ? addableCount === nodeCount
            ? "Applying adds these to the end of your outline in one step and changes nothing you already had."
            : `Applying adds ${addableCount} of the ${nodeCount} above to the end of your outline in one step and changes nothing you already had.`
          : "Applying writes only what is ticked, in one step. Everything else in your outline is left exactly as it is."}{" "}
        Discarding adds nothing at all; the extraction stays in your run history
        either way.
      </p>
    </form>
  );
}

function applyLabel(
  merge: ObjectiveMergeView | null,
  addableCount: number,
  actionable: number,
): string {
  if (merge === null) {
    return addableCount === 0
      ? "Nothing left to add"
      : `Apply ${addableCount} ${addableCount === 1 ? "objective" : "objectives"}`;
  }

  if (actionable === 0) {
    return "Nothing left to add";
  }

  // "Apply 12 changes" rather than "Apply 12 objectives", because two different things are
  // being written and calling an enrichment an objective would overstate what is added.
  return `Apply ${actionable} ${actionable === 1 ? "change" : "changes"}`;
}

/** One tickable verdict: the checkbox, and whatever the caller wants inside its label. */
function MergeCheckbox({
  view,
  defaultChecked,
  children,
}: {
  readonly view: MergeItemView;
  readonly defaultChecked: boolean;
  readonly children: React.ReactNode;
}) {
  if (view.key === null) {
    return <>{children}</>;
  }

  return (
    <label className="choice-label">
      <input
        type="checkbox"
        name="itemKey"
        value={view.key}
        defaultChecked={defaultChecked}
      />
      <span>{children}</span>
    </label>
  );
}

/** What an addition is, and where it goes. */
function AddDetail({ view }: { readonly view: MergeItemView }) {
  const add = view.item;

  if (add.kind !== "ADD") {
    return null;
  }

  return (
    <>
      <span className="objective-title">
        {add.code === null ? "" : `${add.code} `}
        {add.title}
      </span>
      <span className="field-hint">
        {view.parentLabel === null
          ? " — as a new top-level objective"
          : view.parentIsNew
            ? ` — under the new "${view.parentLabel}"`
            : ` — under your existing "${view.parentLabel}"`}
        {add.weight === null ? "" : `, weight ${add.weight}%`}
      </span>
      {add.description === null ? null : (
        <span className="objective-focus">{add.description}</span>
      )}
    </>
  );
}

/**
 * What an enrichment changes, old beside new.
 *
 * Both descriptions in full rather than a computed word-level diff. A diff of two
 * paragraphs of prose reads worse than the two paragraphs do, and the question the owner
 * is answering — "is the new one better than what I wrote?" — is answered by reading them.
 */
function EnrichDetail({ view }: { readonly view: MergeItemView }) {
  const enrich = view.item;

  if (enrich.kind !== "ENRICH") {
    return null;
  }

  return (
    <>
      <span className="objective-title">
        {view.existingTitle ?? view.source?.title ?? enrich.ref}
      </span>
      {view.existingTitle === null ? (
        <span className="field-hint">
          {" "}
          — this objective is no longer on the track and will be left out
        </span>
      ) : null}
      <span className="field-hint">
        Now:{" "}
        {view.existingDescription === null
          ? "no description"
          : view.existingDescription}
      </span>
      <span className="objective-focus">After: {enrich.description}</span>
    </>
  );
}

function sourceExplanation(choice: ImportSourceChoice): string {
  switch (choice) {
    case "OFFICIAL_SYLLABUS":
      return "the outline as published in the official exam guide";
    case "AI_PROPOSED":
      return "extracted with a model's help and not yet checked against an official guide";
  }
}

/**
 * The proposed tree, as a nested list.
 *
 * Reuses the objective tree's own classes so the preview looks like the thing it will
 * become: an owner comparing this screen with their track page should be reading the
 * same shape twice, not translating between two layouts. Nothing here links anywhere,
 * because none of these objectives exists yet.
 */
function ProposedTree({
  nodes,
}: {
  readonly nodes: readonly ProposedObjective[];
}) {
  return (
    <ul className="objective-tree">
      {nodes.map((node, index) => (
        <li
          // Nothing in a proposal has an identifier yet, so position is the only stable
          // key available. It is stable enough: this list never reorders or filters.
          key={`${node.code ?? ""}-${node.title}-${index}`}
          className="objective-node"
        >
          <ProposedNode node={node} />
          {node.children.length > 0 ? (
            <ProposedTree nodes={node.children} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** One proposed objective's own labels. */
function ProposedNode({ node }: { readonly node: ProposedObjective }) {
  return (
    <div className="objective">
      <div className="objective-labels">
        {node.code === null ? null : (
          <p className="objective-reference">{node.code}</p>
        )}
      </div>
      <p className="objective-title">{node.title}</p>
      {node.weight === null ? null : (
        <p className="objective-weight">Weight {node.weight}%</p>
      )}
      {node.description === null ? null : (
        <p className="objective-focus">{node.description}</p>
      )}
    </div>
  );
}
