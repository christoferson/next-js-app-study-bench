import { z } from "zod";
import {
  MAX_PRIORITY,
  MAX_SESSION_MINUTES,
  MIN_PRIORITY,
  MIN_SESSION_MINUTES,
  STUDY_TYPES,
} from "@/modules/certifications/domain/certification";
import { SELECTABLE_OBJECTIVE_SOURCE_TYPES } from "@/modules/certifications/domain/objective";
import { ValidationError } from "@/modules/certifications/domain/errors";

/**
 * Authoritative input schemas for the certification module.
 *
 * Every external value — form fields, action arguments — is parsed here before
 * it reaches a repository. Client-side constraints are conveniences only; this
 * layer decides what is valid.
 */

const TRIMMED_TEXT_LIMIT = 200;
const DESCRIPTION_LIMIT = 2000;

/** Treats empty and whitespace-only submissions as "not provided". */
const optionalText = (limit: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length <= limit, {
      message: `Use ${limit} characters or fewer.`,
    })
    .transform((value) => (value.length === 0 ? null : value));

const requiredText = (label: string, limit: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: `${label} is required.` })
    .refine((value) => value.length <= limit, {
      message: `Use ${limit} characters or fewer.`,
    });

const optionalNumber = (options: {
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

const integerInRange = (options: {
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

/** Calendar date, stored as `YYYY-MM-DD` with no time component. */
const optionalCalendarDate = z
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

export const certificationInputSchema = z.object({
  name: requiredText("Name", TRIMMED_TEXT_LIMIT),
  provider: requiredText("Provider", TRIMMED_TEXT_LIMIT),
  examCode: optionalText(TRIMMED_TEXT_LIMIT),
  version: optionalText(TRIMMED_TEXT_LIMIT),
  studyType: z.enum(STUDY_TYPES as [string, ...string[]]).transform((value) => {
    const studyType = STUDY_TYPES.find((candidate) => candidate === value);

    if (studyType === undefined) {
      throw new Error("Unreachable: enum guarantees a known study type.");
    }

    return studyType;
  }),
  description: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length <= DESCRIPTION_LIMIT, {
      message: `Use ${DESCRIPTION_LIMIT} characters or fewer.`,
    }),
  targetDate: optionalCalendarDate,
  priority: integerInRange({
    message: `Choose a priority between ${MIN_PRIORITY} and ${MAX_PRIORITY}.`,
    min: MIN_PRIORITY,
    max: MAX_PRIORITY,
  }),
  defaultSessionMinutes: integerInRange({
    message: `Choose a session length between ${MIN_SESSION_MINUTES} and ${MAX_SESSION_MINUTES} minutes.`,
    min: MIN_SESSION_MINUTES,
    max: MAX_SESSION_MINUTES,
  }),
});

export type CertificationInput = z.output<typeof certificationInputSchema>;

export const objectiveInputSchema = z.object({
  parentObjectiveId: optionalText(TRIMMED_TEXT_LIMIT),
  code: optionalText(TRIMMED_TEXT_LIMIT),
  title: requiredText("Title", TRIMMED_TEXT_LIMIT),
  description: optionalText(DESCRIPTION_LIMIT),
  weight: optionalNumber({
    message: "Use a weight between 0 and 100, or leave it blank.",
    min: 0,
    max: 100,
  }),
  sourceType: z
    .enum(SELECTABLE_OBJECTIVE_SOURCE_TYPES as [string, ...string[]])
    .transform((value) => {
      const sourceType = SELECTABLE_OBJECTIVE_SOURCE_TYPES.find(
        (candidate) => candidate === value,
      );

      if (sourceType === undefined) {
        throw new Error("Unreachable: enum guarantees a known source type.");
      }

      return sourceType;
    }),
});

export type ObjectiveInput = z.output<typeof objectiveInputSchema>;

export const moveDirectionSchema = z.enum(["UP", "DOWN"]);

export type MoveDirection = z.output<typeof moveDirectionSchema>;

/**
 * Parses external input, converting a schema failure into a `ValidationError`
 * whose messages are already grouped by field name.
 */
export function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const result = schema.safeParse(value);

  if (result.success) {
    return result.data;
  }

  throw new ValidationError(toFieldMessages(result.error));
}

function toFieldMessages(
  error: z.ZodError,
): Readonly<Record<string, readonly string[]>> {
  const messages: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const field = issue.path.map((segment) => String(segment)).join(".");
    const existing = messages[field] ?? [];
    existing.push(issue.message);
    messages[field] = existing;
  }

  return messages;
}
