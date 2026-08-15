import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE } from "@/shared/ui/form-state";
import {
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
} from "@/modules/appearance/domain/text-size";
import { TextSizeForm } from "./text-size-form";

/**
 * The text-size form on `/settings/appearance`.
 *
 * Three things can go wrong here that the action cannot catch. Offering a size outside the
 * range, which is why the bounds are asserted from the domain rather than as literals.
 * Failing to show the size currently in force — a setting whose field reads 16 whatever the
 * application is rendering at looks like it forgot what the owner chose. And letting the
 * stepper walk past a bound, which would submit a value the action then rejects, so the
 * owner presses a button and gets an error instead of nothing.
 */
function action() {
  const calls: FormData[] = [];
  const fn = vi.fn(
    async (_state: FormState, form: FormData): Promise<FormState> => {
      calls.push(form);

      return IDLE_FORM_STATE;
    },
  );

  return { fn, calls };
}

function field(): HTMLInputElement {
  return screen.getByLabelText(/text size in pixels/i) as HTMLInputElement;
}

describe("TextSizeForm", () => {
  it("offers the whole range the application accepts, and no more", () => {
    render(<TextSizeForm action={action().fn} current={16} />);

    expect(field()).toHaveAttribute("min", String(MIN_TEXT_SIZE));
    expect(field()).toHaveAttribute("max", String(MAX_TEXT_SIZE));
    expect(field()).toHaveAttribute("step", "1");
  });

  it.each([12, 16, 19, 24])(
    "shows %d as the size in force when it is",
    (size) => {
      render(<TextSizeForm action={action().fn} current={size} />);

      expect(field().value).toBe(String(size));
    },
  );

  it("says which size is the default, so an unset setting is recognisable", () => {
    render(<TextSizeForm action={action().fn} current={16} />);

    expect(screen.getByText(/the default/i)).toBeVisible();
  });

  it("submits the size in the field", async () => {
    const { fn, calls } = action();

    render(<TextSizeForm action={fn} current={16} />);
    await userEvent.clear(field());
    await userEvent.type(field(), "21");
    await userEvent.click(
      screen.getByRole("button", { name: /save text size/i }),
    );

    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls[0]?.get("textSize")).toBe("21");
  });

  it("steps one pixel at a time in either direction", async () => {
    render(<TextSizeForm action={action().fn} current={16} />);

    await userEvent.click(screen.getByRole("button", { name: /larger text/i }));
    expect(field().value).toBe("17");

    await userEvent.click(
      screen.getByRole("button", { name: /smaller text/i }),
    );
    expect(field().value).toBe("16");
  });

  it("disables the button that would leave the range", () => {
    // A control that accepts a press and submits something the action then refuses is worse
    // than one that says it has run out of room.
    render(<TextSizeForm action={action().fn} current={MAX_TEXT_SIZE} />);

    expect(screen.getByRole("button", { name: /larger text/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /smaller text/i })).toBeEnabled();
  });

  it("disables the smaller button at the bottom of the range", () => {
    render(<TextSizeForm action={action().fn} current={MIN_TEXT_SIZE} />);

    expect(
      screen.getByRole("button", { name: /smaller text/i }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /larger text/i })).toBeEnabled();
  });

  it("keeps a half-typed number rather than rewriting it under the cursor", async () => {
    // "1" is a state the owner passes through on the way to "19". Coercing each keystroke to
    // a valid size would turn it into 12 and lose the second digit.
    render(<TextSizeForm action={action().fn} current={16} />);
    await userEvent.clear(field());
    await userEvent.type(field(), "1");

    expect(field().value).toBe("1");
  });

  it("steps from the size in force when the field has no number in it", async () => {
    // An empty field has no size to step from, so the buttons fall back to what the page is
    // rendering at instead of jumping to a bound.
    render(<TextSizeForm action={action().fn} current={18} />);
    await userEvent.clear(field());
    await userEvent.click(screen.getByRole("button", { name: /larger text/i }));

    expect(field().value).toBe("19");
  });

  it("gives both glyph buttons an accessible name", () => {
    // They are a plus and a minus with no text, so the label is the only name they have.
    render(<TextSizeForm action={action().fn} current={16} />);

    expect(
      screen.getByRole("button", { name: "Smaller text" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Larger text" }),
    ).toBeInTheDocument();
  });

  it("shows a refusal beside the field rather than throwing", async () => {
    const fn = vi.fn(async (): Promise<FormState> => ({
      status: "invalid",
      fieldErrors: {
        textSize: ["Choose a whole text size between 12 and 24 pixels."],
      },
      values: {},
    }));

    render(<TextSizeForm action={fn} current={16} />);
    await userEvent.click(
      screen.getByRole("button", { name: /save text size/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /between 12 and 24 pixels/i,
    );
    expect(field()).toHaveAttribute("aria-invalid", "true");
  });
});
