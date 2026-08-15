import Link from "next/link";
import {
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
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
 *
 * **Root objectives are collapsible.** A syllabus is not always small — the HSK 4 track
 * imports 117 objectives — and at that size a flat nested list is a page the owner scrolls
 * past rather than reads. Each root is a `details` so a domain can be folded away and the
 * others brought into one screen. Only the roots: nesting a disclosure inside a disclosure
 * turns "where am I" into a puzzle, and the child levels are already indented and ruled.
 *
 * **Open by default, and not remembered.** Open, because a tree that starts collapsed hides
 * the content the page exists to show — the owner should have to act to hide, not to see.
 * Not remembered, because persisting it means a cookie or a table per objective per browser,
 * and it would buy a saved scroll position on a page visited to edit one thing. A fold that
 * resets on navigation is the honest version of a cheap feature.
 */
export function ObjectiveTree({ slug, nodes }: ObjectiveTreeProps) {
  if (nodes.length === 0) {
    return (
      <p className="empty-state">
        No objectives yet. Add a root objective to start mapping this track.
      </p>
    );
  }

  return (
    <div className="objective-groups">
      {nodes.map((node, index) => (
        <ObjectiveGroup
          key={node.objective.id}
          slug={slug}
          node={node}
          isFirst={index === 0}
          isLast={index === nodes.length - 1}
        />
      ))}
    </div>
  );
}

interface ObjectiveGroupProps {
  readonly slug: string;
  readonly node: ObjectiveTreeNode;
  readonly isFirst: boolean;
  readonly isLast: boolean;
}

/**
 * One root objective and everything under it, foldable.
 *
 * The summary carries the reference *and* the title, and a count of what is inside — which
 * is exactly what has to be legible when the group is shut, since everything else about the
 * objective is hidden at that point. It repeats the row below when the group is open, and
 * that repetition is the price of the closed state being readable. The objective row itself
 * stays inside, unchanged, so a root is managed exactly like every other node and the
 * summary is navigation rather than a second place the title is edited.
 *
 * A root with no children renders no count, because "0 nested" is a fact about a leaf that
 * reads as a problem.
 */
function ObjectiveGroup({ slug, node, isFirst, isLast }: ObjectiveGroupProps) {
  const nested = countDescendants(node);
  const { code, title } = node.objective;

  return (
    <details className="objective-group" open>
      <summary>
        <span>{code === null ? title : `${code} — ${title}`}</span>
        {nested > 0 ? (
          <span className="collapsible-count">
            {nested} nested objective{nested === 1 ? "" : "s"}
          </span>
        ) : null}
      </summary>

      <ul className="objective-tree">
        <li className="objective-node">
          <ObjectiveRow
            slug={slug}
            objective={node.objective}
            isFirst={isFirst}
            isLast={isLast}
          />
          {node.children.length > 0 ? (
            <ObjectiveBranch slug={slug} nodes={node.children} />
          ) : null}
        </li>
      </ul>
    </details>
  );
}

/** How many objectives are nested under this one, at any depth. */
function countDescendants(node: ObjectiveTreeNode): number {
  return node.children.reduce(
    (total, child) => total + 1 + countDescendants(child),
    0,
  );
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

/**
 * One objective, with its six controls as glyphs.
 *
 * The words came off these buttons because there are up to six of them on every row of a
 * 117-row tree, and "Add child Edit Move up Move down Archive" repeated that many times is
 * the loudest thing on the page — a toolbar shouting over the syllabus it is meant to
 * manage. As glyphs the row reads as content with controls beside it.
 *
 * **Every one keeps its name.** `aria-label` names the action *and the objective* it acts
 * on, so a screen reader hears "Archive Cloud security" rather than the sixth "Archive" on
 * the page, and `title` repeats it as a pointer tooltip for anyone who cannot place the
 * glyph. The icons themselves are `aria-hidden`: the label is the name, and an icon
 * announced beside it would be the name twice.
 *
 * This is a deliberate trade against discoverability, and it is only made here. The bank
 * rows keep their words, because those rows carry two controls and have the space.
 */
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
            className="icon-button"
            href={`/study-tracks/${slug}/objectives/new?parent=${encodeURIComponent(objective.id)}`}
            aria-label={`Add a child objective under ${objective.title}`}
            title={`Add a child objective under ${objective.title}`}
          >
            <Plus aria-hidden="true" className="icon" />
          </Link>
        )}
        <Link
          className="icon-button"
          href={`/study-tracks/${slug}/objectives/${objective.id}/edit`}
          aria-label={`Edit ${objective.title}`}
          title={`Edit ${objective.title}`}
        >
          <Pencil aria-hidden="true" className="icon" />
        </Link>

        {isFirst && isLast ? null : (
          <div className="icon-button-group">
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
          </div>
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
              are distinguishable; it still begins with the visible action. */}
          <button
            type="submit"
            className={
              isArchived ? "icon-button" : "icon-button icon-button-danger"
            }
            aria-label={`${isArchived ? "Restore" : "Archive"} ${objective.title}`}
            title={`${isArchived ? "Restore" : "Archive"} ${objective.title}`}
          >
            {isArchived ? (
              <ArchiveRestore aria-hidden="true" className="icon" />
            ) : (
              <Trash2 aria-hidden="true" className="icon" />
            )}
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
  const name = `${label} ${objective.title}`;

  return (
    <form action={moveObjectiveAction}>
      <input type="hidden" name="slug" value={slug} readOnly />
      <input type="hidden" name="objectiveId" value={objective.id} readOnly />
      <input type="hidden" name="direction" value={direction} readOnly />
      <button
        type="submit"
        className="icon-button"
        disabled={disabled}
        aria-label={name}
        title={name}
      >
        {direction === "UP" ? (
          <ChevronUp aria-hidden="true" className="icon" />
        ) : (
          <ChevronDown aria-hidden="true" className="icon" />
        )}
      </button>
    </form>
  );
}
