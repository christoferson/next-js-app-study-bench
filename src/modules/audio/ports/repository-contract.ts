import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mediaAssetFixture } from "@/modules/audio/infrastructure/test-support";
import type { MediaAssetRepository } from "./media-asset-repository";

/**
 * Shared media-asset-repository contract.
 *
 * Defines the domain-observable behaviour every audio-asset persistence adapter must
 * provide, so the PostgreSQL adapter in D13 runs these same assertions rather than a
 * parallel set (`spec/ARCHITECTURE.md` section 7.4).
 */

export interface MediaAssetContractSubject {
  readonly assets: MediaAssetRepository;
  /** Called after each test so state never leaks between cases. */
  dispose(): void;
}

export function describeMediaAssetRepositoryContract(
  adapterName: string,
  createSubject: () => MediaAssetContractSubject,
): void {
  describe(`${adapterName} media asset repository contract`, () => {
    let subject: MediaAssetContractSubject;

    beforeEach(() => {
      subject = createSubject();
    });

    afterEach(() => {
      subject.dispose();
    });

    it("round-trips an asset by identifier and by cache key", async () => {
      const asset = mediaAssetFixture();

      await subject.assets.insertIfAbsent(asset);

      await expect(subject.assets.findById(asset.id)).resolves.toEqual(asset);
      await expect(
        subject.assets.findByCacheKey(asset.cacheKey),
      ).resolves.toEqual(asset);
    });

    it("keeps every field it was given", async () => {
      // Including a measured duration, so the nullable column is not write-only.
      const asset = mediaAssetFixture({
        durationSeconds: 1.5,
        voiceId: "Amy",
        engine: "standard",
        language: "en",
        speechRate: "x-slow",
        contentType: "audio/mpeg",
        byteSize: 4096,
      });

      await subject.assets.insertIfAbsent(asset);

      await expect(subject.assets.findById(asset.id)).resolves.toEqual(asset);
    });

    it("reports nothing for an identifier and a key it does not have", async () => {
      await expect(subject.assets.findById("nope")).resolves.toBeNull();
      await expect(subject.assets.findByCacheKey("nope")).resolves.toBeNull();
    });

    describe("insertIfAbsent", () => {
      it("returns the asset it stored", async () => {
        const asset = mediaAssetFixture();

        await expect(subject.assets.insertIfAbsent(asset)).resolves.toEqual(
          asset,
        );
      });

      it("returns the existing asset when the cache key is taken", async () => {
        // The race two concurrent requests for the same word create. The unique index
        // decides the winner, and the loser must get a playable asset rather than a
        // constraint error.
        const first = mediaAssetFixture({ id: "asset-1" });
        const second = mediaAssetFixture({
          id: "asset-2",
          byteSize: 999,
          createdAt: "2026-02-02T00:00:00.000Z",
        });

        await subject.assets.insertIfAbsent(first);

        const stored = await subject.assets.insertIfAbsent(second);

        expect(stored).toEqual(first);
        // And there is still exactly one row, not two.
        await expect(subject.assets.count()).resolves.toBe(1);
        await expect(subject.assets.findById("asset-2")).resolves.toBeNull();
      });

      it("stores two assets that differ only by cache key", async () => {
        await subject.assets.insertIfAbsent(mediaAssetFixture());
        await subject.assets.insertIfAbsent(
          mediaAssetFixture({
            id: "asset-2",
            cacheKey: "b".repeat(64),
            objectKey: `audio/bb/${"b".repeat(62)}.mp3`,
          }),
        );

        await expect(subject.assets.count()).resolves.toBe(2);
      });
    });

    describe("list", () => {
      it("returns assets newest first", async () => {
        await subject.assets.insertIfAbsent(
          mediaAssetFixture({
            id: "older",
            cacheKey: "1".repeat(64),
            createdAt: "2026-01-01T00:00:00.000Z",
          }),
        );
        await subject.assets.insertIfAbsent(
          mediaAssetFixture({
            id: "newer",
            cacheKey: "2".repeat(64),
            createdAt: "2026-03-01T00:00:00.000Z",
          }),
        );

        const listed = await subject.assets.list(10);

        expect(listed.map((asset) => asset.id)).toEqual(["newer", "older"]);
      });

      it("breaks a tie on the identifier, so paging is deterministic", async () => {
        for (const id of ["a", "b", "c"]) {
          await subject.assets.insertIfAbsent(
            mediaAssetFixture({
              id,
              cacheKey: id.repeat(64),
              createdAt: "2026-01-01T00:00:00.000Z",
            }),
          );
        }

        const listed = await subject.assets.list(10);

        expect(listed.map((asset) => asset.id)).toEqual(["c", "b", "a"]);
      });

      it("applies the limit", async () => {
        for (const id of ["a", "b", "c"]) {
          await subject.assets.insertIfAbsent(
            mediaAssetFixture({ id, cacheKey: id.repeat(64) }),
          );
        }

        await expect(subject.assets.list(2)).resolves.toHaveLength(2);
      });

      it("returns nothing when there is nothing", async () => {
        await expect(subject.assets.list(10)).resolves.toEqual([]);
      });
    });

    describe("count and totalByteSize", () => {
      it("are zero for an empty store", async () => {
        // `SUM` over no rows is null in SQL, which must read as zero bytes rather
        // than crash the settings page.
        await expect(subject.assets.count()).resolves.toBe(0);
        await expect(subject.assets.totalByteSize()).resolves.toBe(0);
      });

      it("total every stored asset", async () => {
        await subject.assets.insertIfAbsent(
          mediaAssetFixture({ byteSize: 100 }),
        );
        await subject.assets.insertIfAbsent(
          mediaAssetFixture({
            id: "asset-2",
            cacheKey: "b".repeat(64),
            byteSize: 250,
          }),
        );

        await expect(subject.assets.count()).resolves.toBe(2);
        await expect(subject.assets.totalByteSize()).resolves.toBe(350);
      });
    });

    describe("delete", () => {
      it("removes the asset", async () => {
        const asset = mediaAssetFixture();

        await subject.assets.insertIfAbsent(asset);
        await subject.assets.delete(asset.id);

        await expect(subject.assets.findById(asset.id)).resolves.toBeNull();
        await expect(
          subject.assets.findByCacheKey(asset.cacheKey),
        ).resolves.toBeNull();
        await expect(subject.assets.count()).resolves.toBe(0);
      });

      it("frees the cache key for a new asset", async () => {
        // Deleting a clip must let the owner generate it again, which is the whole
        // point of the delete control.
        const asset = mediaAssetFixture();

        await subject.assets.insertIfAbsent(asset);
        await subject.assets.delete(asset.id);

        const replacement = mediaAssetFixture({ id: "asset-2" });

        await expect(
          subject.assets.insertIfAbsent(replacement),
        ).resolves.toEqual(replacement);
      });

      it("succeeds for an identifier it does not have", async () => {
        await expect(subject.assets.delete("nope")).resolves.toBeUndefined();
      });

      it("leaves other assets alone", async () => {
        await subject.assets.insertIfAbsent(mediaAssetFixture({ id: "keep" }));
        await subject.assets.insertIfAbsent(
          mediaAssetFixture({ id: "drop", cacheKey: "b".repeat(64) }),
        );

        await subject.assets.delete("drop");

        await expect(subject.assets.findById("keep")).resolves.not.toBeNull();
      });
    });
  });
}
