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
import { describeFlashcardRepositoryContract } from "@/modules/flashcards/ports/repository-contract";
import { SqliteFlashcardRepository } from "./sqlite-flashcard-repository";
import {
  cardRevisionFixture,
  flashcardFixture,
  reviewRecordFixture,
  scheduleFixture,
} from "./test-support";

describeFlashcardRepositoryContract("SQLite", () => {
  const database = createMigratedDatabase();

  return {
    flashcards: new SqliteFlashcardRepository(database),
    certifications: new SqliteCertificationRepository(database),
    objectives: new SqliteObjectiveRepository(database),
    questions: new SqliteQuestionRepository(database),
    dispose: () => database.close(),
  };
});

describe("SQLite flashcard schema", () => {
  it("uses strict tables for the flashcard schema", () => {
    const database = createMigratedDatabase();

    try {
      // A STRICT table refuses a value it cannot store in the declared type; a
      // non-strict table would coerce this revision number to 0.
      expect(() =>
        database.exec(
          `INSERT INTO flashcard_revisions (id, flashcard_id, revision_number,
             card_type, content_payload, search_text, tags, created_at)
           VALUES ('r', 'c', 'first', 'BASIC', '{}', '', '[]',
             '2026-01-01T00:00:00.000Z')`,
        ),
      ).toThrow(/cannot store TEXT/i);
    } finally {
      database.close();
    }
  });

  it("constrains the enum columns to the specified values", async () => {
    const database = createMigratedDatabase();

    try {
      const subject = await seedCard(database);

      expect(() =>
        database.exec(
          `UPDATE flashcards SET lifecycle_status = 'PUBLISHED' WHERE id = 'flashcard-1'`,
        ),
      ).toThrow(/constraint/i);
      expect(() =>
        database.exec(
          `UPDATE flashcard_revisions SET card_type = 'PICTURE' WHERE id = 'card-revision-1'`,
        ),
      ).toThrow(/constraint/i);

      await subject.flashcards.recordReview(reviewRecordFixture());

      expect(() =>
        database.exec(
          `UPDATE flashcard_reviews SET rating = 'PERFECT' WHERE id = 'review-1'`,
        ),
      ).toThrow(/constraint/i);
    } finally {
      database.close();
    }
  });

  it("refuses a non-positive interval and a negative lapse count", async () => {
    const database = createMigratedDatabase();

    try {
      const subject = await seedCard(database);

      await subject.flashcards.saveSchedule(
        "flashcard-1",
        scheduleFixture(),
        "2026-01-01T00:00:00.000Z",
      );

      expect(() =>
        database.exec(
          `UPDATE review_schedules SET interval_minutes = 0 WHERE flashcard_id = 'flashcard-1'`,
        ),
      ).toThrow(/constraint/i);
      expect(() =>
        database.exec(
          `UPDATE review_schedules SET lapse_count = -1 WHERE flashcard_id = 'flashcard-1'`,
        ),
      ).toThrow(/constraint/i);
      expect(() =>
        database.exec(
          `UPDATE review_schedules SET review_count = 0 WHERE flashcard_id = 'flashcard-1'`,
        ),
      ).toThrow(/constraint/i);
    } finally {
      database.close();
    }
  });

  it("rejects a card whose certification does not exist", async () => {
    const database = createMigratedDatabase();

    try {
      const flashcards = new SqliteFlashcardRepository(database);

      await expect(
        flashcards.create(flashcardFixture(), cardRevisionFixture()),
      ).rejects.toThrow(/FOREIGN KEY/i);
    } finally {
      database.close();
    }
  });

  it("rejects a review that names a revision that does not exist", async () => {
    const database = createMigratedDatabase();

    try {
      const subject = await seedCard(database);

      await expect(
        subject.flashcards.recordReview(
          reviewRecordFixture({ flashcardRevisionId: "missing-revision" }),
        ),
      ).rejects.toThrow(/FOREIGN KEY/i);
    } finally {
      database.close();
    }
  });

  it("keeps a reviewed revision from being deleted", async () => {
    const database = createMigratedDatabase();

    try {
      const subject = await seedCard(database);

      await subject.flashcards.recordReview(reviewRecordFixture());

      // Historical integrity (`spec/DOMAIN-RULES.md` section 1.4): the revision
      // a review names cannot disappear underneath it. Nothing in the
      // application deletes revisions; this asserts the schema's intent.
      expect(() =>
        database.exec(
          `DELETE FROM flashcard_revisions WHERE id = 'card-revision-1'`,
        ),
      ).toThrow(/FOREIGN KEY/i);
    } finally {
      database.close();
    }
  });

  it("keeps a question that a card was converted from", async () => {
    const database = createMigratedDatabase();

    try {
      const certifications = new SqliteCertificationRepository(database);
      const questions = new SqliteQuestionRepository(database);
      const flashcards = new SqliteFlashcardRepository(database);

      await certifications.save(certificationFixture());
      await questions.create(questionFixture(), revisionFixture());
      await flashcards.create(
        flashcardFixture({ sourceQuestionId: "question-1" }),
        cardRevisionFixture(),
      );

      // A converted card is a dependent of its question: the question-bank
      // dependency checker refuses the deletion first, and this constraint is the
      // backstop that keeps provenance from being erased.
      await expect(questions.delete("question-1")).rejects.toThrow(
        /FOREIGN KEY/i,
      );
    } finally {
      database.close();
    }
  });

  it("removes a card's schedule and reviews when the card's track is deleted", async () => {
    const database = createMigratedDatabase();

    try {
      const subject = await seedCard(database);

      await subject.flashcards.saveSchedule(
        "flashcard-1",
        scheduleFixture(),
        "2026-01-01T00:00:00.000Z",
      );
      await subject.flashcards.recordReview(reviewRecordFixture());

      // Track deletion is not an application capability; this asserts the
      // schema's referential intent rather than a product flow. The
      // current-revision pointer is cleared first because it is RESTRICT, the
      // same order the question bank uses.
      database.exec(
        `UPDATE flashcards SET current_revision_id = NULL WHERE id = 'flashcard-1'`,
      );
      database.exec(`DELETE FROM certifications WHERE id = 'certification-1'`);

      await expect(
        subject.flashcards.findById("flashcard-1"),
      ).resolves.toBeNull();
      await expect(
        subject.flashcards.findSchedule("flashcard-1"),
      ).resolves.toBeNull();
      await expect(
        subject.flashcards.listReviews("flashcard-1", 10),
      ).resolves.toEqual([]);
    } finally {
      database.close();
    }
  });

  it("fails loudly when a stored payload no longer matches its declared type", async () => {
    const database = createMigratedDatabase();

    try {
      const subject = await seedCard(database);

      database.exec(
        `UPDATE flashcard_revisions
         SET content_payload = '{"type":"VOCABULARY","term":"x"}'
         WHERE id = 'card-revision-1'`,
      );

      // The database is an external boundary, so a hand-edited payload must not
      // flow into the domain as a lie.
      await expect(
        subject.flashcards.findWithCurrentRevision("flashcard-1"),
      ).rejects.toThrow(/unsupported card content/i);
    } finally {
      database.close();
    }
  });

  it("fails loudly when a stored payload holds invalid JSON", async () => {
    const database = createMigratedDatabase();

    try {
      const subject = await seedCard(database);

      database.exec(
        `UPDATE flashcard_revisions SET content_payload = 'not json'
         WHERE id = 'card-revision-1'`,
      );

      await expect(
        subject.flashcards.findWithCurrentRevision("flashcard-1"),
      ).rejects.toThrow(/invalid JSON/i);
    } finally {
      database.close();
    }
  });
});

/** One saved track and one draft basic card, for the schema-level assertions. */
async function seedCard(
  database: ReturnType<typeof createMigratedDatabase>,
): Promise<{ readonly flashcards: SqliteFlashcardRepository }> {
  const certifications = new SqliteCertificationRepository(database);
  const flashcards = new SqliteFlashcardRepository(database);

  await certifications.save(certificationFixture());
  await flashcards.create(flashcardFixture(), cardRevisionFixture());

  return { flashcards };
}
