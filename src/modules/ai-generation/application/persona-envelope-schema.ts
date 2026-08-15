import { z } from "zod";
import { QUESTION_TYPES } from "@/modules/question-bank/domain/question";
import type { QuestionType } from "@/modules/question-bank/domain/question";
import { CARD_TYPES } from "@/modules/flashcards/domain/flashcard";
import type { CardType } from "@/modules/flashcards/domain/flashcard";
import {
  PERSONA_ENVELOPE_KEY,
  PERSONA_ENVELOPE_VERSION,
} from "@/modules/ai-generation/domain/persona-export";
import type { ImportedPersona } from "@/modules/ai-generation/domain/persona-export";
import { PERSONA_ARCHETYPES } from "@/modules/ai-generation/domain/stored-persona";
import type { PersonaArchetype } from "@/modules/ai-generation/domain/stored-persona";
import {
  CONTENT_LANGUAGE_LIMIT,
  ENTRY_LIMIT,
  LABEL_LIMIT,
  LANGUAGE_INSTRUCTION_LIMIT,
  MAX_ENTRIES,
  ROLE_LIMIT,
} from "./persona-schemas";

/**
 * Authoritative schema for an imported persona file.
 *
 * A file is untrusted input, and more so than a form: it may have been hand-edited, it
 * may have come from a stranger, and it may have been written by a future release. So
 * every field is bounded here rather than trusted for having once been exported — the
 * same bounds `persona-schemas.ts` applies to the form, imported from it so a file the
 * import accepts is always a persona the form would save.
 *
 * **Two things differ from the form schema, both because JSON is not a textarea.** The
 * list fields arrive as arrays rather than newline-separated text, and the type fields
 * are validated strictly rather than filtered: a checkbox group is rendered from the
 * same constant it is matched against, so an unrecognised submission there means a stale
 * page and is dropped — but an unrecognised value in a *file* means the file is for a
 * different version of this application, and dropping it would silently import a persona
 * that generates the wrong content types.
 *
 * **Every message is field-associated.** The import form renders them beside the field
 * that failed, so "guidance.2: keep each entry to 500 characters or fewer" tells the
 * owner which line of which list to fix in a file they may have written by hand.
 */

/** The version marker, checked before anything else is worth reading. */
const envelopeVersionSchema = z
  .unknown()
  .refine((value) => value !== undefined, {
    message: `This file is not a StudyBench persona: it has no "${PERSONA_ENVELOPE_KEY}" marker.`,
  })
  .refine((value) => value === PERSONA_ENVELOPE_VERSION, {
    message: `This file is in persona format version other than ${PERSONA_ENVELOPE_VERSION}, which this version of StudyBench cannot read. It was probably exported by a newer release.`,
  });

const requiredEnvelopeText = (label: string, limit: number) =>
  z
    .string({ message: `${label} must be text.` })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: `${label} is required.` })
    .refine((value) => value.length <= limit, {
      message: `Use ${limit} characters or fewer.`,
    });

/**
 * One of the three guidance lists, as an array of lines.
 *
 * Blank entries are dropped rather than rejected — an exported file never has one, and a
 * hand-written file with a stray empty string is not worth a refusal — but an empty list
 * is refused, for the reason the form schema states: a persona with no guidance is an
 * instruction to the model to do whatever it likes.
 */
const envelopeLinesSchema = (label: string) =>
  z
    .array(z.string({ message: `Each ${label} must be text.` }), {
      message: `${label} entries must be a list of text lines.`,
    })
    .transform((lines): readonly string[] =>
      lines.map((line) => line.trim()).filter((line) => line.length > 0),
    )
    .refine((lines) => lines.length > 0, {
      message: `List at least one ${label}.`,
    })
    .refine((lines) => lines.length <= MAX_ENTRIES, {
      message: `List ${MAX_ENTRIES} entries or fewer.`,
    })
    .refine((lines) => lines.every((line) => line.length <= ENTRY_LIMIT), {
      message: `Keep each entry to ${ENTRY_LIMIT} characters or fewer.`,
    });

/**
 * A closed list of content types, every value required to be recognised.
 *
 * Strict rather than filtering, for the reason at the top of this file: an unknown type
 * in a file is a file this release cannot honour, and the message names the value so the
 * owner can edit it out.
 */
function envelopeTypeListSchema<Value extends string>(
  values: readonly Value[],
  label: string,
) {
  return z
    .array(z.string({ message: `Each ${label} must be text.` }), {
      message: `${label} must be a list of text values.`,
    })
    .transform((submitted, context): readonly Value[] => {
      const chosen: Value[] = [];

      for (const candidate of submitted) {
        const matched = values.find((value) => value === candidate.trim());

        if (matched === undefined) {
          context.addIssue({
            code: "custom",
            message: `"${candidate}" is not a ${label} this version of StudyBench knows. Accepted values: ${values.join(", ")}.`,
          });
          continue;
        }

        if (!chosen.includes(matched)) {
          chosen.push(matched);
        }
      }

      return chosen;
    })
    .refine((chosen) => chosen.length > 0, {
      message: `List at least one ${label}.`,
    });
}

/** A content language: absent, null, or a short code. */
const envelopeContentLanguageSchema = z
  .union([z.string(), z.null()], {
    message: "The content language must be text or null.",
  })
  .optional()
  .transform((value): string | null => {
    const trimmed = (value ?? "").trim();

    return trimmed.length === 0 ? null : trimmed;
  })
  .refine((value) => value === null || value.length <= CONTENT_LANGUAGE_LIMIT, {
    message: `Use ${CONTENT_LANGUAGE_LIMIT} characters or fewer.`,
  });

/**
 * The whole file.
 *
 * `z.looseObject` rather than a strict one: an unknown *key* is forward compatibility,
 * not corruption — a later release adding a field must not make its files unreadable
 * here, and the version marker is what guards a change this cannot survive. Unknown
 * values inside a known field are a different matter, and refused above.
 */
export const personaEnvelopeSchema = z.looseObject({
  [PERSONA_ENVELOPE_KEY]: envelopeVersionSchema,
  archetype: z.unknown().transform((value, context): PersonaArchetype => {
    const matched = PERSONA_ARCHETYPES.find((archetype) => archetype === value);

    if (matched === undefined) {
      context.addIssue({
        code: "custom",
        message: `The archetype must be one of: ${PERSONA_ARCHETYPES.join(", ")}.`,
      });
      return z.NEVER;
    }

    return matched;
  }),
  label: requiredEnvelopeText("A name", LABEL_LIMIT),
  role: requiredEnvelopeText("The role description", ROLE_LIMIT),
  guidance: envelopeLinesSchema("question guideline"),
  cardGuidance: envelopeLinesSchema("flashcard guideline"),
  prohibitions: envelopeLinesSchema("prohibition"),
  defaultQuestionTypes: envelopeTypeListSchema<QuestionType>(
    QUESTION_TYPES,
    "question type",
  ),
  defaultCardTypes: envelopeTypeListSchema<CardType>(CARD_TYPES, "card type"),
  languageInstruction: requiredEnvelopeText(
    "A language instruction",
    LANGUAGE_INSTRUCTION_LIMIT,
  ),
  contentLanguage: envelopeContentLanguageSchema,
});

/**
 * The parsed file, split into the archetype and the draft.
 *
 * The split is the point: what comes back is exactly what a template offers the create
 * form, so an import reaches the same prefilled form and the same facade call rather than
 * a second write path.
 */
export function toImportedPersona(
  parsed: z.output<typeof personaEnvelopeSchema>,
): ImportedPersona {
  return {
    archetype: parsed.archetype,
    draft: {
      label: parsed.label,
      role: parsed.role,
      guidance: parsed.guidance,
      cardGuidance: parsed.cardGuidance,
      prohibitions: parsed.prohibitions,
      defaultQuestionTypes: parsed.defaultQuestionTypes,
      defaultCardTypes: parsed.defaultCardTypes,
      languageInstruction: parsed.languageInstruction,
      contentLanguage: parsed.contentLanguage,
    },
  };
}
