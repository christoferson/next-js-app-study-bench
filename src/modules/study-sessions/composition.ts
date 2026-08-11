import "server-only";
import { systemClock } from "@/platform/clock";
import { cryptoIdGenerator } from "@/platform/id-generator";
import { getDatabaseContainer } from "@/platform/database/composition";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { SqliteTransactionRunner } from "@/platform/database/sqlite-transaction-runner";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import { DeterministicReviewScheduler } from "@/modules/flashcards/domain/review-scheduling";
import { SqliteFlashcardRepository } from "@/modules/flashcards/infrastructure/sqlite-flashcard-repository";
import { SqliteQuestionRepository } from "@/modules/question-bank/infrastructure/sqlite-question-repository";
import { ProgressFacade } from "@/modules/study-sessions/application/progress-facade";
import { StudyFacade } from "@/modules/study-sessions/application/study-facade";
import { DeterministicSessionComposer } from "@/modules/study-sessions/domain/session-composer";
import { SqliteProgressRepository } from "@/modules/study-sessions/infrastructure/sqlite-progress-repository";
import { SqliteStudySessionRepository } from "@/modules/study-sessions/infrastructure/sqlite-study-session-repository";
import { SqliteStudyUnitOfWork } from "@/modules/study-sessions/infrastructure/sqlite-study-unit-of-work";

/**
 * Server-only composition root for study sessions and progress.
 *
 * Uses the shared connection and transaction runner, so a session write cannot
 * deadlock against a certification, question-bank, or flashcard write on the same
 * SQLite write lock.
 *
 * Both replaceable algorithms are wired here rather than constructed inside the
 * facade. Swapping the composition policy or the review scheduler is one line in this
 * file and no change to the facade, the routes, or persistence
 * (`spec/ARCHITECTURE.md` section 5.3). The scheduler is the same deterministic one
 * the flashcard root composes, so a card rated inside a session is scheduled exactly
 * as one rated on the review screen.
 */
export function createStudyFacade(
  database: SqliteDatabase,
  runner?: SqliteTransactionRunner,
): StudyFacade {
  return new StudyFacade({
    sessions: new SqliteStudySessionRepository(database),
    questions: new SqliteQuestionRepository(database),
    flashcards: new SqliteFlashcardRepository(database),
    certifications: new SqliteCertificationRepository(database),
    unitOfWork: new SqliteStudyUnitOfWork(database, runner),
    composer: new DeterministicSessionComposer(),
    scheduler: new DeterministicReviewScheduler(systemClock),
    clock: systemClock,
    ids: cryptoIdGenerator,
  });
}

/**
 * Progress reporting.
 *
 * Read-only: it gets no unit of work and no identifier generator, because there is
 * nothing for it to write.
 */
export function createProgressFacade(database: SqliteDatabase): ProgressFacade {
  return new ProgressFacade({
    progress: new SqliteProgressRepository(database),
    sessions: new SqliteStudySessionRepository(database),
    certifications: new SqliteCertificationRepository(database),
    objectives: new SqliteObjectiveRepository(database),
    flashcards: new SqliteFlashcardRepository(database),
    clock: systemClock,
  });
}

let studyFacade: StudyFacade | null = null;

export function getStudyFacade(): StudyFacade {
  if (studyFacade === null) {
    const container = getDatabaseContainer();

    studyFacade = createStudyFacade(container.database, container.transactions);
  }

  return studyFacade;
}

let progressFacade: ProgressFacade | null = null;

export function getProgressFacade(): ProgressFacade {
  if (progressFacade === null) {
    progressFacade = createProgressFacade(getDatabaseContainer().database);
  }

  return progressFacade;
}
