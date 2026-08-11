import { describe, expect, it } from "vitest";
import { DemoStudyCatalog } from "@/modules/study-catalog/infrastructure/demo-study-catalog";

describe("DemoStudyCatalog", () => {
  it("lists the two demo study tracks", async () => {
    const catalog = new DemoStudyCatalog();

    const tracks = await catalog.listTracks();

    expect(tracks.map((track) => track.slug)).toEqual([
      "aws-certified-generative-ai-developer-professional",
      "hsk-chinese-demo-track",
    ]);
    expect(tracks[0]?.name).toBe(
      "AWS Certified Generative AI Developer - Professional (AIP-C01)",
    );
    expect(tracks[1]?.name).toBe("HSK Chinese — Demo Track");
  });

  it("marks every listed track as demo content", async () => {
    const catalog = new DemoStudyCatalog();

    const tracks = await catalog.listTracks();

    expect(tracks.every((track) => track.origin === "DEMO")).toBe(true);
  });

  it("returns the same result for repeated calls", async () => {
    const catalog = new DemoStudyCatalog();

    const first = await catalog.listTracks();
    const second = await catalog.listTracks();

    expect(second).toEqual(first);
  });

  it("finds a track detail by a known slug", async () => {
    const catalog = new DemoStudyCatalog();

    const track = await catalog.findTrackBySlug("hsk-chinese-demo-track");

    expect(track).not.toBeNull();
    expect(track?.name).toBe("HSK Chinese — Demo Track");
    expect(track?.provider).toBe("HSK");
    expect(track?.studyType).toBe("LANGUAGE_EXAMINATION");
    expect(track?.objectives.length).toBeGreaterThan(0);
  });

  it("returns objectives for the AWS pilot track", async () => {
    const catalog = new DemoStudyCatalog();

    const track = await catalog.findTrackBySlug(
      "aws-certified-generative-ai-developer-professional",
    );

    expect(track?.studyType).toBe("CERTIFICATION");
    expect(track?.provider).toBe("AWS");
    expect(track?.objectives.map((objective) => objective.title)).toContain(
      "Foundation model selection",
    );
  });

  it("returns null for an unknown slug", async () => {
    const catalog = new DemoStudyCatalog();

    await expect(catalog.findTrackBySlug("no-such-track")).resolves.toBeNull();
  });
});
