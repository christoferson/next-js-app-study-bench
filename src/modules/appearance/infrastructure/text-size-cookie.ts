import { cookies } from "next/headers";
import type { TextSize } from "@/modules/appearance/domain/text-size";
import { toTextSize } from "@/modules/appearance/domain/text-size";

/**
 * Where the chosen text size is kept.
 *
 * **A cookie, not a table.** `SPEC.md`'s logical model has an `app_settings` table, and
 * it does not exist yet — nothing has needed it. This preference is a deliberate reason
 * *not* to create it: the root layout needs the value on every single request, before
 * any markup is produced, and a database read on the critical path of every page to
 * fetch one word is a cost with nothing to show for it. The request already carries the
 * value it needs.
 *
 * **Not `httpOnly`.** The server is the only thing that reads this, so `httpOnly` would
 * cost nothing — but it also protects nothing. There is no secret here: the value is a
 * number between 12 and 24, it is visible in the rendered root font size anyway, and an
 * attacker who could read it would learn how large the owner likes their text. Left
 * readable so a future client-side control could set it without a round trip, which is
 * the only plausible next step for this setting.
 *
 * `sameSite: "lax"` because nothing cross-site should be able to reshape the owner's
 * interface, and no cross-site request needs to. `secure` follows the deployment rather
 * than being hardcoded: a `secure` cookie is dropped on `http://localhost`, which would
 * make the setting appear not to save during development.
 *
 * The migration this file avoids is the point worth restating: no schema change ships
 * with this feature, and `app_settings` stays uncreated until a preference arrives that
 * genuinely belongs to the owner's data rather than to their browser.
 *
 * **The name survived the change from presets to pixels.** A cookie written by the earlier
 * version holds `compact`, `comfortable`, or `large`, and it will keep being sent for up to
 * a year. Renaming the cookie would have orphaned that value; instead the domain guard
 * translates it, so an owner who had chosen a preset keeps the size it rendered at.
 */
export const TEXT_SIZE_COOKIE_NAME = "studybench_text_size";

/**
 * One year.
 *
 * A display preference should outlast the browser session by a long way — an owner who
 * chose 20px once should not have to choose it again next month. A year is long
 * enough to feel permanent and short enough that an abandoned browser eventually
 * forgets. There is no expiry the owner can be surprised by, because the cookie is
 * rewritten every time the setting is saved.
 */
export const TEXT_SIZE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * The cookie attributes, as one value.
 *
 * Exported so the action that writes the cookie and the test that pins these choices
 * read the same object rather than two copies that can drift.
 */
export const TEXT_SIZE_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax",
  httpOnly: false,
  maxAge: TEXT_SIZE_COOKIE_MAX_AGE_SECONDS,
} as const;

/**
 * The size this request should render at.
 *
 * Read on the server, in the root layout, so the correct size is in the first byte of
 * HTML. That is the reason this is a cookie and not `localStorage`: a client-side read
 * happens after the document has already painted, and the owner would watch the page
 * jump from one size to another on every navigation.
 *
 * Whatever the header holds goes through the domain guard, so an absent, empty, or
 * hand-edited cookie renders at the default rather than putting an unknown string into
 * an HTML attribute.
 */
export async function readTextSizeCookie(): Promise<TextSize> {
  const store = await cookies();

  return toTextSize(store.get(TEXT_SIZE_COOKIE_NAME)?.value);
}
