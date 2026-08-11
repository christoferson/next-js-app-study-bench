import "server-only";
import { systemClock } from "@/platform/clock";
import { cryptoIdGenerator } from "@/platform/id-generator";
import { resolveDatabaseFile } from "@/platform/database/config";
import { runMigrations } from "@/platform/database/migration-runner";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import { openSqliteDatabase } from "@/platform/database/sqlite";
import { CertificationFacade } from "@/modules/certifications/application/certification-facade";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import { SqliteUnitOfWork } from "@/modules/certifications/infrastructure/sqlite-unit-of-work";

/**
 * Server-only composition root.
 *
 * Opens the SQLite connection, applies migrations once per process, and wires
 * the repositories, unit of work, clock, and ID generator into the facade.
 * Pages, Server Actions, and route handlers resolve the facade here; none of
 * them constructs a database client or repository locally.
 *
 * The `server-only` import makes an accidental Client Component import a build
 * error rather than a leaked driver in the browser bundle.
 */

/**
 * Builds a facade over an already-open database.
 *
 * Shared by the composition root, the seed script, and the contract tests so
 * that all three exercise identical wiring.
 */
export function createCertificationFacade(
  database: SqliteDatabase,
): CertificationFacade {
  return new CertificationFacade({
    certifications: new SqliteCertificationRepository(database),
    objectives: new SqliteObjectiveRepository(database),
    unitOfWork: new SqliteUnitOfWork(database),
    clock: systemClock,
    ids: cryptoIdGenerator,
  });
}

interface Container {
  readonly database: SqliteDatabase;
  readonly certifications: CertificationFacade;
}

let container: Container | null = null;

function getContainer(): Container {
  if (container === null) {
    const database = openSqliteDatabase(resolveDatabaseFile());
    runMigrations(database);
    container = {
      database,
      certifications: createCertificationFacade(database),
    };
  }

  return container;
}

export function getCertificationFacade(): CertificationFacade {
  return getContainer().certifications;
}
