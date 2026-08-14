import { extractText, getDocumentProxy } from "unpdf";
import type {
  DocumentKind,
  DocumentTextExtraction,
  DocumentTextExtractor,
} from "@/modules/ai-generation/ports/document-text-extractor";
import { DocumentUnreadableError } from "@/modules/ai-generation/ports/document-text-extractor";

/**
 * The one adapter that owns `unpdf`.
 *
 * `unpdf` is a serverless-oriented build of Mozilla's `pdf.js` with no native
 * dependency, no `canvas`, and no binary to compile — which is what made it the choice
 * over `pdf-parse`, whose maintained fork still shells into a bundled `pdf.js` copy and
 * whose text output arrives without page boundaries. Both are pure JS; this one is the
 * one that also reports a page count and installs cleanly on Windows and in the ECS
 * image without a build toolchain.
 *
 * Text extraction is *not* layout reconstruction. `pdf.js` returns the text items a
 * page draws, in draw order, and this adapter joins them page by page with a blank
 * line between pages. A two-column page therefore reads as the typesetter drew it,
 * which is sometimes column by column and sometimes line by line across both columns.
 * That is a real limitation and it is left in place deliberately: guessing columns
 * silently reorders a syllabus, while a model reading slightly jumbled text still
 * recognises "Domain 1: ... 22%".
 *
 * Nothing is logged and no library message is re-thrown. A corrupt PDF produces
 * `DocumentUnreadableError` with text this file wrote, because `pdf.js` failure
 * messages carry byte offsets and, in some paths, the source path
 * (`spec/SECURITY.md`).
 */
export class UnpdfDocumentTextExtractor implements DocumentTextExtractor {
  async extract(
    bytes: Uint8Array,
    kind: DocumentKind,
  ): Promise<DocumentTextExtraction> {
    switch (kind) {
      case "PLAIN_TEXT":
        return { text: decodeUtf8(bytes), pageCount: null };
      case "PDF":
        return this.extractPdf(bytes);
    }
  }

  /**
   * One PDF, page by page.
   *
   * `mergePages: false` rather than `true` so the join between pages is this
   * application's decision: a blank line, which is how the rest of the text separates
   * blocks, instead of the library's own single newline that makes the last line of
   * one page and the first of the next read as one sentence.
   */
  private async extractPdf(bytes: Uint8Array): Promise<DocumentTextExtraction> {
    let pages: readonly string[];
    let pageCount: number;

    try {
      // A copy, because pdf.js transfers ownership of the buffer it is given and the
      // caller's bytes must survive the call.
      const document = await getDocumentProxy(Uint8Array.from(bytes));
      const extracted = await extractText(document, { mergePages: false });

      pages = extracted.text;
      pageCount = extracted.totalPages;
    } catch {
      throw new DocumentUnreadableError(
        "That PDF could not be read. It may be corrupt, password protected, or a scan with no text layer.",
      );
    }

    return { text: pages.join("\n\n"), pageCount };
  }
}

/**
 * Bytes as UTF-8 text, refusing anything that is not valid UTF-8.
 *
 * `fatal` rather than the replacement character, because a `.txt` file in another
 * encoding would otherwise arrive as a page of `` and be sent to a model as if it
 * were a syllabus.
 */
function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DocumentUnreadableError(
      "That text file is not valid UTF-8. Save it as UTF-8 and upload it again.",
    );
  }
}
