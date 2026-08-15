"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, GraduationCap, Layers, Settings } from "lucide-react";

/**
 * The four places worth reaching from anywhere.
 *
 * Deliberately short. A header nav is not a site map: it holds the destinations the owner
 * starts a session from, and everything else in the application is reached from the track
 * it belongs to. Adding a fifth entry here would be cheaper than deciding it does not
 * belong, which is why the list is written out rather than derived from the route tree.
 *
 * `match` decides what counts as "you are here", and it is not just equality: `/study/new`
 * and `/study/sessions/abc` are both Study, and every `/settings/*` page is Settings.
 * Tracks is the exception — it is the dashboard at `/`, and a track's own pages live under
 * `/study-tracks`, so both light it up.
 */
interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly Icon: typeof Layers;
  readonly match: (pathname: string) => boolean;
}

/**
 * Is `pathname` the section rooted at `base`, or a page inside it?
 *
 * A plain `startsWith` is wrong here, and wrong in a way that shows: `/study-tracks/hsk-4`
 * starts with `/study`, so the raw prefix test lit up both Tracks and Study at once. The
 * boundary has to be a segment separator, so `/study` and `/study/new` are Study while
 * `/study-tracks/...` is not.
 */
function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/",
    label: "Tracks",
    Icon: Layers,
    match: (pathname) => pathname === "/" || isUnder(pathname, "/study-tracks"),
  },
  {
    href: "/study/new",
    label: "Study",
    Icon: GraduationCap,
    match: (pathname) => isUnder(pathname, "/study"),
  },
  {
    href: "/progress",
    label: "Progress",
    Icon: BarChart3,
    match: (pathname) => isUnder(pathname, "/progress"),
  },
  {
    href: "/settings",
    label: "Settings",
    Icon: Settings,
    match: (pathname) => isUnder(pathname, "/settings"),
  },
];

/**
 * The primary navigation, with the current section marked.
 *
 * A Client Component for one reason: `usePathname`. Marking the current section is the
 * only thing on this header that cannot be answered on the server, because the root layout
 * does not receive the pathname as a prop. Nothing else here is interactive — they are
 * plain links, and they work with JavaScript disabled.
 *
 * The current item carries `aria-current="page"` as well as a gold underline, so the marker
 * is not colour alone (`spec/UI-GUIDELINES.md`). The icons are decorative: each sits beside
 * its own word, so they are hidden from assistive technology rather than labelled twice.
 *
 * `/study-tracks/foo` matching Tracks is a small lie told on purpose: the entry links to
 * `/`, and from a track page the owner reading "Tracks" as the section they are in is
 * correct even though the link would move them.
 */
export function SiteNav() {
  const pathname = usePathname() ?? "/";

  return (
    <nav aria-label="Primary" className="site-nav">
      <ul className="site-nav-list">
        {NAV_ITEMS.map(({ href, label, Icon, match }) => {
          const current = match(pathname);

          return (
            <li key={href}>
              <Link
                className="site-nav-link"
                href={href}
                aria-current={current ? "page" : undefined}
              >
                <Icon aria-hidden="true" className="site-nav-icon" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
