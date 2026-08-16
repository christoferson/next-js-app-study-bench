/**
 * Application-defined port for turning an uploaded document into plain text.
 *
 * A port rather than a direct call to a PDF library for the reason the language-model
 * gateway is one: the library is a `node:`-and-worker-shaped dependency that must not
 * be importable from the domain, the facade, or a component, and the facade's only
 * interest is "the syllabus, as text". The adapter that owns `unpdf` is
 * `unpdf-document-text-extractor.ts` (same directory) and a boundary test pins it there.
 *
 * Bytes cross this boundary, not a `File`, a stream, or a path. A `File` is a web API
 * the domain has no business knowing, and a path would mean the extractor could read
 * anywhere on the disk.
 */

/** What kind of document the bytes are, decided by the caller from the filename. */
export type DocumentKind = "PDF" | "PLAIN_TEXT";

export interface DocumentTextExtraction {
  /** The document's text, before normalization. */
  readonly text: string;
  /**
   * Pages read, when the format has pages.
   *
   * `null` for plain text. Reported so the confirm step can say how much was read,
   * which is the cheapest way for the owner to notice that a scanned PDF with no text
   * layer produced nothing.
   */
  readonly pageCount: number | null;
}

/**
 * A document that could not be read.
 *
 * Not a `DomainError`: the facade turns it into a recorded failure or a field message
 * as appropriate, and the message here is a category-level statement rather than the
 * library's own text, which can carry file paths and internal offsets
 * (`spec/SECURITY.md`).
 */
export class DocumentUnreadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentUnreadableError";
  }
}

export interface DocumentTextExtractor {
  extract(
    bytes: Uint8Array,
    kind: DocumentKind,
  ): Promise<DocumentTextExtraction>;
}
