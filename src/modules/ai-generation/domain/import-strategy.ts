/**
 * The import strategies an objective import may be run with, as a registry.
 *
 * An objective import used to be one thing: send a document to a model and ask what
 * outline it states. That is the right behaviour for an exam guide written as prose,
 * and it is the wrong behaviour for a document whose structure is a table — the HSK
 * syllabus states its examination structure in numbered sections with a bullet per
 * part, its grammar in a four-column appendix, and its themes in numbered lists, and a
 * model reading the extracted text of those returns either nothing or an invention.
 *
 * So a strategy is chosen the way a persona is chosen: from a registry keyed by a
 * closed union, with one entry per certification family that has a reader of its own.
 * The registry is the reason there is no `if (isHsk)` anywhere in the facade — a
 * strategy states its own label, what inputs it accepts, whether it calls a model, and
 * how many objectives its output may carry, and the flow reads those rather than
 * knowing the family.
 *
 * Domain code: no framework, no zod, no database, no environment. The parsers a
 * deterministic strategy runs are application-layer (they validate untrusted file
 * content), and the registry deliberately does not name them — a strategy here is a
 * *description*, and dispatching on it is the facade's job.
 */

/** The strategies an import may be run with. */
export type ImportStrategyKey = "GENERIC_OUTLINE" | "HSK_EXAMINATION";

export const IMPORT_STRATEGY_KEYS: readonly ImportStrategyKey[] = [
  "GENERIC_OUTLINE",
  "HSK_EXAMINATION",
];

/**
 * The provider recorded on a run that called no model at all.
 *
 * A real value in the `model_provider` column rather than a null, because the column is
 * `NOT NULL` and because "which provider produced this" has a true answer for a
 * deterministic import: none, the repository's own parsers did. Recording `bedrock` with
 * zero tokens would be a false provenance record, and leaving the run out of the history
 * entirely would hide an import that wrote objectives (`spec/AI-GUIDELINES.md`
 * section 1.3 — model-derived content is identified as such, which also means
 * non-model-derived content must not be labelled as though it were).
 */
export const DETERMINISTIC_MODEL_PROVIDER = "deterministic";

/**
 * The prompt template a deterministic import records.
 *
 * Not one of the real template identifiers: no prompt was rendered and no persona wrote
 * anything, so naming `objective-import` would claim a template version that had no
 * effect on the result.
 */
export const DETERMINISTIC_PROMPT_TEMPLATE_ID =
  "objective-import.deterministic";
export const DETERMINISTIC_PROMPT_TEMPLATE_VERSION = 1;

export interface ImportStrategy {
  readonly key: ImportStrategyKey;
  /** What the radio on the upload form is labelled. */
  readonly label: string;
  /** One sentence: when the owner should pick this one. */
  readonly description: string;
  /** What may be uploaded, in the owner's terms. */
  readonly acceptedInputs: string;
  /** Whether running it spends a model call. */
  readonly callsModel: boolean;
  /** Whether it reads several files in one submission. */
  readonly multiFile: boolean;
  /**
   * The most objectives its output may carry.
   *
   * Per strategy rather than global, because the number is a statement about how much
   * the *input* is trusted. A model's answer is capped at 150 because an over-long tree
   * is the shape a hallucinating extraction takes. A deterministic parse of a published
   * syllabus is capped far higher because its size is the document's size: the HSK 5
   * plan is 117 objectives with themes included, and a level with a longer grammar
   * appendix would legitimately be more. The cap still exists — it bounds one
   * transaction and one screen — it is just not the model's cap.
   */
  readonly maxNodes: number;
}

/** The cap a deterministic, document-derived plan is allowed. */
export const MAX_DETERMINISTIC_IMPORT_NODES = 400;

/**
 * The most files one submission may carry.
 *
 * A bound rather than a needed limit: the HSK strategy reads three roles, so more than a
 * handful of files means either a mis-selected directory or an attempt to make one
 * request expensive. Generous enough that a level with the syllabus split across two
 * text files still works.
 */
export const MAX_IMPORT_STRATEGY_FILES = 8;

/** The cap a model-proposed tree is allowed. Mirrors `MAX_IMPORT_NODES`. */
const MAX_MODEL_IMPORT_NODES = 150;

const STRATEGIES: Readonly<Record<ImportStrategyKey, ImportStrategy>> = {
  GENERIC_OUTLINE: {
    key: "GENERIC_OUTLINE",
    label: "Read it with AI",
    description:
      "A model reads one document and copies out the outline it states. Use this for an exam guide or syllabus written as headings and prose.",
    acceptedInputs: "One PDF or text file, pasted text, or both.",
    callsModel: true,
    multiFile: false,
    maxNodes: MAX_MODEL_IMPORT_NODES,
  },
  HSK_EXAMINATION: {
    key: "HSK_EXAMINATION",
    label: "HSK examination syllabus",
    description:
      "Reads the HSK syllabus documents with parsers written for them: the examination structure, the grammar appendix, and topic notes. No model is called and nothing is inferred.",
    acceptedInputs:
      "Any of the HSK syllabus text, the grammar appendix JSON, and topic notes — one file, or several at once.",
    callsModel: false,
    multiFile: true,
    maxNodes: MAX_DETERMINISTIC_IMPORT_NODES,
  },
};

export function importStrategy(key: ImportStrategyKey): ImportStrategy {
  return STRATEGIES[key];
}

/** The strategy a key names, or `null` when it names none. */
export function findImportStrategy(key: string): ImportStrategy | null {
  return IMPORT_STRATEGY_KEYS.find((candidate) => candidate === key) ===
    undefined
    ? null
    : STRATEGIES[key as ImportStrategyKey];
}

/** Which archetype a strategy is offered first for. */
export type ImportStrategyArchetype = "TECHNICAL" | "LANGUAGE";

/**
 * Every strategy, most likely first for this track.
 *
 * Ordering rather than filtering, deliberately. A language track is far more likely to
 * be importing an HSK syllabus and a technical track is far more likely to be importing
 * an exam guide, so the order saves a decision — but both are always offered, because a
 * language track may well have a prose syllabus for some other examination, and the
 * owner is the one who knows which document they are holding.
 */
export function importStrategiesFor(
  archetype: ImportStrategyArchetype,
): readonly ImportStrategy[] {
  const ordered: readonly ImportStrategyKey[] =
    archetype === "LANGUAGE"
      ? ["HSK_EXAMINATION", "GENERIC_OUTLINE"]
      : ["GENERIC_OUTLINE", "HSK_EXAMINATION"];

  return ordered.map((key) => STRATEGIES[key]);
}

/** The strategy selected with nothing chosen, for this track's archetype. */
export function defaultImportStrategy(
  archetype: ImportStrategyArchetype,
): ImportStrategy {
  const [first] = importStrategiesFor(archetype);

  // Exhaustive over a two-entry list, so this cannot be reached; stated rather than
  // asserted because a non-null assertion would hide a registry that lost an entry.
  return first ?? STRATEGIES.GENERIC_OUTLINE;
}

/**
 * The node cap that applies to a run's stored proposal.
 *
 * Read back from the run rather than remembered, because the confirm page and the apply
 * step re-validate the stored payload and must use the same cap the extraction did. A
 * deterministic run records its strategy key as its model id, which is what makes this
 * derivable from the row without a column of its own.
 */
export function importNodeCapForRun(run: {
  readonly modelProvider: string;
  readonly modelId: string;
}): number {
  if (run.modelProvider !== DETERMINISTIC_MODEL_PROVIDER) {
    return MAX_MODEL_IMPORT_NODES;
  }

  return findImportStrategy(run.modelId)?.maxNodes ?? MAX_MODEL_IMPORT_NODES;
}
