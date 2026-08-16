import { describe, expect, it } from "vitest";
import { htmlToText } from "./html-to-text";

/**
 * The sanitisation `spec/SECURITY.md` section 4 requires, tested as subtraction.
 *
 * The guarantee is not "the output is escaped" but "the markup did not survive the
 * import", so most assertions here are that something is *absent* from the result. A
 * `<script>` body, an `onerror=` attribute, and a comment are all things that must not be
 * in the text that gets hashed, stored, chunked, and rendered.
 */

describe("dropped elements", () => {
  it("drops a script tag with its contents", () => {
    const text = htmlToText(
      "<p>Before</p><script>alert('xss'); var x = 1;</script><p>After</p>",
    );

    expect(text).not.toContain("alert");
    expect(text).not.toContain("var x");
    expect(text).toContain("Before");
    expect(text).toContain("After");
  });

  it("drops a style tag with its rules", () => {
    const text = htmlToText("<style>body { color: red; }</style><p>Prose</p>");

    expect(text).not.toContain("color");
    expect(text).not.toContain("{");
    expect(text).toBe("Prose");
  });

  it("drops noscript, template, svg, and head with their contents", () => {
    const text = htmlToText(
      [
        "<head><title>Page title</title></head>",
        "<noscript>Enable JavaScript</noscript>",
        "<template>Row template</template>",
        "<svg><path d='M0 0'/><text>Chart label</text></svg>",
        "<p>Prose</p>",
      ].join(""),
    );

    expect(text).toBe("Prose");
  });

  it("drops a script with attributes on its opening tag", () => {
    const text = htmlToText(
      '<script type="text/javascript" src="x.js">payload()</script><p>Prose</p>',
    );

    expect(text).not.toContain("payload");
    expect(text).not.toContain("text/javascript");
    expect(text).toBe("Prose");
  });

  it("drops an unterminated script at the end of a truncated response", () => {
    // A page cut off by the size cap must still yield the prose it managed to send.
    const text = htmlToText("<p>Prose</p><script>alert('cut off'");

    expect(text).not.toContain("alert");
    expect(text).toBe("Prose");
  });

  it("is case insensitive about which elements it drops", () => {
    expect(htmlToText("<SCRIPT>alert(1)</SCRIPT><P>Prose</P>")).toBe("Prose");
    expect(htmlToText("<Style>a{}</Style><p>Prose</p>")).toBe("Prose");
  });

  it("drops each of several scripts on one page", () => {
    const text = htmlToText(
      "<script>one()</script><p>Prose</p><script>two()</script>",
    );

    expect(text).toBe("Prose");
  });
});

describe("comments", () => {
  it("drops an HTML comment", () => {
    expect(htmlToText("<p>Before<!-- a note -->After</p>")).toBe(
      "Before After",
    );
  });

  it("drops a comment containing an unbalanced tag", () => {
    // Comments go first precisely so a stray `<script>` inside one cannot confuse the
    // element removal that follows.
    const text = htmlToText("<!-- <script> --><p>Prose</p>");

    expect(text).toBe("Prose");
  });

  it("drops a multi-line comment", () => {
    expect(htmlToText("<p>A</p><!--\nline\nline\n--><p>B</p>")).toBe("A\n\nB");
  });

  it("drops a CDATA section", () => {
    expect(htmlToText("<p>A<![CDATA[raw < & > data]]>B</p>")).toBe("A B");
  });
});

describe("block structure", () => {
  it("turns paragraphs into blank-line separated blocks", () => {
    // The chunker splits on blank lines, so this is what makes a retrieved page chunk
    // like a document instead of one enormous line.
    expect(htmlToText("<p>First</p><p>Second</p>")).toBe("First\n\nSecond");
  });

  it("turns a br into a single newline", () => {
    expect(htmlToText("<p>First<br>Second</p>")).toBe("First\nSecond");
    expect(htmlToText("<p>First<br/>Second</p>")).toBe("First\nSecond");
    expect(htmlToText('<p>First<br class="x" />Second</p>')).toBe(
      "First\nSecond",
    );
  });

  it("breaks lines for headings, list items, and table cells", () => {
    expect(htmlToText("<h1>Title</h1><p>Body</p>")).toBe("Title\n\nBody");
    expect(htmlToText("<ul><li>One</li><li>Two</li></ul>")).toBe("One\n\nTwo");
    expect(htmlToText("<table><tr><td>A</td><td>B</td></tr></table>")).toBe(
      "A\n\nB",
    );
  });

  it("breaks lines for divs and sections", () => {
    expect(htmlToText("<div>A</div><section>B</section>")).toBe("A\n\nB");
  });

  it("does not break a line for inline markup", () => {
    expect(
      htmlToText("<p>A <strong>bold</strong> and <em>italic</em> word</p>"),
    ).toBe("A bold and italic word");
  });

  it("keeps navigation as a short block rather than guessing at the main content", () => {
    // Deliberately not readability extraction: silently deleting the article is worse
    // than a paragraph of menu items the owner can see in the preview.
    const text = htmlToText(
      "<nav><a href='/a'>Home</a> <a href='/b'>Docs</a></nav><main><p>Article</p></main>",
    );

    expect(text).toContain("Home");
    expect(text).toContain("Docs");
    expect(text).toContain("Article");
  });
});

describe("tags and attributes", () => {
  it("strips every remaining tag", () => {
    const text = htmlToText("<p>Prose <span>inside</span> a span</p>");

    expect(text).not.toContain("<");
    expect(text).not.toContain(">");
    expect(text).toBe("Prose inside a span");
  });

  it("does not leak attribute values into the text", () => {
    const text = htmlToText(
      '<p class="lead" data-id="42"><a href="https://example.test/deep">Link</a></p>',
    );

    expect(text).toBe("Link");
    expect(text).not.toContain("example.test");
    expect(text).not.toContain("lead");
    expect(text).not.toContain("42");
  });

  it("does not leak an event handler attribute", () => {
    const text = htmlToText(
      '<img src="x" onerror="fetch(\'/steal\')" alt="Diagram">',
    );

    expect(text).not.toContain("onerror");
    expect(text).not.toContain("steal");
    expect(text).not.toContain("Diagram");
  });

  it("strips a doctype and a processing instruction", () => {
    expect(htmlToText("<!DOCTYPE html><?xml version='1.0'?><p>Prose</p>")).toBe(
      "Prose",
    );
  });
});

describe("entities", () => {
  it("decodes the five XML entities", () => {
    expect(htmlToText("<p>&amp; &lt; &gt; &quot; &apos;</p>")).toBe(
      "& < > \" '",
    );
  });

  it("decodes a non-breaking space as a plain space", () => {
    expect(htmlToText("<p>A&nbsp;B</p>")).toBe("A B");
  });

  it("decodes the punctuation entities a documentation page uses", () => {
    expect(
      htmlToText("<p>&hellip;&mdash;&ndash;&rsquo;&lsquo;&rdquo;&ldquo;</p>"),
    ).toBe("…—–’‘”“");
  });

  it("decodes decimal and hexadecimal numeric references", () => {
    expect(htmlToText("<p>&#65;&#x42;</p>")).toBe("AB");
    expect(htmlToText("<p>&#8230;</p>")).toBe("…");
    expect(htmlToText("<p>&#x2026;</p>")).toBe("…");
  });

  it("decodes an uppercase-X hexadecimal reference", () => {
    // `&#X43;` is as valid as `&#x43;`. The reference pattern admitted a lowercase `x`
    // only, which left the decoder's own uppercase branch unreachable and an uppercase
    // reference sitting in the stored text as literal characters.
    expect(htmlToText("<p>&#X43;</p>")).toBe("C");
  });

  it("decodes a named entity whatever its case", () => {
    expect(htmlToText("<p>&AMP; &Nbsp;X</p>")).toBe("& X");
  });

  it("leaves an unknown entity as written", () => {
    expect(htmlToText("<p>&frac12; &notanentity;</p>")).toBe(
      "&frac12; &notanentity;",
    );
  });

  it("leaves a surrogate or out-of-range reference as written", () => {
    // Decoding these would produce a lone surrogate that cannot be written as UTF-8.
    expect(htmlToText("<p>&#xD800;</p>")).toBe("&#xD800;");
    expect(htmlToText("<p>&#x110000;</p>")).toBe("&#x110000;");
    expect(htmlToText("<p>&#0;</p>")).toBe("&#0;");
  });

  it("decodes after stripping tags, so an escaped example survives as words", () => {
    // Decoding first would turn this into markup the tag stripper then deleted, so a
    // tutorial's own example would silently vanish.
    expect(htmlToText("<p>Write &lt;script&gt; to add a script.</p>")).toBe(
      "Write <script> to add a script.",
    );
  });

  it("does not re-strip a tag that decoding produced", () => {
    const text = htmlToText("<p>&lt;div class=&quot;x&quot;&gt;</p>");

    expect(text).toBe('<div class="x">');
  });
});

describe("whitespace", () => {
  it("collapses runs of spaces within a line", () => {
    expect(htmlToText("<p>A      B\t\tC</p>")).toBe("A B C");
  });

  it("collapses runs of blank lines to one", () => {
    expect(
      htmlToText("<div><div><div><p>A</p></div></div></div><p>B</p>"),
    ).toBe("A\n\nB");
  });

  it("normalises Windows and classic Mac line endings", () => {
    expect(htmlToText("A\r\nB\rC")).toBe("A\nB\nC");
  });

  it("removes the spaces around a line break", () => {
    expect(htmlToText("<p>A   </p>   <p>   B</p>")).toBe("A\n\nB");
  });

  it("trims the whole document", () => {
    expect(htmlToText("\n\n  <p>Prose</p>  \n\n")).toBe("Prose");
  });

  it("returns an empty string for markup with no prose in it", () => {
    expect(htmlToText("")).toBe("");
    expect(htmlToText("<html><head><title>T</title></head></html>")).toBe("");
    expect(htmlToText("   \n  ")).toBe("");
  });
});

describe("a whole page", () => {
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <title>Durability &amp; storage</title>
    <style>body { margin: 0 }</style>
  </head>
  <body onload="track()">
    <!-- navigation -->
    <nav><a href="/">Home</a></nav>
    <main>
      <h1>Object storage</h1>
      <p>Objects are stored redundantly across &gt;=3 zones.</p>
      <ul><li>Eleven nines</li><li>Versioning</li></ul>
    </main>
    <script>window.analytics.push("pageview");</script>
  </body>
</html>`;

  it("yields the prose a reader would see", () => {
    expect(htmlToText(html)).toBe(
      [
        "Home",
        "Object storage",
        "Objects are stored redundantly across >=3 zones.",
        "Eleven nines",
        "Versioning",
      ].join("\n\n"),
    );
  });

  it("carries no markup, attribute, or script residue at all", () => {
    const text = htmlToText(html);

    // No tag-shaped residue. The lone `>` in ">=3" is prose the page escaped as
    // `&gt;`, and it is meant to survive.
    expect(text).not.toMatch(/<\/?[a-zA-Z][^>]*>/);
    expect(text).not.toContain("analytics");
    expect(text).not.toContain("onload");
    expect(text).not.toContain("margin");
    expect(text).not.toContain("Durability");
  });

  it("is deterministic", () => {
    expect(htmlToText(html)).toBe(htmlToText(html));
  });
});
