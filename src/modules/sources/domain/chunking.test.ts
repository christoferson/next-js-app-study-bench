import { describe, expect, it } from "vitest";
import {
  CHUNK_SLACK_CHARS,
  TARGET_CHUNK_CHARS,
  chunkText,
  type TextChunk,
} from "./chunking";

/**
 * Passage boundaries for citations (`chunking.ts`).
 *
 * Three properties are load-bearing rather than cosmetic, because a stored citation is
 * shown against a snapshot the owner can re-read: the same text always chunks the same
 * way, `text.slice(charStart, charEnd)` is the chunk, and every non-whitespace character
 * lands in exactly one chunk. Most assertions below are one of those three.
 */

/** The largest chunk the accumulator will emit: the target is soft, this is not. */
const HARD_CAP = TARGET_CHUNK_CHARS + CHUNK_SLACK_CHARS;

/** A block of `length` characters with no sentence end and no space in it. */
function solidBlock(length: number, character = "a"): string {
  return character.repeat(length);
}

/** Prose of roughly `sentences` sentences, each a little over forty characters. */
function prose(sentences: number): string {
  return Array.from(
    { length: sentences },
    (_unused, index) => `Durability claim number ${index} about storage.`,
  ).join(" ");
}

/** Every character of the input that a chunk is obliged to carry. */
function substance(text: string): string {
  return text.replace(/\s+/g, "");
}

function texts(chunks: readonly TextChunk[]): readonly string[] {
  return chunks.map((chunk) => chunk.text);
}

describe("chunkText", () => {
  it("returns no chunks for empty text", () => {
    // Not one empty chunk: the caller decides whether nothing is an error, and the
    // facade rejects an empty import before it reaches here.
    expect(chunkText("")).toEqual([]);
  });

  it("returns no chunks for whitespace-only text", () => {
    expect(chunkText("   \n\n \t \n  ")).toEqual([]);
    expect(chunkText("\n")).toEqual([]);
  });

  it("returns a single chunk for text shorter than the target", () => {
    const chunks = chunkText("A short passage about durable object storage.");

    expect(texts(chunks)).toEqual([
      "A short passage about durable object storage.",
    ]);
  });

  it("trims the surrounding whitespace out of the offsets, not just the text", () => {
    const text = "\n\n  A short passage.  \n\n";
    const chunks = chunkText(text);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe("A short passage.");
    expect(chunks[0]?.charStart).toBe(text.indexOf("A"));
    expect(chunks[0]?.charEnd).toBe(
      text.indexOf("A") + "A short passage.".length,
    );
  });

  it("produces the same chunks every time it is given the same text", () => {
    const text = [prose(60), prose(60), prose(60)].join("\n\n");

    expect(chunkText(text)).toEqual(chunkText(text));
  });

  it("rejects a target smaller than one character", () => {
    expect(() => chunkText("Some text.", { targetChars: 0 })).toThrow(
      /at least one character/,
    );
    expect(() => chunkText("Some text.", { targetChars: -1 })).toThrow(Error);
  });
});

describe("chunk offsets", () => {
  const text = [prose(40), prose(40), solidBlock(2600), prose(5)].join("\n\n");
  const chunks = chunkText(text);

  it("are half-open offsets that slice the input back into the chunk", () => {
    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(text.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text);
    }
  });

  it("increase monotonically and never overlap", () => {
    let previousEnd = -1;

    for (const chunk of chunks) {
      expect(chunk.charStart).toBeGreaterThan(previousEnd - 1);
      expect(chunk.charStart).toBeGreaterThanOrEqual(previousEnd);
      expect(chunk.charEnd).toBeGreaterThan(chunk.charStart);
      previousEnd = chunk.charEnd;
    }
  });

  it("never start or end on whitespace", () => {
    for (const chunk of chunks) {
      expect(chunk.text).toBe(chunk.text.trim());
      expect(chunk.text).not.toBe("");
    }
  });

  it("account for every non-whitespace character of the input exactly once", () => {
    expect(texts(chunks).map(substance).join("")).toBe(substance(text));
  });
});

describe("paragraph-aware boundaries", () => {
  it("keeps several small paragraphs together in one chunk", () => {
    const text = ["First paragraph.", "Second paragraph.", "Third."].join(
      "\n\n",
    );

    expect(texts(chunkText(text))).toEqual([text]);
  });

  it("includes the blank line separator inside a chunk that spans paragraphs", () => {
    // The gap is inside the chunk's own offsets, so the citation reads as the document
    // reads rather than as two joined fragments.
    const text = ["First paragraph.", "Second paragraph."].join("\n\n");
    const chunks = chunkText(text);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain("\n\n");
  });

  it("splits between paragraphs rather than inside one when they do not fit together", () => {
    const first = solidBlock(900, "a");
    const second = solidBlock(900, "b");
    const chunks = chunkText([first, second].join("\n\n"));

    // 900 + 2 + 900 is over the cap, and each paragraph fits on its own.
    expect(texts(chunks)).toEqual([first, second]);
  });

  it("fills a chunk with whole paragraphs while they fit", () => {
    const blocks = Array.from({ length: 6 }, (_unused, index) =>
      solidBlock(500, String.fromCodePoint(97 + index)),
    );
    const chunks = chunkText(blocks.join("\n\n"));

    // Three 500-character blocks plus two separators is 1504, which is inside the
    // 1800 cap; a fourth would not be.
    expect(chunks).toHaveLength(2);
    expect(texts(chunks)).toEqual([
      blocks.slice(0, 3).join("\n\n"),
      blocks.slice(3).join("\n\n"),
    ]);
  });

  it("ignores runs of blank lines longer than one", () => {
    const text = ["First paragraph.", "Second paragraph."].join("\n\n\n\n");
    const chunks = chunkText(text);

    expect(texts(chunks).map(substance).join("")).toBe(substance(text));
    for (const chunk of chunks) {
      expect(chunk.text).toBe(chunk.text.trim());
    }
  });

  it("treats a line of spaces as a paragraph separator", () => {
    const text = `${solidBlock(900, "a")}\n   \n${solidBlock(900, "b")}`;

    expect(texts(chunkText(text))).toEqual([
      solidBlock(900, "a"),
      solidBlock(900, "b"),
    ]);
  });
});

describe("the target as a soft cap", () => {
  it("keeps a paragraph slightly over the target whole", () => {
    const block = solidBlock(TARGET_CHUNK_CHARS + 20);

    expect(texts(chunkText(block))).toEqual([block]);
  });

  it("keeps a paragraph at the very edge of the slack whole", () => {
    const block = solidBlock(HARD_CAP);

    expect(texts(chunkText(block))).toEqual([block]);
  });

  it("splits a single paragraph longer than the target plus its slack", () => {
    const chunks = chunkText(prose(200));

    expect(chunks.length).toBeGreaterThan(1);
  });

  it("emits no chunk larger than the target plus its slack", () => {
    const text = [prose(300), solidBlock(5000), prose(20)].join("\n\n");

    for (const chunk of chunkText(text)) {
      expect(chunk.text.length).toBeLessThanOrEqual(HARD_CAP);
    }
  });
});

describe("splitting an oversized paragraph", () => {
  it("cuts on sentence ends when there are any late enough to use", () => {
    const chunks = chunkText(prose(200));

    // Every chunk but the last ends where a sentence ended.
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.text.endsWith(".")).toBe(true);
    }
    expect(chunks.at(-1)?.text.endsWith(".")).toBe(true);
  });

  it("cuts on a CJK full stop followed by a newline", () => {
    // What `htmlToText` produces for a page of Chinese paragraphs.
    const chunks = chunkText("这是关于持久存储的句子。\n".repeat(300));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.endsWith("。")).toBe(true);
    }
  });

  it("cuts on a CJK full stop with no whitespace after it", () => {
    // The case that matters for a language track, and the one the CJK punctuation is
    // listed for: Chinese text puts nothing after `。`, and it has no spaces anywhere, so
    // requiring whitespace after the stop would fall through the whitespace strategy to
    // the hard cut and end every chunk mid-word.
    const chunks = chunkText("这是关于持久存储的句子。".repeat(300));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.endsWith("。")).toBe(true);
    }
  });

  it("falls back to whitespace when a sentence is longer than the target", () => {
    const words = Array.from({ length: 400 }, () => "durability").join(" ");
    const chunks = chunkText(words, { targetChars: 100, slackChars: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // No word was cut in half, and no chunk carries the separating space.
      for (const word of chunk.text.split(" ")) {
        expect(word).toBe("durability");
      }
    }
  });

  it("falls back to a hard cut for an unbroken run with no punctuation or spaces", () => {
    const chunks = chunkText(solidBlock(400), {
      targetChars: 100,
      slackChars: 0,
    });

    expect(texts(chunks)).toEqual([
      solidBlock(100),
      solidBlock(100),
      solidBlock(100),
      solidBlock(100),
    ]);
  });

  it("keeps the offsets exact and the substance complete through every fallback", () => {
    const text = [
      prose(120),
      solidBlock(1200, "x"),
      Array.from({ length: 300 }, () => "word").join(" "),
    ].join("\n\n");
    const chunks = chunkText(text);

    for (const chunk of chunks) {
      expect(text.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text);
    }
    expect(texts(chunks).map(substance).join("")).toBe(substance(text));
  });

  it("honours a caller-supplied target and slack", () => {
    const text = prose(20);
    const wide = chunkText(text, { targetChars: 5000, slackChars: 0 });
    const narrow = chunkText(text, { targetChars: 200, slackChars: 0 });

    expect(wide).toHaveLength(1);
    expect(narrow.length).toBeGreaterThan(wide.length);
    for (const chunk of narrow) {
      expect(chunk.text.length).toBeLessThanOrEqual(200);
    }
  });
});
