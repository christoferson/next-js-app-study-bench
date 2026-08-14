/**
 * Object-storage port (`spec/ARCHITECTURE.md` section 2.3).
 *
 * Large content does not belong in relational columns: the database keeps
 * metadata and a key, and the bytes live somewhere addressed by that key
 * (`spec/ARCHITECTURE.md` section 7.7, `SPEC.md` sections 12.1 and 12.2). This
 * port is what "somewhere" means to the application.
 *
 * It lives in `platform/` rather than inside the audio module because the same
 * four operations are what uploaded sources (D8) and print artifacts (D9) need,
 * and neither of those modules will own the audio module. Placing it here now
 * costs nothing and avoids a later move that would touch every caller. The
 * interface is deliberately the smallest set D10 actually uses — no listing, no
 * copying, no signed URLs — so `S3ObjectStorage` in D13 has four methods to
 * implement rather than a surface nobody calls (`spec/ARCHITECTURE.md`
 * section 3).
 *
 * A key is a relative POSIX-style path such as `audio/ab/cdef.mp3`. It is always
 * derived by the application from content the application owns; it is never a
 * value that arrived from a browser. `assertValidObjectKey` enforces the shape
 * regardless, so a future caller cannot turn a key into a path traversal.
 */

/** Relative, POSIX-style location of one stored object. */
export type ObjectKey = string;

export interface ObjectStorage {
  /**
   * Writes `bytes` at `key`, replacing anything already there.
   *
   * Replacing rather than failing on a duplicate: the caller's uniqueness rule
   * lives in the database, and a half-written file left by a crashed process
   * must not make the key permanently unusable.
   */
  put(key: ObjectKey, bytes: Uint8Array): Promise<void>;
  /** The stored bytes, or `null` when the key holds nothing. */
  get(key: ObjectKey): Promise<Uint8Array | null>;
  /** Removes the object. Succeeds when the key already holds nothing. */
  delete(key: ObjectKey): Promise<void>;
  exists(key: ObjectKey): Promise<boolean>;
}

/** A key that could escape the storage root, or that no adapter can store. */
export class InvalidObjectKeyError extends Error {
  constructor(readonly key: string) {
    // The key is application-derived, never owner text, so quoting it leaks
    // nothing.
    super(`"${key}" is not a valid object key.`);
    this.name = "InvalidObjectKeyError";
  }
}

/**
 * Rejects any key that is not a plain relative path under the root.
 *
 * Allow-list rather than deny-list: a key is one or more segments of
 * `[A-Za-z0-9._-]` joined by `/`, and a segment cannot be `.` or `..`. That
 * excludes absolute paths, Windows drive letters, backslashes, NUL bytes, URL
 * escapes, and every spelling of "go up one directory" in one rule, instead of a
 * list of the tricks known when it was written.
 *
 * A shared function rather than a check inside the filesystem adapter, because
 * the rule is about the port: an S3 key with `..` in it is a different object
 * than intended, which is the same bug with a different blast radius.
 */
export function assertValidObjectKey(key: string): void {
  if (!isValidObjectKey(key)) {
    throw new InvalidObjectKeyError(key);
  }
}

export function isValidObjectKey(key: string): boolean {
  if (key.length === 0 || key.length > 512) {
    return false;
  }

  const segments = key.split("/");

  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      /^[A-Za-z0-9._-]+$/.test(segment),
  );
}
