import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { SqliteTransactionRunner } from "@/platform/database/sqlite-transaction-runner";
import { systemClock } from "@/platform/clock";
import { cryptoIdGenerator } from "@/platform/id-generator";
import { CertificationFacade } from "@/modules/certifications/application/certification-facade";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import { SqliteUnitOfWork } from "@/modules/certifications/infrastructure/sqlite-unit-of-work";
import { FlashcardFacade } from "@/modules/flashcards/application/flashcard-facade";
import { DeterministicReviewScheduler } from "@/modules/flashcards/domain/review-scheduling";
import { SqliteFlashcardRepository } from "@/modules/flashcards/infrastructure/sqlite-flashcard-repository";
import { SqliteFlashcardUnitOfWork } from "@/modules/flashcards/infrastructure/sqlite-flashcard-unit-of-work";
import type { RealImportDependencies } from "./real-content-importer";

/**
 * Wiring for the real-content import script.
 *
 * Exists for the same reason `@/seed/composition` does: the module composition
 * roots are marked `import "server-only"`, which the Next compiler resolves and a
 * plain `tsx` process cannot, and `npm run import:real` is a Node script rather
 * than a request. Dropping the marker from the module roots would be the wrong
 * fix — it is what makes an accidental Client Component import of a database
 * adapter a build error.
 *
 * The wiring is deliberately identical to the module roots: the same
 * repositories, the same units of work over one shared transaction runner, the
 * same clock and ID generator. The import therefore writes through the facades
 * exactly as the running application does.
 *
 * This file is not `server-only`: it is imported by a script and by its tests,
 * never by a component.
 */
export function createImportFacades(
  database: SqliteDatabase,
  runner?: SqliteTransactionRunner,
): RealImportDependencies {
  return {
    certifications: new CertificationFacade({
      certifications: new SqliteCertificationRepository(database),
      objectives: new SqliteObjectiveRepository(database),
      unitOfWork: new SqliteUnitOfWork(database, runner),
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
  };
}
