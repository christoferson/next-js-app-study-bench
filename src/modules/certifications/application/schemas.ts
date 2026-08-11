import { z } from "zod";
import {
  enumOf,
  integerInRange,
  optionalCalendarDate,
  optionalNumber,
  optionalText,
  requiredText,
} from "@/shared/schema-fields";
import {
  MAX_PRIORITY,
  MAX_SESSION_MINUTES,
  MIN_PRIORITY,
  MIN_SESSION_MINUTES,
  STUDY_TYPES,
} from "@/modules/certifications/domain/certification";
import { SELECTABLE_OBJECTIVE_SOURCE_TYPES } from "@/modules/certifications/domain/objective";

/**
 * Authoritative input schemas for the certification module.
 *
 * Every external value — form fields, action arguments — is parsed here before
 * it reaches a repository. Client-side constraints are conveniences only; this
 * layer decides what is valid. The reusable field helpers live in
 * `@/shared/schema-fields`; `parseInput` is re-exported so existing imports of
 * this module keep working.
 */

export { parseInput } from "@/shared/parse-input";

const TRIMMED_TEXT_LIMIT = 200;
const DESCRIPTION_LIMIT = 2000;

export const certificationInputSchema = z.object({
  name: requiredText("Name", TRIMMED_TEXT_LIMIT),
  provider: requiredText("Provider", TRIMMED_TEXT_LIMIT),
  examCode: optionalText(TRIMMED_TEXT_LIMIT),
  version: optionalText(TRIMMED_TEXT_LIMIT),
  studyType: enumOf(STUDY_TYPES, "Choose a study type."),
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
  sourceType: enumOf(SELECTABLE_OBJECTIVE_SOURCE_TYPES, "Choose a source."),
});

export type ObjectiveInput = z.output<typeof objectiveInputSchema>;

export const moveDirectionSchema = z.enum(["UP", "DOWN"]);

export type MoveDirection = z.output<typeof moveDirectionSchema>;
