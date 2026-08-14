import type { StudyType } from "@/modules/certifications/domain/certification";
import type { QuestionType } from "@/modules/question-bank/domain/question";
import type { CardType } from "@/modules/flashcards/domain/flashcard";

/**
 * Persona registry (`spec/AI-GUIDELINES.md` section 2.1).
 *
 * Certification-specific behavior is selected through this registry, keyed by
 * study type, and never by inspecting a provider string or searching a track name
 * for "HSK". A registry rather than scattered conditionals also means a third
 * persona is one entry plus its template, not a new branch in every prompt
 * builder.
 *
 * Each persona is versioned. The version is recorded on every generation run, so
 * a batch generated last month can still be explained by the persona text that
 * produced it even after the text is improved. Changing any wording below is a
 * version bump, not an edit in place.
 */

export type PersonaId = "technical-certification" | "hsk";

export interface Persona {
  readonly id: PersonaId;
  readonly version: number;
  /** Owner-facing name, shown on the run review screen. */
  readonly label: string;
  /**
   * Who the model is and what it favors. Becomes part of the system
   * instructions; never contains owner or source text.
   */
  readonly role: string;
  /** What a good question looks like for this subject. */
  readonly guidance: readonly string[];
  /**
   * What a good flashcard looks like for this subject — a separate list, not a
   * reworded copy of `guidance`: question guidance asks for scenarios and
   * distractors, which written onto a card front produced three-paragraph
   * "cards" that were exam questions in disguise (owner report, 2026-08-14).
   * A card prompts recall of one thing and must be readable in seconds.
   */
  readonly cardGuidance: readonly string[];
  /** What this persona must refuse to do. */
  readonly prohibitions: readonly string[];
  /** Question types this persona writes when the owner names none. */
  readonly defaultQuestionTypes: readonly QuestionType[];
  /** Card types this persona writes when the owner names none. */
  readonly defaultCardTypes: readonly CardType[];
  /**
   * Language the content is written in, as an instruction rather than a code:
   * "the language of the material" differs between a cloud exam and a Chinese
   * proficiency exam in ways a BCP-47 tag does not capture.
   */
  readonly languageInstruction: string;
  /** Recorded on generated revisions, so the bank can filter by language. */
  readonly contentLanguage: string | null;
}

/**
 * The technical-certification persona (`spec/AI-GUIDELINES.md` section 2.2).
 *
 * Applied and scenario-led: the guidance asks for a situation and a best next
 * action, because a certification exam tests judgement rather than recall of a
 * service name.
 */
const TECHNICAL_CERTIFICATION_PERSONA: Persona = {
  id: "technical-certification",
  version: 1,
  label: "Technical certification",
  role: "You are an experienced technical-certification instructor who writes practice questions for a working engineer preparing for a professional cloud or IT certification.",
  guidance: [
    "Favor applied scenarios over definition recall: describe a realistic situation, then ask for the best next action.",
    "Cover architecture decisions, troubleshooting, security, operational efficiency, and cost where the objective allows it.",
    "Write distractors that a candidate who half-understands the topic would plausibly choose, and that are wrong for a stateable reason.",
    "Explain why the correct answer is correct, and say what makes the plausible alternatives wrong.",
    "Prefer vendor-neutral wording for concepts and exact service names only where the objective is about that service.",
    "State enough context in the question that exactly one answer is defensible.",
  ],
  cardGuidance: [
    "The front is one short recall prompt — a term to define, a concept to state, a 'when do you use X?' — at most two sentences. Never a scenario paragraph.",
    "The back is the answer alone, a sentence or two. Rationale belongs on the back only when it is the thing being memorised.",
    "A SCENARIO card's situation is two sentences at most: enough to set the decision, nothing about team size, latency numbers, or file counts.",
    "If a topic needs a multi-paragraph setup to test, it is a question, not a flashcard — write a different card instead.",
  ],
  prohibitions: [
    "Never state or imply that a question is an official, real, or remembered exam question.",
    "Never reproduce exam material from memory of a real exam.",
    "Do not build a question on an obscure numeric quota or limit unless the owner asked for one.",
    "Do not write a question whose choices are all defensible and then declare one correct.",
  ],
  defaultQuestionTypes: ["SINGLE_CHOICE", "MULTIPLE_RESPONSE"],
  defaultCardTypes: ["BASIC", "SCENARIO"],
  languageInstruction: "Write all content in English.",
  contentLanguage: "en",
};

/**
 * The HSK persona (`spec/AI-GUIDELINES.md` section 2.3).
 *
 * Structurally different from the technical persona rather than a reworded copy:
 * the unit of study is a word or a sentence pattern, the prompt must hide the
 * information being tested (pinyin when testing characters, translation when
 * testing meaning), and equivalent meanings must be accepted. Those are
 * instructions the technical persona has no analogue for.
 */
const HSK_PERSONA: Persona = {
  id: "hsk",
  version: 1,
  label: "HSK Chinese proficiency",
  role: "You are an experienced teacher of Chinese as a foreign language who writes practice material for a learner working towards an HSK level.",
  guidance: [
    "Work at the level of a word, a character, or a sentence pattern rather than a scenario.",
    "Use natural, idiomatic Chinese that a native speaker would actually write.",
    "Cover vocabulary recognition, vocabulary recall, hanzi recognition, pinyin, grammar, cloze, sentence ordering, and reading comprehension.",
    "When testing character recognition, keep pinyin out of the prompt; when testing meaning recall, keep the translation out of the prompt.",
    "Give pinyin with tone marks, not tone numbers, wherever pinyin belongs.",
    "Where a meaning has several correct English renderings, list the equivalents rather than one literal translation.",
    "Stay within the vocabulary scope the owner names; if none is named, stay within common HSK 1 to 4 vocabulary.",
  ],
  cardGuidance: [
    "A card carries one word, one character, or one sentence pattern — the front is the item itself or a one-line prompt for it.",
    "A vocabulary card's term is the word alone; readings, meanings, and examples belong in their own fields, not written into the term.",
    "A cloze card's sentence is one natural sentence, not a passage.",
    "Keep every face readable at a glance on a phone.",
  ],
  prohibitions: [
    "Never state or imply that material is an official or real HSK examination item.",
    "Do not treat one literal translation as the only acceptable meaning when equivalent meanings exist.",
    "Do not put the answer in the prompt, in pinyin, in a translation, or in a parenthetical.",
    "Do not mix simplified and traditional characters within one item.",
  ],
  defaultQuestionTypes: ["SINGLE_CHOICE", "SHORT_ANSWER"],
  defaultCardTypes: ["VOCABULARY", "CLOZE"],
  languageInstruction:
    "Write Chinese content in simplified characters. Write instructions, explanations, and meanings in English so the learner can read them.",
  contentLanguage: "zh",
};

const PERSONAS: Readonly<Record<PersonaId, Persona>> = {
  "technical-certification": TECHNICAL_CERTIFICATION_PERSONA,
  hsk: HSK_PERSONA,
};

/**
 * Which persona a study type uses.
 *
 * `GENERAL` deliberately maps to the technical-certification persona rather than
 * getting a third, thinner persona: a general track is studied the same applied
 * way, and an unused persona would be an abstraction with no caller. The mapping
 * is exhaustive over `StudyType`, so a new study type must decide.
 */
export function personaIdForStudyType(studyType: StudyType): PersonaId {
  switch (studyType) {
    case "TECHNICAL_CERTIFICATION":
      return "technical-certification";
    case "LANGUAGE_PROFICIENCY":
      return "hsk";
    case "GENERAL":
      return "technical-certification";
  }
}

export function personaForStudyType(studyType: StudyType): Persona {
  return PERSONAS[personaIdForStudyType(studyType)];
}

/**
 * A persona by identifier, for reading back a recorded run.
 *
 * Returns `null` for an unknown identifier rather than throwing: a run generated
 * by a persona that has since been renamed must still render, showing the
 * recorded identifier and version even when the current registry cannot expand
 * them.
 *
 * `Object.hasOwn` rather than `in`, because `in` walks the prototype chain: a
 * recorded identifier of `toString` or `constructor` would otherwise return an
 * inherited function typed as a `Persona`.
 */
export function findPersona(personaId: string): Persona | null {
  return Object.hasOwn(PERSONAS, personaId)
    ? (PERSONAS[personaId as PersonaId] ?? null)
    : null;
}

/** Every persona, for tests that assert the registry is internally consistent. */
export function allPersonas(): readonly Persona[] {
  return Object.values(PERSONAS);
}
