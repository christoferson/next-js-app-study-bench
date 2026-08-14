/**
 * Text repairs that a PDF text extraction always needs.
 *
 * Shared rather than script-side: these repairs were written for
 * `npm run import:real`, and the objective import needs exactly the same ones on
 * exactly the same kind of input — text pulled out of a PDF at request time. The file
 * moved from `src/import/` to `@/shared` when the second caller arrived, because a
 * request-time module importing from a `tsx` script directory would be the wrong
 * dependency direction. Nothing about the functions changed; they are pure string
 * work over Unicode facts and depend on nothing.
 *
 * A PDF stores what the typesetter drew rather than what an author typed. Two
 * substitutions therefore have to be undone before anything is parsed or stored, and
 * both are pure string work, which is why they live here rather than in a parser:
 *
 * - **Typographic ligatures.** "configure" is drawn as `conﬁgure` (U+FB01), so a
 *   naive parse stores a word that no search for "configure" will ever match.
 * - **Kangxi radicals and CJK radical supplements.** Some Chinese characters are
 *   drawn with the radical codepoint rather than the ordinary CJK one — `⽩`
 *   (U+2F69) instead of `白` (U+767D). They look nearly identical and are a
 *   different character to every comparison, so a card stored that way is
 *   unsearchable and would not match anything the owner types.
 *
 * Nothing here is source-specific: no vocabulary, no exam wording, and no
 * copyrighted text is embedded in this repository (`spec/SECURITY.md`). The
 * tables below are Unicode facts.
 */

/** Ligature codepoints that appear in the extracted text, and their letters. */
const LIGATURES: ReadonlyMap<string, string> = new Map([
  ["ﬀ", "ff"],
  ["ﬁ", "fi"],
  ["ﬂ", "fl"],
  ["ﬃ", "ffi"],
  ["ﬄ", "ffl"],
  ["ﬅ", "st"],
  ["ﬆ", "st"],
]);

/**
 * Replaces Latin ligatures with the letters they stand for.
 *
 * Applied to both sources: the exam guide writes `conﬁgure` and `eﬃciency`, and
 * the vocabulary list writes English meanings such as `to ﬁx`.
 */
export function normalizeLigatures(text: string): string {
  return text.replace(/[ﬀ-ﬆ]/g, (ligature) => {
    return LIGATURES.get(ligature) ?? ligature;
  });
}

/**
 * Extracted document text, tidied enough to send to a model.
 *
 * Three repairs, and each earns its place on real PDF output. Ligatures, for the
 * reason above. Carriage returns, because a PDF extracted on Windows produces `\r\n`
 * and the delimiters the prompt wraps this text in are line-based. And runs of blank
 * lines and trailing spaces, because column layout produces pages of them — on the
 * owner's own exam guide that is a double-digit percentage of the characters, which
 * is a double-digit percentage of the input tokens for nothing.
 *
 * What it deliberately does *not* do is join wrapped lines, strip page numbers, or
 * drop headers. Those are judgements about a specific document's layout, and getting
 * them wrong silently deletes syllabus content; the model is much better placed to
 * ignore a stray page number than this function is to decide which line is one.
 */
export function normalizeExtractedText(text: string): string {
  return normalizeLigatures(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Kangxi Radicals: U+2F00–U+2FDF. */
const KANGXI_RADICALS_START = 0x2f00;
const KANGXI_RADICALS_END = 0x2fdf;

/** CJK Radicals Supplement: U+2E80–U+2EFF. */
const RADICALS_SUPPLEMENT_START = 0x2e80;
const RADICALS_SUPPLEMENT_END = 0x2eff;

/**
 * Radicals that Unicode compatibility normalization cannot fix, or fixes wrongly.
 *
 * Two groups, and both are needed:
 *
 * - The **CJK Radicals Supplement** block has no compatibility decomposition at
 *   all, so `NFKC` leaves `⻋` (U+2ECB) exactly as it is. These are the
 *   simplified radical forms, so each one maps to its simplified character.
 * - One **Kangxi** radical decomposes to the *traditional* character: `⼾`
 *   (U+2F3E) becomes `戶`, not `户`. A simplified-Chinese vocabulary list must
 *   not gain a traditional character during normalization, so it is overridden
 *   here.
 *
 * Every entry was checked against the word it appears in — `⻋祸` is `车祸`,
 * `客⼾` is `客户` — so this table is not a guess about which form is intended.
 */
const RADICAL_OVERRIDES: ReadonlyMap<string, string> = new Map([
  // Kangxi radical whose compatibility mapping is the traditional form.
  ["⼾", "户"], // ⼾ → 户
  // CJK Radicals Supplement: no compatibility mapping exists.
  ["⺠", "民"], // ⺠ → 民
  ["⺟", "母"], // ⺟ → 母
  ["⻅", "见"], // ⻅ → 见
  ["⻆", "角"], // ⻆ → 角
  ["⻉", "贝"], // ⻉ → 贝
  ["⻋", "车"], // ⻋ → 车
  ["⻓", "长"], // ⻓ → 长
  ["⻔", "门"], // ⻔ → 门
  ["⻘", "青"], // ⻘ → 青
  ["⻛", "风"], // ⻛ → 风
  ["⻜", "飞"], // ⻜ → 飞
  ["⻝", "食"], // ⻝ → 食
  ["⻩", "黄"], // ⻩ → 黄
  ["⻬", "齐"], // ⻬ → 齐
  ["⻮", "齿"], // ⻮ → 齿
  ["⻰", "龙"], // ⻰ → 龙
]);

function isRadicalCodepoint(codepoint: number): boolean {
  return (
    (codepoint >= KANGXI_RADICALS_START && codepoint <= KANGXI_RADICALS_END) ||
    (codepoint >= RADICALS_SUPPLEMENT_START &&
      codepoint <= RADICALS_SUPPLEMENT_END)
  );
}

/**
 * Rewrites radical codepoints as the ordinary CJK characters they depict.
 *
 * The override table is consulted first, then Unicode compatibility
 * normalization (`NFKC`) for the plain Kangxi cases, which is what turns `⽩`
 * into `白`. A character that is neither is left alone and reported by
 * `findUnmappedRadicals`, so a source that starts using a radical this table
 * does not know about fails the import loudly instead of storing a word the
 * owner can never find.
 */
export function normalizeCjkRadicals(text: string): string {
  let normalized = "";

  for (const character of text) {
    const codepoint = character.codePointAt(0);

    if (codepoint === undefined || !isRadicalCodepoint(codepoint)) {
      normalized += character;
      continue;
    }

    const override = RADICAL_OVERRIDES.get(character);

    if (override !== undefined) {
      normalized += override;
      continue;
    }

    const decomposed = character.normalize("NFKC");

    normalized += decomposed === character ? character : decomposed;
  }

  return normalized;
}

/**
 * Radical codepoints still present after normalization, without duplicates.
 *
 * Returned as characters rather than thrown, so the caller decides whether an
 * unknown radical is a warning or a failure, and so no vocabulary line has to be
 * quoted to report the problem.
 */
export function findUnmappedRadicals(text: string): readonly string[] {
  const found = new Set<string>();

  for (const character of text) {
    const codepoint = character.codePointAt(0);

    if (codepoint !== undefined && isRadicalCodepoint(codepoint)) {
      found.add(character);
    }
  }

  return [...found];
}
