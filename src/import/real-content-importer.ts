import {
  DEFAULT_PRIORITY,
  DEFAULT_SESSION_MINUTES,
  slugify,
} from "@/modules/certifications/domain/certification";
import type {
  Certification,
  CertificationSlug,
} from "@/modules/certifications/domain/certification";
import type { ObjectiveId } from "@/modules/certifications/domain/objective";
import { VOCABULARY_LIST_ROOT } from "@/modules/certifications/domain/objective-kind";
import type { CertificationFacade } from "@/modules/certifications/application/certification-facade";
import type { CertificationInput } from "@/modules/certifications/application/schemas";
import type { FlashcardFacade } from "@/modules/flashcards/application/flashcard-facade";
import type { FlashcardInput } from "@/modules/flashcards/application/schemas";
import type { ExamGuideOutline } from "./exam-guide-parser";
import type {
  HskVocabularyEntry,
  HskVocabularyList,
} from "./hsk-vocabulary-parser";

/**
 * Writes the owner's real study content into the database (`npm run import:real`).
 *
 * This is a one-off import tool for two documents the owner already owns, not a
 * product feature: there is no source library here, nothing is uploaded, and no
 * copy of either document is stored. The documents stay in `external/`, which is
 * gitignored, and only the structure the parsers extract is written — objectives
 * and vocabulary cards.
 *
 * **Every record goes through a facade.** `CertificationFacade.createCertification`,
 * `addObjective`, `FlashcardFacade.createFlashcard`, `linkObjective`, and
 * `activateFlashcard` are the same calls the owner's own authoring makes, so the
 * imported content passes exactly the same validation, gets the same `MANUAL`
 * provenance, and lands in the same revision-1 shape. There is no import-only SQL
 * to drift out of step with the schema (`spec/ARCHITECTURE.md` section 3).
 *
 * **Idempotency is by track slug, whole-track.** A track whose slug already
 * exists is reported as already imported and is not touched at all — not its
 * objectives, not its bank. That is deliberately coarser than a per-item check: a
 * partial re-import could add a second copy of an objective next to one the owner
 * has since renamed, and there is no natural key on a flashcard to de-duplicate
 * by.
 *
 * The consequence is worth stating plainly, as the demo seeder states its own: an
 * import interrupted midway is not resumed. Its cards are left as they were, and
 * a re-run reports the track as already imported. Because cards are created as
 * drafts and activated only after their objective link is written, an interrupted
 * run leaves drafts — which are not studiable — rather than half-mapped active
 * cards. Getting back to a clean state means archiving or deleting the track and
 * re-running.
 *
 * **Why cards are not written in one transaction per chunk.** A facade owns its
 * own transaction boundary, and the shared SQLite transaction runner forbids
 * nesting one unit of work inside another, so wrapping a hundred facade calls in
 * an outer transaction would deadlock on the runner's queue rather than batch
 * anything. Bypassing the facades to write raw rows in a chunk transaction would
 * be a second write path for flashcards, which is what the module boundaries
 * exist to prevent. Cards are therefore written one atomic card at a time, in
 * chunks that exist for progress reporting and for a bounded, resumable-looking
 * log rather than for a shared transaction.
 */

/** The name the real AWS track is created under. */
export const AWS_TRACK_NAME =
  "AWS Certified Generative AI Developer - Professional";

/** The name the real HSK track is created under. */
export const HSK_TRACK_NAME = "HSK 5 Chinese";

/**
 * The slugs the two real tracks are addressed by.
 *
 * Derived from the names above with the same `slugify` the facade uses, so the
 * pre-flight existence check and the track the facade actually creates can never
 * disagree. Both are deliberately distinct from the demo slugs
 * (`aws-certified-generative-ai-developer-professional-aip-c01` and
 * `hsk-chinese-demo-track`), so the real tracks stand beside the demo ones rather
 * than colliding with them and gaining a numeric suffix.
 */
export const REAL_TRACK_SLUGS = {
  awsGenerativeAiProfessional: slugify(AWS_TRACK_NAME),
  hsk5Chinese: slugify(HSK_TRACK_NAME),
} as const;

/**
 * Source type recorded for the AWS objectives.
 *
 * `OFFICIAL_SYLLABUS`: the domains, tasks, and weightings come from the official
 * exam guide published by the certifying body, which is what that source type
 * means (`SPEC.md` section 6.2).
 */
const AWS_OBJECTIVE_SOURCE = "OFFICIAL_SYLLABUS" as const;

/**
 * Source type recorded for the HSK objective.
 *
 * `IMPORTED` rather than `OFFICIAL_SYLLABUS`, deliberately. The word list is a
 * third-party compilation of the HSK 3.0 syllabus, not a document published by
 * the examining body, so claiming "official syllabus" would overstate its
 * provenance — and provenance labels exist precisely so the owner can tell how
 * much to trust an item.
 */
const HSK_OBJECTIVE_SOURCE = "IMPORTED" as const;

/**
 * The single objective every imported vocabulary card is mapped to.
 *
 * Named in the domain rather than here, because generation recognises the root by
 * these names when it decides what kind of drill an objective calls for.
 */
const HSK_OBJECTIVE_CODE = VOCABULARY_LIST_ROOT.code;
const HSK_OBJECTIVE_TITLE = VOCABULARY_LIST_ROOT.title;

/** Language tag recorded on every imported vocabulary card. */
const HSK_CARD_LANGUAGE = "zh";

/** How many cards are written between progress reports. */
export const CARD_CHUNK_SIZE = 100;

export interface RealImportDependencies {
  readonly certifications: CertificationFacade;
  readonly flashcards: FlashcardFacade;
}

/** Progress for the caller to print. Carries counts, never content. */
export interface ImportProgress {
  readonly slug: CertificationSlug;
  readonly cardsWritten: number;
  readonly cardsTotal: number;
}

export type ProgressReporter = (progress: ImportProgress) => void;

/** What the import did to one track. */
export interface TrackImportResult {
  readonly slug: CertificationSlug;
  readonly name: string;
  /** True when the track already existed and nothing was written. */
  readonly alreadyImported: boolean;
  readonly rootObjectivesCreated: number;
  readonly childObjectivesCreated: number;
  readonly flashcardsCreated: number;
}

/**
 * The vocabulary member of the card input union.
 *
 * Narrowed rather than left as `FlashcardInput` so that the card fields are
 * visible on the return type: the import only ever writes vocabulary cards, and a
 * caller asserting on `term` should not have to re-narrow a five-member union.
 */
export type VocabularyCardInput = Extract<
  FlashcardInput,
  { readonly cardType: "VOCABULARY" }
>;

export class RealImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealImportError";
  }
}

/**
 * Imports the exam guide's content outline as a track with a two-level objective
 * map: one root objective per content domain carrying its stated weighting, and
 * one child per task.
 *
 * No questions are imported. The guide contains none — it describes what the exam
 * covers — and inventing questions from it here would be fabricating content and
 * labelling it as the owner's own. Questions for these objectives come from AI
 * generation, where they are recorded as generated and land as drafts.
 */
export async function importExamGuideTrack(
  deps: RealImportDependencies,
  outline: ExamGuideOutline,
  description: string,
): Promise<TrackImportResult> {
  const slug = REAL_TRACK_SLUGS.awsGenerativeAiProfessional;
  const existing = await deps.certifications.findEditFormBySlug(slug);

  if (existing !== null) {
    return alreadyImported(slug, AWS_TRACK_NAME);
  }

  const certification = await createTrack(deps, slug, {
    name: AWS_TRACK_NAME,
    provider: "AWS",
    examCode: "AIP-C01",
    version: null,
    studyType: "TECHNICAL_CERTIFICATION",
    description,
    targetDate: null,
    priority: DEFAULT_PRIORITY,
    defaultSessionMinutes: DEFAULT_SESSION_MINUTES,
  });

  let childObjectivesCreated = 0;

  for (const domain of outline.domains) {
    const root = await deps.certifications.addObjective(certification.id, {
      parentObjectiveId: null,
      code: domain.code,
      title: domain.title,
      description: null,
      weight: domain.weight,
      sourceType: AWS_OBJECTIVE_SOURCE,
    });

    for (const task of domain.tasks) {
      await deps.certifications.addObjective(certification.id, {
        parentObjectiveId: root.id,
        code: task.code,
        title: task.title,
        description: task.description === "" ? null : task.description,
        weight: null,
        sourceType: AWS_OBJECTIVE_SOURCE,
      });
      childObjectivesCreated += 1;
    }
  }

  return {
    slug: certification.slug,
    name: certification.name,
    alreadyImported: false,
    rootObjectivesCreated: outline.domains.length,
    childObjectivesCreated,
    flashcardsCreated: 0,
  };
}

/**
 * Imports the vocabulary list as a track with one objective and one active
 * `VOCABULARY` card per word.
 *
 * The objective map is deliberately flat. Splitting the list by register
 * (spoken, written, neutral) was considered and rejected: register is a property
 * of a word, not a part of a syllabus, it is already recorded on each card as a
 * tag, and three register objectives would put every card in a study map that
 * says nothing about what the owner is trying to learn.
 *
 * Cards are activated on the way in, because the point of importing a word list
 * is that the review queue has something in it on the first run. Each card is
 * created, mapped, and then activated, so an interruption leaves an unstudiable
 * draft rather than an active card with no objective.
 */
export async function importHskVocabularyTrack(
  deps: RealImportDependencies,
  list: HskVocabularyList,
  description: string,
  onProgress?: ProgressReporter,
): Promise<TrackImportResult> {
  const slug = REAL_TRACK_SLUGS.hsk5Chinese;
  const existing = await deps.certifications.findEditFormBySlug(slug);

  if (existing !== null) {
    return alreadyImported(slug, HSK_TRACK_NAME);
  }

  const certification = await createTrack(deps, slug, {
    name: HSK_TRACK_NAME,
    provider: "HSK",
    examCode: null,
    version: null,
    studyType: "LANGUAGE_PROFICIENCY",
    description,
    targetDate: null,
    priority: DEFAULT_PRIORITY,
    defaultSessionMinutes: DEFAULT_SESSION_MINUTES,
  });
  const objective = await deps.certifications.addObjective(certification.id, {
    parentObjectiveId: null,
    code: HSK_OBJECTIVE_CODE,
    title: HSK_OBJECTIVE_TITLE,
    description:
      "Every word of the HSK 5 band, imported from the owner's copy of a New HSK 5 word list compiled from the HSK 3.0 syllabus.",
    weight: null,
    sourceType: HSK_OBJECTIVE_SOURCE,
  });
  const flashcardsCreated = await writeVocabularyCards(
    deps,
    certification,
    objective.id,
    list.entries,
    onProgress,
  );

  return {
    slug: certification.slug,
    name: certification.name,
    alreadyImported: false,
    rootObjectivesCreated: 1,
    childObjectivesCreated: 0,
    flashcardsCreated,
  };
}

/**
 * Card content for one vocabulary row.
 *
 * Exported because it is the one formatting decision in the import worth
 * asserting directly in a test.
 *
 * - `term` is the word, `reading` its pinyin, `meaning` the English gloss with
 *   the part of speech prefixed in parentheses. The prefix is kept because a
 *   Chinese word's part of speech changes what the gloss means — `保 (v.)` "to
 *   protect" reads differently from a noun sense — and because the answer face
 *   renders `meaning` as one line, so a separate field would not be shown.
 * - `exampleSentence` is `null`. The list has no example sentences, and
 *   inventing one during an import would put fabricated Chinese on a card
 *   labelled as the owner's own content.
 * - `notes` records the register and whether the word is new in this syllabus
 *   revision. Notes are owner-only and never shown while reviewing, which is the
 *   right place for a property that is context rather than something to recall.
 */
export function toVocabularyCardInput(
  entry: HskVocabularyEntry,
): VocabularyCardInput {
  return {
    cardType: "VOCABULARY",
    term: entry.term,
    reading: entry.reading === "" ? null : entry.reading,
    meaning: `(${entry.partOfSpeech}) ${entry.meaning}`,
    exampleSentence: null,
    notes: `Register: ${entry.register}.${
      entry.isNewInSyllabus ? " New in this HSK syllabus revision." : ""
    } Word ${entry.number} of the imported list.`,
    tags: [
      "hsk5",
      entry.register.toLowerCase(),
      ...(entry.isNewInSyllabus ? ["new-in-syllabus"] : []),
    ],
    language: HSK_CARD_LANGUAGE,
  };
}

async function writeVocabularyCards(
  deps: RealImportDependencies,
  certification: Certification,
  objectiveId: ObjectiveId,
  entries: readonly HskVocabularyEntry[],
  onProgress?: ProgressReporter,
): Promise<number> {
  let written = 0;

  for (const entry of entries) {
    await writeVocabularyCard(deps, certification, objectiveId, entry);
    written += 1;

    if (written % CARD_CHUNK_SIZE === 0 || written === entries.length) {
      onProgress?.({
        slug: certification.slug,
        cardsWritten: written,
        cardsTotal: entries.length,
      });
    }
  }

  return written;
}

async function writeVocabularyCard(
  deps: RealImportDependencies,
  certification: Certification,
  objectiveId: ObjectiveId,
  entry: HskVocabularyEntry,
): Promise<void> {
  try {
    const flashcard = await deps.flashcards.createFlashcard(
      certification.id,
      toVocabularyCardInput(entry),
    );

    await deps.flashcards.linkObjective(flashcard.id, objectiveId);
    await deps.flashcards.activateFlashcard(flashcard.id);
  } catch (cause) {
    // The row number and the failure's class name, never the row itself: a
    // validation message can quote the value it rejected, and an import failure
    // must not print the owner's document to a log (`spec/SECURITY.md` section 4).
    const kind = cause instanceof Error ? cause.name : "an unknown error";

    throw new RealImportError(
      `Word ${entry.number} of the vocabulary list could not be imported (${kind}).`,
    );
  }
}

/**
 * Creates the track and asserts it took the slug the caller expected.
 *
 * The facade appends a numeric suffix when a slug is taken, which is right for
 * the owner naming two similar tracks and wrong here: a suffixed slug would mean
 * the pre-flight existence check looked at a different address than the one the
 * track ended up at, and the next run would import a second copy. Failing says so.
 */
async function createTrack(
  deps: RealImportDependencies,
  expectedSlug: CertificationSlug,
  input: CertificationInput,
): Promise<Certification> {
  const certification = await deps.certifications.createCertification(input);

  if (certification.slug !== expectedSlug) {
    throw new RealImportError(
      `Expected the track "${input.name}" to be created at "${expectedSlug}", but it was created at "${certification.slug}". Another track is already using that address, so the import cannot tell whether it has run before.`,
    );
  }

  return certification;
}

function alreadyImported(
  slug: CertificationSlug,
  name: string,
): TrackImportResult {
  return {
    slug,
    name,
    alreadyImported: true,
    rootObjectivesCreated: 0,
    childObjectivesCreated: 0,
    flashcardsCreated: 0,
  };
}
