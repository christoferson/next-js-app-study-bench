import type { SqliteDatabase } from "@/platform/database/sqlite";
import { SqliteTransactionRunner } from "@/platform/database/sqlite-transaction-runner";
import type {
  CertificationTransactionRepositories,
  CertificationUnitOfWork,
} from "@/modules/certifications/ports/unit-of-work";
import { SqliteCertificationRepository } from "./sqlite-certification-repository";
import { SqliteObjectiveRepository } from "./sqlite-objective-repository";

/**
 * SQLite unit of work for certifications and objectives.
 *
 * The `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` handling and the serialisation
 * queue live in `SqliteTransactionRunner`, which is shared per connection so
 * that two modules cannot open overlapping transactions on it.
 */
export class SqliteUnitOfWork implements CertificationUnitOfWork {
  private readonly repositories: CertificationTransactionRepositories;

  private readonly runner: SqliteTransactionRunner;

  constructor(database: SqliteDatabase, runner?: SqliteTransactionRunner) {
    this.runner = runner ?? new SqliteTransactionRunner(database);
    this.repositories = {
      certifications: new SqliteCertificationRepository(database),
      objectives: new SqliteObjectiveRepository(database),
    };
  }

  async transaction<T>(
    operation: (
      repositories: CertificationTransactionRepositories,
    ) => Promise<T>,
  ): Promise<T> {
    return this.runner.run(async () => operation(this.repositories));
  }
}
