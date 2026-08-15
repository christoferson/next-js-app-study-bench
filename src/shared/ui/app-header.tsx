import Link from "next/link";
import type { TextSize } from "@/modules/appearance/domain/text-size";
import { setTextSizeAction } from "@/modules/appearance/ui/actions";
import { TextSizeStepper } from "@/modules/appearance/ui/text-size-stepper";
import { SiteNav } from "@/shared/ui/site-nav";

interface AppHeaderProps {
  /** The size this request rendered at, so the stepper opens showing the truth. */
  readonly textSize: TextSize;
}

/**
 * The bar every page renders under.
 *
 * **Rendered from the root layout, not from each page.** Thirty routes each carrying their
 * own way back was the state this replaces, and it drifted: the same destination was called
 * three different things depending on which page you left from. One header in one place
 * cannot drift, and a new route gets navigation by existing.
 *
 * **Where it lives.** `src/shared/ui/` rather than a module, because it belongs to no
 * capability — it is chrome, like the stylesheet. It *composes* one thing from a module (the
 * appearance stepper), which is the right direction of dependency: shared chrome may reach
 * into a module, and no module reaches back into the chrome (`spec/ARCHITECTURE.md`).
 *
 * **A Server Component holding two client children.** The wordmark and the shell are static
 * markup. The nav is a Client Component only because marking the current section needs
 * `usePathname`, and the stepper only because it writes the new size to the document before
 * the round trip. Neither of them is required for the header to work: with JavaScript off
 * the links still navigate, and the stepper's buttons are the only thing that goes quiet —
 * `/settings/appearance` is the form that works without them.
 *
 * The stepper's current size is threaded down from the layout rather than read here, so the
 * cookie is read exactly once per request.
 */
export function AppHeader({ textSize }: AppHeaderProps) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        {/* The wordmark is a link to the dashboard because that is the convention, and it
            is not part of the nav list: "StudyBench" is the application's name, not a
            destination alongside Progress. */}
        <Link className="site-wordmark" href="/">
          StudyBench
        </Link>

        <SiteNav />

        <TextSizeStepper action={setTextSizeAction} current={textSize} />
      </div>
    </header>
  );
}
