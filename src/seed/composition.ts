import { systemClock } from "@/platform/clock";
import { cryptoIdGenerator } from "@/platform/id-generator";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { SqliteTransactionRunner } from "@/platform/database/sqlite-transaction-runner";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import { QuestionBankFacade } from "@/modules/question-bank/application/question-bank-facade";
import { SqliteQuestionBankUnitOfWork } from "@/modules/question-bank/infrastructure/sqlite-question-bank-unit-of-work";
import { SqliteQuestionRepository } from "@/modules/question-bank/infrastructure/sqlite-question-repository";
import { FlashcardFacade } from "@/modules/flashcards/application/flashcard-facade";
import { DeterministicReviewScheduler } from "@/modules/flashcards/domain/review-scheduling";
import { FlashcardQuestionDependencyChecker } from "@/modules/flashcards/infrastructure/flashcard-question-dependency-checker";
import { SqliteFlashcardRepository } from "@/modules/flashcards/infrastructure/sqlite-flashcard-repository";
import { SqliteFlashcardUnitOfWork } from "@/modules/flashcards/infrastructure/sqlite-flashcard-unit-of-work";
import {
  AttemptQuestionDependencyChecker,
  CompositeQuestionDependencyChecker,
} from "@/modules/study-sessions/infrastructure/attempt-question-dependency-checker";
import { SqliteStudySessionRepository } from "@/modules/study-sessions/infrastructure/sqlite-study-session-repository";
import { seedDemoBanks } from "./demo-bank-seeder";
import type { DemoBankSeedOutcome } from "./demo-bank-seeder";

/**
 * Wiring for the demo bank seeder.
 *
 * The module composition roots are marked `import "server-only"`, which the Next
 * compiler resolves and a plain `tsx` process cannot: `npm run seed` is a Node
 * script, not a request. So the seed script gets its own small wiring here rather
 * than dropping the `server-only` marker from the application's composition
 * roots, which is what keeps an accidental Client Component import of a database
 * adapter a build error.
 *
 * It is deliberately the same wiring the module roots use — the same
 * repositories, the same units of work over one shared transaction runner, the
 * same review scheduler, the same composite deletion checker — so the seed writes
 * through the facades exactly as the running application does. The seeder itself
 * never deletes, so the deletion checker is included for fidelity rather than
 * because seeding exercises it.
 *
 * This file is not `server-only`: it is imported by a script and by its test, and
 * never by a component.
 */
export interface SeedFacades {
  readonly questionBank: QuestionBankFacade;
  readonly flashcards: FlashcardFacade;
  readonly certifications: SqliteCertificationRepository;
  readonly objectives: SqliteObjectiveRepository;
}

export function createSeedFacades(
  database: SqliteDatabase,
  runner?: SqliteTransactionRunner,
): SeedFacades {
  return {
    questionBank: new QuestionBankFacade({
      questions: new SqliteQuestionRepository(database),
      certifications: new SqliteCertificationRepository(database),
      objectives: new SqliteObjectiveRepository(database),
      unitOfWork: new SqliteQuestionBankUnitOfWork(database, runner),
      dependencies: new CompositeQuestionDependencyChecker(
        new FlashcardQuestionDependencyChecker(
          new SqliteFlashcardRepository(database),
        ),
        new AttemptQuestionDependencyChecker(
          new SqliteStudySessionRepository(database),
        ),
      ),
      clock: systemClock,
      ids: cryptoIdGenerator,
    }),
    flashcards: new FlashcardFacade({
      flashcards: new SqliteFlashcardRepository(database),
      certifications: new SqliteCertificationRepository(database),
      objectives: new SqliteObjectiveRepository(database),
      unitOfWork: new SqliteFlashcardUnitOfWork(database, runner),
      scheduler: new DeterministicReviewScheduler(systemClock),
      clock: systemClock,
      ids: cryptoIdGenerator,
    }),
    certifications: new SqliteCertificationRepository(database),
    objectives: new SqliteObjectiveRepository(database),
  };
}

/** Seeds the demo banks of an already-migrated database. */
export async function seedDemoBanksInto(
  database: SqliteDatabase,
  runner?: SqliteTransactionRunner,
): Promise<DemoBankSeedOutcome> {
  return seedDemoBanks(createSeedFacades(database, runner));
}
