import type { CertificationRepository } from "@/modules/certifications/ports/certification-repository";
import type { ObjectiveRepository } from "@/modules/certifications/ports/objective-repository";
import type { SourceRepository } from "./source-repository";

/**
 * Repositories bound to one source transaction.
 *
 * The certification and objective repositories are here for the same reason the
 * flashcard unit of work carries them: an objective link must be validated against the
 * source's own track inside the transaction that writes it, or two concurrent requests
 * could each check and then write a link the other invalidated.
 */
export interface SourceTransactionRepositories {
  readonly sources: SourceRepository;
  readonly certifications: CertificationRepository;
  readonly objectives: ObjectiveRepository;
}

/**
 * Transaction boundary for the source library.
 *
 * The operation that needs it most is import: a source, its first snapshot, and every
 * chunk of that snapshot commit together or not at all. A partial import would be a
 * source that looks present in the list and grounds nothing, or a snapshot whose chunk
 * count is silently short — and the second is worse, because it looks like a working
 * source that has quietly forgotten the end of the document.
 */
export interface SourceUnitOfWork {
  transaction<T>(
    operation: (repositories: SourceTransactionRepositories) => Promise<T>,
  ): Promise<T>;
}
