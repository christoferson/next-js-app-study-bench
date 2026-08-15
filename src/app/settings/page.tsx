import Link from "next/link";
import { Breadcrumbs, TRACKS_CRUMB } from "@/shared/ui/breadcrumbs";

/**
 * No `force-dynamic` here, unlike the routes around it: this page is three fixed links and
 * reads nothing per request, so it has nothing that could go stale.
 *
 * It is still rendered on demand, because the root layout reads the text-size cookie and that
 * makes every route in the application dynamic. The absence of a declaration is a statement
 * about this page rather than a caching strategy: if the layout ever stopped reading a cookie,
 * this page would be correct as static without further thought.
 */

/**
 * The settings index.
 *
 * Three screens used to cross-link each other, each carrying a nav to the other two, on the
 * argument that three pages do not need an index. The header changed that argument: the
 * header needs one Settings destination, and "whichever of the three you saw last" is not
 * one. So the cross-links come out and this goes in — the header points here, and here
 * points at the three.
 *
 * Each card says what the setting *decides*, not what it is called. "Audio" is a word;
 * "voices, and the clips already generated" is the reason to open it.
 */
export default function SettingsPage() {
  return (
    <main className="page">
      <Breadcrumbs trail={[TRACKS_CRUMB]} current="Settings" />

      <header className="page-header">
        <p className="eyebrow">Settings</p>
        <h1>Settings</h1>
        <p className="lede">
          How StudyBench looks, sounds, and writes. Nothing here changes your
          study material.
        </p>
      </header>

      <section aria-labelledby="settings-heading" className="section">
        <div className="section-heading">
          <h2 id="settings-heading">Everything you can change</h2>
        </div>

        <ul className="card-list">
          <li className="card">
            <div className="card-heading">
              <h3 className="card-title">
                <Link href="/settings/appearance">Appearance</Link>
              </h3>
            </div>
            <p className="card-text">
              How large the text is on every page. The same size is on the
              header of every screen, so you can change it while you read.
            </p>
          </li>

          <li className="card">
            <div className="card-heading">
              <h3 className="card-title">
                <Link href="/settings/audio">Audio</Link>
              </h3>
            </div>
            <p className="card-text">
              The clips generated for your vocabulary cards, and how much space
              they take. Remove any you no longer want.
            </p>
          </li>

          <li className="card">
            <div className="card-heading">
              <h3 className="card-title">
                <Link href="/settings/personas">Personas</Link>
              </h3>
            </div>
            <p className="card-text">
              The voices a model writes in when it drafts questions and
              explanations for a track.
            </p>
          </li>
        </ul>
      </section>
    </main>
  );
}
