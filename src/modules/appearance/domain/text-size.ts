/**
 * How large the interface renders, in pixels.
 *
 * A study application is read for long stretches, often on a phone held at arm's
 * length, and the one thing an owner cannot work around is text that is too small to
 * read comfortably. The browser's own zoom reflows the layout; this sets the root font
 * size instead, so every `rem` in the stylesheet grows together and the measure, the
 * spacing scale, and the touch targets keep their proportions.
 *
 * **A number rather than three named presets.** The first version of this setting offered
 * `compact`, `comfortable`, and `large`. Three steps is the wrong granularity for the one
 * decision the owner is actually making — "a bit bigger than this" — and naming the steps
 * invited the question of what the names meant. A pixel size between 12 and 24 answers
 * that question by being the answer, is steppable one unit at a time from a control in the
 * header, and needs no vocabulary.
 *
 * Domain code: no framework, no cookie, no database, no environment. The name of the
 * cookie and the act of reading it belong to infrastructure; what a valid size is, and
 * what to do with a value that is not one, belongs here.
 */

/**
 * A root font size in pixels, guaranteed to be a whole number within bounds.
 *
 * Not a branded type, because every producer in this module goes through `toTextSize` or
 * `clampTextSize` and there is nowhere else a size is made. The bound worth enforcing is
 * enforced by those two functions being the only way in.
 */
export type TextSize = number;

/**
 * The smallest offered size.
 *
 * Below 12px the interface stops being readable rather than becoming dense: the badge and
 * label styles are 0.75rem, which is already 9px at this bound.
 */
export const MIN_TEXT_SIZE = 12;

/**
 * The largest offered size.
 *
 * 24px is a 50% enlargement, at which a 360px screen still fits an answer choice on two
 * lines. Beyond it the owner wants browser zoom, which reflows to a layout built for the
 * width they end up with.
 */
export const MAX_TEXT_SIZE = 24;

/**
 * The size used when nothing has been chosen.
 *
 * 16 is the browser's own default and the size every screen here was built and reviewed
 * at, so an owner who has never touched the control sees exactly what they saw before this
 * setting existed.
 */
export const DEFAULT_TEXT_SIZE: TextSize = 16;

/** How much one press of the header stepper moves the size. */
export const TEXT_SIZE_STEP = 1;

/**
 * What the three retired presets become.
 *
 * An owner who chose a size before this change has that choice in a cookie that will
 * still be sent for a year, and dropping it would silently reset their interface. Each
 * preset maps to the pixel size it actually rendered at: `compact` was the untouched 16px
 * browser default, `comfortable` was 112.5% of it, and `large` was 125%.
 *
 * Kept as data rather than as a branch in the guard so the mapping is testable and so it
 * is obvious where to delete it once no such cookie can plausibly still exist.
 */
export const LEGACY_TEXT_SIZES: Readonly<Record<string, TextSize>> = {
  compact: 16,
  comfortable: 18,
  large: 20,
};

/**
 * Forces any number into the offered range, as a whole number.
 *
 * Used by the stepper, which computes "one more than the current size" and would
 * otherwise walk past the bound. Rounds rather than truncates so a fractional value from
 * anywhere lands on the nearest offered size instead of always the lower one.
 */
export function clampTextSize(value: number): TextSize {
  if (!Number.isFinite(value)) {
    return DEFAULT_TEXT_SIZE;
  }

  return Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, Math.round(value)));
}

/** Whether a number is one of the sizes this application offers. */
export function isTextSize(value: number): boolean {
  return (
    Number.isInteger(value) && value >= MIN_TEXT_SIZE && value <= MAX_TEXT_SIZE
  );
}

/**
 * Reads a stored or submitted value as a size, falling back to the default.
 *
 * The guard the cookie goes through. It cannot throw and it cannot return anything but a
 * whole number between {@link MIN_TEXT_SIZE} and {@link MAX_TEXT_SIZE}, which is the whole
 * point: the value arrives from a request header that anybody can set to anything, and it
 * is on its way into an inline `style` attribute. An unrecognised value is not an error to
 * report — there is no form to report it on, and a page that refused to render because a
 * cookie was edited would be a worse outcome than one that renders at the default size.
 *
 * Out of range is treated as *not a size* rather than clamped, deliberately. `"999"` was
 * not written by this application, so it says nothing about what the owner wanted, and
 * honouring it as "the largest" would be inventing an intention. Clamping is for the
 * stepper, which knows the owner pressed a button.
 *
 * A retired preset name is the one string that is neither a number nor nonsense, and it is
 * translated rather than discarded.
 */
export function toTextSize(
  value: string | number | null | undefined,
): TextSize {
  if (typeof value === "number") {
    return isTextSize(value) ? value : DEFAULT_TEXT_SIZE;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return DEFAULT_TEXT_SIZE;
  }

  const legacy = LEGACY_TEXT_SIZES[value];

  if (legacy !== undefined) {
    return legacy;
  }

  // `Number` rather than `parseInt`: `parseInt("16px")` is 16, and "16px" is not a value
  // this application ever wrote. A trailing unit means the cookie was edited by hand.
  const parsed = Number(value);

  return isTextSize(parsed) ? parsed : DEFAULT_TEXT_SIZE;
}

/**
 * The size one press of the stepper away, clamped.
 *
 * Returning the unchanged size at a bound rather than refusing is what lets the control
 * disable its own button: the caller compares the result with the current size.
 */
export function stepTextSize(size: TextSize, steps: number): TextSize {
  return clampTextSize(size + steps * TEXT_SIZE_STEP);
}

/**
 * How the size is written where the owner reads it.
 *
 * The unit is spelled out because the number alone ("16") would read as a level or a
 * count. `px` is the honest unit: it is literally what goes into the root font size.
 */
export function describeTextSize(size: TextSize): string {
  return `${size}px`;
}

/**
 * The sentence under the control.
 *
 * Says where the size applies and marks the default, so an owner can tell "the setting is
 * off" from "I chose 16".
 */
export function describeTextSizeHint(size: TextSize): string {
  return size === DEFAULT_TEXT_SIZE
    ? `${describeTextSize(size)} — the default. Every page scales from here.`
    : `${describeTextSize(size)}. Every page scales from here.`;
}
