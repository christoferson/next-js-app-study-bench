import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import { SqliteCertificationRepository } from "./sqlite-certification-repository";
import { SqliteObjectiveRepository } from "./sqlite-objective-repository";
import { SqliteUnitOfWork } from "./sqlite-unit-of-work";
import { seedDemoContent } from "./demo-seed";
import {
  FixedClock,
  SequentialIdGenerator,
  createMigratedDatabase,
} from "./test-support";

describe("seedDemoContent", () => {
  let database: SqliteDatabase;
  let certifications: SqliteCertificationRepository;
  let objectives: SqliteObjectiveRepository;

  const seed = async (): Promise<ReturnType<typeof seedDemoContent>> =>
    seedDemoContent({
      unitOfWork: new SqliteUnitOfWork(database),
      clock: new FixedClock(),
      ids: new SequentialIdGenerator(),
    });

  beforeEach(() => {
    database = createMigratedDatabase();
    certifications = new SqliteCertificationRepository(database);
    objectives = new SqliteObjectiveRepository(database);
  });

  afterEach(() => {
    database.close();
  });

  it("inserts the two demo tracks", async () => {
    const outcome = await seed();

    expect(outcome.inserted).toEqual([
      "aws-certified-generative-ai-developer-professional-aip-c01",
      "hsk-chinese-demo-track",
    ]);
    expect(outcome.skipped).toEqual([]);
    await expect(certifications.listActive()).resolves.toHaveLength(2);
  });

  it("labels every seeded track as demo content", async () => {
    await seed();

    const active = await certifications.listActive();

    expect(active.every((entry) => entry.origin === "DEMO")).toBe(true);
  });

  it("migrates the D1 demo study types to the SPEC 6.1 enum", async () => {
    await seed();

    const aws = await certifications.findBySlug(
      "aws-certified-generative-ai-developer-professional-aip-c01",
    );
    const hsk = await certifications.findBySlug("hsk-chinese-demo-track");

    expect(aws?.studyType).toBe("TECHNICAL_CERTIFICATION");
    expect(hsk?.studyType).toBe("LANGUAGE_PROFICIENCY");
  });

  it("inserts a nested objective hierarchy", async () => {
    await seed();

    const aws = await certifications.findBySlug(
      "aws-certified-generative-ai-developer-professional-aip-c01",
    );
    const stored = await objectives.listByCertification(aws?.id ?? "");

    expect(stored).toHaveLength(6);
    expect(
      stored.filter((entry) => entry.parentObjectiveId !== null),
    ).toHaveLength(2);
    expect(stored.map((entry) => entry.title)).toContain(
      "Foundation model selection",
    );
  });

  it("never labels demo objectives as official", async () => {
    await seed();

    const hsk = await certifications.findBySlug("hsk-chinese-demo-track");
    const stored = await objectives.listByCertification(hsk?.id ?? "");

    expect(stored.every((entry) => entry.sourceType === "USER_DEFINED")).toBe(
      true,
    );
  });

  it("is idempotent: a second run inserts nothing", async () => {
    await seed();

    const second = await seed();

    expect(second.inserted).toEqual([]);
    expect(second.skipped).toHaveLength(2);
    await expect(certifications.listActive()).resolves.toHaveLength(2);
  });

  it("leaves an existing track untouched instead of overwriting it", async () => {
    await seed();
    const before = await certifications.findBySlug("hsk-chinese-demo-track");

    expect(before).not.toBeNull();

    if (before !== null) {
      await certifications.save({ ...before, name: "Owner-edited name" });
    }

    await seed();

    const after = await certifications.findBySlug("hsk-chinese-demo-track");
    expect(after?.name).toBe("Owner-edited name");
  });
});
