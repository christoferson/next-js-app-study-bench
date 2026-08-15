import { z } from "zod";
import type { QuestionType } from "@/modules/question-bank/domain/question";
import { QUESTION_TYPES } from "@/modules/question-bank/domain/question";
import type { CardType } from "@/modules/flashcards/domain/flashcard";
import { CARD_TYPES } from "@/modules/flashcards/domain/flashcard";
import type {
  PersonaArchetype,
  StoredPersona,
} from "@/modules/ai-generation/domain/stored-persona";
import { PERSONA_ARCHETYPES } from "@/modules/ai-generation/domain/stored-persona";

/**
 * Row mapping for the `personas` table.
 *
 * The database is an external boundary, so stored values are validated on the way out
 * rather than cast (`spec/CODING-STANDARDS.md` section 2). Five columns hold JSON and
 * one holds a closed union, and each is checked, so a hand-edited local database fails
 * loudly instead of feeding an unknown card type into a prompt builder.
 *
 * A stored type that is no longer in the domain's list is dropped rather than fatal —
 * unlike the guidance lists, whose contents are free text and are validated only as
 * strings. A persona naming a retired card type should still be editable so the owner
 * can fix it; a persona whose guidance is not an array of strings is corrupt.
 */

export interface PersonaRow {
  readonly id: string;
  readonly persona_key: string;
  readonly archetype: string;
  readonly version: number;
  readonly label: string;
  readonly role: string;
  readonly guidance: string;
  readonly card_guidance: string;
  readonly prohibitions: string;
  readonly default_question_types: string;
  readonly default_card_types: string;
  readonly language_instruction: string;
  readonly content_language: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const stringListSchema = z.array(z.string());

export function toStoredPersona(row: PersonaRow): StoredPersona {
  return {
    id: row.id,
    personaKey: row.persona_key,
    archetype: toArchetype(row.id, row.archetype),
    version: row.version,
    label: row.label,
    role: row.role,
    guidance: parseStringList(row.id, "guidance", row.guidance),
    cardGuidance: parseStringList(row.id, "cardGuidance", row.card_guidance),
    prohibitions: parseStringList(row.id, "prohibitions", row.prohibitions),
    defaultQuestionTypes: parseTypeList(
      row.id,
      "defaultQuestionTypes",
      row.default_question_types,
      QUESTION_TYPES,
    ),
    defaultCardTypes: parseTypeList(
      row.id,
      "defaultCardTypes",
      row.default_card_types,
      CARD_TYPES,
    ),
    languageInstruction: row.language_instruction,
    contentLanguage: row.content_language,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeStringList(values: readonly string[]): string {
  return JSON.stringify(values);
}

function toArchetype(personaId: string, value: string): PersonaArchetype {
  const archetype = PERSONA_ARCHETYPES.find((candidate) => candidate === value);

  if (archetype === undefined) {
    throw new Error(
      `Stored persona ${personaId} has an unsupported archetype: ${value}`,
    );
  }

  return archetype;
}

function parseStringList(
  personaId: string,
  field: string,
  payload: string,
): readonly string[] {
  const parsed = stringListSchema.safeParse(
    readJson(personaId, field, payload),
  );

  if (!parsed.success) {
    throw new Error(
      `Stored persona ${personaId} has an unreadable ${field} list.`,
    );
  }

  return parsed.data;
}

/**
 * A stored list narrowed back to the domain's closed union.
 *
 * Filtered rather than matched exhaustively, so a retired type disappears from an
 * otherwise editable persona instead of making it unopenable.
 *
 * The *stored* order is kept, not the domain's: the persona is the owner's, and the
 * order they saved is what reading it back must return. Canonicalising here would make
 * a round-trip through the database silently reorder a list nothing asked to change.
 */
function parseTypeList<Value extends QuestionType | CardType>(
  personaId: string,
  field: string,
  payload: string,
  allowed: readonly Value[],
): readonly Value[] {
  return parseStringList(personaId, field, payload).flatMap((stored) => {
    const matched = allowed.find((candidate) => candidate === stored);

    return matched === undefined ? [] : [matched];
  });
}

function readJson(personaId: string, field: string, payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    throw new Error(
      `Stored persona ${personaId} has an unreadable ${field} list.`,
    );
  }
}
