import type { SqliteDatabase } from "@/platform/database/sqlite";
import { SqliteTransactionRunner } from "@/platform/database/sqlite-transaction-runner";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import { SqliteQuestionRepository } from "@/modules/question-bank/infrastructure/sqlite-question-repository";
import { SqliteFlashcardRepository } from "@/modules/flashcards/infrastructure/sqlite-flashcard-repository";
import type {
  GenerationTransactionRepositories,
  GenerationUnitOfWork,
} from "@/modules/ai-generation/ports/unit-of-work";
import { SqliteGenerationRunRepository } from "./sqlite-generation-run-repository";
import { SqliteSourceGroundingRepository } from "./sqlite-source-grounding-repository";

/**
 * SQLite unit of work for generation.
 *
 * Shares one `SqliteTransactionRunner` with the other units of work when the
 * composition root passes one in, because all of them use the same connection and
 * `BEGIN` is connection-wide. Passing no runner (tests, scripts that only use this
 * module) creates a private one for that connection.
 *
 * The bank repositories are reused as-is rather than wrapped: a generated question
 * is written by `QuestionRepository.create` and a generated card by
 * `FlashcardRepository.create`, so generation adds no insert SQL of its own and a
 * generated item is stored by exactly the code path a hand-written one is.
 */
export class SqliteGenerationUnitOfWork implements GenerationUnitOfWork {
  private readonly repositories: GenerationTransactionRepositories;

  private readonly runner: SqliteTransactionRunner;

  constructor(database: SqliteDatabase, runner?: SqliteTransactionRunner) {
    this.runner = runner ?? new SqliteTransactionRunner(database);
    this.repositories = {
      runs: new SqliteGenerationRunRepository(database),
      questions: new SqliteQuestionRepository(database),
      flashcards: new SqliteFlashcardRepository(database),
      certifications: new SqliteCertificationRepository(database),
      objectives: new SqliteObjectiveRepository(database),
      grounding: new SqliteSourceGroundingRepository(database),
    };
  }

  async transaction<T>(
    operation: (repositories: GenerationTransactionRepositories) => Promise<T>,
  ): Promise<T> {
    return this.runner.run(async () => operation(this.repositories));
  }
}
