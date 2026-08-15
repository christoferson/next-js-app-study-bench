"use client";

import { useState, useTransition } from "react";
import { Minus, Plus } from "lucide-react";
import type { TextSize } from "@/modules/appearance/domain/text-size";
import {
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  describeTextSize,
  stepTextSize,
} from "@/modules/appearance/domain/text-size";

interface TextSizeStepperProps {
  /** Sets the cookie and revalidates the layout. Takes the size, not a `FormData`. */
  readonly action: (size: number) => Promise<void>;
  /** The size this request rendered at, read from the cookie by the layout. */
  readonly current: TextSize;
}

/**
 * The "Aa" control in the header: smaller, larger, and the size it is now.
 *
 * **Why it lives in the header at all.** Text size is the one appearance decision made
 * *while reading*, not while configuring — the owner discovers a question is too small in
 * the middle of studying it, and a control on a settings page two navigations away means
 * they squint instead. It is on every page for the same reason the size applies to every
 * page.
 *
 * **A stepper, not a slider.** Two buttons and a number is the whole interface. A range
 * input would need a label, a visible value anyway, and a drag on a touch screen where the
 * target is a header 2rem tall; the stepper is two taps for two pixels and is operable from
 * the keyboard without any of that. Each press is one pixel, so the owner converges on the
 * size they want by feel rather than by choosing a number.
 *
 * **The optimistic size, and why it is honest.** The button applies the new size to the
 * document immediately and then asks the server to store it. Waiting for the round trip
 * would make each press feel broken at exactly the moment the owner is pressing it
 * repeatedly. The local state is the size *being requested*; the cookie is the size that is
 * *stored*, and `current` overrides the local value on every fresh render, so a save that
 * failed shows the stored size again on the next navigation rather than lying indefinitely.
 *
 * `document.documentElement.style.fontSize` is written directly because that is what the
 * layout would have rendered: the value is a whole number this module produced, not text
 * from a request, so there is nothing to escape.
 *
 * At a bound the button is `disabled` — the size cannot go further, and a control that
 * accepts a press and does nothing is worse than one that says so.
 */
export function TextSizeStepper({ action, current }: TextSizeStepperProps) {
  const [requested, setRequested] = useState<TextSize | null>(null);
  const [, startTransition] = useTransition();
  // The stored size wins whenever it changes: a navigation re-renders this with the cookie's
  // value, which is the truth. `requested` only covers the gap before that happens.
  const [seen, setSeen] = useState<TextSize>(current);

  if (seen !== current) {
    setSeen(current);
    setRequested(null);
  }

  const size = requested ?? current;

  function apply(steps: number): void {
    const next = stepTextSize(size, steps);

    if (next === size) {
      return;
    }

    setRequested(next);
    document.documentElement.style.fontSize = `${next}px`;

    startTransition(async () => {
      await action(next);
    });
  }

  return (
    <div className="text-size-stepper">
      {/* "Aa" names the control the way every reading application names it, and the
          visually-hidden words say what it does for a screen reader that cannot see the
          two letters are different sizes. */}
      <span aria-hidden="true" className="text-size-stepper-mark">
        Aa
      </span>
      <span className="visually-hidden" id="text-size-stepper-label">
        Text size
      </span>

      <button
        type="button"
        className="text-size-stepper-button"
        onClick={() => apply(-1)}
        disabled={size <= MIN_TEXT_SIZE}
        aria-label="Smaller text"
      >
        <Minus aria-hidden="true" className="text-size-stepper-icon" />
      </button>

      {/* `aria-live` so the new size is announced when it changes: the owner pressing
          "larger" from the keyboard gets the same feedback as the one watching the page
          reflow. */}
      <output
        aria-live="polite"
        className="text-size-stepper-value"
        htmlFor="text-size-stepper-label"
      >
        {describeTextSize(size)}
      </output>

      <button
        type="button"
        className="text-size-stepper-button"
        onClick={() => apply(1)}
        disabled={size >= MAX_TEXT_SIZE}
        aria-label="Larger text"
      >
        <Plus aria-hidden="true" className="text-size-stepper-icon" />
      </button>
    </div>
  );
}
