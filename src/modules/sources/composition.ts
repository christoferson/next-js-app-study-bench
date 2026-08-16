import "server-only";
import { systemClock } from "@/platform/clock";
import { cryptoIdGenerator } from "@/platform/id-generator";
import { getDatabaseContainer } from "@/platform/database/composition";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import type { SqliteTransactionRunner } from "@/platform/database/sqlite-transaction-runner";
import { resolveObjectStorageRoot } from "@/platform/storage/config";
import { LocalFileObjectStorage } from "@/platform/storage/local-file-object-storage";
import type { ObjectStorage } from "@/platform/storage/object-storage";
import { UnpdfDocumentTextExtractor } from "@/platform/documents/unpdf-document-text-extractor";
import { SourceFacade } from "@/modules/sources/application/source-facade";
import { FetchUrlRetriever } from "@/modules/sources/infrastructure/fetch-url-retriever";
import { SqliteSourceRepository } from "@/modules/sources/infrastructure/sqlite-source-repository";
import { SqliteSourceUnitOfWork } from "@/modules/sources/infrastructure/sqlite-source-unit-of-work";
import type { UrlRetriever } from "@/modules/sources/ports/url-retriever";

/**
 * Server-only composition root for the source library.
 *
 * The three wiring decisions are all here and nowhere else: where the extracted text is
 * kept, what reads a PDF, and what fetches a URL. `LocalFileObjectStorage` becomes
 * `S3ObjectStorage` in D13 by changing one constructor, exactly as it does for audio.
 *
 * The shared transaction runner is passed through, because an import writes rows on the
 * same connection every other module uses and `BEGIN` is connection-wide.
 */
export function createSourceFacade(
  database: SqliteDatabase,
  runner?: SqliteTransactionRunner,
  /** Overrides the retriever. Tests pass a fake so nothing reaches the network. */
  retriever?: UrlRetriever,
  /** Overrides storage, for the same reason. */
  storage?: ObjectStorage,
): SourceFacade {
  const extractor = new UnpdfDocumentTextExtractor();

  return new SourceFacade({
    sources: new SqliteSourceRepository(database),
    unitOfWork: new SqliteSourceUnitOfWork(database, runner),
    storage: storage ?? new LocalFileObjectStorage(resolveObjectStorageRoot()),
    extractor,
    // The retriever gets the same extractor instance: a URL can point at a PDF, and
    // reading it there must produce exactly what uploading the same file would.
    retriever: retriever ?? new FetchUrlRetriever(extractor),
    clock: systemClock,
    ids: cryptoIdGenerator,
  });
}

let facade: SourceFacade | null = null;

export function getSourceFacade(): SourceFacade {
  if (facade === null) {
    const container = getDatabaseContainer();

    facade = createSourceFacade(container.database, container.transactions);
  }

  return facade;
}
