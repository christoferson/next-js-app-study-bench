import type { CertificationRepository } from "@/modules/certifications/ports/certification-repository";
import type { ObjectiveRepository } from "@/modules/certifications/ports/objective-repository";
import type { QuestionRepository } from "./question-repository";

/**
 * Repositories bound to one question-bank transaction.
 *
 * The certification and objective repositories are included because objective
 * mapping must validate an objective against the question's certification inside
 * the same transaction that writes the links.
 */
export interface QuestionBankTransactionRepositories {
  readonly questions: QuestionRepository;
  readonly certifications: CertificationRepository;
  readonly objectives: ObjectiveRepository;
}

/**
 * Transaction boundary for multi-record question operations, following the
 * reference shape in `SPEC.md` section 9.6.
 *
 * Used by create (root plus revision 1), edit (append revision plus current
 * pointer), objective-mapping replacement, and delete (root plus revisions plus
 * links). Transaction handling never appears in a React component or route
 * handler.
 */
export interface QuestionBankUnitOfWork {
  transaction<T>(
    operation: (
      repositories: QuestionBankTransactionRepositories,
    ) => Promise<T>,
  ): Promise<T>;
}
