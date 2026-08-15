import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEXT_SIZE_COOKIE_NAME, readTextSizeCookie } from "./text-size-cookie";

/**
 * Reading the preference off the request.
 *
 * The layout calls this before it renders anything, so it has to answer for every state
 * a request can be in — no cookie at all on a first visit, a valid one after a save, and
 * a hand-edited one at any time. None of those is an error, and none of them may reach
 * the markup unchecked: this is the boundary the domain guard sits on.
 */
const get = vi.fn<(name: string) => { value: string } | undefined>();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get }),
}));

describe("readTextSizeCookie", () => {
  beforeEach(() => {
    get.mockReset();
    get.mockReturnValue(undefined);
  });

  it("reads the size a save stored", async () => {
    get.mockReturnValue({ value: "19" });

    await expect(readTextSizeCookie()).resolves.toBe(19);
    expect(get).toHaveBeenCalledWith(TEXT_SIZE_COOKIE_NAME);
  });

  it("renders at the default on a first visit", async () => {
    await expect(readTextSizeCookie()).resolves.toBe(16);
  });

  it.each(["", "Large", "largest", '"><script>', "0", "999", "16px", "-1"])(
    "renders at the default when the cookie holds %j",
    async (value) => {
      // A cookie is a request header the owner's browser — or anything else — can set to
      // anything. The value is on its way into an inline `style` attribute, so an
      // unrecognised one becomes the default rather than being passed through.
      get.mockReturnValue({ value });

      await expect(readTextSizeCookie()).resolves.toBe(16);
    },
  );

  it.each([
    ["compact", 16],
    ["comfortable", 18],
    ["large", 20],
  ])(
    "keeps the size a %j cookie from the preset version rendered at",
    async (value, expected) => {
      // The cookie name did not change when the three presets became pixel sizes, so a
      // cookie written by that version is still sent for up to a year. It is translated
      // rather than discarded: dropping it would silently reset the owner's interface.
      get.mockReturnValue({ value: value as string });

      await expect(readTextSizeCookie()).resolves.toBe(expected);
    },
  );

  it("uses a name that says which application owns it", async () => {
    // Namespaced, because a personal deployment may share a host with something else.
    expect(TEXT_SIZE_COOKIE_NAME).toBe("studybench_text_size");
  });
});
