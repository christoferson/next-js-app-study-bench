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

interface ObjectiveImportConfirmProps {
  readonly action: (state: FormState, form: FormData) => Promise<FormState>;
  readonly slug: string;
  readonly runId: string;
  readonly roots: readonly ProposedObjective[];
  readonly nodeCount: number;
}

/**
 * The proposed outline, and the decision about it.
 *
 * This screen is the point of the whole feature. A model reading a hundred-page PDF
 * will sometimes merge two domains, miss a subsection, or turn a table of weights into
 * nonsense, and none of that is detectable from a success message — only from reading
 * the tree. So the tree is rendered in full, with codes and weights, *before* anything
 * is written, and the only way into the objective hierarchy is the button below it.
 *
 * The source-type choice is a radio rather than a default because it is a claim about
 * provenance that only the owner can make. `OFFICIAL_SYLLABUS` means "this came out of
 * the real exam guide"; `AI_PROPOSED` means "a model helped and I have not checked it
 * against an official source". Guessing on the owner's behalf would put an unverified
 * outline in the bank labelled as official, which is exactly the mislabelling
 * `SELECTABLE_OBJECTIVE_SOURCE_TYPES` exists to prevent elsewhere.
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
  nodeCount,
}: ObjectiveImportConfirmProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  const formErrors = formLevelErrors(state);
  const sourceErrors = fieldErrors(state, "sourceType");

  return (
    <form action={formAction} className="form" noValidate>
      <input type="hidden" name="slug" value={slug} readOnly />
      <input type="hidden" name="runId" value={runId} readOnly />

      {formErrors.length > 0 ? (
        <FieldErrors id="apply-form-errors" messages={formErrors} />
      ) : null}

      <ProposedTree nodes={roots} />

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
        <button type="submit" className="button" disabled={isPending}>
          {isPending
            ? "Adding…"
            : `Apply ${nodeCount} ${nodeCount === 1 ? "objective" : "objectives"}`}
        </button>
        <Link className="button-quiet" href={`/study-tracks/${slug}`}>
          Discard
        </Link>
      </div>

      <p className="field-hint">
        Applying adds these to the end of your outline in one step and changes
        nothing you already had. Discarding adds nothing at all; the extraction
        stays in your run history either way.
      </p>
    </form>
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
  if (nodes.length === 0) {
    return (
      <p className="empty-state">
        The model found no objectives in that document.
      </p>
    );
  }

  return (
    <ul className="objective-tree">
      {nodes.map((node, index) => (
        <li
          // Nothing in a proposal has an identifier yet, so position is the only stable
          // key available. It is stable enough: this list never reorders or filters.
          key={`${node.code ?? ""}-${node.title}-${index}`}
          className="objective-node"
        >
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
          {node.children.length > 0 ? (
            <ProposedTree nodes={node.children} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
