/**
 * Fetching one web page, as a port.
 *
 * A port for the reason the language-model gateway is one, plus a stronger one: the
 * default test suite must never reach the network (`spec/TESTING.md` section 5). Every
 * test above this boundary drives `FakeUrlRetriever`, so the import flow, the refresh
 * comparison, and the failure messages are all exercised offline and deterministically,
 * and the one adapter that owns `fetch` is tested against its own safety rules with a
 * fake resolver.
 *
 * The returned document is already plain text. HTML-to-text conversion happens inside
 * the adapter, so nothing above this line ever holds retrieved markup — which is what
 * makes "sanitize rendered content" (`spec/SECURITY.md` section 4) a property of the
 * architecture rather than a rule every future template has to remember.
 */

/** What a successful retrieval produced. */
export interface RetrievedDocument {
  /** Plain text, converted from whatever the response was. Not yet normalized. */
  readonly text: string;
  /** The address actually read, after redirects. Recorded, never re-fetched blindly. */
  readonly finalUrl: string;
  /** The response's declared content type, without parameters. */
  readonly contentType: string;
}

export interface UrlRetriever {
  /**
   * Reads one URL, or throws a `DomainError` explaining why it would not.
   *
   * Throws rather than returning a result union, because every caller's response to a
   * refusal is the same — show the message next to the URL field — and a union would
   * make that a branch each caller could forget.
   */
  retrieve(url: string): Promise<RetrievedDocument>;
}
