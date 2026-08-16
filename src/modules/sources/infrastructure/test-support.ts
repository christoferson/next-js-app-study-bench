import type { HostResolver } from "@/modules/sources/domain/url-safety";
import type {
  Source,
  SourceChunk,
  SourceSnapshot,
} from "@/modules/sources/domain/source";
import type {
  RetrievedDocument,
  UrlRetriever,
} from "@/modules/sources/ports/url-retriever";
import type {
  DocumentKind,
  DocumentTextExtraction,
  DocumentTextExtractor,
} from "@/platform/documents/document-text-extractor";
import { DocumentUnreadableError } from "@/platform/documents/document-text-extractor";

/**
 * Deterministic fixtures and doubles for the source library's tests.
 *
 * Nothing here opens a socket, resolves a name, or touches `./data`.
 */

export function sourceFixture(overrides: Partial<Source> = {}): Source {
  return {
    id: "source-1",
    certificationId: "cert-1",
    title: "Exam guide",
    sourceType: "PASTED_TEXT",
    authority: "OFFICIAL",
    originalLocation: null,
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function snapshotFixture(
  overrides: Partial<SourceSnapshot> = {},
): SourceSnapshot {
  const contentHash = overrides.contentHash ?? "a".repeat(64);

  return {
    id: "snapshot-1",
    sourceId: "source-1",
    contentHash,
    objectKey: `sources/${contentHash.slice(0, 2)}/${contentHash.slice(2)}.txt`,
    byteSize: 120,
    charCount: 120,
    retrievedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function chunkFixture(overrides: Partial<SourceChunk> = {}): SourceChunk {
  return {
    id: "chunk-1",
    snapshotId: "snapshot-1",
    chunkIndex: 0,
    text: "A passage of the document.",
    charStart: 0,
    charEnd: 26,
    ...overrides,
  };
}

/**
 * A resolver with a fixed table.
 *
 * A map rather than a stub function, so a test states "this name is 10.0.0.5" as data.
 * An unlisted name resolves to a public address, which makes the *rejections* the thing
 * each test has to spell out — the safe default in a test double for a security control
 * is the one that fails the test rather than the one that passes it.
 */
export class FakeHostResolver implements HostResolver {
  /** Names looked up, in order. */
  readonly lookups: string[] = [];

  constructor(
    private readonly table: Readonly<Record<string, readonly string[]>> = {},
    private readonly fallback: readonly string[] = ["93.184.216.34"],
  ) {}

  async resolve(hostname: string): Promise<readonly string[]> {
    this.lookups.push(hostname);

    return this.table[hostname] ?? this.fallback;
  }
}

/**
 * A retriever with scripted responses.
 *
 * Keyed by URL, so a refresh test can return one document, then a second, and assert
 * that the second produced a new snapshot. A URL with no scripted response throws, so a
 * test cannot accidentally assert against a default document it did not write.
 */
export class FakeUrlRetriever implements UrlRetriever {
  /** URLs retrieved, in order. */
  readonly requests: string[] = [];

  private readonly queues = new Map<string, (RetrievedDocument | Error)[]>();

  /** Adds one scripted outcome for `url`, consumed in order. */
  script(url: string, outcome: RetrievedDocument | Error): this {
    const queue = this.queues.get(url) ?? [];

    queue.push(outcome);
    this.queues.set(url, queue);

    return this;
  }

  /** Scripts plain text, which is the common case. */
  scriptText(url: string, text: string): this {
    return this.script(url, {
      text,
      finalUrl: url,
      contentType: "text/plain",
    });
  }

  async retrieve(url: string): Promise<RetrievedDocument> {
    this.requests.push(url);

    const queue = this.queues.get(url);
    // The last scripted outcome repeats, so a refresh test that expects "unchanged"
    // does not have to script the same document twice.
    const outcome = queue === undefined || queue.length === 0
      ? undefined
      : (queue.length === 1 ? queue[0] : queue.shift());

    if (outcome === undefined) {
      throw new Error(`No response was scripted for ${url}.`);
    }

    if (outcome instanceof Error) {
      throw outcome;
    }

    return outcome;
  }
}

/**
 * A text extractor with no PDF library behind it.
 *
 * `pdfText` is what a PDF "contains": `null` means the extraction produces nothing,
 * which is what a scanned page does, and an `Error` means the file could not be read at
 * all. Both paths matter to the acceptance criteria, and neither needs a real PDF.
 */
export class StubDocumentTextExtractor implements DocumentTextExtractor {
  constructor(
    private readonly pdfText: string | null | Error = "Extracted PDF text.",
    private readonly pageCount: number = 2,
  ) {}

  async extract(
    bytes: Uint8Array,
    kind: DocumentKind,
  ): Promise<DocumentTextExtraction> {
    if (kind === "PLAIN_TEXT") {
      return {
        text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        pageCount: null,
      };
    }

    if (this.pdfText instanceof Error) {
      throw this.pdfText;
    }

    return { text: this.pdfText ?? "", pageCount: this.pageCount };
  }
}

/** The error the real extractor raises for a PDF it cannot read. */
export function unreadablePdfError(): DocumentUnreadableError {
  return new DocumentUnreadableError(
    "That PDF could not be read. It may be corrupt, password protected, or a scan with no text layer.",
  );
}
