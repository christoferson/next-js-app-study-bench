import {
  archiveAllObjectivesAction,
  deleteAllObjectivesAction,
  restoreAllObjectivesAction,
} from "./actions";

interface ObjectiveBulkActionsProps {
  readonly slug: string;
  readonly certificationId: string;
  readonly activeCount: number;
  readonly archivedCount: number;
}

/**
 * Whole-outline actions, beside the tree they act on.
 *
 * An imported syllabus arrives with over a hundred objectives, and the per-row
 * controls are the wrong tool for "this whole import was against the wrong exam
 * guide" — the same intent expressed a hundred times, with a hundred chances to
 * stop half-way. These three are that intent said once.
 *
 * **Every control is conditional on there being something for it to do.** Nothing
 * renders for a track with no objectives; Archive all needs an active objective,
 * Restore all needs an archived one. A bulk button that would report "0 changed"
 * is a dead control, and the repository does not ship those.
 *
 * Counts are in the labels rather than only in the section note above, because
 * these are the buttons where the number *is* the warning.
 */
export function ObjectiveBulkActions({
  slug,
  certificationId,
  activeCount,
  archivedCount,
}: ObjectiveBulkActionsProps) {
  const total = activeCount + archivedCount;

  if (total === 0) {
    return null;
  }

  return (
    <div className="section-actions">
      {activeCount > 0 ? (
        <form action={archiveAllObjectivesAction} className="inline-form">
          <TrackFields slug={slug} certificationId={certificationId} />
          <button type="submit" className="button-quiet">
            Archive all {activeCount}
          </button>
        </form>
      ) : null}

      {archivedCount > 0 ? (
        <form action={restoreAllObjectivesAction} className="inline-form">
          <TrackFields slug={slug} certificationId={certificationId} />
          <button type="submit" className="button-quiet">
            Restore all {archivedCount} archived
          </button>
        </form>
      ) : null}

      {/* A `details` rather than a browser `confirm()`: the warning is text on the
          page, readable before the button appears and without client JavaScript,
          matching how the bank confirms a permanent question deletion. The red
          button lives inside, so opening the disclosure is the deliberate step. */}
      <details className="disclosure">
        <summary>Delete all objectives permanently</summary>
        <p className="field-hint">
          Delete all {total} objective{total === 1 ? "" : "s"} permanently.
          Questions and cards lose their objective mappings. This cannot be
          undone.
        </p>
        <form action={deleteAllObjectivesAction}>
          <TrackFields slug={slug} certificationId={certificationId} />
          <button type="submit" className="button-danger">
            Yes, delete all {total} objective{total === 1 ? "" : "s"}
          </button>
        </form>
      </details>
    </div>
  );
}

interface TrackFieldsProps {
  readonly slug: string;
  readonly certificationId: string;
}

/** The track identity every bulk action posts: the id to act on, the slug to revalidate. */
function TrackFields({ slug, certificationId }: TrackFieldsProps) {
  return (
    <>
      <input type="hidden" name="slug" value={slug} readOnly />
      <input
        type="hidden"
        name="certificationId"
        value={certificationId}
        readOnly
      />
    </>
  );
}
