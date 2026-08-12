import { describe, expect, it } from "vitest";
import {
  findUnmappedRadicals,
  normalizeCjkRadicals,
  normalizeLigatures,
} from "./text-normalization";

/**
 * Every fixture here is invented for the test. The real sources stay in
 * `external/` and none of their wording appears in this repository.
 */

describe("normalizeLigatures", () => {
  it("replaces a ligature with the letters it stands for", () => {
    // "configure" as a PDF draws it: U+FB01 for "fi".
    expect(normalizeLigatures("conﬁgure")).toBe("configure");
  });

  it("replaces every ligature the extraction produces", () => {
    expect(normalizeLigatures("staﬀ ﬁne ﬂow eﬃcient suﬄe ﬅill ﬆand")).toBe(
      "staff fine flow efficient suffle still stand",
    );
  });

  it("leaves text with no ligatures untouched", () => {
    expect(normalizeLigatures("plain ascii text")).toBe("plain ascii text");
  });

  it("makes a ligature word searchable by its ordinary spelling", () => {
    // The point of the repair: a stored objective must match what the owner types.
    expect(normalizeLigatures("Conﬁgure a proﬁle")).toContain("Configure");
  });
});

describe("normalizeCjkRadicals", () => {
  it("rewrites a Kangxi radical as its ordinary character", () => {
    // U+2F69 is the Kangxi radical that depicts 白 (U+767D).
    expect(normalizeCjkRadicals("⽩")).toBe("白");
  });

  it("rewrites a radical inside a word and leaves the rest alone", () => {
    // "⽩" + 天 becomes 白天.
    expect(normalizeCjkRadicals("⽩天")).toBe("白天");
  });

  it("rewrites a CJK Radicals Supplement character, which NFKC cannot", () => {
    // U+2ECB has no compatibility decomposition at all, so the override table is
    // the only thing that can repair it.
    expect("⻋".normalize("NFKC")).toBe("⻋");
    expect(normalizeCjkRadicals("⻋")).toBe("车");
  });

  it("keeps a simplified list simplified where NFKC would not", () => {
    // U+2F3E decomposes to the traditional 戶, which must not appear in a
    // simplified-Chinese vocabulary card.
    expect("⼾".normalize("NFKC")).toBe("戶");
    expect(normalizeCjkRadicals("⼾")).toBe("户");
  });

  it("leaves ordinary CJK characters untouched", () => {
    expect(normalizeCjkRadicals("你好")).toBe("你好");
  });

  it("leaves Latin text untouched", () => {
    expect(normalizeCjkRadicals("to stay up late")).toBe("to stay up late");
  });
});

describe("findUnmappedRadicals", () => {
  it("finds nothing in normalized text", () => {
    expect(findUnmappedRadicals(normalizeCjkRadicals("⽩天"))).toEqual([]);
  });

  it("reports a radical that survived normalization", () => {
    // U+2E9C is in the supplement block and is deliberately not in the override
    // table, so it stands for "a radical this build does not know".
    expect(findUnmappedRadicals("⺜")).toEqual(["⺜"]);
  });

  it("reports each unmapped radical once", () => {
    expect(findUnmappedRadicals("⺜⺜")).toEqual(["⺜"]);
  });

  it("reports nothing for ordinary text", () => {
    expect(findUnmappedRadicals("白天 white day")).toEqual([]);
  });
});
