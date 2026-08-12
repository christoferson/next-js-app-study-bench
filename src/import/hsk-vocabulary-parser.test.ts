import { describe, expect, it } from "vitest";
import {
  assertHskVocabularyListSize,
  HskVocabularyParseError,
  parseHskVocabularyList,
  toVocabularyRows,
} from "./hsk-vocabulary-parser";

/**
 * Every fixture in this file is invented.
 *
 * The parser reads the owner's own copy of a published word list, which stays in
 * `external/` and is never committed. These fixtures imitate its *row layout*
 * using a handful of common words with deliberately plain glosses; no run of rows
 * from the real list appears here.
 */

/** A list with page furniture around the rows, as the extraction produces it. */
function fixture(...rows: readonly string[]): string {
  return [
    "MANDARIN ZONE",
    "New HSK 5 Vocabulary List (Widget Edition)",
    "All 1,600 New HSK 5 words with pinyin and English",
    "#汉字 Pinyin POS English Register",
    ...rows,
    "Page 1 / 40",
  ].join("\n");
}

describe("parseHskVocabularyList", () => {
  it("reads a row into its number, term, reading, part of speech, and meaning", () => {
    const list = parseHskVocabularyList(fixture("2001阿姨 āyí n. auntNeutral"));

    expect(list.entries).toHaveLength(1);
    expect(list.entries[0]).toEqual({
      number: 2001,
      term: "阿姨",
      reading: "āyí",
      partOfSpeech: "n.",
      meaning: "aunt",
      register: "Neutral",
      isNewInSyllabus: false,
    });
  });

  it("reads several rows in list order", () => {
    const list = parseHskVocabularyList(
      fixture(
        "2001阿姨 āyí n. auntNeutral",
        "2002爱护 àihù v. to take good care ofWritten",
        "2003安装 ānzhuāng v. to installNeutral",
      ),
    );

    expect(list.entries.map((entry) => entry.number)).toEqual([
      2001, 2002, 2003,
    ]);
    expect(list.entries.map((entry) => entry.term)).toEqual([
      "阿姨",
      "爱护",
      "安装",
    ]);
  });

  it("reads each register the list distinguishes", () => {
    const list = parseHskVocabularyList(
      fixture(
        "2001阿姨 āyí n. auntNeutral",
        "2002爱护 àihù v. to take good care ofWritten",
        "2003哎 āi interj. heyySpoken",
      ),
    );

    expect(list.entries.map((entry) => entry.register)).toEqual([
      "Neutral",
      "Written",
      "Spoken",
    ]);
  });

  it("reads the New flag that follows a register", () => {
    const list = parseHskVocabularyList(
      fixture(
        "2001阿姨 āyí n. auntNeutralNew",
        "2002爱护 àihù v. to take good care ofWritten",
      ),
    );

    expect(list.entries.map((entry) => entry.isNewInSyllabus)).toEqual([
      true,
      false,
    ]);
  });

  it("keeps the register out of the meaning", () => {
    const list = parseHskVocabularyList(
      fixture("2001阿姨 āyí n. auntNeutralNew"),
    );

    expect(list.entries[0]?.meaning).toBe("aunt");
  });

  it("joins a meaning that wrapped across lines", () => {
    const list = parseHskVocabularyList(
      fixture(
        "2003哎 āi interj. hey!; (an interjection used to attract",
        "attention or to express surprise or",
        "disapprobation)Spoken",
      ),
    );

    expect(list.entries).toHaveLength(1);
    expect(list.entries[0]?.meaning).toBe(
      "hey!; (an interjection used to attract attention or to express surprise or disapprobation)",
    );
  });

  it("joins a hyphenated wrap without inserting a space", () => {
    const list = parseHskVocabularyList(
      fixture("2004高铁 gāotiě n. high-", "speed railwayNeutral"),
    );

    expect(list.entries[0]?.meaning).toBe("high-speed railway");
  });

  it("starts a new row only at a number glued to a non-space character", () => {
    // A wrapped English line can begin with a year, which must not be mistaken
    // for a row number.
    const list = parseHskVocabularyList(
      fixture(
        "2005世纪 shìjì n. century; the period after",
        "2000 or soNeutral",
      ),
    );

    expect(list.entries).toHaveLength(1);
    expect(list.entries[0]?.meaning).toBe(
      "century; the period after 2000 or so",
    );
  });

  it("reads a reading written as more than one token", () => {
    const list = parseHskVocabularyList(
      fixture("2006从不 cóng bù adv. neverWritten"),
    );

    expect(list.entries[0]).toMatchObject({
      reading: "cóng bù",
      partOfSpeech: "adv.",
      meaning: "never",
    });
  });

  it("reads a compound part of speech", () => {
    const list = parseHskVocabularyList(
      fixture("2007保 bǎo v./n. to protect; a guaranteeWritten"),
    );

    expect(list.entries[0]?.partOfSpeech).toBe("v./n.");
    expect(list.entries[0]?.meaning).toBe("to protect; a guarantee");
  });

  it("reads an annotated part of speech", () => {
    const list = parseHskVocabularyList(
      fixture("2008当初 dāngchū n.(time) at that timeWritten"),
    );

    expect(list.entries[0]?.partOfSpeech).toBe("n.(time)");
    expect(list.entries[0]?.meaning).toBe("at that time");
  });

  it("reads the dotless idiom part of speech", () => {
    const list = parseHskVocabularyList(
      fixture(
        "2009一举两得 yī-jǔ-liǎng-dé idiom to kill two birds with one stoneWritten",
      ),
    );

    expect(list.entries[0]).toMatchObject({
      reading: "yī-jǔ-liǎng-dé",
      partOfSpeech: "idiom",
      meaning: "to kill two birds with one stone",
    });
  });

  it("reads a part of speech the list writes in Chinese", () => {
    const list = parseHskVocabularyList(
      fixture("2010把 bǎ 数量 a bunch ofNeutral"),
    );

    expect(list.entries[0]?.partOfSpeech).toBe("数量");
    expect(list.entries[0]?.meaning).toBe("a bunch of");
  });

  it("keeps a digit that is part of a term", () => {
    // The list disambiguates homographs with a trailing digit, and two different
    // words collide if it is stripped.
    const list = parseHskVocabularyList(
      fixture("2011本2 běn mw. a copyNeutral"),
    );

    expect(list.entries[0]?.term).toBe("本2");
  });

  it("repairs a radical codepoint in a term and counts it", () => {
    // 客⼾ is written with the Kangxi radical U+2F3E; stored that way the card
    // would never match a search for 客户.
    const list = parseHskVocabularyList(
      fixture("2012客⼾ kèhù n. customerNeutral"),
    );

    expect(list.entries[0]?.term).toBe("客户");
    expect(list.radicalRepairCount).toBe(1);
  });

  it("counts no repair for a term that needed none", () => {
    const list = parseHskVocabularyList(fixture("2001阿姨 āyí n. auntNeutral"));

    expect(list.radicalRepairCount).toBe(0);
  });

  it("reports a radical it has no mapping for", () => {
    const list = parseHskVocabularyList(
      fixture("2013⺜天 mouri n. an invented wordNeutral"),
    );

    expect(list.unmappedRadicals).toEqual(["⺜"]);
  });

  it("repairs ligatures in an English meaning", () => {
    const list = parseHskVocabularyList(
      fixture("2014修 xiū v. to ﬁx a proﬁleNeutral"),
    );

    expect(list.entries[0]?.meaning).toBe("to fix a profile");
  });

  it("skips a row with no register, reporting its number only", () => {
    const list = parseHskVocabularyList(
      fixture(
        "2001阿姨 āyí n. aunt",
        "2002爱护 àihù v. to take good care ofWritten",
      ),
    );

    // The next line starts its own row, so nothing repairs the first one: it is
    // dropped and reported, and the rest of the list still parses.
    expect(list.entries.map((entry) => entry.number)).toEqual([2002]);
    expect(list.skipped).toEqual([{ number: 2001, reason: "NO_REGISTER" }]);
  });

  it("skips a row with no recognisable part of speech", () => {
    const list = parseHskVocabularyList(fixture("2015阿姨 āyí auntNeutral"));

    expect(list.entries).toEqual([]);
    expect(list.skipped).toEqual([
      { number: 2015, reason: "NO_PART_OF_SPEECH" },
    ]);
  });

  it("skips a row with no meaning", () => {
    const list = parseHskVocabularyList(fixture("2016阿姨 āyí n.Neutral"));

    expect(list.entries).toEqual([]);
    expect(list.skipped).toEqual([{ number: 2016, reason: "NO_MEANING" }]);
  });

  it("reports a skipped row without quoting any of it", () => {
    const list = parseHskVocabularyList(fixture("2015阿姨 āyí auntNeutral"));

    expect(JSON.stringify(list.skipped)).not.toContain("阿姨");
  });
});

describe("toVocabularyRows", () => {
  it("drops the cover banner, the column header, and the page footer", () => {
    const rows = toVocabularyRows(fixture("2001阿姨 āyí n. auntNeutral"));

    expect(rows).toEqual(["2001阿姨 āyí n. auntNeutral"]);
  });

  it("drops the column header repeated mid-document", () => {
    const rows = toVocabularyRows(
      fixture(
        "2001阿姨 āyí n. auntNeutral",
        "Page 1 / 40",
        "#汉字 Pinyin POS English Register",
        "2002爱护 àihù v. to take good care ofWritten",
      ),
    );

    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe("2002爱护 àihù v. to take good care ofWritten");
  });

  it("returns one line per row however many lines it wrapped across", () => {
    const rows = toVocabularyRows(
      fixture(
        "2001阿姨 āyí n. auntNeutral",
        "2003哎 āi interj. hey!; (an interjection used to attract",
        "attention)Spoken",
      ),
    );

    expect(rows).toEqual([
      "2001阿姨 āyí n. auntNeutral",
      "2003哎 āi interj. hey!; (an interjection used to attract attention)Spoken",
    ]);
  });

  it("treats a page break as a line break", () => {
    const rows = toVocabularyRows(
      fixture(
        "2001阿姨 āyí n. aunt\f2002爱护 àihù v. to take good care ofWritten",
      ),
    );

    expect(rows).toHaveLength(2);
  });

  it("discards leading text that is not part of any row", () => {
    const rows = toVocabularyRows("An introduction paragraph.\nAnother line.");

    expect(rows).toEqual([]);
  });
});

describe("assertHskVocabularyListSize", () => {
  const expectations = { wordCount: 3, minimumEntryCount: 2 };

  function listOf(count: number, startAt = 2001) {
    return parseHskVocabularyList(
      fixture(
        ...Array.from(
          { length: count },
          (_unused, index) => `${startAt + index}词 cí n. a wordNeutral`,
        ),
      ),
    );
  }

  it("accepts a complete list", () => {
    expect(() =>
      assertHskVocabularyListSize(listOf(3), expectations),
    ).not.toThrow();
  });

  it("accepts a shortfall inside the tolerance, for the caller to report", () => {
    expect(() =>
      assertHskVocabularyListSize(listOf(2), expectations),
    ).not.toThrow();
  });

  it("rejects a shortfall below the tolerance", () => {
    expect(() => assertHskVocabularyListSize(listOf(1), expectations)).toThrow(
      /Parsed only 1 of 3 vocabulary entries/,
    );
  });

  it("rejects more entries than the list contains", () => {
    // A surplus means row detection is matching something that is not a word.
    expect(() => assertHskVocabularyListSize(listOf(4), expectations)).toThrow(
      /more than the 3 the list contains/,
    );
  });

  it("rejects a duplicated row number", () => {
    const list = parseHskVocabularyList(
      fixture(
        "2001阿姨 āyí n. auntNeutral",
        "2001阿姨 āyí n. auntNeutral",
        "2002爱护 àihù v. to take good care ofWritten",
      ),
    );

    expect(() => assertHskVocabularyListSize(list, expectations)).toThrow(
      /appear more than once: 2001/,
    );
  });

  it("rejects a term still holding an unmapped radical", () => {
    const list = parseHskVocabularyList(
      fixture(
        "2001⺜姨 āyí n. auntNeutral",
        "2002爱护 àihù v. to take good care ofWritten",
        "2003安装 ānzhuāng v. to installNeutral",
      ),
    );

    expect(() => assertHskVocabularyListSize(list, expectations)).toThrow(
      HskVocabularyParseError,
    );
    expect(() => assertHskVocabularyListSize(list, expectations)).toThrow(
      /U\+2E9C/,
    );
  });

  it("names no vocabulary when it rejects a list", () => {
    const list = parseHskVocabularyList(
      fixture(
        "2001⺜姨 āyí n. auntNeutral",
        "2002爱护 àihù v. to take good care ofWritten",
        "2003安装 ānzhuāng v. to installNeutral",
      ),
    );

    expect(() => assertHskVocabularyListSize(list, expectations)).not.toThrow(
      /阿姨|aunt/,
    );
  });
});
