import type { IsoTimestamp } from "@/platform/clock";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import type {
  Objective,
  ObjectiveId,
} from "@/modules/certifications/domain/objective";

/** One position change applied as part of a sibling reorder. */
export interface ObjectivePosition {
  readonly id: ObjectiveId;
  readonly displayOrder: number;
}

/**
 * Persistence port for the objective hierarchy.
 *
 * `listByCertification` returns archived objectives as well: the hierarchy rules
 * (parent validity, cycle detection, sibling ordering) must consider every row,
 * and view filtering is a presentation concern.
 */
export interface ObjectiveRepository {
  listByCertification(certificationId: CertificationId): Promise<Objective[]>;
  findById(id: ObjectiveId): Promise<Objective | null>;
  save(objective: Objective): Promise<void>;
  /**
   * Applies several sibling positions. Must be called inside a unit of work so
   * that a reorder never leaves two siblings sharing one position.
   */
  applyPositions(
    positions: readonly ObjectivePosition[],
    occurredAt: IsoTimestamp,
  ): Promise<void>;
  archive(id: ObjectiveId, occurredAt: IsoTimestamp): Promise<void>;
  restore(id: ObjectiveId, occurredAt: IsoTimestamp): Promise<void>;
}
