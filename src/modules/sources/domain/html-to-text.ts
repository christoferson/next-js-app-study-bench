/**
 * An HTML page as the text a reader would see.
 *
 * A deliberately small, deterministic function rather than a parser dependency. The job
 * is not to reconstruct a document — it is to get the prose out of a documentation page
 * so the owner can read it and a model can be grounded in it. A DOM parser would do
 * that better in the hard cases and would also pull a large dependency, a second HTML
 * spec implementation, and a class of parser vulnerabilities into a flow that already
 * fetches attacker-influenced bytes.
 *
 * **This is the sanitisation `spec/SECURITY.md` section 4 requires, and it works by
 * subtraction.** Nothing else in StudyBench ever stores or renders retrieved HTML: this
 * function runs once, at import, and only its plain-text output is hashed, written to
 * object storage, chunked, and displayed. There is no path by which a fetched `<script>`
 * or `onerror=` reaches a browser, because the markup does not survive the import. That
 * is a stronger guarantee than escaping at render time, which depends on every future
 * template getting it right.
 *
 * What it does, in order:
 *
 * 1. Drops `<script>`, `<style>`, `<noscript>`, `<template>`, `<svg>`, and HTML comments
 *    *with their contents*. These are the elements whose text is not prose, and leaving
 *    them in produces chunks of minified JavaScript that a model would happily quote.
 * 2. Turns block-level tags into blank lines and `<br>` into a newline, so paragraphs
 *    survive as paragraphs. The chunker splits on blank lines, so this is what makes a
 *    retrieved page chunk like a document instead of one enormous line.
 * 3. Removes every remaining tag.
 * 4. Decodes the five XML entities plus `&nbsp;` and numeric references.
 * 5. Collapses whitespace: spaces within a line, and runs of blank lines to one.
 *
 * What it deliberately does not do: identify the main content, drop navigation, or
 * handle `<table>` layout. A page's nav links become a short paragraph of link text at
 * the top of the source, which is noise the owner can see in the preview and a model can
 * ignore. Guessing which `<div>` is the article silently deletes content, and being
 * wrong about that is worse than a paragraph of menu items.
 */

/** Elements whose contents are not prose and must go with the tag. */
const DROPPED_ELEMENTS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "head",
] as const;

/** Tags that end a line of prose. */
const BLOCK_ELEMENTS = [
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "dd",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
] as const;

/** Named entities worth decoding. The numeric forms are handled generically. */
const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
  ["hellip", "…"],
  ["mdash", "—"],
  ["ndash", "–"],
  ["rsquo", "’"],
  ["lsquo", "‘"],
  ["rdquo", "”"],
  ["ldquo", "“"],
]);

export function htmlToText(html: string): string {
  let text = html;

  // Comments first: a comment can contain anything, including an unbalanced tag that
  // would otherwise confuse the element removal below.
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, " ");

  for (const element of DROPPED_ELEMENTS) {
    // Non-greedy to the matching close tag, and tolerant of an unterminated one at the
    // end of a truncated response — a page cut off by the size cap must still produce
    // the text it managed to send rather than nothing.
    text = text.replace(
      new RegExp(`<${element}\\b[^>]*>[\\s\\S]*?(?:</${element}\\s*>|$)`, "gi"),
      " ",
    );
  }

  text = text.replace(/<br\b[^>]*\/?>/gi, "\n");

  for (const element of BLOCK_ELEMENTS) {
    text = text.replace(new RegExp(`</?${element}\\b[^>]*>`, "gi"), "\n\n");
  }

  // Whatever is left is inline markup, a doctype, or a processing instruction.
  text = text.replace(/<[^>]*>/g, "");

  text = decodeEntities(text);

  return collapseWhitespace(text);
}

/**
 * Character references, decoded.
 *
 * Decoding happens *after* tag removal, and that order is not an accident: decoding
 * first would turn `&lt;script&gt;` into markup that the tag stripper would then remove,
 * so text that a page deliberately displayed as an example would silently vanish.
 * Decoding last means a stored source shows `<script>` as the words a tutorial wrote,
 * and — because nothing renders this as HTML — that is inert.
 */
function decodeEntities(text: string): string {
  return text.replace(
    // `[xX]`, because `&#X43;` is as valid as `&#x43;` and the branch below already
    // reads both. With a lowercase-only `x` here that branch was unreachable and an
    // uppercase reference survived into the stored text as literal characters.
    /&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, reference: string) => {
      if (reference.startsWith("#")) {
        const isHex = reference[1] === "x" || reference[1] === "X";
        const codepoint = Number.parseInt(
          isHex ? reference.slice(2) : reference.slice(1),
          isHex ? 16 : 10,
        );

        // Surrogates and out-of-range values would throw or produce lone surrogates that
        // cannot be written as UTF-8. Left as written text instead.
        if (
          !Number.isInteger(codepoint) ||
          codepoint < 0x20 ||
          codepoint > 0x10ffff ||
          (codepoint >= 0xd800 && codepoint <= 0xdfff)
        ) {
          return match;
        }

        return String.fromCodePoint(codepoint);
      }

      return NAMED_ENTITIES.get(reference.toLowerCase()) ?? match;
    },
  );
}

/**
 * Whitespace, reduced to what carries meaning.
 *
 * Line structure is kept because the chunker reads it; everything else goes. A
 * documentation page indents its markup, so without this the extracted text is
 * two-thirds spaces, and those spaces would be a third of the input tokens of every
 * grounded prompt.
 */
function collapseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
