import type { ReactNode } from "react";

interface CollapsibleSectionProps {
  /** Used for the heading, and for the `id` the section is labelled by. */
  readonly title: string;
  /** Stable id root, so the heading and the section reference each other. */
  readonly id: string;
  /**
   * Whether the section starts open. Callers decide from how much is inside — see
   * `openWhenShort`.
   */
  readonly open: boolean;
  /** Short count shown in the summary, e.g. "12 attempts". Read before opening. */
  readonly count?: string;
  /** Explanatory line under the heading, revealed with the body. */
  readonly note?: ReactNode;
  readonly children: ReactNode;
}

/**
 * A page section the owner can fold away.
 *
 * The accessibility pattern, which is the whole reason this is a component rather than four
 * hand-written `<details>` blocks: the `<h2>` goes *inside* the `<summary>`. That keeps the
 * heading in the document outline — so heading-to-heading navigation still reaches this
 * section, and it still appears in a screen reader's heading list whether it is open or shut —
 * while making the entire line the disclosure control rather than a small triangle beside it.
 * `<summary>` is focusable and toggles on Enter and Space with no JavaScript at all.
 *
 * The `<section>` wrapper stays outside the `<details>` and keeps its `aria-labelledby`, so
 * the landmark is named even while collapsed. Putting the heading in the summary and the
 * summary inside the section is the only arrangement where both of those hold.
 *
 * State is deliberately not persisted (`SPEC.md` has no preference for it, and a cookie per
 * section is a lot of machinery for a triangle). Every visit starts from the default the page
 * chose, which is why that default is computed from content length rather than fixed.
 */
export function CollapsibleSection({
  title,
  id,
  open,
  count,
  note,
  children,
}: CollapsibleSectionProps) {
  const headingId = `${id}-heading`;

  return (
    <section aria-labelledby={headingId} className="section">
      <details className="collapsible" open={open}>
        <summary>
          <h2 id={headingId}>{title}</h2>
          {count === undefined ? null : (
            <span className="collapsible-count">{count}</span>
          )}
        </summary>
        <div className="collapsible-body">
          {note === undefined ? null : <p className="section-note">{note}</p>}
          {children}
        </div>
      </details>
    </section>
  );
}

/**
 * How many entries a history can hold before it is folded away by default.
 *
 * Three fits on a phone screen without pushing the rest of the page below the fold, so a
 * short history is worth showing outright — collapsing two attempts only hides them behind a
 * press. Past that, the list is reference material the owner opens deliberately.
 */
export const SHORT_HISTORY_LENGTH = 3;

/** Open when there is little enough inside to be worth showing unasked. */
export function openWhenShort(length: number): boolean {
  return length <= SHORT_HISTORY_LENGTH;
}
