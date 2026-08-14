import { FAKE_SPEECH_PROVIDER } from "@/modules/audio/domain/speech-provider";
import { AUDIO_CONTENT_TYPE } from "@/modules/audio/domain/speech-request";
import type { SpeechRequest } from "@/modules/audio/domain/speech-request";
import { normalizeSpeechText } from "@/modules/audio/domain/speech-request";
import type {
  SpeechSynthesisGateway,
  SynthesizedSpeech,
} from "@/modules/audio/ports/speech-synthesis-gateway";

/**
 * Deterministic in-process speech gateway (`spec/TESTING.md` section 5).
 *
 * The default provider, so a fresh clone exercises the whole audio flow — generate,
 * cache, play, delete — with no AWS account, no credentials, and no spend. Every
 * test in the default suite uses it, which is what keeps the suite free of AWS calls.
 *
 * **It returns a real, playable MP3.** Not an empty buffer and not random bytes: the
 * output is a run of valid MPEG-2 Layer III frames carrying silence, so a browser's
 * `<audio>` element loads it, reports a duration, and plays it. That matters because
 * the parts most likely to be wrong are the plumbing — content type, byte length,
 * the player's own state machine — and a fake that produced unplayable bytes would
 * hide exactly those faults until the first live Polly call.
 *
 * The clip's length is derived from the text, so a longer term produces a longer
 * clip. It makes the difference between two requests audible during manual
 * verification, and it keeps distinct requests from producing byte-identical files
 * that would mask a cache-key collision.
 */

/**
 * One frame of MPEG-2 Layer III silence: 32 kbit/s, 24 kHz, mono.
 *
 * The four header bytes, bit by bit:
 *
 * - `ff f3` — eleven sync bits, then version `10` (MPEG-2), layer `01` (Layer III),
 *   and protection `1` (no CRC).
 * - `44` — bitrate index `0100` (32 kbit/s for MPEG-2 Layer III), sample-rate index
 *   `01` (24 kHz), no padding, private bit clear.
 * - `c4` — channel mode `11` (mono), no mode extension, not copyrighted, original,
 *   no emphasis.
 *
 * MPEG-2 Layer III carries 576 samples per frame, so the frame length is
 * `72 * 32000 / 24000 = 96` bytes: four of header and 92 of payload. Zero payload
 * decodes as silence, and each frame is 24 milliseconds long.
 *
 * Hand-built rather than read from a fixture file, so a reader can check the bytes
 * against the MPEG frame layout instead of trusting a binary blob that no diff can
 * show. `fake-speech-synthesis-gateway.test.ts` re-derives the frame length from
 * these header bits, so a typo in them fails a test rather than producing a file
 * that only a browser can reject.
 */
const SILENT_FRAME = new Uint8Array([
  0xff,
  0xf3,
  0x44,
  0xc4,
  ...new Array<number>(92).fill(0),
]);

/** Frames in the shortest possible clip. About 190 milliseconds. */
const BASE_FRAMES = 8;

/** Extra frames per character, so a longer utterance is a longer clip. */
const FRAMES_PER_CHARACTER = 2;

/** Never produce a clip longer than this, whatever the text. About ten seconds. */
const MAX_FRAMES = 400;

export class FakeSpeechSynthesisGateway implements SpeechSynthesisGateway {
  readonly provider = FAKE_SPEECH_PROVIDER;

  /**
   * Every request this gateway was asked to speak, in order.
   *
   * Public because the cache is the feature: a facade test proves a second identical
   * request costs nothing by asserting this list did not grow.
   */
  readonly requests: SpeechRequest[] = [];

  async synthesize(request: SpeechRequest): Promise<SynthesizedSpeech> {
    this.requests.push(request);

    const spoken = normalizeSpeechText(request.text);
    const frameCount = Math.min(
      MAX_FRAMES,
      BASE_FRAMES + spoken.length * FRAMES_PER_CHARACTER,
    );
    const bytes = new Uint8Array(SILENT_FRAME.length * frameCount);

    for (let index = 0; index < frameCount; index += 1) {
      bytes.set(SILENT_FRAME, index * SILENT_FRAME.length);
    }

    return {
      bytes,
      contentType: AUDIO_CONTENT_TYPE,
      // Polly bills per character of text, so the fake reports the same count it
      // would, making the cost line on screen honest under both providers.
      billedCharacters: spoken.length,
    };
  }

  /** How many provider calls were made. For cache assertions. */
  get callCount(): number {
    return this.requests.length;
  }
}
