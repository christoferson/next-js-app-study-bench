import { DomainError } from "@/shared/domain-error";

/**
 * Expected failures of the source library.
 *
 * Each one carries the field its message belongs next to, so the import form can render
 * "that address points inside a private network" under the URL input rather than as an
 * anonymous banner (`spec/ARCHITECTURE.md` section 6.5).
 */

export type SourceErrorCode =
  | "SOURCE_NOT_FOUND"
  | "SOURCE_EMPTY"
  | "SOURCE_TOO_LARGE"
  | "SOURCE_NOT_REFRESHABLE"
  | "SOURCE_URL_REJECTED"
  | "SOURCE_RETRIEVAL_FAILED"
  | "SOURCE_OBJECTIVE_INVALID"
  | "SOURCE_OBJECTIVE_ALREADY_LINKED";

export class SourceNotFoundError extends DomainError {
  readonly code = "SOURCE_NOT_FOUND";

  constructor(readonly sourceId: string) {
    super("That source does not exist.");
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": ["That source does not exist."] };
  }
}

/**
 * A document with no text in it.
 *
 * The acceptance criterion "scanned PDFs fail clearly" lands here as well as on
 * `DocumentUnreadableError`: a scan that `pdf.js` reads without complaint but that
 * contains only images produces an empty extraction rather than an exception, and an
 * empty source is worse than a rejected one because it looks imported and grounds
 * nothing.
 */
export class SourceEmptyError extends DomainError {
  readonly code = "SOURCE_EMPTY";

  constructor(
    private readonly field: string,
    message: string,
  ) {
    super(message);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { [this.field]: [this.message] };
  }
}

export class SourceTooLargeError extends DomainError {
  readonly code = "SOURCE_TOO_LARGE";

  constructor(
    private readonly field: string,
    message: string,
  ) {
    super(message);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { [this.field]: [this.message] };
  }
}

/** A refresh of something with no origin to re-read. */
export class SourceNotRefreshableError extends DomainError {
  readonly code = "SOURCE_NOT_REFRESHABLE";

  constructor() {
    super(
      "Only a web source can be refreshed. Pasted text and uploaded files have no address to read again.",
    );
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": [this.message] };
  }
}

/**
 * A URL the safety guard refused.
 *
 * The guard's own message is carried through, because it is the specific one the owner
 * needs — which of scheme, credentials, resolution, or private address was the problem.
 */
export class SourceUrlRejectedError extends DomainError {
  readonly code = "SOURCE_URL_REJECTED";

  constructor(message: string) {
    super(message);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { url: [this.message] };
  }
}

/**
 * A fetch that was allowed but did not produce a usable document.
 *
 * Timeout, size cap, content type, redirect limit, and HTTP status all arrive here.
 * The message is written by the retriever from a fixed set of category-level sentences;
 * no library error text and no response body is ever passed through, because a response
 * body is attacker-influenced content (`spec/SECURITY.md`).
 */
export class SourceRetrievalFailedError extends DomainError {
  readonly code = "SOURCE_RETRIEVAL_FAILED";

  constructor(message: string) {
    super(message);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { url: [this.message] };
  }
}

/** An objective that belongs to another track, or does not exist. */
export class SourceObjectiveInvalidError extends DomainError {
  readonly code = "SOURCE_OBJECTIVE_INVALID";

  constructor() {
    super("That objective does not belong to this study track.");
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { objectiveId: [this.message] };
  }
}

export class SourceObjectiveAlreadyLinkedError extends DomainError {
  readonly code = "SOURCE_OBJECTIVE_ALREADY_LINKED";

  constructor() {
    super("That objective is already linked to this source.");
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { objectiveId: [this.message] };
  }
}
