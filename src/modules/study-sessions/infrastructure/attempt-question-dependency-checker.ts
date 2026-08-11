import type { QuestionId } from "@/modules/question-bank/domain/question";
import type {
  QuestionDependencyKind,
  QuestionDeletionEligibility,
  QuestionDependencyChecker,
} from "@/modules/question-bank/ports/question-dependency-checker";
import type { StudySessionRepository } from "@/modules/study-sessions/ports/study-session-repository";

/**
 * Reports answer attempts and study-session history as dependents of a question.
 *
 * These are the first two kinds `SPEC.md` section 6.3.2 names, and D5 is the
 * milestone that creates them. Once the owner has answered a question, deleting it
 * would erase the evidence behind every accuracy figure that answer contributed to;
 * once a session has offered it, deleting it would leave a recorded session with a
 * hole in it. Both are exactly what `spec/DOMAIN-RULES.md` section 1.3 protects, so
 * the question becomes retirable rather than deletable.
 *
 * The `ON DELETE RESTRICT` foreign keys on `question_attempts` and
 * `study_session_items` are the backstop; this checker is what lets the detail view
 * say so before the owner clicks delete, with a message naming the reason.
 *
 * It lives in the study-sessions module because that module owns those tables, and
 * it implements the question-bank port so the question-bank facade, delete flow, and
 * error type are unchanged. The composition root combines it with the D4 flashcard
 * checker (see `CompositeQuestionDependencyChecker`).
 */
export class AttemptQuestionDependencyChecker implements QuestionDependencyChecker {
  constructor(private readonly sessions: StudySessionRepository) {}

  async checkDeletionEligibility(
    id: QuestionId,
  ): Promise<QuestionDeletionEligibility> {
    const references = await this.sessions.countQuestionReferences(id);
    const blocking: QuestionDependencyKind[] = [];

    if (references.attempts > 0) {
      blocking.push("ATTEMPTS");
    }

    if (references.sessionItems > 0) {
      blocking.push("STUDY_SESSIONS");
    }

    return blocking.length === 0
      ? { deletable: true, blockingDependencies: [] }
      : { deletable: false, blockingDependencies: blocking };
  }
}

/**
 * Combines several dependency checkers into the one the facade consults.
 *
 * Each milestone that introduces a dependent record contributes a checker rather
 * than editing an existing one, and this composes them: a question is deletable
 * only when every checker agrees, and the blocking kinds are the union of what they
 * report, so the owner is told about all of the history at once instead of
 * discovering it one delete attempt at a time.
 *
 * Checkers run in order and every one is consulted even after the first refusal,
 * which is the point — a partial answer would send the owner back to the same dead
 * end.
 */
export class CompositeQuestionDependencyChecker implements QuestionDependencyChecker {
  private readonly checkers: readonly QuestionDependencyChecker[];

  constructor(...checkers: readonly QuestionDependencyChecker[]) {
    this.checkers = checkers;
  }

  async checkDeletionEligibility(
    id: QuestionId,
  ): Promise<QuestionDeletionEligibility> {
    const blocking = new Set<QuestionDependencyKind>();

    for (const checker of this.checkers) {
      const result = await checker.checkDeletionEligibility(id);

      for (const kind of result.blockingDependencies) {
        blocking.add(kind);
      }
    }

    return blocking.size === 0
      ? { deletable: true, blockingDependencies: [] }
      : { deletable: false, blockingDependencies: [...blocking] };
  }
}
