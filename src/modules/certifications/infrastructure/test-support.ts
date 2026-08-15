import type { Clock, IsoTimestamp } from "@/platform/clock";
import type { IdGenerator } from "@/platform/id-generator";
import { runMigrations } from "@/platform/database/migration-runner";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import {
  IN_MEMORY_DATABASE,
  openSqliteDatabase,
} from "@/platform/database/sqlite";
import type { Certification } from "@/modules/certifications/domain/certification";
import { DEFAULT_SESSION_MINUTES } from "@/modules/certifications/domain/certification";
import type { Objective } from "@/modules/certifications/domain/objective";

/**
 * Deterministic fixtures for repository, facade, and component tests.
 *
 * Tests always run against a fresh in-memory database with migrations applied,
 * so they never read or write `./data/study-bench.db` and never depend on
 * execution order.
 */

/** Fixed clock that advances only when a test asks it to. */
export class FixedClock implements Clock {
  constructor(private current: IsoTimestamp = "2026-01-01T00:00:00.000Z") {}

  now(): IsoTimestamp {
    return this.current;
  }

  set(timestamp: IsoTimestamp): void {
    this.current = timestamp;
  }
}

/** Sequential ID generator: `id-1`, `id-2`, ... */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix: string = "id") {}

  nextId(): string {
    this.counter += 1;

    return `${this.prefix}-${this.counter}`;
  }
}

export function createMigratedDatabase(): SqliteDatabase {
  const database = openSqliteDatabase(IN_MEMORY_DATABASE);
  runMigrations(database, undefined, "2026-01-01T00:00:00.000Z");

  return database;
}

export function certificationFixture(
  overrides: Partial<Certification> = {},
): Certification {
  return {
    id: "certification-1",
    slug: "demo-cloud-practitioner",
    name: "Demo Cloud Practitioner",
    provider: "Demo Provider",
    examCode: "DEMO-001",
    version: null,
    studyType: "TECHNICAL_CERTIFICATION",
    description: "Fictional track used only by the test suite.",
    targetDate: null,
    priority: 3,
    defaultSessionMinutes: DEFAULT_SESSION_MINUTES,
    status: "ACTIVE",
    origin: "OWNER",
    personaId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function objectiveFixture(
  overrides: Partial<Objective> = {},
): Objective {
  return {
    id: "objective-1",
    certificationId: "certification-1",
    parentObjectiveId: null,
    code: "Demo domain 1",
    title: "Demo objective",
    description: null,
    weight: null,
    sourceType: "USER_DEFINED",
    displayOrder: 1,
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
