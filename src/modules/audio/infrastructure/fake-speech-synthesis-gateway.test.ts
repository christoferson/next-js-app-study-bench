import { describe, expect, it } from "vitest";
import type { SpeechRequest } from "@/modules/audio/domain/speech-request";
import { FakeSpeechSynthesisGateway } from "./fake-speech-synthesis-gateway";

/**
 * The fake speech gateway.
 *
 * It is the default provider and the one every other test in the suite uses, so its
 * output has to be a real MP3 rather than a plausible-looking buffer. The frame
 * assertions below are what stop a typo in the hand-written header from becoming a
 * file that only a browser can reject.
 */

const REQUEST: SpeechRequest = {
  text: "学习",
  language: "zh",
  voiceId: "Zhiyu",
  engine: "neural",
  rate: "medium",
};

/** Frame length as the MPEG specification derives it, not as the code claims. */
const FRAME_BYTES = 96;

describe("FakeSpeechSynthesisGateway", () => {
  it("identifies itself as the fake provider", () => {
    expect(new FakeSpeechSynthesisGateway().provider).toBe("fake");
  });

  it("returns bytes that begin with an MPEG sync word", async () => {
    const { bytes } = await new FakeSpeechSynthesisGateway().synthesize(
      REQUEST,
    );

    // Eleven set sync bits: the first byte is all ones, and the top three bits of
    // the second are too.
    expect(bytes[0]).toBe(0xff);
    expect((bytes[1] ?? 0) & 0b1110_0000).toBe(0b1110_0000);
  });

  it("declares MPEG-2 Layer III, 32 kbit/s, 24 kHz, mono", async () => {
    const { bytes } = await new FakeSpeechSynthesisGateway().synthesize(
      REQUEST,
    );
    const second = bytes[1] ?? 0;
    const third = bytes[2] ?? 0;
    const fourth = bytes[3] ?? 0;

    expect((second & 0b0001_1000) >> 3).toBe(0b10); // version: MPEG-2
    expect((second & 0b0000_0110) >> 1).toBe(0b01); // layer: III
    expect(second & 0b0000_0001).toBe(1); // no CRC
    expect((third & 0b1111_0000) >> 4).toBe(0b0100); // bitrate index
    expect((third & 0b0000_1100) >> 2).toBe(0b01); // sample rate: 24 kHz
    expect((third & 0b0000_0010) >> 1).toBe(0); // no padding
    expect((fourth & 0b1100_0000) >> 6).toBe(0b11); // mono
  });

  it("is a whole number of frames of the length the header implies", async () => {
    // 72 * 32000 / 24000 = 96 bytes per MPEG-2 Layer III frame at this bitrate.
    const { bytes } = await new FakeSpeechSynthesisGateway().synthesize(
      REQUEST,
    );

    expect(bytes.length % FRAME_BYTES).toBe(0);
  });

  it("repeats the sync word at the start of every frame", async () => {
    // A decoder resynchronises on each frame, so a clip whose later frames are
    // silence-without-a-header would truncate on playback.
    const { bytes } = await new FakeSpeechSynthesisGateway().synthesize(
      REQUEST,
    );

    for (let offset = 0; offset < bytes.length; offset += FRAME_BYTES) {
      expect(bytes[offset]).toBe(0xff);
    }
  });

  it("reports the MP3 content type", async () => {
    const speech = await new FakeSpeechSynthesisGateway().synthesize(REQUEST);

    expect(speech.contentType).toBe("audio/mpeg");
  });

  it("is deterministic: the same request gives byte-identical audio", async () => {
    const gateway = new FakeSpeechSynthesisGateway();
    const first = await gateway.synthesize(REQUEST);
    const second = await gateway.synthesize(REQUEST);

    expect(first.bytes).toEqual(second.bytes);
  });

  it("gives two instances the same answer", async () => {
    // No hidden per-instance state, so a test that builds its own gateway sees what
    // every other test sees.
    const first = await new FakeSpeechSynthesisGateway().synthesize(REQUEST);
    const second = await new FakeSpeechSynthesisGateway().synthesize(REQUEST);

    expect(first.bytes).toEqual(second.bytes);
  });

  it("gives longer text a longer clip", async () => {
    const gateway = new FakeSpeechSynthesisGateway();
    const short = await gateway.synthesize(REQUEST);
    const long = await gateway.synthesize({
      ...REQUEST,
      text: "我每天都在图书馆学习中文。",
    });

    expect(long.bytes.length).toBeGreaterThan(short.bytes.length);
  });

  it("gives whitespace-equivalent text an identical clip", async () => {
    // The clip is derived from the normalized text, so it matches what the cache
    // considers one request.
    const gateway = new FakeSpeechSynthesisGateway();
    const plain = await gateway.synthesize(REQUEST);
    const padded = await gateway.synthesize({ ...REQUEST, text: " 学习\n" });

    expect(padded.bytes).toEqual(plain.bytes);
  });

  it("never returns empty audio, even for empty text", async () => {
    // A zero-length clip would be cached as a successful asset and play silence
    // forever. The facade refuses empty text before this point; the gateway does not
    // rely on that.
    const { bytes } = await new FakeSpeechSynthesisGateway().synthesize({
      ...REQUEST,
      text: "   ",
    });

    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.length % FRAME_BYTES).toBe(0);
  });

  it("caps the clip length however long the text is", async () => {
    const { bytes } = await new FakeSpeechSynthesisGateway().synthesize({
      ...REQUEST,
      text: "a".repeat(1500),
    });

    expect(bytes.length).toBe(400 * FRAME_BYTES);
  });

  it("bills for the characters it was given", async () => {
    const speech = await new FakeSpeechSynthesisGateway().synthesize(REQUEST);

    expect(speech.billedCharacters).toBe(2);
  });

  it("records every request, so a cache hit is provable", async () => {
    const gateway = new FakeSpeechSynthesisGateway();

    expect(gateway.callCount).toBe(0);

    await gateway.synthesize(REQUEST);
    await gateway.synthesize({ ...REQUEST, text: "学生" });

    expect(gateway.callCount).toBe(2);
    expect(gateway.requests.map((request) => request.text)).toEqual([
      "学习",
      "学生",
    ]);
  });
});
