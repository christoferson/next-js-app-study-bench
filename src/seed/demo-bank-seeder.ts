import type { Certification } from "@/modules/certifications/domain/certification";
import type { Objective } from "@/modules/certifications/domain/objective";
import type { CertificationRepository } from "@/modules/certifications/ports/certification-repository";
import type { ObjectiveRepository } from "@/modules/certifications/ports/objective-repository";
import type { QuestionBankFacade } from "@/modules/question-bank/application/question-bank-facade";
import type { FlashcardFacade } from "@/modules/flashcards/application/flashcard-facade";
import { DEMO_BANKS } from "./demo-bank-content";
import type {
  DemoBank,
  DemoFlashcard,
  DemoQuestion,
} from "./demo-bank-content";

/**
 * Writes the demo questions and demo flashcards for the seeded demo tracks.
 *
 * Runs after `seedDemoContent` has created the tracks and their objectives, and
 * only ever adds to a track that seed created. Every item goes through the bank
 * facades — `createQuestion`, `linkObjective`, `activateQuestion`, and their
 * flashcard equivalents — so the demo bank is written by exactly the code path
 * the owner's own authoring uses: the same content invariants, the same
 * revision 1, the same `MANUAL` provenance, the same cross-track objective check.
 * There is no seed-only SQL to drift out of step with the schema.
 *
 * Items are activated on the way in. A draft is not studiable
 * (`spec/DOMAIN-RULES.md`), and the point of demo content is that a quick session
 * has something to offer on the first run.
 *
 * **How idempotency extends.** `seedDemoContent` is idempotent by track slug. A
 * bank has no slug, so content is idempotent per bank per track instead: a bank
 * that already holds *any* item is left completely alone, and a bank that is
 * empty receives the whole demo set. Nothing is ever edited, deleted, or
 * de-duplicated item by item, so the seed can never overwrite the owner's
 * wording or add a second copy of a demo question next to one they have since
 * rewritten. Two consequences are worth stating plainly:
 *
 * - Deleting every question from the demo track and re-seeding writes the demo
 *   questions again. That is the documented meaning of "empty bank".
 * - A seed interrupted midway leaves what it had written and is not resumed,
 *   because the bank is no longer empty. Clearing the affected bank (or the
 *   database) and re-seeding is the way back.
 */

/** What the seeder did to one track's two banks. */
export interface DemoBankSeedResult {
  readonly slug: string;
  /** False when the demo track is absent, in which case nothing was attempted. */
  readonly trackFound: boolean;
  readonly questionsInserted: number;
  readonly flashcardsInserted: number;
  /** True when the question bank already held items and was left untouched. */
  readonly questionsSkipped: boolean;
  /** True when the flashcard bank already held items and was left untouched. */
  readonly flashcardsSkipped: boolean;
}

export interface DemoBankSeedOutcome {
  readonly tracks: readonly DemoBankSeedResult[];
}

export interface DemoBankSeedDependencies {
  readonly questionBank: QuestionBankFacade;
  readonly flashcards: FlashcardFacade;
  readonly certifications: CertificationRepository;
  readonly objectives: ObjectiveRepository;
}

export async function seedDemoBanks(
  deps: DemoBankSeedDependencies,
  banks: readonly DemoBank[] = DEMO_BANKS,
): Promise<DemoBankSeedOutcome> {
  const tracks: DemoBankSeedResult[] = [];

  for (const bank of banks) {
    tracks.push(await seedOneBank(deps, bank));
  }

  return { tracks };
}

async function seedOneBank(
  deps: DemoBankSeedDependencies,
  bank: DemoBank,
): Promise<DemoBankSeedResult> {
  const certification = await deps.certifications.findBySlug(bank.slug);

  if (certification === null) {
    // The demo track is absent — archived and renamed, or never seeded. Creating
    // it here would be a second, hidden track seeder; reporting it lets the
    // script say so.
    return {
      slug: bank.slug,
      trackFound: false,
      questionsInserted: 0,
      flashcardsInserted: 0,
      questionsSkipped: false,
      flashcardsSkipped: false,
    };
  }

  const objectives = await deps.objectives.listByCertification(
    certification.id,
  );
  const [questionCounts, cardCounts] = await Promise.all([
    deps.questionBank.countBank(certification.id),
    deps.flashcards.countBank(certification.id),
  ]);
  const questionsSkipped = questionCounts.total > 0;
  const flashcardsSkipped = cardCounts.total > 0;

  return {
    slug: bank.slug,
    trackFound: true,
    questionsInserted: questionsSkipped
      ? 0
      : await insertQuestions(deps, certification, objectives, bank.questions),
    flashcardsInserted: flashcardsSkipped
      ? 0
      : await insertFlashcards(
          deps,
          certification,
          objectives,
          bank.flashcards,
        ),
    questionsSkipped,
    flashcardsSkipped,
  };
}

async function insertQuestions(
  deps: DemoBankSeedDependencies,
  certification: Certification,
  objectives: readonly Objective[],
  demoQuestions: readonly DemoQuestion[],
): Promise<number> {
  let inserted = 0;

  for (const demoQuestion of demoQuestions) {
    const objectiveId = requireObjectiveId(
      objectives,
      demoQuestion.objectiveCode,
      certification,
    );
    const question = await deps.questionBank.createQuestion(
      certification.id,
      demoQuestion.input,
    );

    await deps.questionBank.linkObjective(question.id, objectiveId);
    await deps.questionBank.activateQuestion(question.id);
    inserted += 1;
  }

  return inserted;
}

async function insertFlashcards(
  deps: DemoBankSeedDependencies,
  certification: Certification,
  objectives: readonly Objective[],
  demoFlashcards: readonly DemoFlashcard[],
): Promise<number> {
  let inserted = 0;

  for (const demoFlashcard of demoFlashcards) {
    const objectiveId = requireObjectiveId(
      objectives,
      demoFlashcard.objectiveCode,
      certification,
    );
    const flashcard = await deps.flashcards.createFlashcard(
      certification.id,
      demoFlashcard.input,
    );

    await deps.flashcards.linkObjective(flashcard.id, objectiveId);
    await deps.flashcards.activateFlashcard(flashcard.id);
    inserted += 1;
  }

  return inserted;
}

/**
 * Resolves the objective a demo item is written for.
 *
 * Objective identifiers are generated at seed time, so the demo content names
 * objectives by code. A code that no longer exists means the demo data and the
 * demo objectives have drifted apart, which is a repository defect rather than
 * an owner mistake: failing here says so, instead of quietly seeding content
 * that no objective map would ever reach.
 */
function requireObjectiveId(
  objectives: readonly Objective[],
  code: string,
  certification: Certification,
): string {
  const match = objectives.find((objective) => objective.code === code);

  if (match === undefined) {
    throw new Error(
      `Demo seed content names objective "${code}", which the track "${certification.slug}" does not have.`,
    );
  }

  return match.id;
}
