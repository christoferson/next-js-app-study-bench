import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_FORM_STATE } from "@/shared/ui/form-state";
import {
  TEXT_SIZE_COOKIE_MAX_AGE_SECONDS,
  TEXT_SIZE_COOKIE_NAME,
} from "@/modules/appearance/infrastructure/text-size-cookie";

/**
 * The action that writes the preference.
 *
 * The cookie jar is a double, because what is worth pinning is the *shape* of the write
 * rather than Next's header serialization: the name the layout reads back, the
 * attributes that decide whether the value survives a navigation, and the fact that a
 * submission the schema rejects writes nothing at all.
 *
 * The last property is the security-relevant one. `toTextSize` guards the read path, so
 * an unknown cookie value cannot reach the markup — but a cookie the application itself
 * wrote from an unvalidated submission would be an unknown value stored under a name the
 * application trusts, and one round trip later it is the same problem in a different
 * place.
 */
const set = vi.fn<(name: string, value: string, options: unknown) => void>();
const revalidatePath = vi.fn<(path: string, type?: string) => void>();

vi.mock("next/headers", () => ({
  cookies: async () => ({ set }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string, type?: string) => revalidatePath(path, type),
}));

const { saveTextSizeAction, setTextSizeAction } = await import("./actions");

function submit(textSize: string) {
  const form = new FormData();

  form.set("textSize", textSize);

  return saveTextSizeAction(IDLE_FORM_STATE, form);
}

describe("saveTextSizeAction", () => {
  beforeEach(() => {
    set.mockReset();
    revalidatePath.mockReset();
  });

  it("stores the chosen size under the name the layout reads", async () => {
    const state = await submit("20");

    expect(state).toEqual(IDLE_FORM_STATE);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0]?.[0]).toBe(TEXT_SIZE_COOKIE_NAME);
    // A cookie value is a string; the number is stringified on the way in and parsed back
    // by the domain guard on the way out.
    expect(set.mock.calls[0]?.[1]).toBe("20");
  });

  it("stores it for the whole application and for a long time", async () => {
    await submit("18");

    expect(set.mock.calls[0]?.[2]).toMatchObject({
      path: "/",
      maxAge: TEXT_SIZE_COOKIE_MAX_AGE_SECONDS,
    });
    // A year, so a size chosen once is not chosen again next month.
    expect(TEXT_SIZE_COOKIE_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 365);
  });

  it("keeps the cookie same-site and readable, because it holds no secret", async () => {
    // `lax`: nothing cross-site should be able to reshape the owner's interface. Not
    // `httpOnly`: the value is a number between 12 and 24 and is visible in the rendered
    // root font size regardless, so hiding it from script protects nothing.
    await submit("20");

    expect(set.mock.calls[0]?.[2]).toMatchObject({
      sameSite: "lax",
      httpOnly: false,
    });
  });

  it("does not require HTTPS outside production, so the setting saves locally", async () => {
    // A `secure` cookie is dropped over plain HTTP, which would look exactly like a
    // broken save on `http://localhost`.
    await submit("20");

    expect(set.mock.calls[0]?.[2]).toMatchObject({ secure: false });
  });

  it("revalidates the whole layout, not just the page that was saved", async () => {
    // The size lives on `<html>`, which the root layout renders, so every cached page
    // was rendered with the old value.
    await submit("20");

    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it.each([
    "",
    " ",
    "large",
    "enormous",
    "11",
    "25",
    "0",
    "999",
    "-16",
    "16.5",
    "16px",
  ])("writes nothing when %j is submitted", async (value) => {
    const state = await submit(value);

    expect(state.status).toBe("invalid");
    expect(state.fieldErrors.textSize).toEqual([
      "Choose a whole text size between 12 and 24 pixels.",
    ]);
    expect(set).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("writes nothing when the field is missing entirely", async () => {
    const state = await saveTextSizeAction(IDLE_FORM_STATE, new FormData());

    expect(state.status).toBe("invalid");
    expect(set).not.toHaveBeenCalled();
  });

  it.each([12, 16, 24])("accepts %d, which is in range", async (size) => {
    const state = await submit(String(size));

    expect(state).toEqual(IDLE_FORM_STATE);
    expect(set.mock.calls[0]?.[1]).toBe(String(size));
  });
});

/**
 * The action behind the header stepper.
 *
 * The security-relevant property is the same one the form action has, and it is worth
 * asserting separately because this one takes a `number` argument rather than a `FormData`.
 * A Server Action is a POST endpoint: "the parameter is typed `number`" is a claim about
 * this repository's own callers, not about the request, so anything can call it with
 * anything and the schema is what stands between that and the cookie.
 */
describe("setTextSizeAction", () => {
  beforeEach(() => {
    set.mockReset();
    revalidatePath.mockReset();
  });

  it("stores a size the owner stepped to, and revalidates the layout", async () => {
    await setTextSizeAction(19);

    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0]?.[0]).toBe(TEXT_SIZE_COOKIE_NAME);
    expect(set.mock.calls[0]?.[1]).toBe("19");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it.each([11, 25, 0, -16, 16.5, Number.NaN, Number.POSITIVE_INFINITY, 1e21])(
    "writes nothing when called with %p",
    async (value) => {
      // Returns quietly rather than throwing: the header is not a form and has nowhere to
      // put a message, and the stepper re-renders at the stored size on the next
      // navigation. What matters is that nothing unvalidated reaches the cookie.
      await expect(setTextSizeAction(value)).resolves.toBeUndefined();

      expect(set).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("stores the same attributes as the form action", async () => {
    // One cookie, two writers: if these drifted, a size set from the header would expire on
    // a different schedule from one set on the settings page.
    await setTextSizeAction(20);

    expect(set.mock.calls[0]?.[2]).toMatchObject({
      path: "/",
      sameSite: "lax",
      httpOnly: false,
      maxAge: TEXT_SIZE_COOKIE_MAX_AGE_SECONDS,
      secure: false,
    });
  });
});
