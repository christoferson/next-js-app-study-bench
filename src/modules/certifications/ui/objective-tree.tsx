import Link from "next/link";
import type {
  Objective,
  ObjectiveTreeNode,
} from "@/modules/certifications/domain/objective";
import {
  describeObjectiveSourceType,
  isOfficialSource,
} from "@/modules/certifications/domain/objective";
import {
  archiveObjectiveAction,
  moveObjectiveAction,
  restoreObjectiveAction,
} from "./actions";

interface ObjectiveTreeProps {
  readonly slug: string;
  readonly nodes: readonly ObjectiveTreeNode[];
}

/**
 * Nested objective list with per-node management actions.
 *
 * A Server Component: every action is a form posting to a Server Action, so the
 * tree needs no client JavaScript and each control is a real submit button.
 * Reordering uses explicit up and down buttons rather than drag-and-drop so it
 * stays keyboard accessible.
 */
export function ObjectiveTree({ slug, nodes }: ObjectiveTreeProps) {
  if (nodes.length === 0) {
    return (
      <p className="empty-state">
        No objectives yet. Add a root objective to start mapping this track.
      </p>
    );
  }

  return <ObjectiveBranch slug={slug} nodes={nodes} />;
}

function ObjectiveBranch({ slug, nodes }: ObjectiveTreeProps) {
  return (
    <ul className="objective-tree">
      {nodes.map((node, index) => (
        <li key={node.objective.id} className="objective-node">
          <ObjectiveRow
            slug={slug}
            objective={node.objective}
            isFirst={index === 0}
            isLast={index === nodes.length - 1}
          />
          {node.children.length > 0 ? (
            <ObjectiveBranch slug={slug} nodes={node.children} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

interface ObjectiveRowProps {
  readonly slug: string;
  readonly objective: Objective;
  readonly isFirst: boolean;
  readonly isLast: boolean;
}

function ObjectiveRow({ slug, objective, isFirst, isLast }: ObjectiveRowProps) {
  const isArchived = objective.status === "ARCHIVED";

  return (
    <div className={isArchived ? "objective objective-archived" : "objective"}>
      <div className="objective-labels">
        {objective.code !== null ? (
          <p className="objective-reference">{objective.code}</p>
        ) : null}
        {isArchived ? <span className="badge">Archived</span> : null}
        {isOfficialSource(objective.sourceType) ? (
          <span className="badge">
            {describeObjectiveSourceType(objective.sourceType)}
          </span>
        ) : null}
      </div>

      <p className="objective-title">{objective.title}</p>

      {objective.weight !== null ? (
        <p className="objective-weight">Weight {objective.weight}%</p>
      ) : null}

      {objective.description !== null ? (
        <p className="objective-focus">{objective.description}</p>
      ) : null}

      <div className="objective-actions">
        {isArchived ? null : (
          <Link
            className="button-quiet"
            href={`/study-tracks/${slug}/objectives/new?parent=${encodeURIComponent(objective.id)}`}
          >
            Add child
          </Link>
        )}
        <Link
          className="button-quiet"
          href={`/study-tracks/${slug}/objectives/${objective.id}/edit`}
        >
          Edit
        </Link>

        {isFirst && isLast ? null : (
          <>
            <MoveForm
              slug={slug}
              objective={objective}
              direction="UP"
              disabled={isFirst}
            />
            <MoveForm
              slug={slug}
              objective={objective}
              direction="DOWN"
              disabled={isLast}
            />
          </>
        )}

        <form
          action={isArchived ? restoreObjectiveAction : archiveObjectiveAction}
        >
          <input type="hidden" name="slug" value={slug} readOnly />
          <input
            type="hidden"
            name="objectiveId"
            value={objective.id}
            readOnly
          />
          {/* The accessible name names the objective so the repeated controls
              are distinguishable; it still begins with the visible label. */}
          <button
            type="submit"
            className="button-quiet"
            aria-label={`${isArchived ? "Restore" : "Archive"} ${objective.title}`}
          >
            {isArchived ? "Restore" : "Archive"}
          </button>
        </form>
      </div>
    </div>
  );
}

interface MoveFormProps {
  readonly slug: string;
  readonly objective: Objective;
  readonly direction: "UP" | "DOWN";
  readonly disabled: boolean;
}

/**
 * Sibling move control.
 *
 * At an end of the sibling group the button is rendered `disabled`. This is not
 * a future-feature placeholder: the control exists and works, and its disabled
 * state communicates the current position.
 */
function MoveForm({ slug, objective, direction, disabled }: MoveFormProps) {
  const label = direction === "UP" ? "Move up" : "Move down";

  return (
    <form action={moveObjectiveAction}>
      <input type="hidden" name="slug" value={slug} readOnly />
      <input type="hidden" name="objectiveId" value={objective.id} readOnly />
      <input type="hidden" name="direction" value={direction} readOnly />
      <button
        type="submit"
        className="button-quiet"
        disabled={disabled}
        aria-label={`${label} ${objective.title}`}
      >
        {label}
      </button>
    </form>
  );
}
