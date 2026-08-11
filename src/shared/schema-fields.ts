import { z } from "zod";

/**
 * Reusable field schemas for form input.
 *
 * Browser form fields always arrive as strings, so these helpers own the
 * string-to-domain conversion (trimming, empty-to-null, numeric parsing, closed
 * unions) in one place. Client-side attributes such as `required` or `max` are
 * conveniences only; these schemas decide what is valid.
 */

/** Treats empty and whitespace-only submissions as "not provided". */
export const optionalText = (limit: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length <= limit, {
      message: `Use ${limit} characters or fewer.`,
    })
    .transform((value) => (value.length === 0 ? null : value));

export const requiredText = (label: string, limit: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: `${label} is required.` })
    .refine((value) => value.length <= limit, {
      message: `Use ${limit} characters or fewer.`,
    });

export const optionalNumber = (options: {
  readonly message: string;
  readonly min: number;
  readonly max: number;
}) =>
  z
    .string()
    .transform((value) => value.trim())
    .transform((value, context) => {
      if (value.length === 0) {
        return null;
      }

      const parsed = Number(value);

      if (
        !Number.isFinite(parsed) ||
        parsed < options.min ||
        parsed > options.max
      ) {
        context.addIssue({ code: "custom", message: options.message });
        return z.NEVER;
      }

      return parsed;
    });

export const integerInRange = (options: {
  readonly message: string;
  readonly min: number;
  readonly max: number;
}) =>
  z
    .string()
    .transform((value) => value.trim())
    .transform((value, context) => {
      const parsed = Number(value);

      if (
        !Number.isInteger(parsed) ||
        parsed < options.min ||
        parsed > options.max
      ) {
        context.addIssue({ code: "custom", message: options.message });
        return z.NEVER;
      }

      return parsed;
    });

export const optionalIntegerInRange = (options: {
  readonly message: string;
  readonly min: number;
  readonly max: number;
}) =>
  z
    .string()
    .transform((value) => value.trim())
    .transform((value, context) => {
      if (value.length === 0) {
        return null;
      }

      const parsed = Number(value);

      if (
        !Number.isInteger(parsed) ||
        parsed < options.min ||
        parsed > options.max
      ) {
        context.addIssue({ code: "custom", message: options.message });
        return z.NEVER;
      }

      return parsed;
    });

/**
 * Closed union of allowed literal values, preserving the domain union type.
 *
 * `z.enum` alone widens to `string` when built from a `readonly T[]`, so the
 * value is matched back against the source list. That keeps the schema output
 * assignable to the domain type instead of a bare string.
 */
export const enumOf = <Value extends string>(
  values: readonly Value[],
  message: string,
) =>
  z.string().transform((value, context): Value => {
    const matched = values.find((candidate) => candidate === value);

    if (matched === undefined) {
      context.addIssue({ code: "custom", message });
      return z.NEVER;
    }

    return matched;
  });

/** Calendar date, stored as `YYYY-MM-DD` with no time component. */
export const optionalCalendarDate = z
  .string()
  .transform((value) => value.trim())
  .transform((value, context) => {
    if (value.length === 0) {
      return null;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      context.addIssue({
        code: "custom",
        message: "Use the date format YYYY-MM-DD.",
      });
      return z.NEVER;
    }

    // `Date.parse` silently rolls an impossible date over ("2026-02-30"
    // becomes 2 March), so the parsed value is compared back to the input.
    const parsed = new Date(`${value}T00:00:00Z`);

    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    ) {
      context.addIssue({
        code: "custom",
        message: "That date does not exist.",
      });
      return z.NEVER;
    }

    return value;
  });
