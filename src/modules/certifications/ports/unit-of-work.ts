import type { CertificationRepository } from "./certification-repository";
import type { ObjectiveRepository } from "./objective-repository";

/** Repositories bound to one transaction. */
export interface CertificationTransactionRepositories {
  readonly certifications: CertificationRepository;
  readonly objectives: ObjectiveRepository;
}

/**
 * Transaction boundary for multi-record operations, following the reference
 * shape in `SPEC.md` section 9.6.
 *
 * Used by sibling reorder, reparent (which rewrites both source and destination
 * sibling ranks), and the demo seed. Transaction handling never appears in a
 * React component or route handler.
 */
export interface CertificationUnitOfWork {
  transaction<T>(
    operation: (
      repositories: CertificationTransactionRepositories,
    ) => Promise<T>,
  ): Promise<T>;
}
