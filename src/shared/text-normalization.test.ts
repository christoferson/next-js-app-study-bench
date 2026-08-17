import { describe, expect, it } from "vitest";
import {
  findUnmappedRadicals,
  normalizeCjkNumberSpacing,
  normalizeCjkRadicals,
  normalizeLigatures,
} from "@/shared/text-normalization";

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

describe("normalizeCjkNumberSpacing", () => {
  it("closes both spaces around a number between CJK characters", () => {
    expect(normalizeCjkNumberSpacing("共 20 题")).toBe("共20题");
  });

  it("closes the space before a number that a CJK character opens", () => {
    expect(normalizeCjkNumberSpacing("约 30 分钟")).toBe("约30分钟");
  });

  it("closes every number in a run of them", () => {
    expect(normalizeCjkNumberSpacing("第 1 到 45 题")).toBe("第1到45题");
  });

  it("leaves a number that no CJK character follows alone", () => {
    expect(normalizeCjkNumberSpacing("词汇量 2500")).toBe("词汇量 2500");
  });

  it("leaves a number that no CJK character precedes alone", () => {
    expect(normalizeCjkNumberSpacing("HSK 5 级")).toBe("HSK 5 级");
  });

  it("leaves a Latin sentence untouched", () => {
    expect(normalizeCjkNumberSpacing("Domain 1: Design 22% of the exam")).toBe(
      "Domain 1: Design 22% of the exam",
    );
  });

  it("leaves the spacing of a Latin identifier untouched", () => {
    expect(
      normalizeCjkNumberSpacing("AWS Certified AI Practitioner 1 of 3"),
    ).toBe("AWS Certified AI Practitioner 1 of 3");
  });

  it("leaves a number beside fullwidth punctuation alone", () => {
    // A table row, not a sentence: a fullwidth parenthesis is not an ideograph, so
    // the layout spacing this line depends on survives.
    expect(normalizeCjkNumberSpacing("HSK（五级） 2500 C1")).toBe(
      "HSK（五级） 2500 C1",
    );
  });

  it("never repairs across a line break", () => {
    // The opening ideograph is on the previous line, so this is a wrapped line
    // rather than a spaced count and it is left exactly as extracted.
    expect(normalizeCjkNumberSpacing("共\n20 题")).toBe("共\n20 题");
  });

  it("leaves a number that only a line break follows alone", () => {
    // Conservative in both directions: the ideograph that would close the run is
    // on the next line, so this stays as extracted rather than being guessed at.
    expect(normalizeCjkNumberSpacing("共 20\n题")).toBe("共 20\n题");
  });

  it("leaves text that needs no repair unchanged", () => {
    expect(normalizeCjkNumberSpacing("共20题。")).toBe("共20题。");
  });
});
