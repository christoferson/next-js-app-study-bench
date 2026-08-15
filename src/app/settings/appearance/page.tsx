import {
  Breadcrumbs,
  SETTINGS_CRUMB,
  TRACKS_CRUMB,
} from "@/shared/ui/breadcrumbs";
import { readTextSizeCookie } from "@/modules/appearance/infrastructure/text-size-cookie";
import { saveTextSizeAction } from "@/modules/appearance/ui/actions";
import { TextSizeForm } from "@/modules/appearance/ui/text-size-form";

/**
 * Rendered per request, never prerendered.
 *
 * This page reads a cookie, which makes it request-specific by definition: prerendering
 * it would bake one owner's chosen size into the build output and show it back to them
 * whatever they had actually saved. The other settings pages say the same thing for the
 * database's sake.
 */
export const dynamic = "force-dynamic";

/**
 * How large StudyBench renders its text.
 *
 * The setting exists because of where this application is used. Study happens on a
 * phone, in short sessions, often at arm's length, and question text and explanations
 * are the whole content — a size that fits the most on screen is right for building the
 * bank and wrong for reading it for twenty minutes. Browser zoom is the usual answer and
 * it is not a good one here: it scales the viewport, so the mobile layout switches to
 * narrower breakpoints as the text grows.
 *
 * Scaling the root font size instead keeps the layout exactly as designed. Every size,
 * space, and measure in the stylesheet is expressed in `rem`, `em`, or `ch`, so all of
 * them grow together and the line length stays the same number of characters.
 */
export default async function AppearanceSettingsPage() {
  const current = await readTextSizeCookie();

  return (
    <main className="page">
      {/* The cross-links to the other two settings screens are gone: there is a settings
          index now, and the trail is the way to it. */}
      <Breadcrumbs
        trail={[TRACKS_CRUMB, SETTINGS_CRUMB]}
        current="Appearance"
      />

      <header className="page-header">
        <p className="eyebrow">Settings</p>
        <h1>Appearance</h1>
        <p className="lede">
          Text size applies to every page. Everything scales together —
          headings, answer choices, and explanations — so the layout stays as it
          is and lines stay the same length. The same size is on the header of
          every screen if you would rather change it while you read.
        </p>
      </header>

      <section aria-labelledby="text-size-heading" className="section">
        <div className="section-heading">
          <h2 id="text-size-heading">Text size</h2>
          <p className="section-note">
            Saved in this browser rather than in your study bank, so it takes
            effect on the first render of every page and never flickers from one
            size to another. Another browser or another device keeps its own
            choice.
          </p>
        </div>
        <TextSizeForm action={saveTextSizeAction} current={current} />
      </section>
    </main>
  );
}
