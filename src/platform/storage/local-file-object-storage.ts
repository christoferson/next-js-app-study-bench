import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { ObjectKey, ObjectStorage } from "./object-storage";
import { assertValidObjectKey } from "./object-storage";

/**
 * Filesystem-backed object storage (`spec/ARCHITECTURE.md` section 2.4,
 * "Local filesystem storage").
 *
 * The local-development and personal-POC implementation, exactly as SQLite is for
 * persistence. `S3ObjectStorage` arrives in D13 and implements the same port, so
 * moving to S3 changes one line in a composition root.
 *
 * **Two independent guards against escaping the root.** `assertValidObjectKey`
 * rejects the key's shape, and every resolved path is then checked to be inside
 * the resolved root. Either one alone would be enough for the keys this
 * application generates; both are here because a traversal bug in a file-serving
 * path is the difference between an audio clip and the database file, and the
 * cost of the second check is one string comparison.
 *
 * Writes are atomic per key: the bytes go to a temporary sibling and are renamed
 * into place, so a reader never sees a half-written MP3 and a crashed synthesis
 * leaves no truncated file for the cache to hand out later.
 */
export class LocalFileObjectStorage implements ObjectStorage {
  /** Absolute, normalised storage root. */
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: ObjectKey, bytes: Uint8Array): Promise<void> {
    const path = this.pathFor(key);

    await mkdir(dirname(path), { recursive: true });

    // A temporary name unique to this write, so two concurrent writes of the same
    // key cannot interleave into one file. `writeFile` then `rename` rather than
    // a single write, because rename within a directory is atomic.
    const temporary = `${path}.${process.pid}-${Date.now()}.part`;

    await writeFile(temporary, bytes);

    try {
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });

      throw error;
    }
  }

  async get(key: ObjectKey): Promise<Uint8Array | null> {
    try {
      const contents = await readFile(this.pathFor(key));

      // A plain `Uint8Array`, not the `Buffer` Node returns. `Buffer` is a
      // subclass, so returning it would type-check and work — but it would make
      // callers and tests accidentally depend on a Node type that `S3ObjectStorage`
      // and the in-memory test double have no reason to produce. The view shares
      // the bytes Node just allocated, so this is a wrapper, not a copy.
      return new Uint8Array(
        contents.buffer,
        contents.byteOffset,
        contents.byteLength,
      );
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }

      throw error;
    }
  }

  async delete(key: ObjectKey): Promise<void> {
    // `force` makes deleting an absent object a success: the caller asked for the
    // object to be gone, and it is.
    await rm(this.pathFor(key), { force: true });
  }

  async exists(key: ObjectKey): Promise<boolean> {
    try {
      const found = await stat(this.pathFor(key));

      return found.isFile();
    } catch (error) {
      if (isMissingFile(error)) {
        return false;
      }

      throw error;
    }
  }

  /**
   * The absolute path one key names.
   *
   * Both guards run here, so no method of this class can reach a path without
   * them.
   */
  private pathFor(key: ObjectKey): string {
    assertValidObjectKey(key);

    const path = resolve(join(this.root, key));

    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new Error("An object key resolved outside the storage root.");
    }

    return path;
  }
}

/** Whether an error is "that path holds nothing", rather than a real failure. */
function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
