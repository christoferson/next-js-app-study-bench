import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_SIZE,
  LEGACY_TEXT_SIZES,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  clampTextSize,
  describeTextSize,
  describeTextSizeHint,
  isTextSize,
  stepTextSize,
  toTextSize,
} from "./text-size";

/** Every size the application offers, for exhaustive checks. */
const EVERY_SIZE = Array.from(
  { length: MAX_TEXT_SIZE - MIN_TEXT_SIZE + 1 },
  (_unused, index) => MIN_TEXT_SIZE + index,
);

/**
 * The guard every stored preference passes through.
 *
 * The property that matters is that `toTextSize` is total: it is fed a raw cookie value,
 * which is a request header anybody can edit, and its result is written into an inline
 * `style` attribute on `<html>`. Returning the caller's string for anything unexpected
 * would put arbitrary text in that attribute, so the tests below are mostly about values
 * this application never writes.
 */
describe("toTextSize", () => {
  it.each(EVERY_SIZE)("accepts %d, which is a size this app writes", (size) => {
    expect(toTextSize(String(size))).toBe(size);
    expect(toTextSize(size)).toBe(size);
  });

  it("falls back to the default when nothing has been chosen", () => {
    expect(toTextSize(null)).toBe(DEFAULT_TEXT_SIZE);
    expect(toTextSize(undefined)).toBe(DEFAULT_TEXT_SIZE);
    expect(toTextSize("")).toBe(DEFAULT_TEXT_SIZE);
    expect(toTextSize("   ")).toBe(DEFAULT_TEXT_SIZE);
    // 16 is the browser's own default, which is the size every screen was built at.
    expect(DEFAULT_TEXT_SIZE).toBe(16);
  });

  it.each([
    MIN_TEXT_SIZE - 1,
    MAX_TEXT_SIZE + 1,
    0,
    -16,
    999,
    Number.MAX_SAFE_INTEGER,
  ])("refuses %d rather than clamping it into range", (value) => {
    // Out of range is treated as *not a size*, not as "the nearest size". A cookie holding
    // 999 was not written by this application, so it says nothing about what the owner
    // wanted, and honouring it as "the largest" would invent an intention. Clamping is for
    // the stepper, which knows a button was pressed.
    expect(toTextSize(String(value))).toBe(DEFAULT_TEXT_SIZE);
    expect(toTextSize(value)).toBe(DEFAULT_TEXT_SIZE);
  });

  it.each([16.5, 15.999, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses %d because a size is a whole number of pixels",
    (value) => {
      expect(toTextSize(value)).toBe(DEFAULT_TEXT_SIZE);
    },
  );

  it.each([
    "sixteen",
    "16px",
    "16.5",
    "1e2",
    "0x10",
    " 16 ",
    "16 18",
    "enormous",
    '"><script>',
    '" onload="alert(1)',
  ])(
    "falls back to the default for %j rather than passing it through",
    (value) => {
      // "16px" in particular: `parseInt` would read 16 out of it, and a trailing unit means
      // the cookie was edited by hand, so it is not a value to honour.
      expect(toTextSize(value)).toBe(DEFAULT_TEXT_SIZE);
    },
  );

  it("never returns anything that is not a whole number in range", () => {
    for (const value of [
      "12",
      "24",
      "999",
      "nonsense",
      "",
      null,
      undefined,
      "compact",
      Number.NaN,
    ]) {
      const result = toTextSize(value);

      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(MIN_TEXT_SIZE);
      expect(result).toBeLessThanOrEqual(MAX_TEXT_SIZE);
    }
  });
});

/**
 * The retired presets.
 *
 * This setting shipped as three named sizes, and a cookie written by that version is sent
 * for up to a year afterwards. Dropping it would silently reset the interface of the one
 * owner this application has, so each name maps to the pixel size it actually rendered at.
 */
describe("legacy preset migration", () => {
  it("keeps the size each retired preset rendered at", () => {
    // `compact` was the untouched 16px browser default, `comfortable` was 112.5% of it, and
    // `large` was 125%.
    expect(toTextSize("compact")).toBe(16);
    expect(toTextSize("comfortable")).toBe(18);
    expect(toTextSize("large")).toBe(20);
  });

  it("migrates to sizes that are themselves valid", () => {
    for (const size of Object.values(LEGACY_TEXT_SIZES)) {
      expect(isTextSize(size)).toBe(true);
    }
  });

  it("covers every preset the old version could have written, and nothing else", () => {
    expect(Object.keys(LEGACY_TEXT_SIZES).sort()).toEqual([
      "comfortable",
      "compact",
      "large",
    ]);
  });

  it("does not migrate a near-match, which the old version never wrote either", () => {
    expect(toTextSize("Large")).toBe(DEFAULT_TEXT_SIZE);
    expect(toTextSize("LARGE")).toBe(DEFAULT_TEXT_SIZE);
    expect(toTextSize(" large")).toBe(DEFAULT_TEXT_SIZE);
    expect(toTextSize("largest")).toBe(DEFAULT_TEXT_SIZE);
  });
});

describe("isTextSize", () => {
  it.each(EVERY_SIZE)("accepts %d", (size) => {
    expect(isTextSize(size)).toBe(true);
  });

  it.each([MIN_TEXT_SIZE - 1, MAX_TEXT_SIZE + 1, 16.5, Number.NaN, 0])(
    "rejects %d",
    (value) => {
      expect(isTextSize(value)).toBe(false);
    },
  );
});

/**
 * Clamping, which is what the *controls* use.
 *
 * The difference from `toTextSize` is who is asking. A cookie holding 999 is not a request;
 * a stepper computing 25 from a press at 24 is, and the honest answer to it is 24.
 */
describe("clampTextSize", () => {
  it("holds at the bounds instead of walking past them", () => {
    expect(clampTextSize(MIN_TEXT_SIZE - 5)).toBe(MIN_TEXT_SIZE);
    expect(clampTextSize(MAX_TEXT_SIZE + 5)).toBe(MAX_TEXT_SIZE);
  });

  it("rounds to the nearest offered size rather than always downwards", () => {
    expect(clampTextSize(16.4)).toBe(16);
    expect(clampTextSize(16.6)).toBe(17);
  });

  it("returns the default for a value that is not a number at all", () => {
    expect(clampTextSize(Number.NaN)).toBe(DEFAULT_TEXT_SIZE);
    expect(clampTextSize(Number.POSITIVE_INFINITY)).toBe(DEFAULT_TEXT_SIZE);
  });
});

describe("stepTextSize", () => {
  it("moves one pixel per step", () => {
    expect(stepTextSize(16, 1)).toBe(17);
    expect(stepTextSize(16, -1)).toBe(15);
  });

  it("returns the same size at a bound, so a control can disable itself", () => {
    // The stepper compares the result with the current size to decide whether the button is
    // pressable; returning the unchanged size is what makes that comparison work.
    expect(stepTextSize(MIN_TEXT_SIZE, -1)).toBe(MIN_TEXT_SIZE);
    expect(stepTextSize(MAX_TEXT_SIZE, 1)).toBe(MAX_TEXT_SIZE);
  });

  it("never leaves the offered range", () => {
    for (const size of EVERY_SIZE) {
      for (const steps of [-99, -1, 0, 1, 99]) {
        expect(isTextSize(stepTextSize(size, steps))).toBe(true);
      }
    }
  });
});

describe("text size descriptions", () => {
  it("names the size with its unit, so the number is not read as a level", () => {
    expect(describeTextSize(16)).toBe("16px");
    expect(describeTextSize(MAX_TEXT_SIZE)).toBe("24px");
  });

  it("says which size is the default, so an unset setting is recognisable", () => {
    expect(describeTextSizeHint(DEFAULT_TEXT_SIZE)).toMatch(/default/i);
    expect(describeTextSizeHint(MAX_TEXT_SIZE)).not.toMatch(/default/i);
  });

  it("describes every size it could be asked about", () => {
    for (const size of EVERY_SIZE) {
      expect(describeTextSize(size)).toContain(String(size));
      expect(describeTextSizeHint(size).length).toBeGreaterThan(0);
    }
  });
});
