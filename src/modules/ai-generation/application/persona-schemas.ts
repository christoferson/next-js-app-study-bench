import { z } from "zod";
import { enumOf, optionalText, requiredText } from "@/shared/schema-fields";
import { QUESTION_TYPES } from "@/modules/question-bank/domain/question";
import { CARD_TYPES } from "@/modules/flashcards/domain/flashcard";
import { PERSONA_TEMPLATE_KEYS } from "@/modules/ai-generation/domain/persona-templates";

/**
 * Authoritative input schemas for persona management.
 *
 * A persona is prose the owner writes, so almost every rule here is a bound rather
 * than a shape: the fields are bounded because they are carried into a prompt, and an
 * unbounded persona would put the size — and the cost — of every future request outside
 * the batch limit's control.
 *
 * The three list fields arrive as textareas holding one entry per line, parsed exactly
 * the way a flashcard's vocabulary lists are (`flashcards/application/schemas.ts`): one
 * convention for the owner to learn, and no client state, so the form works
 * uncontrolled (`spec/UI-GUIDELINES.md` section 1.1).
 */

const LABEL_LIMIT = 120;
const ROLE_LIMIT = 2000;
const ENTRY_LIMIT = 500;
const MAX_ENTRIES = 25;
const LANGUAGE_INSTRUCTION_LIMIT = 1000;
const CONTENT_LANGUAGE_LIMIT = 20;
const ID_LIMIT = 200;

/**
 * A textarea holding one entry per line, with at least one entry.
 *
 * Blank lines are dropped rather than rejected, because a trailing newline is how a
 * textarea normally ends. Emptiness *is* rejected, unlike the flashcard lists: a
 * persona with no guidance and no prohibitions is not a minimal persona, it is an
 * instruction to the model to do whatever it likes.
 */
const requiredLinesSchema = (label: string) =>
  z
    .string()
    .transform((value): readonly string[] =>
      value
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    )
    .refine((lines) => lines.length > 0, {
      message: `Write at least one ${label}, one per line.`,
    })
    .refine((lines) => lines.length <= MAX_ENTRIES, {
      message: `List ${MAX_ENTRIES} entries or fewer.`,
    })
    .refine((lines) => lines.every((line) => line.length <= ENTRY_LIMIT), {
      message: `Keep each line to ${ENTRY_LIMIT} characters or fewer.`,
    });

/**
 * A checkbox group over a closed list of content types, with at least one ticked.
 *
 * An unrecognised value is dropped rather than rejected — the group is rendered from
 * the same constant it is matched against, so an unrecognised value means a stale page.
 * An *empty* selection is refused, because these are the types the persona writes when
 * the owner names none, and a persona with no default types would silently produce
 * nothing of either kind.
 */
function requiredTypeListSchema<Value extends string>(
  values: readonly Value[],
  message: string,
) {
  return z
    .array(z.string())
    .optional()
    .transform((submitted): readonly Value[] => {
      const chosen = (submitted ?? []).map((value) => value.trim());

      return values.filter((value) => chosen.includes(value));
    })
    .refine((chosen) => chosen.length > 0, { message });
}

/**
 * The editable fields of one persona.
 *
 * The same schema for create and edit: what differs between them is the key, the
 * version, and the timestamps, none of which is submitted.
 */
export const personaDraftSchema = z.object({
  label: requiredText("A name", LABEL_LIMIT),
  role: requiredText("The role description", ROLE_LIMIT),
  guidance: requiredLinesSchema("question guideline"),
  cardGuidance: requiredLinesSchema("flashcard guideline"),
  prohibitions: requiredLinesSchema("prohibition"),
  defaultQuestionTypes: requiredTypeListSchema(
    QUESTION_TYPES,
    "Choose at least one question type.",
  ),
  defaultCardTypes: requiredTypeListSchema(
    CARD_TYPES,
    "Choose at least one card type.",
  ),
  languageInstruction: requiredText(
    "A language instruction",
    LANGUAGE_INSTRUCTION_LIMIT,
  ),
  /**
   * Recorded on generated content so the bank can be filtered by language.
   *
   * Optional and free text rather than a BCP-47 validator: the built-in personas store
   * `"en"` and `"zh"`, and a persona for a language whose tag the owner does not know
   * should still be saveable.
   */
  contentLanguage: optionalText(CONTENT_LANGUAGE_LIMIT),
});

export type PersonaDraftInput = z.output<typeof personaDraftSchema>;

/** Creating a persona: which template to copy, plus the fields as edited. */
export const createPersonaSchema = personaDraftSchema.extend({
  templateKey: enumOf(
    PERSONA_TEMPLATE_KEYS,
    "Choose one of the starting points listed.",
  ),
});

export type CreatePersonaInput = z.output<typeof createPersonaSchema>;

/** Editing a persona. */
export const updatePersonaSchema = personaDraftSchema.extend({
  personaId: z
    .string()
    .max(ID_LIMIT)
    .transform((value) => value.trim()),
});

export type UpdatePersonaInput = z.output<typeof updatePersonaSchema>;

/** Deleting a persona, from the settings list. */
export const personaIdSchema = z.object({
  personaId: z
    .string()
    .max(ID_LIMIT)
    .transform((value) => value.trim()),
});
