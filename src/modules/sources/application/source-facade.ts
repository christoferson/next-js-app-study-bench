import type { Clock } from "@/platform/clock";
import { sha256Hex } from "@/platform/hash";
import type { IdGenerator } from "@/platform/id-generator";
import type { ObjectStorage } from "@/platform/storage/object-storage";
import type { DocumentTextExtractor } from "@/platform/documents/document-text-extractor";
import { DocumentUnreadableError } from "@/platform/documents/document-text-extractor";
import { normalizeExtractedText } from "@/shared/text-normalization";
import type {
  Certification,
  CertificationSlug,
} from "@/modules/certifications/domain/certification";
import type {
  Objective,
  ObjectiveId,
} from "@/modules/certifications/domain/objective";
import { chunkText } from "@/modules/sources/domain/chunking";
import {
  SourceEmptyError,
  SourceNotFoundError,
  SourceNotRefreshableError,
  SourceObjectiveAlreadyLinkedError,
  SourceObjectiveInvalidError,
  SourceTooLargeError,
} from "@/modules/sources/domain/errors";
import type {
  Source,
  SourceAuthority,
  SourceChunk,
  SourceId,
  SourceSnapshot,
  SourceType,
} from "@/modules/sources/domain/source";
import {
  isRefreshable,
  objectKeyForContentHash,
} from "@/modules/sources/domain/source";
import type { SourceRepository } from "@/modules/sources/ports/source-repository";
import type {
  SourceTransactionRepositories,
  SourceUnitOfWork,
} from "@/modules/sources/ports/unit-of-work";
import type { UrlRetriever } from "@/modules/sources/ports/url-retriever";
import { MAX_PASTED_CHARS } from "./schemas";

/**
 * The source library's one entry point (`spec/ARCHITECTURE.md` section 5.2).
 *
 * Pages, Server Actions, and route handlers call this. None of them hashes text, builds
 * an object key, decides what a chunk is, or opens a transaction.
 *
 * **What is stored where, and why.** An import produces three things: a metadata row, an
 * object holding the extracted text, and chunk rows. The acceptance criterion "an
 * imported source is stored outside the database" is satisfied by the object — the whole
 * document is written to `ObjectStorage` under a content-addressed key and the row keeps
 * only that key (`SPEC.md` section 12.1). Chunk *text* is in SQLite, and that is not a
 * contradiction: a chunk is a small, queried, joined record that slice 2 selects by
 * objective, and making evidence display fetch and re-split a whole exam guide would be a
 * worse design than a bounded TEXT column.
 *
 * **The original bytes are not kept.** A PDF is read once, its text is stored, and the
 * upload is discarded. Nothing in the product renders the original file: the preview, the
 * chunks, the prompts, and the evidence display are all the extracted text, so keeping a
 * 10 MB binary would be storing something with no reader. Re-extracting later would also
 * produce the same text, since the extractor is deterministic. Keeping originals is a
 * deliberate future option — it would need only a second object key — and until something
 * needs them, this is documented rather than implemented.
 *
 * **Write ordering.** The object is written *before* the transaction that writes the
 * rows. An object with no row is unreachable garbage that the next import of the same
 * content overwrites, because the key is the content's own hash; a row with no object
 * would be a source whose preview is permanently broken and which nothing would retry.
 * This is the same reasoning `AudioFacade` states, for the same reason.
 */

/** How much of a snapshot the source page previews. */
export const SNAPSHOT_PREVIEW_CHARS = 2000;

/** One import, as the interface describes it. */
export interface ImportPastedSourceInput {
  readonly title: string;
  readonly authority: SourceAuthority;
  readonly text: string;
  readonly isMarkdown: boolean;
}

export interface ImportFileSourceInput {
  readonly title: string;
  readonly authority: SourceAuthority;
  readonly filename: string;
  readonly bytes: Uint8Array;
}

export interface ImportUrlSourceInput {
  readonly title: string;
  readonly authority: SourceAuthority;
  readonly url: string;
}

/** An import's outcome: what was created, and how much of it. */
export interface SourceImportResult {
  readonly source: Source;
  readonly snapshot: SourceSnapshot;
  readonly chunkCount: number;
}

/**
 * A refresh's outcome.
 *
 * `changed: false` carries the existing snapshot rather than nothing, so the source page
 * can say "the page has not changed since 3 June" instead of only "unchanged".
 */
export interface SourceRefreshResult {
  readonly changed: boolean;
  readonly snapshot: SourceSnapshot;
  readonly chunkCount: number;
}

/** One row of the track's source list. */
export interface SourceListEntry {
  readonly source: Source;
  readonly snapshotCount: number;
  /** The newest snapshot, or `null` when an import failed before writing one. */
  readonly latestSnapshot: SourceSnapshot | null;
  readonly chunkCount: number;
  readonly objectiveCount: number;
}

export interface SourceLibraryView {
  readonly certification: Certification;
  readonly entries: readonly SourceListEntry[];
}

/** Everything one source's page shows. */
export interface SourceDetailView {
  readonly certification: Certification;
  readonly source: Source;
  readonly snapshots: readonly SourceSnapshot[];
  /** Chunk counts by snapshot id, so the list needs no second query per row. */
  readonly chunkCounts: Readonly<Record<string, number>>;
  readonly linkedObjectives: readonly Objective[];
  /** Active objectives of this track that are not linked yet. */
  readonly linkableObjectives: readonly Objective[];
  /** The first characters of the newest snapshot, or `null` when there is none. */
  readonly preview: string | null;
  readonly previewTruncated: boolean;
  readonly refreshable: boolean;
}

interface SourceFacadeDependencies {
  readonly sources: SourceRepository;
  readonly unitOfWork: SourceUnitOfWork;
  readonly storage: ObjectStorage;
  readonly extractor: DocumentTextExtractor;
  readonly retriever: UrlRetriever;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export class SourceFacade {
  constructor(private readonly deps: SourceFacadeDependencies) {}

  /**
   * One track's sources, with the counts the list shows.
   *
   * `null` for an unknown slug, so the page can call `notFound()` — the same convention
   * every other facade's view method uses.
   */
  async findLibraryBySlug(
    slug: CertificationSlug,
  ): Promise<SourceLibraryView | null> {
    return this.deps.unitOfWork.transaction(async (repositories) => {
      const certification = await repositories.certifications.findBySlug(slug);

      if (certification === null) {
        return null;
      }

      const sources = await repositories.sources.listByCertification(
        certification.id,
      );
      const entries: SourceListEntry[] = [];

      for (const source of sources) {
        const snapshots = await repositories.sources.listSnapshots(source.id);
        const latest = snapshots[0] ?? null;

        entries.push({
          source,
          snapshotCount: snapshots.length,
          latestSnapshot: latest,
          chunkCount:
            latest === null
              ? 0
              : await repositories.sources.countChunks(latest.id),
          objectiveCount: (
            await repositories.sources.listObjectiveLinks(source.id)
          ).length,
        });
      }

      return { certification, entries };
    });
  }

  /**
   * One source's page.
   *
   * Read inside a transaction so the snapshot list, the chunk counts, and the objective
   * links are all one consistent picture. A refresh committing halfway through would
   * otherwise render a snapshot count that does not match the rows below it.
   */
  async findDetail(
    slug: CertificationSlug,
    sourceId: SourceId,
  ): Promise<SourceDetailView | null> {
    const view = await this.deps.unitOfWork.transaction(
      async (repositories) => {
        const certification =
          await repositories.certifications.findBySlug(slug);

        if (certification === null) {
          return null;
        }

        const source = await repositories.sources.findById(sourceId);

        // A source of another track is "not found" here rather than "forbidden": the
        // address is wrong, and this is a single-user application with nothing to
        // conceal from anyone.
        if (source === null || source.certificationId !== certification.id) {
          return null;
        }

        const snapshots = await repositories.sources.listSnapshots(source.id);
        const chunkCounts: Record<string, number> = {};

        for (const snapshot of snapshots) {
          chunkCounts[snapshot.id] = await repositories.sources.countChunks(
            snapshot.id,
          );
        }

        const linkedIds = new Set(
          await repositories.sources.listObjectiveLinks(source.id),
        );
        const objectives = await repositories.objectives.listByCertification(
          certification.id,
        );

        return {
          certification,
          source,
          snapshots,
          chunkCounts,
          linkedObjectives: objectives.filter((objective) =>
            linkedIds.has(objective.id),
          ),
          linkableObjectives: objectives.filter(
            (objective) =>
              objective.status === "ACTIVE" && !linkedIds.has(objective.id),
          ),
          latest: snapshots[0] ?? null,
        };
      },
    );

    if (view === null) {
      return null;
    }

    // The preview is read outside the transaction, because it is a file read rather than
    // a query and holding the SQLite write lock across it would block every other write
    // for the duration.
    const text = view.latest === null ? null : await this.readText(view.latest);

    return {
      certification: view.certification,
      source: view.source,
      snapshots: view.snapshots,
      chunkCounts: view.chunkCounts,
      linkedObjectives: view.linkedObjectives,
      linkableObjectives: view.linkableObjectives,
      preview: text === null ? null : text.slice(0, SNAPSHOT_PREVIEW_CHARS),
      previewTruncated: text !== null && text.length > SNAPSHOT_PREVIEW_CHARS,
      refreshable: isRefreshable(view.source),
    };
  }

  /** One snapshot's text, or `null` when its object has gone missing. */
  async readSnapshotText(snapshot: SourceSnapshot): Promise<string | null> {
    return this.readText(snapshot);
  }

  /** How many sources a track has. For the track page's summary line. */
  async countActiveSources(certificationId: string): Promise<number> {
    const sources =
      await this.deps.sources.listByCertification(certificationId);

    return sources.filter((source) => source.status === "ACTIVE").length;
  }

  async importPastedText(
    slug: CertificationSlug,
    input: ImportPastedSourceInput,
  ): Promise<SourceImportResult> {
    return this.importText(slug, {
      title: input.title,
      authority: input.authority,
      sourceType: input.isMarkdown ? "MARKDOWN" : "PASTED_TEXT",
      originalLocation: null,
      rawText: input.text,
      emptyField: "text",
      emptyMessage: "That text has nothing in it to import.",
    });
  }

  /**
   * A file, as a source.
   *
   * The extension decides how the bytes are read, which is the same decision the
   * objective import makes and for the same reason: the browser's declared MIME type is
   * unreliable and the owner knows what they uploaded.
   *
   * A scanned PDF fails here, clearly, and by two different routes — an unreadable file
   * raises `DocumentUnreadableError` from the extractor, and a readable scan with no text
   * layer extracts to nothing and raises `SourceEmptyError` with a message that names the
   * cause. The second is the one that matters, because it is the case that would otherwise
   * look like success (`SPEC.md` section 26.3).
   */
  async importFile(
    slug: CertificationSlug,
    input: ImportFileSourceInput,
  ): Promise<SourceImportResult> {
    const isPdf = input.filename.toLowerCase().endsWith(".pdf");
    const extraction = await this.deps.extractor.extract(
      input.bytes,
      isPdf ? "PDF" : "PLAIN_TEXT",
    );

    return this.importText(slug, {
      title:
        input.title.length > 0
          ? input.title
          : titleFromFilename(input.filename),
      authority: input.authority,
      sourceType: isPdf
        ? "TEXT_PDF"
        : input.filename.toLowerCase().endsWith(".md")
          ? "MARKDOWN"
          : "PASTED_TEXT",
      originalLocation: input.filename,
      rawText: extraction.text,
      emptyField: "document",
      emptyMessage: isPdf
        ? "No text could be read from that PDF. It is most likely a scan, which has images rather than text — paste the text instead, or use a PDF with a text layer."
        : "That file has no text in it.",
    });
  }

  /**
   * A web page, as a source.
   *
   * Every safety control lives in the retriever, which is why this method looks like the
   * other two: by the time text arrives here, the address has been checked against
   * resolved DNS on every redirect hop, the response has been size-capped and
   * type-checked, and HTML has become plain text (`spec/SECURITY.md` section 4).
   *
   * The address stored as the origin is the URL the owner typed, not the final URL after
   * redirects. A refresh must re-follow the chain, because the redirect is part of how
   * that address behaves — freezing hop three would mean a later change to the site's
   * routing was silently ignored.
   */
  async importUrl(
    slug: CertificationSlug,
    input: ImportUrlSourceInput,
  ): Promise<SourceImportResult> {
    const retrieved = await this.deps.retriever.retrieve(input.url);

    return this.importText(slug, {
      title: input.title.length > 0 ? input.title : titleFromUrl(input.url),
      authority: input.authority,
      sourceType: "WEB_URL",
      originalLocation: input.url,
      rawText: retrieved.text,
      emptyField: "url",
      emptyMessage:
        "That page had no readable text. It may be built entirely by JavaScript, which this importer does not run — paste the text instead.",
    });
  }

  /**
   * Reads a web source again.
   *
   * The whole point of `SPEC.md` section 10.2 is here: identical content produces *no*
   * new snapshot and says so, and changed content produces a second snapshot beside the
   * first rather than replacing it. Nothing is ever updated, so the history of what the
   * page said — and therefore which questions were written from which version — stays
   * intact for slice 2's outdated-question detection.
   */
  async refresh(
    slug: CertificationSlug,
    sourceId: SourceId,
  ): Promise<SourceRefreshResult> {
    const source = await this.requireSource(slug, sourceId);

    if (!isRefreshable(source) || source.originalLocation === null) {
      throw new SourceNotRefreshableError();
    }

    const retrieved = await this.deps.retriever.retrieve(
      source.originalLocation,
    );
    const text = normalizeExtractedText(retrieved.text);

    if (text.length === 0) {
      throw new SourceEmptyError(
        "",
        "That page had no readable text this time, so the existing snapshot was kept.",
      );
    }

    const contentHash = sha256Hex(text);
    const existing = await this.deps.sources.findSnapshotByHash(
      source.id,
      contentHash,
    );

    if (existing !== null) {
      return {
        changed: false,
        snapshot: existing,
        chunkCount: await this.deps.sources.countChunks(existing.id),
      };
    }

    const written = await this.writeSnapshot(source.id, text, contentHash);

    return {
      changed: true,
      snapshot: written.snapshot,
      chunkCount: written.chunkCount,
    };
  }

  /** Renames a source or changes its authority. Content is untouched. */
  async editSource(
    slug: CertificationSlug,
    sourceId: SourceId,
    input: { readonly title: string; readonly authority: SourceAuthority },
  ): Promise<Source> {
    return this.deps.unitOfWork.transaction(async (repositories) => {
      const source = await requireSourceOfTrack(repositories, slug, sourceId);
      const updated: Source = {
        ...source,
        title: input.title,
        authority: input.authority,
        updatedAt: this.deps.clock.now(),
      };

      await repositories.sources.saveSource(updated);

      return updated;
    });
  }

  /**
   * Takes a source out of use without destroying it.
   *
   * Archived rather than deleted, because a question generated from it in slice 2 will
   * cite its chunks, and deleting the text a question was written from would leave that
   * question unverifiable. There is no delete in this slice for exactly that reason.
   */
  async archive(slug: CertificationSlug, sourceId: SourceId): Promise<void> {
    await this.deps.unitOfWork.transaction(async (repositories) => {
      const source = await requireSourceOfTrack(repositories, slug, sourceId);

      await repositories.sources.archive(source.id, this.deps.clock.now());
    });
  }

  async restore(slug: CertificationSlug, sourceId: SourceId): Promise<void> {
    await this.deps.unitOfWork.transaction(async (repositories) => {
      const source = await requireSourceOfTrack(repositories, slug, sourceId);

      await repositories.sources.restore(source.id, this.deps.clock.now());
    });
  }

  /**
   * Maps one objective to a source (`SPEC.md` section 6.15).
   *
   * The objective is re-read and re-checked inside the transaction that writes the link,
   * so a link can never cross study tracks even if two requests interleave.
   */
  async linkObjective(
    slug: CertificationSlug,
    sourceId: SourceId,
    objectiveId: ObjectiveId,
  ): Promise<void> {
    await this.deps.unitOfWork.transaction(async (repositories) => {
      const source = await requireSourceOfTrack(repositories, slug, sourceId);
      const objective = await repositories.objectives.findById(objectiveId);

      if (
        objective === null ||
        objective.certificationId !== source.certificationId
      ) {
        throw new SourceObjectiveInvalidError();
      }

      const linked = await repositories.sources.listObjectiveLinks(source.id);

      if (linked.includes(objectiveId)) {
        throw new SourceObjectiveAlreadyLinkedError();
      }

      await repositories.sources.linkObjective(
        source.id,
        objectiveId,
        this.deps.clock.now(),
      );
    });
  }

  async unlinkObjective(
    slug: CertificationSlug,
    sourceId: SourceId,
    objectiveId: ObjectiveId,
  ): Promise<void> {
    await this.deps.unitOfWork.transaction(async (repositories) => {
      const source = await requireSourceOfTrack(repositories, slug, sourceId);

      await repositories.sources.unlinkObjective(source.id, objectiveId);
    });
  }

  /**
   * The one import path, whatever the text came from.
   *
   * Paste, file, and URL differ only in how they produce a string and what they record as
   * the origin. Normalizing, hashing, storing, chunking, and the transaction are shared,
   * so all four source types cannot drift apart in how their content is treated — which
   * matters because a chunk offset must mean the same thing regardless of type.
   */
  private async importText(
    slug: CertificationSlug,
    request: {
      readonly title: string;
      readonly authority: SourceAuthority;
      readonly sourceType: SourceType;
      readonly originalLocation: string | null;
      readonly rawText: string;
      readonly emptyField: string;
      readonly emptyMessage: string;
    },
  ): Promise<SourceImportResult> {
    // The same normalization the objective import uses on the same kind of input:
    // ligatures repaired, line endings unified, and runs of blank lines collapsed. It
    // runs before hashing, so a source re-fetched from a server that changed its line
    // endings is correctly recognised as unchanged.
    const text = normalizeExtractedText(request.rawText);

    if (text.length === 0) {
      throw new SourceEmptyError(request.emptyField, request.emptyMessage);
    }

    if (text.length > MAX_PASTED_CHARS) {
      throw new SourceTooLargeError(
        request.emptyField,
        `That document holds ${text.length.toLocaleString("en-GB")} characters, which is more than the ${MAX_PASTED_CHARS.toLocaleString("en-GB")} this importer accepts. Import the relevant part instead.`,
      );
    }

    const now = this.deps.clock.now();
    const contentHash = sha256Hex(text);
    const objectKey = objectKeyForContentHash(contentHash);
    const bytes = new TextEncoder().encode(text);

    // Before the rows. See the class comment: an object with no row is collectable
    // garbage, a row with no object is a broken page.
    await this.deps.storage.put(objectKey, bytes);

    return this.deps.unitOfWork.transaction(async (repositories) => {
      const certification = await repositories.certifications.findBySlug(slug);

      if (certification === null) {
        throw new SourceNotFoundError(slug);
      }

      const source: Source = {
        id: this.deps.ids.nextId(),
        certificationId: certification.id,
        title: request.title,
        sourceType: request.sourceType,
        authority: request.authority,
        originalLocation: request.originalLocation,
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      };
      const snapshot: SourceSnapshot = {
        id: this.deps.ids.nextId(),
        sourceId: source.id,
        contentHash,
        objectKey,
        byteSize: bytes.byteLength,
        charCount: text.length,
        retrievedAt: now,
      };
      const chunks = this.buildChunks(snapshot.id, text);

      await repositories.sources.saveSource(source);
      await repositories.sources.insertSnapshot(snapshot);
      await repositories.sources.insertChunks(chunks);

      return { source, snapshot, chunkCount: chunks.length };
    });
  }

  /** A second (or later) snapshot of an existing source. */
  private async writeSnapshot(
    sourceId: SourceId,
    text: string,
    contentHash: string,
  ): Promise<{
    readonly snapshot: SourceSnapshot;
    readonly chunkCount: number;
  }> {
    const objectKey = objectKeyForContentHash(contentHash);
    const bytes = new TextEncoder().encode(text);

    await this.deps.storage.put(objectKey, bytes);

    return this.deps.unitOfWork.transaction(async (repositories) => {
      const snapshot: SourceSnapshot = {
        id: this.deps.ids.nextId(),
        sourceId,
        contentHash,
        objectKey,
        byteSize: bytes.byteLength,
        charCount: text.length,
        retrievedAt: this.deps.clock.now(),
      };
      const chunks = this.buildChunks(snapshot.id, text);

      await repositories.sources.insertSnapshot(snapshot);
      await repositories.sources.insertChunks(chunks);

      return { snapshot, chunkCount: chunks.length };
    });
  }

  private buildChunks(
    snapshotId: string,
    text: string,
  ): readonly SourceChunk[] {
    return chunkText(text).map((chunk, index) => ({
      id: this.deps.ids.nextId(),
      snapshotId,
      chunkIndex: index,
      text: chunk.text,
      charStart: chunk.charStart,
      charEnd: chunk.charEnd,
    }));
  }

  /**
   * The stored text of one snapshot.
   *
   * `null` rather than a throw for a missing object, because the row is the record that
   * matters and a page that says "the stored text is missing" is more useful than a 500.
   * Invalid UTF-8 is impossible here — this application wrote the bytes — but the decode
   * is non-fatal anyway, since a corrupted file should degrade the preview rather than
   * break the page.
   */
  private async readText(snapshot: SourceSnapshot): Promise<string | null> {
    const bytes = await this.deps.storage.get(snapshot.objectKey);

    return bytes === null ? null : new TextDecoder("utf-8").decode(bytes);
  }

  /** The source, if it belongs to this track. */
  private async requireSource(
    slug: CertificationSlug,
    sourceId: SourceId,
  ): Promise<Source> {
    return this.deps.unitOfWork.transaction(async (repositories) =>
      requireSourceOfTrack(repositories, slug, sourceId),
    );
  }
}

/**
 * The source named by `sourceId`, if the track named by `slug` owns it.
 *
 * A free function over the transaction's repositories rather than a method, so every
 * mutating operation performs the check *inside its own transaction* and none of them can
 * accidentally verify ownership against a snapshot of the data that has since changed.
 *
 * A source belonging to another track raises "not found" rather than a distinct error:
 * the address is simply wrong, and there is no second user to conceal anything from.
 */
async function requireSourceOfTrack(
  repositories: SourceTransactionRepositories,
  slug: CertificationSlug,
  sourceId: SourceId,
): Promise<Source> {
  const certification = await repositories.certifications.findBySlug(slug);
  const source = await repositories.sources.findById(sourceId);

  if (
    certification === null ||
    source === null ||
    source.certificationId !== certification.id
  ) {
    throw new SourceNotFoundError(sourceId);
  }

  return source;
}

/** A filename as a readable title: no extension, underscores as spaces. */
function titleFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).at(-1) ?? filename;
  const withoutExtension = base.replace(/\.[A-Za-z0-9]{1,8}$/, "");

  return withoutExtension.replace(/[_-]+/g, " ").trim() || base;
}

/**
 * A URL as a readable title: the host and the last path segment.
 *
 * A guess, and one the owner can overwrite in the title field. `docs.aws.amazon.com` plus
 * `well-architected` beats both the bare host, which is the same for every page of a
 * documentation site, and the full URL, which is unreadable in a list.
 */
function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname
      .split("/")
      .filter((part) => part !== "")
      .at(-1);

    if (segment === undefined) {
      return parsed.hostname;
    }

    const readable = decodeURIComponent(segment)
      .replace(/\.[A-Za-z0-9]{1,8}$/, "")
      .replace(/[_-]+/g, " ")
      .trim();

    return readable === ""
      ? parsed.hostname
      : `${parsed.hostname}: ${readable}`;
  } catch {
    return url;
  }
}

/** Re-exported so a page can name the error without importing the domain directly. */
export { DocumentUnreadableError };
