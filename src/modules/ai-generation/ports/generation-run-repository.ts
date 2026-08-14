import type { IsoTimestamp } from "@/platform/clock";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import type {
  GenerationRun,
  GenerationRunId,
} from "@/modules/ai-generation/domain/generation-run";

/**
 * Persistence port for generation runs.
 *
 * No SQL, query builder, or database row crosses this boundary
 * (`spec/ARCHITECTURE.md` section 5.1).
 *
 * There is no `delete`. A run explains where bank content came from, so removing
 * one would leave generated items claiming a provenance that cannot be read —
 * the same reason attempts and reviews are append-only.
 */

/** Bounded run-history query. */
export interface GenerationRunCriteria {
  readonly certificationId: CertificationId;
  /** Required: run history must never be read unbounded. */
  readonly limit: number;
  readonly offset: number;
}

export interface GenerationRunPage {
  readonly items: readonly GenerationRun[];
  readonly totalCount: number;
  readonly limit: number;
  readonly offset: number;
}

/** Counts of the items a run produced that still exist, by lifecycle state. */
export interface GenerationRunItemCounts {
  readonly total: number;
  readonly draft: number;
  readonly active: number;
}

export interface GenerationRunRepository {
  findById(id: GenerationRunId): Promise<GenerationRun | null>;
  list(criteria: GenerationRunCriteria): Promise<GenerationRunPage>;
  /**
   * The most recent run of one track with the same request fingerprint.
   *
   * Backs the duplicate-batch guard (`SPEC.md` section 11.6). Only runs that
   * produced something count as duplicates: a failed run left no content, so
   * asking again is not a repeat.
   */
  findLatestByInputHash(
    certificationId: CertificationId,
    inputHash: string,
    itemKind: GenerationRun["itemKind"],
  ): Promise<GenerationRun | null>;
  /** Inserts a run row. Called with `PENDING` before the provider is used. */
  create(run: GenerationRun): Promise<void>;
  /**
   * Records the outcome of a finished run.
   *
   * Takes the whole run rather than a patch so a completed run is written from one
   * value the caller has already assembled, and a partially updated row cannot
   * exist.
   */
  complete(run: GenerationRun): Promise<void>;
  /**
   * Claims a run's proposal for application, once.
   *
   * Resolves `true` when this call is the one that claimed it and `false` when it was
   * already applied — which is the idempotence guard for the objective import: applying
   * the same proposed tree twice would silently double every objective, and a stale
   * confirm page in a second tab is the ordinary way that happens. Implementations must
   * make the check and the claim one atomic statement, not a read followed by a write.
   */
  markApplied(id: GenerationRunId, appliedAt: IsoTimestamp): Promise<boolean>;
  /** How many of a run's items survive, so a review screen can say so. */
  countItems(id: GenerationRunId): Promise<GenerationRunItemCounts>;
  /**
   * Identifiers of the items a run produced that still exist, oldest first.
   *
   * Identifiers rather than aggregates: the run repository has no business
   * assembling a question or a card, and the review screen loads each item through
   * the bank repository that owns it. The list is bounded by the batch limit, so it
   * is a short list by construction.
   *
   * Which table is read follows the run's own `itemKind`, so a question run never
   * returns card identifiers.
   */
  listItemIds(id: GenerationRunId): Promise<readonly string[]>;
}
