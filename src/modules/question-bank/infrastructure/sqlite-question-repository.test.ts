import { describe, expect, it } from "vitest";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import {
  certificationFixture,
  createMigratedDatabase,
} from "@/modules/certifications/infrastructure/test-support";
import { describeQuestionRepositoryContract } from "@/modules/question-bank/ports/repository-contract";
import { SqliteQuestionRepository } from "./sqlite-question-repository";
import { questionFixture, revisionFixture } from "./test-support";

describeQuestionRepositoryContract("SQLite", () => {
  const database = createMigratedDatabase();

  return {
    questions: new SqliteQuestionRepository(database),
    certifications: new SqliteCertificationRepository(database),
    objectives: new SqliteObjectiveRepository(database),
    dispose: () => database.close(),
  };
});

describe("SQLite question schema", () => {
  it("uses strict tables for the question schema", () => {
    const database = createMigratedDatabase();

    try {
      // A STRICT table refuses a value it cannot store in the declared type;
      // a non-strict table would coerce this revision number to 0.
      expect(() =>
        database.exec(
          `INSERT INTO question_revisions (id, question_id, revision_number,
             stem, question_type, content_payload, tags, created_at)
           VALUES ('r', 'q', 'first', 's', 'SINGLE_CHOICE', '{}', '[]',
             '2026-01-01T00:00:00.000Z')`,
        ),
      ).toThrow(/cannot store TEXT/i);
    } finally {
      database.close();
    }
  });

  it("constrains the status columns to the specified enums", async () => {
    const database = createMigratedDatabase();

    try {
      const certifications = new SqliteCertificationRepository(database);
      const questions = new SqliteQuestionRepository(database);

      await certifications.save(certificationFixture());
      await questions.create(questionFixture(), revisionFixture());

      expect(() =>
        database.exec(
          `UPDATE questions SET lifecycle_status = 'PUBLISHED' WHERE id = 'question-1'`,
        ),
      ).toThrow(/constraint/i);
      expect(() =>
        database.exec(
          `UPDATE questions SET quality_status = 'GREAT' WHERE id = 'question-1'`,
        ),
      ).toThrow(/constraint/i);
      expect(() =>
        database.exec(
          `UPDATE questions SET generation_mode = 'PSYCHIC' WHERE id = 'question-1'`,
        ),
      ).toThrow(/constraint/i);
    } finally {
      database.close();
    }
  });

  it("keeps a dispute reason only while the question is disputed", async () => {
    const database = createMigratedDatabase();

    try {
      const certifications = new SqliteCertificationRepository(database);
      const questions = new SqliteQuestionRepository(database);

      await certifications.save(certificationFixture());
      await questions.create(questionFixture(), revisionFixture());

      expect(() =>
        database.exec(
          `UPDATE questions SET dispute_reason = 'orphaned' WHERE id = 'question-1'`,
        ),
      ).toThrow(/constraint/i);
    } finally {
      database.close();
    }
  });

  it("rejects a question whose certification does not exist", async () => {
    const database = createMigratedDatabase();

    try {
      const questions = new SqliteQuestionRepository(database);

      await expect(
        questions.create(questionFixture(), revisionFixture()),
      ).rejects.toThrow(/FOREIGN KEY/i);
    } finally {
      database.close();
    }
  });

  it("removes a certification's questions when the track is deleted", async () => {
    const database = createMigratedDatabase();

    try {
      const certifications = new SqliteCertificationRepository(database);
      const questions = new SqliteQuestionRepository(database);

      await certifications.save(certificationFixture());
      await questions.create(questionFixture(), revisionFixture());

      // Track deletion is not an application capability; this asserts the
      // schema's referential intent rather than a product flow.
      database.exec(
        `UPDATE questions SET current_revision_id = NULL WHERE id = 'question-1'`,
      );
      database.exec(`DELETE FROM certifications WHERE id = 'certification-1'`);

      await expect(questions.findById("question-1")).resolves.toBeNull();
    } finally {
      database.close();
    }
  });
});
