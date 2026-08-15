import { z } from "zod";
import { integerInRange } from "@/shared/schema-fields";
import {
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
} from "@/modules/appearance/domain/text-size";

/**
 * Authoritative input schema for the appearance form (`spec/CODING-STANDARDS.md`
 * section 2).
 *
 * The form renders a stepper and a number input carrying `min` and `max`, and this schema
 * is what decides which values are acceptable — a submitted field is whatever was posted,
 * not whatever the browser was willing to let the owner type. The domain's `toTextSize`
 * guard is the equivalent check on the way *out* of the cookie; this one is the check on
 * the way in, and it rejects rather than falls back: here there is a form to put a message
 * on, and silently saving 16 when the owner asked for 20 would be a lie.
 *
 * The bounds are the domain's, not repeated literals, so widening the range is one edit.
 */
export const TEXT_SIZE_MESSAGE = `Choose a whole text size between ${MIN_TEXT_SIZE} and ${MAX_TEXT_SIZE} pixels.`;

export const textSizeFormSchema = z.object({
  textSize: integerInRange({
    message: TEXT_SIZE_MESSAGE,
    min: MIN_TEXT_SIZE,
    max: MAX_TEXT_SIZE,
  }),
});

export type TextSizeFormInput = z.output<typeof textSizeFormSchema>;
