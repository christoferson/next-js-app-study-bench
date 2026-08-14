import { describe, expect, it } from "vitest";
import { DocumentUnreadableError } from "@/modules/ai-generation/ports/document-text-extractor";
import { UnpdfDocumentTextExtractor } from "./unpdf-document-text-extractor";

/**
 * The text extractor, over bytes built in the test.
 *
 * No fixture file is committed, for two reasons. A real exam guide is somebody else's
 * copyrighted document and does not belong in this repository, and a binary fixture is
 * the kind of test input nobody can read in a diff. So the PDF here is written out
 * literally below — small enough to read, real enough that `pdf.js` parses it.
 *
 * What this covers is the boundary: bytes in, text or a refusal out. Whether a
 * *hundred-page, two-column, table-heavy* exam guide extracts usefully is not a
 * question a unit test can answer, and it is verified by hand against a real guide
 * instead.
 */

const extractor = new UnpdfDocumentTextExtractor();

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * A one-page PDF that draws two lines of text.
 *
 * Written by hand rather than generated, so what the assertions expect is visible in
 * the source. The byte offsets in a PDF cross-reference table would normally have to be
 * exact; `pdf.js` reconstructs the table when it does not match, which is what makes a
 * hand-written fixture practical here. That tolerance is itself worth having under test:
 * real syllabus PDFs are frequently malformed in exactly this way.
 */
function onePagePdf(lines: readonly string[]): Uint8Array {
  const content = [
    "BT",
    "/F1 12 Tf",
    "72 720 Td",
    ...lines.flatMap((line, index) => [
      ...(index === 0 ? [] : ["0 -18 Td"]),
      `(${line.replace(/([()\\])/g, "\\$1")}) Tj`,
    ]),
    "ET",
  ].join("\n");

  return bytesOf(
    [
      "%PDF-1.4",
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
        "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
      "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
      `5 0 obj << /Length ${content.length} >> stream`,
      content,
      "endstream endobj",
      "trailer << /Size 6 /Root 1 0 R >>",
      "%%EOF",
      "",
    ].join("\n"),
  );
}

describe("UnpdfDocumentTextExtractor", () => {
  describe("plain text", () => {
    it("returns the file's text and reports no page count", async () => {
      // No page count, because a text file has no pages. `null` rather than `1` so the
      // confirm screen can tell "one page" from "not paginated".
      await expect(
        extractor.extract(bytesOf("1. Demo Foundations (40%)"), "PLAIN_TEXT"),
      ).resolves.toEqual({
        text: "1. Demo Foundations (40%)",
        pageCount: null,
      });
    });

    it("reads text outside the ASCII range, which a syllabus often is", async () => {
      const extracted = await extractor.extract(
        bytesOf("语法：与其……不如……"),
        "PLAIN_TEXT",
      );

      expect(extracted.text).toBe("语法：与其……不如……");
    });

    it("refuses a file that is not valid UTF-8 rather than sending replacement characters", async () => {
      // A Latin-1 or UTF-16 syllabus decoded leniently becomes a page of  and would be
      // sent to a model as though it were text.
      await expect(
        extractor.extract(
          Uint8Array.from([0x44, 0xff, 0xfe, 0x6f]),
          "PLAIN_TEXT",
        ),
      ).rejects.toThrow(DocumentUnreadableError);
    });
  });

  describe("PDF", () => {
    it("extracts the text a page draws, and counts the page", async () => {
      const extracted = await extractor.extract(
        onePagePdf([
          "Demo Certification Exam Guide",
          "Domain 1: Demo Foundations",
        ]),
        "PDF",
      );

      expect(extracted.text).toContain("Demo Certification Exam Guide");
      expect(extracted.text).toContain("Domain 1: Demo Foundations");
      expect(extracted.pageCount).toBe(1);
    });

    it("refuses bytes that are not a PDF at all", async () => {
      await expect(
        extractor.extract(bytesOf("This is a text file, not a PDF."), "PDF"),
      ).rejects.toThrow(DocumentUnreadableError);
    });

    it("says nothing about the library or the bytes when it refuses", async () => {
      // `pdf.js` failure messages carry byte offsets and sometimes a source path, and
      // this message reaches a form field the owner reads (`spec/SECURITY.md`).
      const failure = await extractor
        .extract(bytesOf("%PDF-1.4 truncated"), "PDF")
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(DocumentUnreadableError);
      expect((failure as Error).message).toBe(
        "That PDF could not be read. It may be corrupt, password protected, or a scan with no text layer.",
      );
    });

    it("leaves the caller's bytes intact, because pdf.js takes ownership of what it is given", async () => {
      // The adapter copies before handing the buffer over. Without the copy the caller's
      // array is detached, and the facade reads its length afterwards.
      const bytes = onePagePdf(["Demo Foundations"]);
      const lengthBefore = bytes.byteLength;

      await extractor.extract(bytes, "PDF");

      expect(bytes.byteLength).toBe(lengthBefore);
    });
  });
});
