import type { IsoTimestamp } from "@/platform/clock";
import type { CertificationId } from "@/modules/certifications/domain/certification";
import type { ObjectiveId } from "@/modules/certifications/domain/objective";
import type { GroundingCandidate } from "@/modules/ai-generation/domain/source-grounding";

/**
 * What grounded generation needs to read from, and write to, the source library.
 *
 * **Why this port lives in ai-generation rather than in sources.** The dependency
 * direction is `sources ← ai-generation` (`spec/ARCHITECTURE.md` section 7): generation
 * may know that a source library exists, and the library must not know that generation
 * does. Two of the three operations here are firmly on generation's side of that line —
 * `question_source_links` is a table generation writes and nothing else reads, and
 * "which questions were built on a superseded snapshot" is a question about the bank
 * rather than about the library. Putting them in `SourceRepository` would have made the
 * source module carry a table it has no use for and join to `questions`, which is the
 * dependency pointing the wrong way.
 *
 * The chunk-candidate query reads source tables, and that is the one place this port
 * reaches across. It is a read, it is expressed here rather than by importing the source
 * module's SQL, and the alternative — loading every chunk of every chosen source through
 * `SourceRepository.listChunks` and joining in memory — would mean reading a whole exam
 * guide to select ten paragraphs from it.
 *
 * **There is no update or delete for a link.** A link records that a question was built
 * from a passage, which is a historical fact: the passage is immutable, and the question
 * having been written from it does not stop being true when the question is edited.
 * `deleteLinksForQuestion` exists only because a deleted question's evidence is evidence
 * of nothing, and it is called from the delete paths that already clear the question's
 * other links.
 */

/**
 * One active source, as much of it as choosing between them needs.
 *
 * Not a `Source`. Returning the source module's aggregate through this port would make
 * generation depend on that type's shape, and the two things the owner picks a source by on
 * the generate form are its title and what kind of document it is.
 */
export interface GroundingSourceSummary {
  readonly id: string;
  readonly title: string;
  readonly sourceType: string;
}

/** One question's evidence, resolved for display. */
export interface QuestionEvidence {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly snapshotId: string;
  /** When the snapshot this passage belongs to was read. */
  readonly retrievedAt: IsoTimestamp;
  readonly chunkIndex: number;
  readonly text: string;
  /**
   * Whether the passage's source has been read again since, producing a newer snapshot.
   *
   * Computed by the query rather than stored (see migration 0015): a column would need a
   * writer on the refresh path and would be wrong for every question written before that
   * writer existed. This is the "outdated-question detection" of `SPEC.md` section 26.2 —
   * a notice the owner reads, not a quality status the application sets behind them.
   */
  readonly supersededByNewerSnapshot: boolean;
}

export interface SourceGroundingRepository {
  /**
   * Chunks of the given sources' newest snapshots, ready to be ranked.
   *
   * Newest snapshot only. Grounding a new question on superseded text would be writing a
   * question that is outdated the moment it is created, and an older snapshot is kept so
   * that existing evidence stays readable rather than so that new questions can use it.
   *
   * `objectiveIds` decides only the `objectiveLinked` flag on each candidate — no
   * filtering. A source the owner picked but did not link to the chosen objective is
   * still a source they picked, and dropping its chunks would silently ignore an explicit
   * instruction; ranking them below the linked ones is the honest reading of both signals
   * (`domain/source-grounding.ts`).
   *
   * Returned in a deterministic order — source, then chunk index — because that order is
   * the selector's final tie-break and therefore part of what makes a selection
   * reproducible.
   */
  listGroundingCandidates(input: {
    readonly certificationId: CertificationId;
    readonly sourceIds: readonly string[];
    readonly objectiveIds: readonly ObjectiveId[];
  }): Promise<readonly GroundingCandidate[]>;

  /**
   * Every active source of one track, for the source check.
   *
   * The check has no source picker: the owner is asking "do my documents agree with this
   * question", and making them choose which documents to ask would be making them guess
   * where the answer is. So the candidate query is given the whole active library and the
   * ranker narrows it.
   *
   * Identifiers only. A full `Source` would mean this port returning another module's
   * aggregate, and nothing here needs the title until the excerpts are chosen.
   */
  listCheckableSourceIds(
    certificationId: CertificationId,
  ): Promise<readonly string[]>;

  /**
   * Every active source of one track, for the generate form's picker.
   *
   * Active only: grounding a new question on a document the owner archived would be using
   * material they have said they no longer study from. An archived source keeps its existing
   * evidence readable, which is a different question and a different query.
   */
  listGroundableSources(
    certificationId: CertificationId,
  ): Promise<readonly GroundingSourceSummary[]>;

  /** Records which passages one question was built from. */
  createLinks(input: {
    readonly questionId: string;
    readonly chunkIds: readonly string[];
    readonly occurredAt: IsoTimestamp;
  }): Promise<void>;

  /** One question's evidence, in the order the passages appear in their documents. */
  listEvidence(questionId: string): Promise<readonly QuestionEvidence[]>;

  /** Clears one question's links, for the delete paths. */
  deleteLinksForQuestion(questionId: string): Promise<void>;

  /**
   * How many of a track's questions were built on a snapshot of this source that has since
   * been superseded.
   *
   * For the source page's notice after a refresh. A count rather than a list, because the
   * source page's job is to say that a refresh has consequences; which questions those are
   * is a question each question's own page answers.
   */
  countQuestionsOnSupersededSnapshots(sourceId: string): Promise<number>;
}
