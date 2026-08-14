import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFileObjectStorage } from "./local-file-object-storage";
import { InvalidObjectKeyError, isValidObjectKey } from "./object-storage";

/**
 * Filesystem object storage.
 *
 * Every case runs against a fresh temporary directory, so nothing here reads or
 * writes `./data` and the tests cannot interfere with the owner's audio.
 *
 * The traversal cases are the important ones. This adapter is what a route handler
 * reads bytes through, so "a key cannot address a file outside the root" is a
 * security property, not a tidiness preference.
 */

const KEY = "audio/ab/cdef1234.mp3";
const BYTES = new Uint8Array([1, 2, 3, 4, 5]);

describe("LocalFileObjectStorage", () => {
  let root: string;
  let storage: LocalFileObjectStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "studybench-storage-"));
    storage = new LocalFileObjectStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips bytes through a nested key", async () => {
    await storage.put(KEY, BYTES);

    await expect(storage.exists(KEY)).resolves.toBe(true);
    // A plain `Uint8Array`, so no caller can come to depend on a Node `Buffer`
    // that the S3 adapter would not return.
    const stored = await storage.get(KEY);

    expect(stored).toEqual(BYTES);
    expect(Buffer.isBuffer(stored)).toBe(false);
    // The key is a real relative path under the root, so the file is findable
    // without going through the adapter.
    await expect(readFile(join(root, KEY))).resolves.toEqual(
      Buffer.from(BYTES),
    );
  });

  it("creates the intermediate directories a key names", async () => {
    // Nothing else creates `audio/ab`; a caller must not have to.
    await storage.put("deep/nested/path/file.mp3", BYTES);

    await expect(storage.exists("deep/nested/path/file.mp3")).resolves.toBe(
      true,
    );
  });

  it("reports nothing for a key that holds nothing", async () => {
    await expect(storage.get(KEY)).resolves.toBeNull();
    await expect(storage.exists(KEY)).resolves.toBe(false);
  });

  it("replaces the bytes at a key that already holds some", async () => {
    await storage.put(KEY, BYTES);
    await storage.put(KEY, new Uint8Array([9, 9]));

    await expect(storage.get(KEY)).resolves.toEqual(new Uint8Array([9, 9]));
  });

  it("leaves no partial file behind after a write", async () => {
    await storage.put(KEY, BYTES);

    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(join(root, "audio", "ab"));

    // The temporary sibling the atomic write uses must be renamed, not left.
    expect(entries).toEqual(["cdef1234.mp3"]);
  });

  it("deletes an object and treats a missing one as already deleted", async () => {
    await storage.put(KEY, BYTES);
    await storage.delete(KEY);

    await expect(storage.exists(KEY)).resolves.toBe(false);
    // Deleting again is a success: the caller asked for it to be gone, and it is.
    await expect(storage.delete(KEY)).resolves.toBeUndefined();
  });

  it("reports a directory as not being an object", async () => {
    await storage.put(KEY, BYTES);

    await expect(storage.exists("audio")).resolves.toBe(false);
  });

  describe("key validation", () => {
    const traversals = [
      "../escape.mp3",
      "audio/../../escape.mp3",
      "audio/./file.mp3",
      "/absolute/file.mp3",
      "C:/windows/file.mp3",
      "audio\\windows.mp3",
      "audio//double.mp3",
      "",
      "audio/file name.mp3",
      "audio/file\u0000.mp3",
      "audio/%2e%2e/escape.mp3",
    ];

    it.each(traversals)("refuses the key %j", async (key) => {
      // Every operation validates, so no method is a way around the rule.
      await expect(storage.put(key, BYTES)).rejects.toBeInstanceOf(
        InvalidObjectKeyError,
      );
      await expect(storage.get(key)).rejects.toBeInstanceOf(
        InvalidObjectKeyError,
      );
      await expect(storage.delete(key)).rejects.toBeInstanceOf(
        InvalidObjectKeyError,
      );
      await expect(storage.exists(key)).rejects.toBeInstanceOf(
        InvalidObjectKeyError,
      );
    });

    it("cannot read a file that exists outside the root", async () => {
      const outside = join(root, "..", "studybench-outside-secret.txt");

      await writeFile(outside, "not for the browser");

      try {
        await expect(
          storage.get("../studybench-outside-secret.txt"),
        ).rejects.toBeInstanceOf(InvalidObjectKeyError);
      } finally {
        await rm(outside, { force: true });
      }
    });

    it("accepts the key shapes the application generates", () => {
      expect(isValidObjectKey("audio/ab/cdef1234.mp3")).toBe(true);
      expect(isValidObjectKey("file.mp3")).toBe(true);
      expect(isValidObjectKey("a-b_c.1/d.mp3")).toBe(true);
    });

    it("refuses a key long enough to be a denial-of-service", () => {
      expect(isValidObjectKey(`${"a".repeat(600)}.mp3`)).toBe(false);
    });
  });
});
