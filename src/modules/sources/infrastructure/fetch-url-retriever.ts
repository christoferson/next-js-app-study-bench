import { resolve4, resolve6 } from "node:dns/promises";
import { htmlToText } from "@/modules/sources/domain/html-to-text";
import {
  SourceRetrievalFailedError,
  SourceUrlRejectedError,
} from "@/modules/sources/domain/errors";
import type { HostResolver } from "@/modules/sources/domain/url-safety";
import { checkUrlIsSafeToFetch } from "@/modules/sources/domain/url-safety";
import type { DocumentTextExtractor } from "@/platform/documents/document-text-extractor";
import { DocumentUnreadableError } from "@/platform/documents/document-text-extractor";
import type {
  RetrievedDocument,
  UrlRetriever,
} from "@/modules/sources/ports/url-retriever";

/**
 * The one adapter that fetches a URL.
 *
 * Every control `spec/SECURITY.md` section 4 requires is enforced here, and each one is
 * enforced *before* the thing it protects against can happen:
 *
 * - **Scheme, credentials, and destination** are judged by `checkUrlIsSafeToFetch`
 *   before any connection is opened, using real DNS through `HostResolver`.
 * - **Redirects are followed by hand**, at most `MAX_REDIRECTS` of them, with the full
 *   safety check repeated on every `Location`. `redirect: "manual"` is what makes that
 *   possible: `fetch`'s own following would connect to the private address first and
 *   report it afterwards.
 * - **A timeout** aborts the whole retrieval, redirects included, via one `AbortSignal`
 *   shared across the hops — so three slow redirects cannot add up to three timeouts.
 * - **The size cap** is applied while streaming, not after. `Content-Length` is checked
 *   when the server sends one, and the body is read chunk by chunk and abandoned the
 *   moment it exceeds the cap, because a server that lies about its length or sends none
 *   at all must not be able to fill this process's memory.
 * - **Content types** are an allow-list. Anything else is refused without reading the
 *   body.
 * - **Sanitisation** is conversion: HTML becomes plain text here and the markup is
 *   discarded, so nothing above this adapter ever holds retrieved HTML.
 *
 * No response text, header, or library message is ever put into an error. Every message
 * this file raises is a fixed sentence written here, because a response body is content
 * an attacker chose (`spec/SECURITY.md` section 5).
 */

/** Hard ceiling on a retrieved document. */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** How long the whole retrieval may take, redirects included. */
export const RETRIEVAL_TIMEOUT_MS = 15_000;

/**
 * How many redirects to follow.
 *
 * Three, which covers the ordinary cases — http to https, bare domain to `www`, and one
 * path move — without turning a redirect loop into a long series of DNS lookups.
 */
export const MAX_REDIRECTS = 3;

/** What may be imported, keyed by the type the server declares. */
const HTML_TYPES = ["text/html", "application/xhtml+xml"];
const TEXT_TYPES = ["text/plain", "text/markdown", "text/x-markdown"];
const PDF_TYPES = ["application/pdf"];

/**
 * DNS through Node's resolver.
 *
 * Both families are queried and the results concatenated, because a name with a public
 * A record and a private AAAA record must be refused — and `dns.lookup` would report
 * only whichever the system prefers. A family that fails to resolve contributes nothing
 * rather than failing the whole lookup, since a v4-only host is entirely normal.
 */
export const nodeHostResolver: HostResolver = {
  async resolve(hostname: string): Promise<readonly string[]> {
    const [v4, v6] = await Promise.all([
      resolve4(hostname).catch((): string[] => []),
      resolve6(hostname).catch((): string[] => []),
    ]);

    return [...v4, ...v6];
  },
};

export class FetchUrlRetriever implements UrlRetriever {
  constructor(
    /** Reads a retrieved PDF. The same extractor the file import uses. */
    private readonly extractor: DocumentTextExtractor,
    private readonly resolver: HostResolver = nodeHostResolver,
    private readonly maxBytes: number = MAX_RESPONSE_BYTES,
    private readonly timeoutMs: number = RETRIEVAL_TIMEOUT_MS,
  ) {}

  async retrieve(url: string): Promise<RetrievedDocument> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.retrieveWithin(url, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The redirect chain, one hop at a time.
   *
   * A loop rather than recursion so the hop budget is one visible counter, and so the
   * "too many redirects" case cannot be confused with a stack limit.
   */
  private async retrieveWithin(
    url: string,
    signal: AbortSignal,
  ): Promise<RetrievedDocument> {
    let current = url;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      // Re-checked on every hop, including the first. This is the redirect
      // revalidation `spec/SECURITY.md` requires: hop three is a URL the owner never
      // typed and never saw.
      const verdict = await checkUrlIsSafeToFetch(current, this.resolver);

      if (!verdict.allowed) {
        throw new SourceUrlRejectedError(
          verdict.message ?? "That address cannot be imported.",
        );
      }

      const response = await this.fetchOnce(current, signal);
      const location = redirectTarget(response);

      if (location === null) {
        return this.readDocument(response, current);
      }

      // Resolved against the current URL, because a Location header may be relative.
      // An unparseable one is a broken server, not a redirect worth chasing.
      let next: string;

      try {
        next = new URL(location, current).toString();
      } catch {
        throw new SourceRetrievalFailedError(
          "That address redirected somewhere this application could not read.",
        );
      }

      current = next;
    }

    throw new SourceRetrievalFailedError(
      `That address redirected more than ${MAX_REDIRECTS} times, so it was not followed further.`,
    );
  }

  /** One request, with network and abort failures turned into owner-facing text. */
  private async fetchOnce(
    url: string,
    signal: AbortSignal,
  ): Promise<Response> {
    let response: Response;

    try {
      response = await fetch(url, {
        signal,
        redirect: "manual",
        headers: {
          // Named so a site owner reading their logs can see what this is, and so a
          // server that negotiates on Accept sends the document rather than an API
          // representation.
          "user-agent": "StudyBench/1.0 (personal study tool)",
          accept: "text/html,text/plain,text/markdown,application/pdf",
        },
      });
    } catch (error) {
      if (signal.aborted) {
        throw new SourceRetrievalFailedError(
          `That address did not respond within ${Math.round(this.timeoutMs / 1000)} seconds. Try again, or paste the text instead.`,
        );
      }

      // The thrown value is discarded deliberately: a `fetch` failure message can
      // contain the resolved address and the TLS chain.
      void error;

      throw new SourceRetrievalFailedError(
        "That address could not be reached. Check it in a browser, or paste the text instead.",
      );
    }

    if (!response.ok && redirectTarget(response) === null) {
      throw new SourceRetrievalFailedError(
        `That address returned HTTP ${response.status}. Nothing was imported.`,
      );
    }

    return response;
  }

  /**
   * A final response, as text.
   *
   * The content type decides the conversion, and an unlisted type is refused before the
   * body is read at all — there is no reason to download a video to discover it is not a
   * syllabus.
   */
  private async readDocument(
    response: Response,
    finalUrl: string,
  ): Promise<RetrievedDocument> {
    const contentType = baseContentType(response.headers.get("content-type"));

    if (
      ![...HTML_TYPES, ...TEXT_TYPES, ...PDF_TYPES].includes(contentType)
    ) {
      throw new SourceRetrievalFailedError(
        contentType === ""
          ? "That address did not say what kind of document it returned, so it was not imported."
          : `That address returned ${contentType}, which cannot be imported. Web pages, plain text, markdown, and PDFs can.`,
      );
    }

    const declaredLength = response.headers.get("content-length");

    if (declaredLength !== null && Number(declaredLength) > this.maxBytes) {
      throw this.tooLarge();
    }

    const bytes = await this.readCapped(response);

    if (PDF_TYPES.includes(contentType)) {
      try {
        const extraction = await this.extractor.extract(bytes, "PDF");

        return { text: extraction.text, finalUrl, contentType };
      } catch (error) {
        if (error instanceof DocumentUnreadableError) {
          throw new SourceRetrievalFailedError(error.message);
        }

        throw error;
      }
    }

    // `fatal: false` here, unlike the file extractor's strict decode: a web server's
    // declared charset is frequently wrong, and refusing a page over one bad byte in a
    // footer would reject documents that are otherwise entirely readable. A replacement
    // character in the text is visible in the preview; a rejected import is not
    // recoverable except by pasting.
    const text = new TextDecoder("utf-8").decode(bytes);

    return {
      text: HTML_TYPES.includes(contentType) ? htmlToText(text) : text,
      finalUrl,
      contentType,
    };
  }

  /**
   * The body, refusing to hold more than the cap.
   *
   * Read from the stream rather than through `arrayBuffer()`, because `arrayBuffer()`
   * buffers everything the server chooses to send before this code gets a say. The
   * stream is cancelled as soon as the cap is passed, which also closes the connection.
   */
  private async readCapped(response: Response): Promise<Uint8Array> {
    const body = response.body;

    if (body === null) {
      return new Uint8Array(0);
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    try {
      for (;;) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        if (value !== undefined) {
          total += value.byteLength;

          if (total > this.maxBytes) {
            await reader.cancel();

            throw this.tooLarge();
          }

          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    const combined = new Uint8Array(total);
    let offset = 0;

    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return combined;
  }

  private tooLarge(): SourceRetrievalFailedError {
    return new SourceRetrievalFailedError(
      `That document is larger than ${Math.round(this.maxBytes / (1024 * 1024))} MB, so it was not imported.`,
    );
  }
}

/** The `Location` of a redirect response, or `null` when it is not one. */
function redirectTarget(response: Response): string | null {
  const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
  const location = response.headers.get("location");

  return isRedirect && location !== null && location.trim() !== ""
    ? location.trim()
    : null;
}

/** A content-type header without its parameters, lower-cased. */
function baseContentType(header: string | null): string {
  return (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}
