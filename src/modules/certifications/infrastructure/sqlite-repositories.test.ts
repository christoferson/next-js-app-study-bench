import { describe, expect, it } from "vitest";
import { readPragma } from "@/platform/database/sqlite";
import { describeCertificationRepositoryContract } from "@/modules/certifications/ports/repository-contract";
import { SqliteCertificationRepository } from "./sqlite-certification-repository";
import { SqliteObjectiveRepository } from "./sqlite-objective-repository";
import { SqliteUnitOfWork } from "./sqlite-unit-of-work";
import { createMigratedDatabase } from "./test-support";

describeCertificationRepositoryContract("SQLite", () => {
  const database = createMigratedDatabase();

  return {
    certifications: new SqliteCertificationRepository(database),
    objectives: new SqliteObjectiveRepository(database),
    unitOfWork: new SqliteUnitOfWork(database),
    dispose: () => database.close(),
  };
});

describe("SQLite connection configuration", () => {
  it("enables foreign keys and a busy timeout on every connection", () => {
    const database = createMigratedDatabase();

    try {
      expect(readPragma(database, "foreign_keys")).toBe(1);
      expect(readPragma(database, "busy_timeout")).toBe(5000);
    } finally {
      database.close();
    }
  });

  it("uses strict tables for the certification schema", () => {
    const database = createMigratedDatabase();

    try {
      // A STRICT table rejects a value that cannot be stored in its column's
      // declared type. Here a non-numeric priority is refused rather than
      // silently coerced, which a non-strict table would allow.
      expect(() =>
        database.exec(
          `INSERT INTO certifications (id, slug, name, provider, study_type,
             description, priority, default_session_minutes, status, origin,
             created_at, updated_at)
           VALUES ('x', 'x', 'x', 'x', 'GENERAL', 'x', 'high', 20, 'ACTIVE',
             'OWNER', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        ),
      ).toThrow(/cannot store TEXT/i);
    } finally {
      database.close();
    }
  });
});
