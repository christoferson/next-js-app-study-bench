import { describe, expect, it } from "vitest";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import {
  certificationFixture,
  createMigratedDatabase,
} from "@/modules/certifications/infrastructure/test-support";
import { SqliteQuestionRepository } from "@/modules/question-bank/infrastructure/sqlite-question-repository";
import {
  questionFixture,
  revisionFixture,
} from "@/modules/question-bank/infrastructure/test-support";
import { SqliteFlashcardRepository } from "@/modules/flashcards/infrastructure/sqlite-flashcard-repository";
import {
  cardRevisionFixture,
  flashcardFixture,
} from "@/modules/flashcards/infrastructure/test-support";
import { describeStudySessionRepositoryContract } from "@/modules/study-sessions/ports/repository-contract";
import { SqliteStudySessionRepository } from "./sqlite-study-session-repository";
import {
  attemptFixture,
  cardItemFixture,
  questionItemFixture,
  sessionFixture,
} from "./test-support";

describeStudySessionRepositoryContract("SQLite", () => {
  const database = createMigratedDatabase();

  return {
    sessions: new SqliteStudySessionRepository(database),
    certifications: new SqliteCertificationRepository(database),
    objectives: new SqliteObjectiveRepository(database),
    questions: new SqliteQuestionRepository(database),
    flashcards: new SqliteFlashcardRepository(database),
    dispose: () => database.close(),
  };
});

describe("SQLite study-session schema", () => {
  it("uses strict tables for the session schema", () => {
    const database = createMigratedDatabase();

    try {
      // A STRICT table refuses a value it cannot store in the declared type; a
      // non-strict table would coerce this position to 0.
      expect(() =>
        database.exec(
          `INSERT INTO study_session_items (id, session_id, position, item_type,
             question_id, question_revision_id, status)
           VALUES ('i', 's', 'first', 'QUESTION', 'question-1', 'revision-1',
             'PENDING')`,
        ),
      ).toThrow(/cannot store TEXT/i);
    } finally {
      database.close();
    }
  });

  it("constrains the enum columns to the specified values", async () => {
    const database = createMigratedDatabase();

    try {
      const subject = await seedSession(database);

      await subject.sessions.recordAttempt(attemptFixture());

      expect(() =>
        database.exec(
          `UPDATE study_sessions SET mode = 'EXAM_SIMULATION' WHERE id = 'session-1'`,
        ),
      ).toThrow(/constraint/i);
      expect(() =>
        database.exec(
          `UPDATE study_sessions SET status = 'PAUSED' WHERE id = 'session-1'`,
        ),
      ).toThrow(/constraint/i);
      expect(() =>
        database.exec(
          `UPDATE study_session_items SET status = 'ANSWERED' WHERE id = 'item-1'`,
        ),
      ).toThrow(/constraint/i);
      expect(() =>
        database.exec(
          `UPDATE question_attempts SET confidence = 'SURE' WHERE id = 'attempt-1'`,
        ),
      ).toThrow(/constraint/i);
      expect(() =>
        database.exec(
          `UPDATE question_attempts SET evaluation_mode = 'AI_GRADED'
           WHERE id = 'attempt-1'`,
        ),
      ).toThrow(/constraint/i);
    } finally {
      database.close();
    }
  });

  it("refuses a target that is not a plausible session length", async () => {
    const database = createMigratedDatabase();

    try {
      await seedSession(database);

      // The estimate sizes the item list, so a zero- or day-long target would
      // compose either nothing or the whole bank.
      expect(() =>
        database.exec(
          `UPDATE study_sessions SET target_minutes = 0 WHERE id = 'session-1'`,
        ),
      ).toThrow(/constraint/i);
      expect(() =>
        database.exec(
          `UPDATE study_sessions SET target_minutes = 600 WHERE id = 'session-1'`,
        ),
      ).toThrow(/constraint/i);
    } finally {
      database.close();
    }
  });

  it("refuses a negative answer duration", async () => {
    const database = createMigratedDatabase();

    try {
      const subject = await seedSession(database);

      await subject.sessions.recordAttempt(attemptFixture());

      expect(() =>
        database.exec(
          `UPDATE question_attempts SET duration_seconds = -1 WHERE id = 'attempt-1'`,
        ),
      ).toThrow(/constraint/i);
      // Null stays legal: a restored page reports no timing at all.
      expect(() =>
        database.exec(
          `UPDATE question_attempts SET duration_seconds = NULL WHERE id = 'attempt-1'`,
        ),
      ).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("refuses an item that mixes a question with a flashcard", async () => {
    const database = createMigratedDatabase();

    try {
      await seedSession(database);

      expect(() =>
        database.exec(
          `UPDATE study_session_items SET flashcard_id = 'flashcard-1'
           WHERE id = 'item-1'`,
        ),
      ).toThrow(/constraint/i);
    } finally {
      database.close();
    }
  });

  it("refuses two items at the same position in one session", async () => {
    const database = createMigratedDatabase();

    try {
      const subject = await seedSession(database);

      await expect(
        subject.sessions.create(sessionFixture({ id: "session-2" }), [
          questionItemFixture({ id: "item-a", position: 1 }),
          questionItemFixture({ id: "item-b", position: 1 }),
        ]),
      ).rejects.toThrow(/UNIQUE/i);
    } finally {
      database.close();
    }
  });

  it("rejects a session that names a track which does not exist", async () => {
    const database = createMigratedDatabase();

    try {
      const sessions = new SqliteStudySessionRepository(database);

      await expect(
        sessions.create(
          sessionFixture({ certificationIds: ["certification-missing"] }),
          [],
        ),
      ).rejects.toThrow(/FOREIGN KEY/i);
    } finally {
      database.close();
    }
  });

  it("rejects an attempt that names a revision which does not exist", async () => {
    const database = createMigratedDatabase();

    try {
      const subject = await seedSession(database);

      await expect(
        subject.sessions.recordAttempt(
          attemptFixture({ questionRevisionId: "missing-revision" }),
        ),
      ).rejects.toThrow(/FOREIGN KEY/i);
    } finally {
      database.close();
    }
  });

  it("keeps an attempted question and its revision from being deleted", async () => {
    const database = createMigratedDatabase();

    try {
      const subject = await seedSession(database);

      await subject.sessions.recordAttempt(attemptFixture());

      // Historical integrity (`spec/DOMAIN-RULES.md` section 1.3): the question
      // and the exact revision an attempt names cannot disappear underneath it.
      // The dependency checker refuses the deletion first; this is the backstop.
      await expect(
        new SqliteQuestionRepository(database).delete("question-1"),
      ).rejects.toThrow(/FOREIGN KEY/i);
      expect(() =>
        database.exec(`DELETE FROM question_revisions WHERE id = 'revision-1'`),
      ).toThrow(/FOREIGN KEY/i);
    } finally {
      database.close();
    }
  });

  it("keeps a flashcard that a session item offered from being deleted", async () => {
    const database = createMigratedDatabase();

    try {
      const certifications = new SqliteCertificationRepository(database);
      const flashcards = new SqliteFlashcardRepository(database);
      const sessions = new SqliteStudySessionRepository(database);

      await certifications.save(certificationFixture());
      await flashcards.create(flashcardFixture(), cardRevisionFixture());
      await sessions.create(sessionFixture({ mode: "FLASHCARDS_ONLY" }), [
        cardItemFixture(),
      ]);

      // A card the owner was shown stays explainable: RESTRICT on both the card
      // and the frozen revision.
      expect(() =>
        database.exec(`DELETE FROM flashcards WHERE id = 'flashcard-1'`),
      ).toThrow(/FOREIGN KEY/i);
      expect(() =>
        database.exec(
          `DELETE FROM flashcard_revisions WHERE id = 'card-revision-1'`,
        ),
      ).toThrow(/FOREIGN KEY/i);
    } finally {
      database.close();
    }
  });

  it("removes items and attempts when the session itself is deleted", async () => {
    const database = createMigratedDatabase();

    try {
      const subject = await seedSession(database);

      await subject.sessions.recordAttempt(attemptFixture());

      // Deleting a session is not an application capability; this asserts the
      // schema's referential intent. Items and attempts are parts of the
      // aggregate, so they cascade rather than restrict.
      database.exec(`DELETE FROM study_sessions WHERE id = 'session-1'`);

      await expect(subject.sessions.findById("session-1")).resolves.toBeNull();
      await expect(
        subject.sessions.listAttemptsForSession("session-1"),
      ).resolves.toEqual([]);
      await expect(
        subject.sessions.countQuestionReferences("question-1"),
      ).resolves.toEqual({ attempts: 0, sessionItems: 0 });
    } finally {
      database.close();
    }
  });

  it("fails loudly when a stored answer no longer matches its question type", async () => {
    const database = createMigratedDatabase();

    try {
      const subject = await seedSession(database);

      await subject.sessions.recordAttempt(attemptFixture());
      database.exec(
        `UPDATE question_attempts
         SET submitted_answer = '{"type":"ESSAY","text":"x"}'
         WHERE id = 'attempt-1'`,
      );

      // The database is an external boundary, so a hand-edited answer must not
      // flow into the domain as a lie (`spec/CODING-STANDARDS.md` section 6).
      await expect(
        subject.sessions.listAttemptsForSession("session-1"),
      ).rejects.toThrow(/submitted answer/i);
    } finally {
      database.close();
    }
  });

  it("fails loudly when a stored answer holds invalid JSON", async () => {
    const database = createMigratedDatabase();

    try {
      const subject = await seedSession(database);

      await subject.sessions.recordAttempt(attemptFixture());
      database.exec(
        `UPDATE question_attempts SET submitted_answer = 'not json'
         WHERE id = 'attempt-1'`,
      );

      await expect(
        subject.sessions.listAttemptsForSession("session-1"),
      ).rejects.toThrow(/invalid JSON/i);
    } finally {
      database.close();
    }
  });
});

/** One track, one active question, and one single-item session in progress. */
async function seedSession(
  database: ReturnType<typeof createMigratedDatabase>,
): Promise<{ readonly sessions: SqliteStudySessionRepository }> {
  const certifications = new SqliteCertificationRepository(database);
  const questions = new SqliteQuestionRepository(database);
  const sessions = new SqliteStudySessionRepository(database);

  await certifications.save(certificationFixture());
  await questions.create(
    questionFixture({ lifecycleStatus: "ACTIVE" }),
    revisionFixture(),
  );
  await sessions.create(sessionFixture(), [questionItemFixture()]);

  return { sessions };
}
