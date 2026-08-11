import type { Clock } from "@/platform/clock";
import type { IdGenerator } from "@/platform/id-generator";
import type {
  Certification,
  CertificationId,
  CertificationSlug,
  ContentOrigin,
} from "@/modules/certifications/domain/certification";
import {
  isReservedSlug,
  slugify,
  slugWithSuffix,
} from "@/modules/certifications/domain/certification";
import {
  CertificationNotFoundError,
  ObjectiveNotFoundError,
  SlugConflictError,
} from "@/modules/certifications/domain/errors";
import type {
  Objective,
  ObjectiveId,
  ObjectiveTreeNode,
} from "@/modules/certifications/domain/objective";
import {
  assertValidNewParent,
  assertValidReparent,
  buildObjectiveTree,
  listReparentCandidates,
} from "@/modules/certifications/domain/objective";
import type { CertificationRepository } from "@/modules/certifications/ports/certification-repository";
import type {
  ObjectivePosition,
  ObjectiveRepository,
} from "@/modules/certifications/ports/objective-repository";
import type { CertificationUnitOfWork } from "@/modules/certifications/ports/unit-of-work";
import type {
  CertificationInput,
  MoveDirection,
  ObjectiveInput,
} from "./schemas";

/**
 * Certification capability facade.
 *
 * Owns the workflow rules for study tracks and their objective hierarchy:
 * slug derivation, hierarchy validation, sibling ordering, and transaction
 * boundaries. Server Actions and pages call this facade; they never touch SQL,
 * ordering arithmetic, or cycle detection themselves.
 */

/** Dashboard payload. Archived tracks are fetched only when asked for. */
export interface CertificationListView {
  readonly active: readonly Certification[];
  readonly archived: readonly Certification[];
  readonly archivedCount: number;
}

export interface CertificationDetailView {
  readonly certification: Certification;
  readonly objectiveTree: readonly ObjectiveTreeNode[];
  readonly activeObjectiveCount: number;
  readonly archivedObjectiveCount: number;
}

/** Everything the objective form needs, including legal parent choices. */
export interface ObjectiveFormView {
  readonly certification: Certification;
  readonly objective: Objective;
  readonly parentCandidates: readonly Objective[];
}

export interface NewObjectiveFormView {
  readonly certification: Certification;
  readonly parentCandidates: readonly Objective[];
  readonly parentObjectiveId: ObjectiveId | null;
}

export interface CertificationFacadeDependencies {
  readonly certifications: CertificationRepository;
  readonly objectives: ObjectiveRepository;
  readonly unitOfWork: CertificationUnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export class CertificationFacade {
  constructor(private readonly deps: CertificationFacadeDependencies) {}

  async listCertifications(options: {
    readonly includeArchived: boolean;
  }): Promise<CertificationListView> {
    const [active, archived] = await Promise.all([
      this.deps.certifications.listActive(),
      this.deps.certifications.listArchived(),
    ]);

    return {
      active,
      archived: options.includeArchived ? archived : [],
      archivedCount: archived.length,
    };
  }

  async findDetailBySlug(
    slug: CertificationSlug,
  ): Promise<CertificationDetailView | null> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      return null;
    }

    const objectives = await this.deps.objectives.listByCertification(
      certification.id,
    );

    return {
      certification,
      objectiveTree: buildObjectiveTree(objectives),
      activeObjectiveCount: objectives.filter(
        (objective) => objective.status === "ACTIVE",
      ).length,
      archivedObjectiveCount: objectives.filter(
        (objective) => objective.status === "ARCHIVED",
      ).length,
    };
  }

  async findEditFormBySlug(
    slug: CertificationSlug,
  ): Promise<Certification | null> {
    return this.deps.certifications.findBySlug(slug);
  }

  /**
   * Creates a track and returns its slug.
   *
   * The slug is derived from the name; collisions gain a numeric suffix so that
   * two similarly named tracks can coexist without the owner editing an address.
   */
  async createCertification(
    input: CertificationInput,
    origin: ContentOrigin = "OWNER",
  ): Promise<Certification> {
    const now = this.deps.clock.now();
    const certification: Certification = {
      id: this.deps.ids.nextId(),
      slug: await this.allocateSlug(input.name),
      name: input.name,
      provider: input.provider,
      examCode: input.examCode,
      version: input.version,
      studyType: input.studyType,
      description: input.description,
      targetDate: input.targetDate,
      priority: input.priority,
      defaultSessionMinutes: input.defaultSessionMinutes,
      status: "ACTIVE",
      origin,
      createdAt: now,
      updatedAt: now,
    };

    await this.deps.certifications.save(certification);

    return certification;
  }

  /**
   * Updates a track.
   *
   * The slug is deliberately stable across edits so that bookmarks, printable
   * material, and browser history keep resolving. Renaming a track changes its
   * displayed name only.
   */
  async updateCertification(
    id: CertificationId,
    input: CertificationInput,
  ): Promise<Certification> {
    const existing = await this.requireCertification(id);
    const updated: Certification = {
      ...existing,
      name: input.name,
      provider: input.provider,
      examCode: input.examCode,
      version: input.version,
      studyType: input.studyType,
      description: input.description,
      targetDate: input.targetDate,
      priority: input.priority,
      defaultSessionMinutes: input.defaultSessionMinutes,
      updatedAt: this.deps.clock.now(),
    };

    await this.deps.certifications.save(updated);

    return updated;
  }

  async archiveCertification(id: CertificationId): Promise<Certification> {
    await this.deps.certifications.archive(id, this.deps.clock.now());

    return this.requireCertification(id);
  }

  async restoreCertification(id: CertificationId): Promise<Certification> {
    await this.deps.certifications.restore(id, this.deps.clock.now());

    return this.requireCertification(id);
  }

  async findNewObjectiveForm(
    slug: CertificationSlug,
    parentObjectiveId: ObjectiveId | null,
  ): Promise<NewObjectiveFormView | null> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      return null;
    }

    const objectives = await this.deps.objectives.listByCertification(
      certification.id,
    );

    if (parentObjectiveId !== null) {
      assertValidNewParent(objectives, parentObjectiveId);
    }

    return { certification, parentCandidates: objectives, parentObjectiveId };
  }

  async findObjectiveForm(
    slug: CertificationSlug,
    objectiveId: ObjectiveId,
  ): Promise<ObjectiveFormView | null> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      return null;
    }

    const objectives = await this.deps.objectives.listByCertification(
      certification.id,
    );
    const objective = objectives.find((entry) => entry.id === objectiveId);

    if (objective === undefined) {
      return null;
    }

    return {
      certification,
      objective,
      parentCandidates: listReparentCandidates(objectives, objectiveId),
    };
  }

  /**
   * Adds an objective as the last child of its parent.
   *
   * Runs in a transaction: the insert and the sibling renumbering that follows
   * it must be observed together.
   */
  async addObjective(
    certificationId: CertificationId,
    input: ObjectiveInput,
  ): Promise<Objective> {
    await this.requireCertification(certificationId);

    return this.deps.unitOfWork.transaction(async ({ objectives }) => {
      const existing = await objectives.listByCertification(certificationId);

      assertValidNewParent(existing, input.parentObjectiveId);

      const now = this.deps.clock.now();
      const objective: Objective = {
        id: this.deps.ids.nextId(),
        certificationId,
        parentObjectiveId: input.parentObjectiveId,
        code: input.code,
        title: input.title,
        description: input.description,
        weight: input.weight,
        sourceType: input.sourceType,
        displayOrder: nextDisplayOrder(existing, input.parentObjectiveId),
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      };

      await objectives.save(objective);

      return objective;
    });
  }

  /**
   * Edits an objective, including moving it under a different parent.
   *
   * A reparent renumbers both the old and the new sibling group, so the whole
   * edit is one transaction.
   */
  async updateObjective(
    objectiveId: ObjectiveId,
    input: ObjectiveInput,
  ): Promise<Objective> {
    return this.deps.unitOfWork.transaction(async ({ objectives }) => {
      const existing = await objectives.findById(objectiveId);

      if (existing === null) {
        throw new ObjectiveNotFoundError(objectiveId);
      }

      const siblings = await objectives.listByCertification(
        existing.certificationId,
      );

      assertValidReparent(siblings, objectiveId, input.parentObjectiveId);

      const reparented = input.parentObjectiveId !== existing.parentObjectiveId;
      const now = this.deps.clock.now();
      const updated: Objective = {
        ...existing,
        parentObjectiveId: input.parentObjectiveId,
        code: input.code,
        title: input.title,
        description: input.description,
        weight: input.weight,
        sourceType: input.sourceType,
        displayOrder: reparented
          ? nextDisplayOrder(
              siblings.filter((entry) => entry.id !== objectiveId),
              input.parentObjectiveId,
            )
          : existing.displayOrder,
        updatedAt: now,
      };

      await objectives.save(updated);

      if (reparented) {
        await compactSiblings(
          objectives,
          siblings.map((entry) => (entry.id === objectiveId ? updated : entry)),
          existing.parentObjectiveId,
          now,
        );
      }

      return updated;
    });
  }

  /**
   * Moves an objective one position up or down among its siblings.
   *
   * The swap and the renumbering are one transaction so two siblings never share
   * a position.
   */
  async moveObjective(
    objectiveId: ObjectiveId,
    direction: MoveDirection,
  ): Promise<void> {
    await this.deps.unitOfWork.transaction(async ({ objectives }) => {
      const existing = await objectives.findById(objectiveId);

      if (existing === null) {
        throw new ObjectiveNotFoundError(objectiveId);
      }

      const all = await objectives.listByCertification(
        existing.certificationId,
      );
      const siblings = orderedSiblings(all, existing.parentObjectiveId);
      const index = siblings.findIndex((entry) => entry.id === objectiveId);
      const targetIndex = direction === "UP" ? index - 1 : index + 1;

      if (index === -1 || targetIndex < 0 || targetIndex >= siblings.length) {
        return;
      }

      const reordered = [...siblings];
      const moved = reordered[index];
      const displaced = reordered[targetIndex];

      if (moved === undefined || displaced === undefined) {
        return;
      }

      reordered[index] = displaced;
      reordered[targetIndex] = moved;

      await objectives.applyPositions(
        toContiguousPositions(reordered),
        this.deps.clock.now(),
      );
    });
  }

  async archiveObjective(objectiveId: ObjectiveId): Promise<void> {
    await this.deps.objectives.archive(objectiveId, this.deps.clock.now());
  }

  async restoreObjective(objectiveId: ObjectiveId): Promise<void> {
    await this.deps.objectives.restore(objectiveId, this.deps.clock.now());
  }

  private async requireCertification(
    id: CertificationId,
  ): Promise<Certification> {
    const certification = await this.deps.certifications.findById(id);

    if (certification === null) {
      throw new CertificationNotFoundError(id);
    }

    return certification;
  }

  /**
   * Finds a free slug for `name`.
   *
   * The loop is bounded: after a small number of collisions the owner is asked
   * to choose a different name rather than the application generating an
   * unbounded sequence of addresses.
   */
  private async allocateSlug(name: string): Promise<CertificationSlug> {
    const stem = slugify(name);
    const maximumAttempts = 25;

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      const candidate = slugWithSuffix(stem, attempt);

      if (
        !isReservedSlug(candidate) &&
        !(await this.deps.certifications.isSlugTaken(candidate))
      ) {
        return candidate;
      }
    }

    throw new SlugConflictError(stem);
  }
}

function orderedSiblings(
  objectives: readonly Objective[],
  parentObjectiveId: ObjectiveId | null,
): readonly Objective[] {
  return objectives
    .filter((objective) => objective.parentObjectiveId === parentObjectiveId)
    .sort(
      (left, right) =>
        left.displayOrder - right.displayOrder ||
        left.id.localeCompare(right.id),
    );
}

function nextDisplayOrder(
  objectives: readonly Objective[],
  parentObjectiveId: ObjectiveId | null,
): number {
  return orderedSiblings(objectives, parentObjectiveId).length + 1;
}

function toContiguousPositions(
  ordered: readonly Objective[],
): readonly ObjectivePosition[] {
  return ordered.map((objective, index) => ({
    id: objective.id,
    displayOrder: index + 1,
  }));
}

/** Closes the gap left in a sibling group after an objective moved away. */
async function compactSiblings(
  objectives: ObjectiveRepository,
  all: readonly Objective[],
  parentObjectiveId: ObjectiveId | null,
  occurredAt: string,
): Promise<void> {
  const siblings = orderedSiblings(all, parentObjectiveId);
  const positions = toContiguousPositions(siblings).filter(
    (position, index) => {
      const sibling = siblings[index];

      return (
        sibling !== undefined && sibling.displayOrder !== position.displayOrder
      );
    },
  );

  if (positions.length > 0) {
    await objectives.applyPositions(positions, occurredAt);
  }
}
