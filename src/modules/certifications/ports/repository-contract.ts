import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CertificationRepository } from "./certification-repository";
import type { ObjectiveRepository } from "./objective-repository";
import type { CertificationUnitOfWork } from "./unit-of-work";
import {
  certificationFixture,
  objectiveFixture,
} from "@/modules/certifications/infrastructure/test-support";
import {
  CertificationNotFoundError,
  ObjectiveNotFoundError,
} from "@/modules/certifications/domain/errors";

/**
 * Shared repository contract.
 *
 * This suite defines the domain-observable behaviour every certification
 * persistence adapter must provide. The SQLite adapter runs it today; when
 * PostgreSQL arrives in D13 it must run the same suite (`spec/ARCHITECTURE.md`
 * section 7.4) rather than a parallel set of assertions.
 */

export interface ContractSubject {
  readonly certifications: CertificationRepository;
  readonly objectives: ObjectiveRepository;
  readonly unitOfWork: CertificationUnitOfWork;
  /** Called after each test so state never leaks between cases. */
  dispose(): void;
}

const LATER = "2026-06-01T12:00:00.000Z";

export function describeCertificationRepositoryContract(
  adapterName: string,
  createSubject: () => ContractSubject,
): void {
  describe(`${adapterName} certification repository contract`, () => {
    let subject: ContractSubject;

    beforeEach(() => {
      subject = createSubject();
    });

    afterEach(() => {
      subject.dispose();
    });

    it("round-trips a saved certification", async () => {
      const certification = certificationFixture({
        examCode: "DEMO-900",
        version: "2026",
        targetDate: "2026-09-30",
        priority: 1,
        defaultSessionMinutes: 45,
      });

      await subject.certifications.save(certification);

      await expect(
        subject.certifications.findById(certification.id),
      ).resolves.toEqual(certification);
    });

    it("preserves nulls for optional certification fields", async () => {
      const certification = certificationFixture({
        examCode: null,
        version: null,
        targetDate: null,
      });

      await subject.certifications.save(certification);
      const found = await subject.certifications.findById(certification.id);

      expect(found?.examCode).toBeNull();
      expect(found?.version).toBeNull();
      expect(found?.targetDate).toBeNull();
    });

    it("finds a certification by slug and returns null for an unknown slug", async () => {
      await subject.certifications.save(
        certificationFixture({ slug: "known-track" }),
      );

      await expect(
        subject.certifications.findBySlug("known-track"),
      ).resolves.not.toBeNull();
      await expect(
        subject.certifications.findBySlug("no-such-track"),
      ).resolves.toBeNull();
    });

    it("reports whether a slug is taken", async () => {
      await subject.certifications.save(
        certificationFixture({ slug: "taken-track" }),
      );

      await expect(
        subject.certifications.isSlugTaken("taken-track"),
      ).resolves.toBe(true);
      await expect(
        subject.certifications.isSlugTaken("free-track"),
      ).resolves.toBe(false);
    });

    it("updates an existing certification instead of duplicating it", async () => {
      const certification = certificationFixture();
      await subject.certifications.save(certification);

      await subject.certifications.save({
        ...certification,
        name: "Renamed track",
        priority: 5,
        updatedAt: LATER,
      });

      const active = await subject.certifications.listActive();
      expect(active).toHaveLength(1);
      expect(active[0]?.name).toBe("Renamed track");
      expect(active[0]?.priority).toBe(5);
      expect(active[0]?.createdAt).toBe(certification.createdAt);
    });

    it("excludes archived certifications from the active list", async () => {
      await subject.certifications.save(
        certificationFixture({ id: "active-1", slug: "active-track" }),
      );
      await subject.certifications.save(
        certificationFixture({ id: "archived-1", slug: "archived-track" }),
      );

      await subject.certifications.archive("archived-1", LATER);

      await expect(subject.certifications.listActive()).resolves.toMatchObject([
        { id: "active-1" },
      ]);
      await expect(
        subject.certifications.listArchived(),
      ).resolves.toMatchObject([{ id: "archived-1" }]);
    });

    it("restores an archived certification to the active list", async () => {
      await subject.certifications.save(
        certificationFixture({ id: "restorable" }),
      );
      await subject.certifications.archive("restorable", LATER);

      await subject.certifications.restore("restorable", LATER);

      await expect(subject.certifications.listActive()).resolves.toMatchObject([
        { id: "restorable", status: "ACTIVE" },
      ]);
      await expect(subject.certifications.listArchived()).resolves.toEqual([]);
    });

    it("records the archival timestamp", async () => {
      await subject.certifications.save(certificationFixture());

      await subject.certifications.archive("certification-1", LATER);

      const archived = await subject.certifications.findById("certification-1");
      expect(archived?.updatedAt).toBe(LATER);
    });

    it("orders active certifications by priority then name", async () => {
      await subject.certifications.save(
        certificationFixture({
          id: "low",
          slug: "low",
          name: "Alpha",
          priority: 5,
        }),
      );
      await subject.certifications.save(
        certificationFixture({
          id: "high-b",
          slug: "high-b",
          name: "Bravo",
          priority: 1,
        }),
      );
      await subject.certifications.save(
        certificationFixture({
          id: "high-a",
          slug: "high-a",
          name: "Anvil",
          priority: 1,
        }),
      );

      const active = await subject.certifications.listActive();

      expect(active.map((entry) => entry.id)).toEqual([
        "high-a",
        "high-b",
        "low",
      ]);
    });

    it("rejects archiving a certification that does not exist", async () => {
      await expect(
        subject.certifications.archive("missing", LATER),
      ).rejects.toBeInstanceOf(CertificationNotFoundError);
    });

    it("round-trips an objective hierarchy", async () => {
      await subject.certifications.save(certificationFixture());
      const root = objectiveFixture({ id: "root", title: "Root" });
      const child = objectiveFixture({
        id: "child",
        parentObjectiveId: "root",
        title: "Child",
        displayOrder: 1,
        weight: 42.5,
        description: "Nested objective.",
      });
      const grandchild = objectiveFixture({
        id: "grandchild",
        parentObjectiveId: "child",
        title: "Grandchild",
        displayOrder: 1,
      });

      await subject.objectives.save(root);
      await subject.objectives.save(child);
      await subject.objectives.save(grandchild);

      const stored =
        await subject.objectives.listByCertification("certification-1");

      expect(stored).toHaveLength(3);
      expect(stored).toEqual(expect.arrayContaining([root, child, grandchild]));
    });

    it("returns archived objectives from listByCertification", async () => {
      await subject.certifications.save(certificationFixture());
      await subject.objectives.save(objectiveFixture({ id: "objective-a" }));
      await subject.objectives.save(
        objectiveFixture({ id: "objective-b", displayOrder: 2 }),
      );

      await subject.objectives.archive("objective-b", LATER);

      const stored =
        await subject.objectives.listByCertification("certification-1");

      expect(stored.map((entry) => entry.status)).toEqual([
        "ACTIVE",
        "ARCHIVED",
      ]);
    });

    it("restores an archived objective", async () => {
      await subject.certifications.save(certificationFixture());
      await subject.objectives.save(objectiveFixture());
      await subject.objectives.archive("objective-1", LATER);

      await subject.objectives.restore("objective-1", LATER);

      const restored = await subject.objectives.findById("objective-1");
      expect(restored?.status).toBe("ACTIVE");
    });

    it("keeps objectives scoped to their certification", async () => {
      await subject.certifications.save(certificationFixture());
      await subject.certifications.save(
        certificationFixture({ id: "certification-2", slug: "other-track" }),
      );
      await subject.objectives.save(objectiveFixture({ id: "in-first" }));
      await subject.objectives.save(
        objectiveFixture({
          id: "in-second",
          certificationId: "certification-2",
        }),
      );

      const first =
        await subject.objectives.listByCertification("certification-1");

      expect(first.map((entry) => entry.id)).toEqual(["in-first"]);
    });

    it("rejects an objective whose parent does not exist", async () => {
      await subject.certifications.save(certificationFixture());

      await expect(
        subject.objectives.save(
          objectiveFixture({ parentObjectiveId: "no-such-parent" }),
        ),
      ).rejects.toThrow();
    });

    it("rejects an objective whose certification does not exist", async () => {
      await expect(
        subject.objectives.save(
          objectiveFixture({ certificationId: "no-such-track" }),
        ),
      ).rejects.toThrow();
    });

    it("rejects an objective that is its own parent", async () => {
      await subject.certifications.save(certificationFixture());

      await expect(
        subject.objectives.save(
          objectiveFixture({ id: "self", parentObjectiveId: "self" }),
        ),
      ).rejects.toThrow();
    });

    it("applies a sibling reorder atomically", async () => {
      await subject.certifications.save(certificationFixture());
      await subject.objectives.save(
        objectiveFixture({ id: "first", displayOrder: 1 }),
      );
      await subject.objectives.save(
        objectiveFixture({ id: "second", displayOrder: 2 }),
      );
      await subject.objectives.save(
        objectiveFixture({ id: "third", displayOrder: 3 }),
      );

      await subject.unitOfWork.transaction(async ({ objectives }) => {
        await objectives.applyPositions(
          [
            { id: "third", displayOrder: 1 },
            { id: "first", displayOrder: 2 },
            { id: "second", displayOrder: 3 },
          ],
          LATER,
        );
      });

      const ordered =
        await subject.objectives.listByCertification("certification-1");

      expect(ordered.map((entry) => entry.id)).toEqual([
        "third",
        "first",
        "second",
      ]);
    });

    it("leaves positions unchanged when a reorder fails part-way", async () => {
      await subject.certifications.save(certificationFixture());
      await subject.objectives.save(
        objectiveFixture({ id: "first", displayOrder: 1 }),
      );
      await subject.objectives.save(
        objectiveFixture({ id: "second", displayOrder: 2 }),
      );

      await expect(
        subject.unitOfWork.transaction(async ({ objectives }) => {
          await objectives.applyPositions(
            [
              { id: "second", displayOrder: 1 },
              { id: "does-not-exist", displayOrder: 2 },
            ],
            LATER,
          );
        }),
      ).rejects.toBeInstanceOf(ObjectiveNotFoundError);

      const ordered =
        await subject.objectives.listByCertification("certification-1");

      expect(ordered.map((entry) => [entry.id, entry.displayOrder])).toEqual([
        ["first", 1],
        ["second", 2],
      ]);
    });

    it("rolls back every write in a failed transaction", async () => {
      await subject.certifications.save(certificationFixture());

      await expect(
        subject.unitOfWork.transaction(async ({ objectives }) => {
          await objectives.save(objectiveFixture({ id: "kept-briefly" }));
          throw new Error("deliberate failure");
        }),
      ).rejects.toThrow("deliberate failure");

      await expect(
        subject.objectives.listByCertification("certification-1"),
      ).resolves.toEqual([]);
    });

    it("commits every write in a successful transaction", async () => {
      await subject.unitOfWork.transaction(
        async ({ certifications, objectives }) => {
          await certifications.save(certificationFixture());
          await objectives.save(objectiveFixture({ id: "root" }));
          await objectives.save(
            objectiveFixture({
              id: "child",
              parentObjectiveId: "root",
              displayOrder: 1,
            }),
          );
        },
      );

      await expect(
        subject.objectives.listByCertification("certification-1"),
      ).resolves.toHaveLength(2);
    });

    it("rejects archiving an objective that does not exist", async () => {
      await expect(
        subject.objectives.archive("missing", LATER),
      ).rejects.toBeInstanceOf(ObjectiveNotFoundError);
    });
  });
}
