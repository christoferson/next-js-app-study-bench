/**
 * Which passages of the owner's sources a request is grounded in, and how they are
 * chosen (`SPEC.md` sections 11.5, 11.6, and 26).
 *
 * **There is no vector database and no embedding model.** `SPEC.md` section 26.2 says so
 * outright, and this file is what fills the gap: a deterministic lexical ranker over the
 * chunks of the sources the owner picked. It is worth being plain about how simple that
 * is — it counts shared words. It does not know that "IAM role" and "temporary
 * credentials" are related, it cannot match across a paraphrase, and a chunk that uses
 * different vocabulary for the same idea will rank below one that repeats the objective's
 * own wording.
 *
 * That is an acceptable trade here for three reasons, and they are the design:
 *
 * 1. **The owner has already done the retrieval.** They chose which sources to ground on,
 *    and slice 1 let them say which objectives each source covers. Selection starts from
 *    a handful of documents the owner picked for this purpose, not from a corpus.
 * 2. **Ranking only decides order and what falls off the end.** Every selected chunk is a
 *    real passage of a real document either way, so a mediocre ranking produces a weaker
 *    prompt, never a false one.
 * 3. **It is explicable.** The owner can look at the evidence panel and see exactly which
 *    paragraphs were used; nothing was retrieved by a similarity score nobody can read.
 *
 * If this proves too blunt in use, the honest upgrade is a real index behind the same
 * function signature — which is why the caller passes candidates in and gets a selection
 * out, rather than this file reaching for a repository.
 *
 * Domain code is framework-free: no React, Next.js, database driver, AWS SDK, or
 * environment access.
 */

/**
 * How many excerpts one request may send.
 *
 * Ten, because that is roughly what a model can hold in view while writing five questions
 * and still attribute each one to a specific passage. More excerpts do not make the
 * grounding better; they make the attribution vaguer, and every one of them is paid for
 * on every request.
 */
export const MAX_GROUNDING_CHUNKS = 10;

/**
 * How much source text one request may send, in characters.
 *
 * The bound `SPEC.md` section 11.6 asks for on source content per request. 12k characters
 * is roughly 3k input tokens — a few tenths of a cent on the configured model, and a
 * prompt where the instructions are still the larger part of what the model reads. The cap
 * is on characters rather than tokens because the character count is something this module
 * can compute exactly and a token count is the provider's own arithmetic.
 *
 * A chunk is never truncated to fit. A half sentence is not evidence, and an excerpt the
 * owner would read back in the evidence panel must be the passage the model was actually
 * shown. Selection stops instead.
 */
export const MAX_GROUNDING_CHARACTERS = 12_000;

/** One chunk offered to the selector, with what it needs to be ranked and shown. */
export interface GroundingCandidate {
  readonly chunkId: string;
  readonly snapshotId: string;
  readonly sourceId: string;
  readonly sourceTitle: string;
  /** Position within its snapshot, which is the tie-breaking document order. */
  readonly chunkIndex: number;
  readonly text: string;
  /**
   * Whether the owner linked this chunk's source to one of the objectives the request
   * names.
   *
   * The strongest signal available, and it is the owner's own judgement rather than
   * anything inferred: they said this document covers this objective. It outranks word
   * overlap entirely — a passage from the right document beats a lexically similar one
   * from a document the owner did not connect to the topic.
   */
  readonly objectiveLinked: boolean;
}

/** One selected excerpt, in the order it is sent, with the index the model cites. */
export interface SelectedExcerpt {
  /**
   * 1-based position in the excerpt list as the model sees it.
   *
   * 1-based because the model is asked to cite these numbers and off-by-one is the
   * mistake to make impossible to make quietly: an answer of `0` is out of range and
   * rejected, rather than being a valid index into a different excerpt.
   */
  readonly index: number;
  readonly candidate: GroundingCandidate;
}

/** What one selection produced, including what it left out and why. */
export interface GroundingSelection {
  readonly excerpts: readonly SelectedExcerpt[];
  /** Snapshot ids the excerpts came from, deduplicated, for the run's provenance. */
  readonly snapshotIds: readonly string[];
  /** How many candidates were available but not sent, because a cap was reached. */
  readonly omittedCount: number;
  readonly totalCharacters: number;
}

/**
 * Words worth matching on.
 *
 * Lowercased, split on anything that is not a letter or a digit, and short tokens
 * dropped. `\p{L}` rather than `a-z` because the owner's other track is Chinese: an HSK
 * objective's keywords are CJK characters, and a tokenizer that only understood ASCII
 * would score every Chinese source at zero and silently fall back to document order.
 *
 * CJK text has no spaces, so for those scripts this splits on punctuation and produces
 * long tokens that rarely match. That is a real limitation of lexical matching without a
 * segmenter, and it is why the objective link outranks overlap: for a Chinese source the
 * owner's own mapping is doing the work, and the word score contributes little.
 */
function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH);
}

/**
 * The shortest token worth scoring.
 *
 * Three characters, which drops "a", "of", "to", and "the" without needing a stop-word
 * list in every language the product supports. A stop-word list would be a second thing
 * to be wrong about per language; a length floor is wrong the same way everywhere.
 */
const MIN_TOKEN_LENGTH = 3;

/**
 * Distinct query words, from whatever text describes what the request is about.
 *
 * Deduplicated, because a keyword repeated in the objective title should not count twice
 * against a chunk that mentions it once.
 */
export function groundingKeywords(
  parts: readonly (string | null)[],
): ReadonlySet<string> {
  return new Set(
    parts.flatMap((part) => (part === null ? [] : [...tokenize(part)])),
  );
}

/**
 * How well one chunk matches the query words.
 *
 * The fraction of query words the chunk mentions, not the raw count. A fraction so that a
 * long chunk does not win simply by containing more words — the question is how much of
 * what was asked about this passage covers, and a passage that mentions four of five
 * keywords is a better excerpt than one that mentions the same four out of twenty.
 *
 * Zero when there is nothing to match against, which is what makes the no-objective case
 * fall through to document order rather than to an arbitrary ranking.
 */
export function lexicalOverlap(
  text: string,
  keywords: ReadonlySet<string>,
): number {
  if (keywords.size === 0) {
    return 0;
  }

  const present = new Set(tokenize(text));
  let matched = 0;

  for (const keyword of keywords) {
    if (present.has(keyword)) {
      matched += 1;
    }
  }

  return matched / keywords.size;
}

/**
 * Chooses the excerpts one grounded request is built from.
 *
 * The order is: chunks whose source the owner linked to a requested objective first, then
 * by word overlap, then by document position — source order, then chunk index. The last
 * tie-break is what makes the whole function deterministic: with no objectives chosen
 * every score is zero, so the selection is simply the first chunks of the chosen sources
 * in the order they were offered, which is the honest answer to "ground this on my exam
 * guide" with nothing narrower said.
 *
 * Both caps are applied while filling. A chunk that would take the total over the
 * character budget is skipped rather than truncated, and the fill continues — a single
 * enormous chunk should not end the selection when three small relevant ones would still
 * fit. Everything not sent is counted, so the owner can be told the request was bounded
 * rather than complete.
 */
export function selectGroundingExcerpts(
  candidates: readonly GroundingCandidate[],
  keywords: ReadonlySet<string>,
  limits: {
    readonly maxChunks?: number;
    readonly maxCharacters?: number;
  } = {},
): GroundingSelection {
  const maxChunks = limits.maxChunks ?? MAX_GROUNDING_CHUNKS;
  const maxCharacters = limits.maxCharacters ?? MAX_GROUNDING_CHARACTERS;
  const scored = candidates.map((candidate, position) => ({
    candidate,
    position,
    score: lexicalOverlap(candidate.text, keywords),
  }));

  scored.sort((left, right) => {
    if (left.candidate.objectiveLinked !== right.candidate.objectiveLinked) {
      return left.candidate.objectiveLinked ? -1 : 1;
    }

    if (left.score !== right.score) {
      return right.score - left.score;
    }

    return left.position - right.position;
  });

  const excerpts: SelectedExcerpt[] = [];
  let totalCharacters = 0;
  let omittedCount = 0;

  for (const entry of scored) {
    const length = entry.candidate.text.length;

    if (
      excerpts.length >= maxChunks ||
      totalCharacters + length > maxCharacters
    ) {
      omittedCount += 1;
      continue;
    }

    totalCharacters += length;
    excerpts.push({ index: excerpts.length + 1, candidate: entry.candidate });
  }

  return {
    excerpts,
    snapshotIds: [
      ...new Set(excerpts.map((excerpt) => excerpt.candidate.snapshotId)),
    ],
    omittedCount,
    totalCharacters,
  };
}

/**
 * Which excerpts a model claimed support one item, narrowed to the ones it was shown.
 *
 * Out-of-range indexes are dropped rather than rejecting the whole item, and duplicates
 * collapse. The caller decides what an empty result means, because that differs by mode:
 * for `SOURCE_GROUNDED` an item supported by nothing is not grounded and is rejected, and
 * for `HYBRID` it is a legitimate item whose framing came from the model's own knowledge
 * (`deterministic-checks.ts`).
 */
export function resolveSupportingChunkIds(
  claimed: readonly number[],
  excerpts: readonly SelectedExcerpt[],
): readonly string[] {
  const byIndex = new Map(
    excerpts.map((excerpt) => [excerpt.index, excerpt.candidate.chunkId]),
  );

  return [
    ...new Set(
      claimed.flatMap((index) => {
        const chunkId = byIndex.get(index);

        return chunkId === undefined ? [] : [chunkId];
      }),
    ),
  ];
}
