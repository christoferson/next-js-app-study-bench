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
  /**
   * Archives every active objective of one track, and restores every archived
   * one. Both answer with how many rows changed, so a caller can report "12
   * archived" without counting the tree itself, and both are no-ops returning
   * zero when nothing is in the opposite state.
   *
   * Must be called inside a unit of work: the owner asked for one act, so the
   * tree is never observed half-archived.
   */
  archiveAllByCertification(
    certificationId: CertificationId,
    occurredAt: IsoTimestamp,
  ): Promise<number>;
  restoreAllByCertification(
    certificationId: CertificationId,
    occurredAt: IsoTimestamp,
  ): Promise<number>;
  /**
   * Permanently removes every objective of one track, whatever its status, and
   * returns how many went.
   *
   * Objective *mappings* go with them — a question, card, or source that pointed
   * at an objective loses the pointer and nothing else. The mapped content is
   * never deleted here: an objective is an outline over the bank, not the bank.
   *
   * Must be called inside a unit of work: the link rows and the objectives are
   * one removal.
   */
  purgeAllByCertification(certificationId: CertificationId): Promise<number>;
}
