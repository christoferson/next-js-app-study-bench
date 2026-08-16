import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentUnreadableError } from "@/platform/documents/document-text-extractor";
import {
  SourceRetrievalFailedError,
  SourceUrlRejectedError,
} from "@/modules/sources/domain/errors";
import { FakeHostResolver, StubDocumentTextExtractor } from "./test-support";
import { FetchUrlRetriever, MAX_REDIRECTS } from "./fetch-url-retriever";

/**
 * The one adapter that fetches a URL, against a stubbed `fetch` and a fake resolver.
 *
 * Nothing here opens a socket or resolves a name: `global.fetch` is replaced for the
 * duration of each case and restored afterwards, and DNS is a fake table
 * (`spec/TESTING.md` sections 3 and 5). That is what makes it possible to assert the
 * security controls exhaustively, which is the whole reason this test exists.
 *
 * Every case is about *ordering*, because each control only works if it runs before the
 * thing it protects against:
 *
 * - The destination is judged before a connection is opened, so a rejected host must show
 *   `fetch` never being called at all.
 * - A redirect is judged before the *next* connection, so a redirect into private space
 *   must show exactly one call.
 * - The content type is judged before the body is read, so a refused type must leave the
 *   response body untouched.
 * - The size cap is applied while streaming, so a server that sends no `Content-Length`
 *   must still be cut off rather than buffered.
 *
 * The addresses are all `.example` names or literals from private ranges, so nothing here
 * would reach a real host even if the stub were removed.
 */

/** How the stubbed `fetch` was called, plus the responses it hands back. */
const fetchMock =
  vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

/** The URLs `fetch` was asked for, in order. */
function requestedUrls(): readonly string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

/** A final response with a declared type. */
function documentResponse(
  body: BodyInit | null,
  contentType: string | null,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  const headers = new Headers(extraHeaders);

  if (contentType === null) {
    headers.delete("content-type");
  } else {
    headers.set("content-type", contentType);
  }

  const response = new Response(body, { status: 200, headers });

  // `Response` adds a type for a string body, so an "undeclared type" case has to remove
  // it after construction.
  if (contentType === null) {
    response.headers.delete("content-type");
  }

  return response;
}

function redirectResponse(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

/** A body delivered in chunks, with no declared length. */
function chunkedBody(chunkCount: number, chunkBytes: number): ReadableStream {
  return new ReadableStream({
    start(controller) {
      for (let index = 0; index < chunkCount; index += 1) {
        controller.enqueue(new Uint8Array(chunkBytes));
      }

      controller.close();
    },
  });
}

function retrieverWith(
  options: {
    readonly resolver?: FakeHostResolver;
    readonly extractor?: StubDocumentTextExtractor;
    readonly maxBytes?: number;
    readonly timeoutMs?: number;
  } = {},
): FetchUrlRetriever {
  return new FetchUrlRetriever(
    options.extractor ?? new StubDocumentTextExtractor(),
    options.resolver ?? new FakeHostResolver(),
    options.maxBytes ?? 64 * 1024,
    options.timeoutMs ?? 5_000,
  );
}

const PAGE = "https://docs.demo.example/guides/storage";

describe("FetchUrlRetriever", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("before any connection is opened", () => {
    it("refuses a host that resolves into a private network without fetching", async () => {
      // The ordering that matters most: `fetch` would have connected to 10.0.0.5 and
      // handed the response back before any check could run.
      const resolver = new FakeHostResolver({
        "internal.demo.example": ["10.0.0.5"],
      });

      await expect(
        retrieverWith({ resolver }).retrieve("https://internal.demo.example/x"),
      ).rejects.toBeInstanceOf(SourceUrlRejectedError);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(resolver.lookups).toEqual(["internal.demo.example"]);
    });

    it("carries the guard's own explanation, which names no address", async () => {
      const resolver = new FakeHostResolver({
        "internal.demo.example": ["93.184.216.34", "169.254.169.254"],
      });

      const failure = retrieverWith({ resolver }).retrieve(
        "https://internal.demo.example/latest/meta-data/",
      );

      await expect(failure).rejects.toThrow(/inside a private network/);
      await expect(failure).rejects.not.toThrow(/169\.254/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ["a file URL", "file:///etc/passwd"],
      ["an address with credentials", "https://user:pass@docs.demo.example/x"],
      ["a private literal", "http://169.254.169.254/latest/meta-data/"],
      ["nonsense", "not a url at all"],
    ])("refuses %s without fetching", async (_label, url) => {
      await expect(retrieverWith().retrieve(url)).rejects.toBeInstanceOf(
        SourceUrlRejectedError,
      );

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("redirects", () => {
    it("follows one hop and re-checks the address it was sent to", async () => {
      const resolver = new FakeHostResolver();

      fetchMock
        .mockResolvedValueOnce(
          redirectResponse("https://www.demo.example/guides/storage"),
        )
        .mockResolvedValueOnce(
          documentResponse("The guidance page.", "text/plain"),
        );

      const document = await retrieverWith({ resolver }).retrieve(PAGE);

      expect(document).toMatchObject({
        text: "The guidance page.",
        // The address actually read, which is not the one the caller asked for.
        finalUrl: "https://www.demo.example/guides/storage",
      });
      // The check ran again on the hop: hop two is a URL the owner never typed.
      expect(resolver.lookups).toEqual([
        "docs.demo.example",
        "www.demo.example",
      ]);
    });

    it("resolves a relative Location against the current address", async () => {
      fetchMock
        .mockResolvedValueOnce(redirectResponse("/guides/storage/v2"))
        .mockResolvedValueOnce(documentResponse("Version two.", "text/plain"));

      const document = await retrieverWith().retrieve(PAGE);

      expect(requestedUrls()).toEqual([
        PAGE,
        "https://docs.demo.example/guides/storage/v2",
      ]);
      expect(document.finalUrl).toBe(
        "https://docs.demo.example/guides/storage/v2",
      );
    });

    it("refuses a redirect into private space, having connected only once", async () => {
      // The reason redirects are followed by hand. `fetch`'s own following would have
      // connected to the metadata endpoint and reported it afterwards.
      fetchMock.mockResolvedValueOnce(
        redirectResponse("http://169.254.169.254/latest/meta-data/"),
      );

      await expect(retrieverWith().retrieve(PAGE)).rejects.toBeInstanceOf(
        SourceUrlRejectedError,
      );

      expect(requestedUrls()).toEqual([PAGE]);
    });

    it("refuses a chain longer than the hop budget", async () => {
      // One more redirect than the budget allows, which is also what a redirect loop
      // looks like from here.
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        fetchMock.mockResolvedValueOnce(
          redirectResponse(`https://docs.demo.example/hop-${hop}`),
        );
      }

      const failure = retrieverWith().retrieve(PAGE);

      await expect(failure).rejects.toBeInstanceOf(SourceRetrievalFailedError);
      await expect(failure).rejects.toThrow(
        new RegExp(`redirected more than ${MAX_REDIRECTS} times`),
      );
      expect(fetchMock).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
    });

    it("reads a document that arrives within the budget", async () => {
      for (let hop = 0; hop < MAX_REDIRECTS; hop += 1) {
        fetchMock.mockResolvedValueOnce(
          redirectResponse(`https://docs.demo.example/hop-${hop}`),
        );
      }

      fetchMock.mockResolvedValueOnce(
        documentResponse("Arrived at last.", "text/plain"),
      );

      await expect(retrieverWith().retrieve(PAGE)).resolves.toMatchObject({
        text: "Arrived at last.",
      });
    });

    it("refuses a Location it cannot read", async () => {
      fetchMock.mockResolvedValueOnce(redirectResponse("http://[not a host]/"));

      await expect(retrieverWith().retrieve(PAGE)).rejects.toBeInstanceOf(
        SourceRetrievalFailedError,
      );
    });
  });

  describe("content types", () => {
    it("converts HTML to the text a reader would see", async () => {
      // The sanitisation `spec/SECURITY.md` section 4 requires, and it works by
      // subtraction: the markup does not survive the import, so nothing above this
      // adapter ever holds retrieved HTML.
      fetchMock.mockResolvedValueOnce(
        documentResponse(
          "<html><body><h1>Storage</h1><script>alert(1)</script><p>Objects are keyed.</p></body></html>",
          "text/html; charset=utf-8",
        ),
      );

      const document = await retrieverWith().retrieve(PAGE);

      expect(document.text).toContain("Objects are keyed.");
      expect(document.text).not.toContain("<p>");
      expect(document.text).not.toContain("alert(1)");
      expect(document.contentType).toBe("text/html");
    });

    it.each(["text/plain", "text/markdown", "text/x-markdown"])(
      "passes %s through unchanged",
      async (contentType) => {
        const body = "# Storage\n\nObjects are keyed by name.";

        fetchMock.mockResolvedValueOnce(documentResponse(body, contentType));

        await expect(retrieverWith().retrieve(PAGE)).resolves.toMatchObject({
          text: body,
          contentType,
        });
      },
    );

    it("reads a PDF through the same extractor the file import uses", async () => {
      // A URL can point at a PDF, and reading it there must produce exactly what
      // uploading the same file would.
      const extractor = new StubDocumentTextExtractor(
        "The extracted guidance.",
      );

      fetchMock.mockResolvedValueOnce(
        documentResponse(new Uint8Array([1, 2, 3]), "application/pdf"),
      );

      await expect(
        retrieverWith({ extractor }).retrieve(PAGE),
      ).resolves.toMatchObject({
        text: "The extracted guidance.",
        contentType: "application/pdf",
      });
    });

    it("reports a PDF it could not read in the reader's own words", async () => {
      const extractor = new StubDocumentTextExtractor(
        new DocumentUnreadableError("That PDF could not be read."),
      );

      fetchMock.mockResolvedValueOnce(
        documentResponse(new Uint8Array([1, 2, 3]), "application/pdf"),
      );

      const failure = retrieverWith({ extractor }).retrieve(PAGE);

      await expect(failure).rejects.toBeInstanceOf(SourceRetrievalFailedError);
      await expect(failure).rejects.toThrow("That PDF could not be read.");
    });

    it.each([
      ["an image", "image/png"],
      ["an API response", "application/json"],
      ["a video", "video/mp4"],
    ])("refuses %s without reading the body", async (_label, contentType) => {
      // There is no reason to download a video to discover it is not a syllabus.
      const response = documentResponse(chunkedBody(4, 16), contentType);

      fetchMock.mockResolvedValueOnce(response);

      const failure = retrieverWith().retrieve(PAGE);

      await expect(failure).rejects.toBeInstanceOf(SourceRetrievalFailedError);
      await expect(failure).rejects.toThrow(
        new RegExp(`returned ${contentType}`),
      );
      expect(response.bodyUsed).toBe(false);
      expect(response.body?.locked).toBe(false);
    });

    it("refuses a response that declares no type at all", async () => {
      const response = documentResponse(chunkedBody(4, 16), null);

      fetchMock.mockResolvedValueOnce(response);

      const failure = retrieverWith().retrieve(PAGE);

      await expect(failure).rejects.toBeInstanceOf(SourceRetrievalFailedError);
      await expect(failure).rejects.toThrow(
        /did not say what kind of document/,
      );
      expect(response.bodyUsed).toBe(false);
    });
  });

  describe("the size cap", () => {
    it("refuses a document whose declared length is over the cap", async () => {
      fetchMock.mockResolvedValueOnce(
        documentResponse("short body, long claim", "text/plain", {
          "content-length": "999999999",
        }),
      );

      const failure = retrieverWith({ maxBytes: 2 * 1024 * 1024 }).retrieve(
        PAGE,
      );

      await expect(failure).rejects.toBeInstanceOf(SourceRetrievalFailedError);
      await expect(failure).rejects.toThrow(/larger than 2 MB/);
    });

    it("cuts off a body that exceeds the cap while streaming", async () => {
      // A server that sends no `Content-Length` at all, which is what a chunked response
      // does. Reading through `arrayBuffer()` would have buffered whatever it chose to
      // send before this code got a say.
      const response = documentResponse(chunkedBody(20, 64), "text/plain");

      expect(response.headers.get("content-length")).toBeNull();
      fetchMock.mockResolvedValueOnce(response);

      const failure = retrieverWith({ maxBytes: 256 }).retrieve(PAGE);

      await expect(failure).rejects.toBeInstanceOf(SourceRetrievalFailedError);
      await expect(failure).rejects.toThrow(/larger than/);
    });

    it("accepts a body just under the cap", async () => {
      fetchMock.mockResolvedValueOnce(
        documentResponse("a".repeat(200), "text/plain"),
      );

      await expect(
        retrieverWith({ maxBytes: 256 }).retrieve(PAGE),
      ).resolves.toMatchObject({ text: "a".repeat(200) });
    });

    it("reads an empty response as empty text rather than failing", async () => {
      // The facade decides that an empty document is an error, and its message is the
      // one the owner needs; this layer only reports what arrived.
      fetchMock.mockResolvedValueOnce(documentResponse(null, "text/plain"));

      await expect(retrieverWith().retrieve(PAGE)).resolves.toMatchObject({
        text: "",
      });
    });
  });

  describe("failures", () => {
    it("reports the HTTP status of a response that is not one", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("<h1>Not found</h1>", {
          status: 404,
          headers: { "content-type": "text/html" },
        }),
      );

      const failure = retrieverWith().retrieve(PAGE);

      await expect(failure).rejects.toBeInstanceOf(SourceRetrievalFailedError);
      await expect(failure).rejects.toThrow(/returned HTTP 404/);
      // The page's own words are not the explanation: a response body is content the
      // server chose.
      await expect(failure).rejects.not.toThrow(/Not found/);
    });

    it("reports a connection failure without the library's message", async () => {
      fetchMock.mockRejectedValueOnce(
        new Error("getaddrinfo ENOTFOUND 203.0.113.9 self-signed certificate"),
      );

      const failure = retrieverWith().retrieve(PAGE);

      await expect(failure).rejects.toBeInstanceOf(SourceRetrievalFailedError);
      await expect(failure).rejects.toThrow(/could not be reached/);
      // A `fetch` failure message can contain the resolved address and the TLS chain.
      await expect(failure).rejects.not.toThrow(/203\.0\.113\.9/);
    });

    it("gives up on a server that does not respond in time", async () => {
      // The timeout covers the whole retrieval, so the adapter is handed a signal it
      // aborts itself rather than a per-hop deadline.
      fetchMock.mockImplementation(
        async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init.signal as AbortSignal;

            signal.addEventListener("abort", () => {
              reject(new Error("The operation was aborted."));
            });
          }),
      );

      const failure = retrieverWith({ timeoutMs: 50 }).retrieve(PAGE);

      await expect(failure).rejects.toBeInstanceOf(SourceRetrievalFailedError);
      await expect(failure).rejects.toThrow(/did not respond within/);
    });

    it("passes one signal across every hop, so slow redirects share the deadline", async () => {
      // Three slow redirects must not add up to three timeouts.
      fetchMock
        .mockResolvedValueOnce(
          redirectResponse("https://www.demo.example/guides/storage"),
        )
        .mockResolvedValueOnce(
          documentResponse("The guidance page.", "text/plain"),
        );

      await retrieverWith().retrieve(PAGE);

      const signals = fetchMock.mock.calls.map((call) => call[1].signal);

      expect(signals).toHaveLength(2);
      expect(signals[0]).toBe(signals[1]);
    });
  });

  describe("the request it makes", () => {
    it("identifies itself and does not let fetch follow redirects", async () => {
      fetchMock.mockResolvedValueOnce(
        documentResponse("The guidance page.", "text/plain"),
      );

      await retrieverWith().retrieve(PAGE);

      const init = fetchMock.mock.calls[0]?.[1];

      // `redirect: "manual"` is what makes checking every hop possible at all.
      expect(init).toMatchObject({ redirect: "manual" });
      expect(init?.headers).toMatchObject({
        "user-agent": expect.stringContaining("StudyBench"),
      });
    });
  });
});
