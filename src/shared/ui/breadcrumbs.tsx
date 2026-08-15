import Link from "next/link";

export interface Crumb {
  readonly label: string;
  readonly href: string;
}

interface BreadcrumbsProps {
  /** The ancestors, outermost first. Empty renders just the current page. */
  readonly trail: readonly Crumb[];
  /** Where the owner is now. Not a link: it is the page they are reading. */
  readonly current: string;
}

/**
 * Where this page sits, and the way back out of it.
 *
 * Replaces the per-page "Back to X" link that every nested screen used to carry. That link
 * answered one question — how do I leave — and it answered it differently on each page
 * ("Back to the question bank", "Back to this card", "Leave and come back later"), so it
 * never taught the shape of the application. A trail answers two questions instead: how do
 * I leave, and how deep am I.
 *
 * An ordered list, because the order is the meaning: `Tracks / AWS SAA / Question bank`
 * is a path, not a set of links. The separator is a CSS pseudo-element rather than a text
 * node so a screen reader reads the labels without a slash between each one, and it is
 * `aria-hidden` for the same reason.
 *
 * The last item is not a link and carries `aria-current="page"`. Linking the page to
 * itself is a control that does nothing, and the owner clicking it to see whether it does
 * something is a cost with no return.
 *
 * A Server Component: nothing here is interactive, and the trail is known at render time
 * from the data the page already loaded. It takes the labels rather than deriving them
 * from the pathname on purpose — a slug is not a track name, and `/study-tracks/aws-saa`
 * should read "AWS Solutions Architect Associate".
 */
export function Breadcrumbs({ trail, current }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className="breadcrumb">
      <ol className="breadcrumb-list">
        {trail.map((crumb) => (
          <li className="breadcrumb-item" key={`${crumb.href}:${crumb.label}`}>
            <Link href={crumb.href}>{crumb.label}</Link>
          </li>
        ))}
        <li className="breadcrumb-item">
          <span aria-current="page" className="breadcrumb-current">
            {current}
          </span>
        </li>
      </ol>
    </nav>
  );
}

/** The crumb every trail starts from. */
export const TRACKS_CRUMB: Crumb = { label: "Tracks", href: "/" };

/**
 * The crumb for one study track.
 *
 * A helper rather than an object literal repeated on twenty pages: the label is the track's
 * name and the address is built from its slug, and getting those two out of step would
 * produce a link that reads like one track and goes to another.
 */
export function trackCrumb(track: {
  readonly name: string;
  readonly slug: string;
}): Crumb {
  return { label: track.name, href: `/study-tracks/${track.slug}` };
}

/** The crumb for the settings index. */
export const SETTINGS_CRUMB: Crumb = { label: "Settings", href: "/settings" };
