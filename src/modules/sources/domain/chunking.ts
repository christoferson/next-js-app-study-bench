/**
 * Splitting one document into passages a model can be given.
 *
 * There is no vector database and there will not be one (`SPEC.md` section 26.2), so
 * chunking is not an indexing step here — it is how a citation gets a size. A question
 * generated from a source must be able to say *which passage* it came from, and a
 * passage has to be small enough that reading it verifies the question and large
 * enough that it still means something on its own.
 *
 * The algorithm, in full:
 *
 * 1. Split the text into blocks on blank lines. A blank line is the one boundary that
 *    every input this application accepts agrees on — markdown paragraphs, pasted
 *    notes, and `normalizeExtractedText`'s output, which puts a blank line between PDF
 *    pages and collapses longer runs to exactly one.
 * 2. Fill a chunk with whole blocks while it fits inside the target size.
 * 3. A block that is itself larger than the target is split on sentence ends, and a
 *    sentence longer than the target is split on whitespace, and a single unbroken run
 *    longer than the target is cut at the target. Each fallback is only reached when
 *    the previous one cannot apply.
 *
 * Three properties matter more than chunk quality, because slice 2 depends on them:
 *
 * - **Deterministic.** The same text always produces the same chunks. Nothing consults
 *   a clock, a random source, or a token counter that could change with a model.
 * - **Offsets are exact.** `text.slice(charStart, charEnd)` is the chunk's text with
 *   whitespace trimmed off each end, and offsets are into the *snapshot* text, so a
 *   citation can be shown in its surroundings.
 * - **Lossless in substance.** Every non-whitespace character of the input lands in
 *   exactly one chunk. Chunks do not overlap, which is why there is no overlap
 *   parameter: overlap exists to stop a retriever from cutting an answer in half, and
 *   the owner selects whole sources here rather than a retriever selecting passages.
 *
 * Character counts rather than tokens, deliberately. A token count would tie stored
 * chunk boundaries to one model's tokeniser, and re-chunking every snapshot on a model
 * change is a migration nobody wants for a bound that is approximate either way.
 */

/**
 * Target chunk size in characters.
 *
 * Roughly 300–400 English tokens, or a long paragraph: enough that a passage states a
 * complete idea, small enough that ten of them still fit in a prompt beside the
 * instructions. A soft target, not a maximum — a block of `TARGET + 20` characters is
 * kept whole rather than cut, because a chunk that ends mid-sentence to satisfy a
 * round number is worse than one slightly over it.
 */
export const TARGET_CHUNK_CHARS = 1500;

/**
 * How far over the target a block may be and still be kept whole.
 *
 * Without this, a 1520-character paragraph becomes a 1500-character chunk and a
 * 20-character one, and the second is useless on its own.
 */
export const CHUNK_SLACK_CHARS = 300;

/** One passage, and where it sits in the text it came from. */
export interface TextChunk {
  readonly text: string;
  /** Half-open offsets into the input: `[charStart, charEnd)`. */
  readonly charStart: number;
  readonly charEnd: number;
}

/** A span of the input, before it is trimmed into a chunk. */
interface Span {
  readonly start: number;
  readonly end: number;
}

/**
 * The document, as chunks.
 *
 * Empty input, or input that is nothing but whitespace, produces no chunks rather than
 * one empty one. The caller decides whether that is an error; for an imported source it
 * is, and the facade rejects it before ever reaching here.
 */
export function chunkText(
  text: string,
  options: {
    readonly targetChars?: number;
    readonly slackChars?: number;
  } = {},
): readonly TextChunk[] {
  const target = options.targetChars ?? TARGET_CHUNK_CHARS;
  const slack = options.slackChars ?? CHUNK_SLACK_CHARS;

  if (target < 1) {
    throw new Error("A chunk target must be at least one character.");
  }

  const chunks: TextChunk[] = [];
  let pending: Span | null = null;

  /** Emits whatever has accumulated, if it holds anything. */
  const flush = (): void => {
    if (pending !== null) {
      const chunk = toChunk(text, pending);

      if (chunk !== null) {
        chunks.push(chunk);
      }

      pending = null;
    }
  };

  for (const block of blockSpans(text)) {
    for (const piece of splitOversized(text, block, target, slack)) {
      const length = piece.end - piece.start;

      if (pending === null) {
        pending = piece;
        continue;
      }

      // The gap between the two pieces counts: it is the blank line that separates
      // them, and it will be inside the chunk's own offsets.
      const combined = piece.end - pending.start;

      if (combined <= target + slack) {
        pending = { start: pending.start, end: piece.end };
        continue;
      }

      flush();
      pending = { start: piece.start, end: piece.start + length };
    }
  }

  flush();

  return chunks;
}

/**
 * Spans of the input separated by blank lines, in order.
 *
 * Returned as offsets rather than strings so that every later step can keep reporting
 * positions in the original text. A `split()` on the string would lose exactly the
 * information the chunk offsets exist to carry.
 */
function blockSpans(text: string): readonly Span[] {
  const spans: Span[] = [];
  const separator = /\n[ \t]*\n/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = separator.exec(text)) !== null) {
    spans.push({ start: cursor, end: match.index });
    cursor = match.index + match[0].length;
  }

  spans.push({ start: cursor, end: text.length });

  return spans.filter((span) => text.slice(span.start, span.end).trim() !== "");
}

/**
 * One block, cut down to pieces no larger than the target allows.
 *
 * A block that fits is returned unchanged, which is the common case: a paragraph is
 * usually a few hundred characters. The recursive-looking structure is three ordered
 * strategies, each tried only when the previous cannot apply — sentence ends, then
 * whitespace, then a hard cut — so a wall of text with no punctuation and no spaces
 * still terminates.
 */
function splitOversized(
  text: string,
  block: Span,
  target: number,
  slack: number,
): readonly Span[] {
  if (block.end - block.start <= target + slack) {
    return [block];
  }

  const pieces: Span[] = [];
  let cursor = block.start;

  while (block.end - cursor > target + slack) {
    const limit = cursor + target;
    const cut =
      lastIndexOfSentenceEnd(text, cursor, limit) ??
      lastIndexOfWhitespace(text, cursor, limit) ??
      limit;

    pieces.push({ start: cursor, end: cut });
    cursor = cut;
  }

  pieces.push({ start: cursor, end: block.end });

  return pieces;
}

/**
 * The end of the last sentence that finishes at or before `limit`.
 *
 * Two families of sentence end, and they need different rules:
 *
 * - **Latin** `.`, `!`, `?`, `…` count only when whitespace or the limit follows. Without
 *   that condition, `AWS S3.Standard`, `v1.2`, and `e.g.` would all be cut mid-token, and
 *   a full stop inside a version number is far commoner in a technical exam guide than one
 *   at the end of a line is rare.
 * - **CJK** `。`, `！`, `？` count wherever they appear. These are full-width, they are
 *   used for nothing but sentence ends, and Chinese text puts no space after them — so
 *   requiring one would reject every sentence boundary in a Chinese document and fall
 *   through to the whitespace strategy, which in text with no spaces at all means the hard
 *   cut. That is precisely the failure the CJK punctuation is listed here to prevent, and
 *   it was the behaviour before the split below existed.
 *
 * Returns the offset *after* the punctuation and any following spaces, so the next piece
 * starts at a word. `null` when there is no sentence end late enough to be worth using — a
 * cut in the first quarter of a chunk would produce a stub, so the whitespace strategy gets
 * a chance instead.
 */
function lastIndexOfSentenceEnd(
  text: string,
  start: number,
  limit: number,
): number | null {
  const minimum = start + Math.floor((limit - start) / 4);

  for (let index = limit - 1; index > minimum; index -= 1) {
    const character = text[index];

    if (character === undefined) {
      continue;
    }

    if (isCjkSentenceEnd(character)) {
      return skipWhitespace(text, index + 1, limit);
    }

    if (!isLatinSentenceEnd(character)) {
      continue;
    }

    const next = text[index + 1];

    if (next === undefined || /\s/.test(next)) {
      return skipWhitespace(text, index + 1, limit);
    }
  }

  return null;
}

/** Full-width sentence-ending punctuation, which is self-delimiting. */
function isCjkSentenceEnd(character: string): boolean {
  return "。！？".includes(character);
}

function isLatinSentenceEnd(character: string): boolean {
  return ".!?…".includes(character);
}

/** The last whitespace run at or before `limit`, or `null` if there is none late. */
function lastIndexOfWhitespace(
  text: string,
  start: number,
  limit: number,
): number | null {
  const minimum = start + Math.floor((limit - start) / 4);

  for (let index = limit - 1; index > minimum; index -= 1) {
    const character = text[index];

    if (character !== undefined && /\s/.test(character)) {
      return skipWhitespace(text, index, limit);
    }
  }

  return null;
}

/** The first non-whitespace offset at or after `from`, bounded by `limit`. */
function skipWhitespace(text: string, from: number, limit: number): number {
  let index = from;

  while (index < limit) {
    const character = text[index];

    if (character === undefined || !/\s/.test(character)) {
      break;
    }

    index += 1;
  }

  return index;
}

/**
 * One span as a chunk, with the surrounding whitespace excluded from the offsets.
 *
 * Trimming the *offsets* rather than only the text is what keeps
 * `text.slice(charStart, charEnd) === chunk.text` true, which is the invariant that
 * lets slice 2 highlight a citation inside the document without storing anything
 * twice.
 */
function toChunk(text: string, span: Span): TextChunk | null {
  let start = span.start;
  let end = span.end;

  while (start < end && /\s/.test(text[start] ?? "")) {
    start += 1;
  }

  while (end > start && /\s/.test(text[end - 1] ?? "")) {
    end -= 1;
  }

  return start === end
    ? null
    : { text: text.slice(start, end), charStart: start, charEnd: end };
}
