import "server-only";
import { systemClock } from "@/platform/clock";
import { cryptoIdGenerator } from "@/platform/id-generator";
import { getDatabaseContainer } from "@/platform/database/composition";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { SqliteTransactionRunner } from "@/platform/database/sqlite-transaction-runner";
import { CertificationFacade } from "@/modules/certifications/application/certification-facade";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import { SqliteUnitOfWork } from "@/modules/certifications/infrastructure/sqlite-unit-of-work";

/**
 * Server-only composition root for the certifications module.
 *
 * Wires the repositories, unit of work, clock, and ID generator into the facade
 * over the shared connection from `@/platform/database/composition`. Pages,
 * Server Actions, and route handlers resolve the facade here; none of them
 * constructs a database client or repository locally.
 *
 * The `server-only` import makes an accidental Client Component import a build
 * error rather than a leaked driver in the browser bundle.
 */

/**
 * Builds a facade over an already-open database.
 *
 * Shared by the composition root, the seed script, and the contract tests so
 * that all three exercise identical wiring. `runner` is optional so a caller
 * that owns a single connection can share one transaction queue across modules.
 */
export function createCertificationFacade(
  database: SqliteDatabase,
  runner?: SqliteTransactionRunner,
): CertificationFacade {
  return new CertificationFacade({
    certifications: new SqliteCertificationRepository(database),
    objectives: new SqliteObjectiveRepository(database),
    unitOfWork: new SqliteUnitOfWork(database, runner),
    clock: systemClock,
    ids: cryptoIdGenerator,
  });
}

let facade: CertificationFacade | null = null;

export function getCertificationFacade(): CertificationFacade {
  if (facade === null) {
    const container = getDatabaseContainer();

    facade = createCertificationFacade(
      container.database,
      container.transactions,
    );
  }

  return facade;
}
