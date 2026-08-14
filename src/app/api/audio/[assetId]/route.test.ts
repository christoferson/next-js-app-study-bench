import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "@/modules/audio/domain/media-asset";
import { mediaAssetFixture } from "@/modules/audio/infrastructure/test-support";

/**
 * The audio playback route.
 *
 * What matters here is the contract a browser's `<audio>` element depends on: the
 * right content type, an accurate length, a cache policy that makes a replay free,
 * and a 404 that says nothing about what exists. The traversal question is answered
 * one layer down — the route never sees a path — and the case below asserts that the
 * route reads the key from the row rather than from the request.
 */

const readBytes = vi.fn<
  (assetId: string) => Promise<{
    readonly asset: MediaAsset;
    readonly bytes: Uint8Array;
  } | null>
>();

vi.mock("@/modules/audio/composition", () => ({
  getAudioFacade: () => ({ readBytes }),
}));

const { GET } = await import("@/app/api/audio/[assetId]/route");

const BYTES = new Uint8Array([0xff, 0xf3, 0x44, 0xc4, 0x01, 0x02]);

function request(assetId: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/audio/${assetId}`), {
    params: Promise.resolve({ assetId }),
  });
}

describe("GET /api/audio/[assetId]", () => {
  beforeEach(() => {
    readBytes.mockReset();
  });

  describe("for a known asset", () => {
    beforeEach(() => {
      readBytes.mockResolvedValue({
        asset: mediaAssetFixture({ id: "asset-1", byteSize: BYTES.length }),
        bytes: BYTES,
      });
    });

    it("returns the bytes", async () => {
      const response = await request("asset-1");

      expect(response.status).toBe(200);
      await expect(
        response.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
      ).resolves.toEqual(BYTES);
    });

    it("declares the stored content type", async () => {
      // Not a guess: `<audio>` refuses to play a clip served as the wrong type.
      const response = await request("asset-1");

      expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    });

    it("declares the stored byte length", async () => {
      const response = await request("asset-1");

      expect(response.headers.get("Content-Length")).toBe(String(BYTES.length));
    });

    it("lets the browser cache it forever, privately", async () => {
      // Honest because an asset's identity is a hash of its content, so the bytes at
      // one id can never change. `private` because this is one owner's material.
      const cacheControl = await request("asset-1").then((response) =>
        response.headers.get("Cache-Control"),
      );

      expect(cacheControl).toContain("immutable");
      expect(cacheControl).toContain("private");
      expect(cacheControl).toMatch(/max-age=\d{6,}/);
    });

    it("looks the asset up by identifier", async () => {
      await request("asset-1");

      expect(readBytes).toHaveBeenCalledWith("asset-1");
    });

    it("serves the object key the row holds, not one from the request", async () => {
      // The route passes the identifier through and nothing else; the object key
      // never appears in it. This is what keeps the endpoint from being a
      // file-reading primitive.
      const asset = mediaAssetFixture({
        id: "asset-1",
        objectKey: "audio/aa/deadbeef.mp3",
        byteSize: BYTES.length,
      });

      readBytes.mockResolvedValue({ asset, bytes: BYTES });

      await request("asset-1");

      expect(readBytes).toHaveBeenCalledTimes(1);
      expect(readBytes.mock.calls[0]).toEqual(["asset-1"]);
    });
  });

  describe("for an asset it cannot serve", () => {
    it("returns 404 with an empty body", async () => {
      readBytes.mockResolvedValue(null);

      const response = await request("nope");

      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("");
    });

    it("does not let a 404 be cached", async () => {
      // A clip generated a moment later must not be masked by a cached miss.
      readBytes.mockResolvedValue(null);

      const response = await request("nope");

      expect(response.headers.get("Cache-Control")).toBe("no-store");
    });

    it("says nothing about what does exist", async () => {
      readBytes.mockResolvedValue(null);

      const response = await request("nope");
      const body = await response.text();

      expect(body).not.toContain("nope");
      expect(response.headers.get("Content-Type")).toBeNull();
    });

    it.each([
      "../../../etc/passwd",
      "..%2f..%2fdata%2fstudy-bench.db",
      "audio/aa/bb.mp3",
    ])("treats %j as an unknown identifier, not a path", async (assetId) => {
      // Whatever the request says, it is only ever a database lookup. The storage
      // adapter is where a key's shape is enforced, and it is never given this value.
      readBytes.mockResolvedValue(null);

      const response = await request(assetId);

      expect(response.status).toBe(404);
      expect(readBytes).toHaveBeenCalledWith(assetId);
    });
  });
});
