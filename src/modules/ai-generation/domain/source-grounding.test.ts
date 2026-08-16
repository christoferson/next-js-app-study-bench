import { describe, expect, it } from "vitest";
import {
  MAX_GROUNDING_CHARACTERS,
  MAX_GROUNDING_CHUNKS,
  groundingKeywords,
  lexicalOverlap,
  resolveSupportingChunkIds,
  selectGroundingExcerpts,
} from "./source-grounding";
import type { GroundingCandidate } from "./source-grounding";

/**
 * What has to hold for grounding to be trustworthy rather than merely present.
 *
 * The ranking is deliberately blunt — it counts shared words — so the tests are written
 * against the guarantees the caller actually relies on rather than against particular
 * scores. Those guarantees are: the owner's own objective mapping beats any word overlap,
 * the same candidates in the same order always produce the same selection, an excerpt is
 * either sent whole or not sent at all, and the indexes the model is asked to cite line up
 * with the excerpts it was shown. A regression in any one of those is either a prompt that
 * quotes half a sentence as evidence or a citation that resolves to the wrong passage.
 */

function candidate(
  overrides: Partial<GroundingCandidate> = {},
): GroundingCandidate {
  return {
    chunkId: "chunk-1",
    snapshotId: "snapshot-1",
    sourceId: "source-1",
    sourceTitle: "Solutions Architect Exam Guide",
    chunkIndex: 0,
    text: "An IAM role delegates permissions without long-lived credentials.",
    objectiveLinked: false,
    ...overrides,
  };
}

function chunkIds(
  candidates: readonly GroundingCandidate[],
): readonly string[] {
  return candidates.map((entry) => entry.chunkId);
}

const NO_KEYWORDS: ReadonlySet<string> = new Set<string>();

describe("ranking the candidates", () => {
  it("puts an objective-linked chunk ahead of a better-matching unlinked one", () => {
    // The whole point of slice 1's objective mapping: the owner said this document covers
    // this topic, and that judgement outranks vocabulary. A passage that merely repeats
    // the objective's wording must not displace one from the document the owner chose.
    const selection = selectGroundingExcerpts(
      [
        candidate({
          chunkId: "unlinked-but-wordy",
          text: "identity and access management, in detail",
        }),
        candidate({
          chunkId: "linked",
          text: "Invoices are issued monthly in arrears.",
          objectiveLinked: true,
        }),
      ],
      groundingKeywords(["identity access management"]),
    );

    expect(
      chunkIds(selection.excerpts.map((entry) => entry.candidate)),
    ).toEqual(["linked", "unlinked-but-wordy"]);
  });

  it("keeps every linked chunk ahead of every unlinked one", () => {
    // Checked with more than one of each, because a comparator that returned 0 for the
    // link difference would still pass a two-element case on sort stability alone.
    const selection = selectGroundingExcerpts(
      [
        candidate({ chunkId: "free-1", text: "vpc endpoint gateway route" }),
        candidate({ chunkId: "linked-1", objectiveLinked: true }),
        candidate({ chunkId: "free-2", text: "vpc endpoint gateway" }),
        candidate({ chunkId: "linked-2", objectiveLinked: true }),
      ],
      groundingKeywords(["vpc endpoint gateway route"]),
    );

    expect(
      chunkIds(selection.excerpts.map((entry) => entry.candidate)),
    ).toEqual(["linked-1", "linked-2", "free-1", "free-2"]);
  });

  it("orders chunks of equal standing by how much of the query they cover", () => {
    const selection = selectGroundingExcerpts(
      [
        candidate({ chunkId: "none", text: "Invoices are issued monthly." }),
        candidate({ chunkId: "some", text: "An endpoint policy is attached." }),
        candidate({
          chunkId: "most",
          text: "A gateway endpoint routes vpc traffic.",
        }),
      ],
      groundingKeywords(["vpc endpoint gateway route"]),
    );

    expect(
      chunkIds(selection.excerpts.map((entry) => entry.candidate)),
    ).toEqual(["most", "some", "none"]);
  });

  it("breaks a tie on the order the candidates were offered in", () => {
    // The deterministic last resort. Note that it is the position in the array, not
    // `chunkIndex` or `sourceId`: offering the candidates in document order is the
    // caller's job, and this test pins that contract by offering them out of it.
    const selection = selectGroundingExcerpts(
      [
        candidate({ chunkId: "offered-first", chunkIndex: 9 }),
        candidate({ chunkId: "offered-second", chunkIndex: 4 }),
        candidate({ chunkId: "offered-third", chunkIndex: 0 }),
      ],
      groundingKeywords(["nothing here matches"]),
    );

    expect(
      chunkIds(selection.excerpts.map((entry) => entry.candidate)),
    ).toEqual(["offered-first", "offered-second", "offered-third"]);
  });

  it("is simply the offered order when there are no keywords at all", () => {
    // "Ground this on my exam guide" with nothing narrower said. Every score is zero, so
    // the answer is the first chunks of the chosen sources — not an arbitrary ranking.
    const selection = selectGroundingExcerpts(
      [
        candidate({ chunkId: "a" }),
        candidate({ chunkId: "b" }),
        candidate({ chunkId: "c" }),
      ],
      NO_KEYWORDS,
    );

    expect(
      chunkIds(selection.excerpts.map((entry) => entry.candidate)),
    ).toEqual(["a", "b", "c"]);
    expect(selection.omittedCount).toBe(0);
  });

  it("returns an empty selection for no candidates", () => {
    const selection = selectGroundingExcerpts([], NO_KEYWORDS);

    expect(selection.excerpts).toEqual([]);
    expect(selection.snapshotIds).toEqual([]);
    expect(selection.omittedCount).toBe(0);
    expect(selection.totalCharacters).toBe(0);
  });
});

describe("the caps on one request", () => {
  it("sends no more than maxChunks and counts the remainder as omitted", () => {
    const candidates = Array.from({ length: 5 }, (_, position) =>
      candidate({ chunkId: `chunk-${position}` }),
    );

    const selection = selectGroundingExcerpts(candidates, NO_KEYWORDS, {
      maxChunks: 2,
    });

    expect(
      chunkIds(selection.excerpts.map((entry) => entry.candidate)),
    ).toEqual(["chunk-0", "chunk-1"]);
    expect(selection.omittedCount).toBe(3);
  });

  it("skips an oversized chunk rather than truncating it, and keeps filling", () => {
    // A half sentence is not evidence, and the evidence panel must show the passage the
    // model actually saw. A single enormous chunk must also not end the selection when
    // smaller relevant ones would still fit, so the fill continues past it.
    const oversized = "O".repeat(300);
    const selection = selectGroundingExcerpts(
      [
        candidate({ chunkId: "oversized", text: oversized }),
        candidate({ chunkId: "small-1", text: "S".repeat(40) }),
        candidate({ chunkId: "small-2", text: "S".repeat(40) }),
      ],
      NO_KEYWORDS,
      { maxCharacters: 100 },
    );

    expect(
      chunkIds(selection.excerpts.map((entry) => entry.candidate)),
    ).toEqual(["small-1", "small-2"]);
    expect(
      selection.excerpts.some((entry) =>
        entry.candidate.text.includes(oversized),
      ),
    ).toBe(false);
    expect(selection.omittedCount).toBe(1);
    expect(selection.totalCharacters).toBe(80);
    expect(selection.totalCharacters).toBeLessThanOrEqual(100);
  });

  it("reports totalCharacters as the exact sum of what it sent", () => {
    const selection = selectGroundingExcerpts(
      [
        candidate({ chunkId: "a", text: "A".repeat(30) }),
        candidate({ chunkId: "b", text: "B".repeat(45) }),
      ],
      NO_KEYWORDS,
    );

    expect(selection.totalCharacters).toBe(75);
    expect(selection.totalCharacters).toBeLessThanOrEqual(
      MAX_GROUNDING_CHARACTERS,
    );
  });

  it("applies the module defaults when no limits are passed", () => {
    const candidates = Array.from(
      { length: MAX_GROUNDING_CHUNKS + 3 },
      (_, position) => candidate({ chunkId: `chunk-${position}` }),
    );

    const selection = selectGroundingExcerpts(candidates, NO_KEYWORDS);

    expect(selection.excerpts).toHaveLength(MAX_GROUNDING_CHUNKS);
    expect(selection.omittedCount).toBe(3);
  });
});

describe("what the model is asked to cite", () => {
  it("numbers the excerpts from one, contiguously", () => {
    const selection = selectGroundingExcerpts(
      [
        candidate({ chunkId: "a" }),
        candidate({ chunkId: "b" }),
        candidate({ chunkId: "c" }),
      ],
      NO_KEYWORDS,
    );

    expect(selection.excerpts.map((entry) => entry.index)).toEqual([1, 2, 3]);
  });

  it("numbers by position in the sent list, not by position among the candidates", () => {
    // The gap a skipped oversized chunk would leave, if indexes were derived from the
    // candidate list: the model would cite 3 and the caller would resolve nothing.
    const selection = selectGroundingExcerpts(
      [
        candidate({ chunkId: "oversized", text: "O".repeat(300) }),
        candidate({ chunkId: "small-1", text: "S".repeat(10) }),
        candidate({ chunkId: "small-2", text: "S".repeat(10) }),
      ],
      NO_KEYWORDS,
      { maxCharacters: 100 },
    );

    expect(selection.excerpts.map((entry) => entry.index)).toEqual([1, 2]);
  });

  it("records each snapshot once, in the order it was first drawn from", () => {
    // Provenance for the run, so the owner can see which revision of which source the
    // questions came out of. Duplicates would misrepresent how many documents were used.
    const selection = selectGroundingExcerpts(
      [
        candidate({ chunkId: "a", snapshotId: "snapshot-b" }),
        candidate({ chunkId: "b", snapshotId: "snapshot-a" }),
        candidate({ chunkId: "c", snapshotId: "snapshot-b" }),
      ],
      NO_KEYWORDS,
    );

    expect(selection.snapshotIds).toEqual(["snapshot-b", "snapshot-a"]);
  });

  it("lists only the snapshots it actually sent", () => {
    const selection = selectGroundingExcerpts(
      [
        candidate({ chunkId: "a", snapshotId: "snapshot-a" }),
        candidate({ chunkId: "b", snapshotId: "snapshot-b" }),
      ],
      NO_KEYWORDS,
      { maxChunks: 1 },
    );

    expect(selection.snapshotIds).toEqual(["snapshot-a"]);
  });
});

describe("the query words", () => {
  it("lowercases and deduplicates across every part", () => {
    expect([...groundingKeywords(["IAM Role", "iam role"])]).toEqual([
      "iam",
      "role",
    ]);
  });

  it("drops tokens shorter than three characters", () => {
    // A length floor instead of a stop-word list per language: it loses "of" and "to"
    // everywhere without a list to maintain. It also loses short service names such as
    // "s3", which is the accepted cost — the objective link is what carries those.
    expect(groundingKeywords(["a an of to the s3 vpc"])).toEqual(
      new Set(["the", "vpc"]),
    );
  });

  it("ignores null parts, so an absent objective title costs nothing", () => {
    expect([...groundingKeywords([null, "encryption", null])]).toEqual([
      "encryption",
    ]);
  });

  it("returns an empty set when there is nothing to read", () => {
    expect(groundingKeywords([]).size).toBe(0);
    expect(groundingKeywords([null, ""]).size).toBe(0);
  });

  it("produces tokens from Chinese text rather than nothing at all", () => {
    // `\p{L}` rather than `a-z`, because the owner's other track is Chinese. An
    // ASCII-only tokenizer would score every Chinese source at zero.
    expect(groundingKeywords(["汉语水平考试"]).size).toBeGreaterThan(0);
  });

  it("splits Chinese text on punctuation, having no segmenter", () => {
    expect(groundingKeywords(["汉语水平考试，考试大纲"])).toEqual(
      new Set(["汉语水平考试", "考试大纲"]),
    );
  });
});

describe("lexical overlap", () => {
  it("is the fraction of query words present, not the number of them", () => {
    const keywords = groundingKeywords(["vpc endpoint gateway route"]);

    expect(keywords.size).toBe(4);
    expect(lexicalOverlap("A gateway for vpc traffic.", keywords)).toBe(0.5);
    expect(lexicalOverlap("A gateway endpoint on a vpc route.", keywords)).toBe(
      1,
    );
  });

  it("matches whole words only, with no stemming", () => {
    // Worth pinning rather than leaving implicit: "routes" does not match "route", so a
    // passage written in the plural scores zero on that keyword. This is the bluntness
    // the module's own comment admits to, and the reason the objective link ranks first.
    const keywords = groundingKeywords(["route"]);

    expect(lexicalOverlap("The table routes traffic.", keywords)).toBe(0);
    expect(lexicalOverlap("The route table.", keywords)).toBe(1);
  });

  it("does not reward repetition", () => {
    const keywords = groundingKeywords(["endpoint"]);

    expect(lexicalOverlap("endpoint endpoint endpoint", keywords)).toBe(
      lexicalOverlap("endpoint", keywords),
    );
  });

  it("does not reward length", () => {
    // Being a fraction of the query rather than of the chunk, a long passage that happens
    // to mention one keyword must not beat a short one that mentions the same keyword.
    const keywords = groundingKeywords(["endpoint gateway"]);
    const short = lexicalOverlap("A gateway.", keywords);
    const padded = lexicalOverlap(
      `A gateway. ${"Unrelated prose. ".repeat(50)}`,
      keywords,
    );

    expect(padded).toBe(short);
  });

  it("is zero when there is nothing to match against", () => {
    expect(
      lexicalOverlap("Anything the source happens to say.", NO_KEYWORDS),
    ).toBe(0);
  });

  it("is zero for a chunk that shares no words", () => {
    expect(
      lexicalOverlap(
        "Invoices are issued monthly.",
        groundingKeywords(["vpc"]),
      ),
    ).toBe(0);
  });
});

describe("resolving the indexes a model claimed", () => {
  const excerpts = selectGroundingExcerpts(
    [
      candidate({ chunkId: "chunk-a" }),
      candidate({ chunkId: "chunk-b" }),
      candidate({ chunkId: "chunk-c" }),
    ],
    NO_KEYWORDS,
  ).excerpts;

  it("maps 1-based indexes back to chunk ids", () => {
    expect(resolveSupportingChunkIds([1, 3], excerpts)).toEqual([
      "chunk-a",
      "chunk-c",
    ]);
  });

  it("drops out-of-range indexes rather than rejecting the whole item", () => {
    // Zero in particular: 1-based numbering is what makes an off-by-one answer invalid
    // instead of quietly resolving to a different excerpt.
    expect(resolveSupportingChunkIds([0, 2, 4, -1, 99], excerpts)).toEqual([
      "chunk-b",
    ]);
  });

  it("collapses duplicate claims", () => {
    expect(resolveSupportingChunkIds([2, 2, 1, 2], excerpts)).toEqual([
      "chunk-b",
      "chunk-a",
    ]);
  });

  it("returns nothing when the model cited nothing usable", () => {
    // The caller decides what that means: rejection under SOURCE_GROUNDED, a legitimate
    // model-knowledge item under HYBRID.
    expect(resolveSupportingChunkIds([], excerpts)).toEqual([]);
    expect(resolveSupportingChunkIds([7], excerpts)).toEqual([]);
    expect(resolveSupportingChunkIds([1], [])).toEqual([]);
  });
});
