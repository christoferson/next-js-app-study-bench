import type { SqliteDatabase } from "@/platform/database/sqlite";
import { SqliteTransactionRunner } from "@/platform/database/sqlite-transaction-runner";
import { SqliteFlashcardRepository } from "@/modules/flashcards/infrastructure/sqlite-flashcard-repository";
import { SqliteQuestionRepository } from "@/modules/question-bank/infrastructure/sqlite-question-repository";
import type {
  StudyTransactionRepositories,
  StudyUnitOfWork,
} from "@/modules/study-sessions/ports/unit-of-work";
import { SqliteStudySessionRepository } from "./sqlite-study-session-repository";

/**
 * SQLite unit of work for study sessions.
 *
 * Shares one `SqliteTransactionRunner` with the certification, question-bank, and
 * flashcard units of work when the composition root passes one in, because all four
 * use the same connection and `BEGIN` is connection-wide. Passing no runner (tests,
 * scripts that only use this module) creates a private one for that connection.
 *
 * The flashcard repository is bound here so that rating a card inside a session
 * commits the review record, the new schedule, and the item completion together
 * (`SPEC.md` section 9.6).
 */
export class SqliteStudyUnitOfWork implements StudyUnitOfWork {
  private readonly repositories: StudyTransactionRepositories;

  private readonly runner: SqliteTransactionRunner;

  constructor(database: SqliteDatabase, runner?: SqliteTransactionRunner) {
    this.runner = runner ?? new SqliteTransactionRunner(database);
    this.repositories = {
      sessions: new SqliteStudySessionRepository(database),
      questions: new SqliteQuestionRepository(database),
      flashcards: new SqliteFlashcardRepository(database),
    };
  }

  async transaction<T>(
    operation: (repositories: StudyTransactionRepositories) => Promise<T>,
  ): Promise<T> {
    return this.runner.run(async () => operation(this.repositories));
  }
}
