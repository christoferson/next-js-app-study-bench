import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "@/platform/hash";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import type {
  ObjectKey,
  ObjectStorage,
} from "@/platform/storage/object-storage";
import { assertValidObjectKey } from "@/platform/storage/object-storage";
import { DocumentUnreadableError } from "@/platform/documents/document-text-extractor";
import type { DocumentTextExtractor } from "@/platform/documents/document-text-extractor";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import {
  FixedClock,
  SequentialIdGenerator,
  certificationFixture,
  createMigratedDatabase,
  objectiveFixture,
} from "@/modules/certifications/infrastructure/test-support";
import { MAX_PASTED_CHARS } from "@/modules/sources/application/schemas";
import {
  SourceEmptyError,
  SourceNotFoundError,
  SourceNotRefreshableError,
  SourceObjectiveAlreadyLinkedError,
  SourceObjectiveInvalidError,
  SourceTooLargeError,
} from "@/modules/sources/domain/errors";
import { objectKeyForContentHash } from "@/modules/sources/domain/source";
import {
  FakeUrlRetriever,
  StubDocumentTextExtractor,
  unreadablePdfError,
} from "@/modules/sources/infrastructure/test-support";
import { SqliteSourceRepository } from "@/modules/sources/infrastructure/sqlite-source-repository";
import { SqliteSourceUnitOfWork } from "@/modules/sources/infrastructure/sqlite-source-unit-of-work";
import { SNAPSHOT_PREVIEW_CHARS, SourceFacade } from "./source-facade";

/**
 * The source library end to end, over the real SQLite adapters.
 *
 * The repository, the unit of work, the migrated schema, the chunker, the hash, and the
 * normalizer are all production code. Only the three things that would otherwise reach
 * outside the process are doubles: object storage, the PDF reader, and the URL retriever
 * (`spec/TESTING.md` sections 3 and 5). Nothing here opens a socket or touches `./data`.
 *
 * The properties these cases exist for, in order of how much later work depends on them:
 *
 * 1. **An import produces all three records or none.** A source row, an object holding
 *    the text, and chunk rows — a partial import would look present in the list and
 *    ground nothing.
 * 2. **A refresh appends, and identical content appends nothing.** `SPEC.md` section 10.2
 *    is what lets slice 2 tell which version of a page a question was written from.
 * 3. **A scanned PDF fails, visibly.** It is the one failure that would otherwise look
 *    like success.
 *
 * The storage double is local rather than borrowed from the audio module's test support:
 * `module-boundaries.test.ts` asserts that nothing under `modules/sources` imports
 * `modules/audio`, and a test import would be the first crack in that.
 */

/** Object storage in a map, recording what was written. */
class InMemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, Uint8Array>();

  /** Every `put`, in order, so a test can assert what was written and when. */
  readonly writes: ObjectKey[] = [];

  readonly deletes: ObjectKey[] = [];

  async put(key: ObjectKey, bytes: Uint8Array): Promise<void> {
    assertValidObjectKey(key);
    this.writes.push(key);
    this.objects.set(key, bytes);
  }

  async get(key: ObjectKey): Promise<Uint8Array | null> {
    assertValidObjectKey(key);

    return this.objects.get(key) ?? null;
  }

  async delete(key: ObjectKey): Promise<void> {
    assertValidObjectKey(key);
    this.deletes.push(key);
    this.objects.delete(key);
  }

  async exists(key: ObjectKey): Promise<boolean> {
    assertValidObjectKey(key);

    return this.objects.has(key);
  }

  get size(): number {
    return this.objects.size;
  }

  /** Removes an object without recording a delete, to simulate a lost file. */
  forget(key: ObjectKey): void {
    this.objects.delete(key);
  }

  /** The stored text of one key, for asserting what an import actually kept. */
  async text(key: ObjectKey): Promise<string | null> {
    const bytes = await this.get(key);

    return bytes === null ? null : new TextDecoder("utf-8").decode(bytes);
  }
}

const TRACK = certificationFixture();
const OTHER_TRACK = certificationFixture({
  id: "certification-2",
  slug: "second-demo-track",
  name: "Second Demo Track",
  examCode: "DEMO-002",
});

const OBJECTIVE = objectiveFixture({
  id: "objective-1",
  certificationId: TRACK.id,
  title: "Demo objective one",
  displayOrder: 1,
});
const SECOND_OBJECTIVE = objectiveFixture({
  id: "objective-2",
  certificationId: TRACK.id,
  code: "Demo domain 2",
  title: "Demo objective two",
  displayOrder: 2,
});
const ARCHIVED_OBJECTIVE = objectiveFixture({
  id: "objective-3",
  certificationId: TRACK.id,
  code: "Demo domain 3",
  title: "Archived objective",
  displayOrder: 3,
  status: "ARCHIVED",
});
const OTHER_TRACK_OBJECTIVE = objectiveFixture({
  id: "objective-9",
  certificationId: OTHER_TRACK.id,
  code: "Other domain 1",
  displayOrder: 1,
});

const NOW = "2026-06-01T12:00:00.000Z";

/** Fictional study text. Long enough to be a document, short enough to read. */
const PASTED = [
  "Object storage keeps whole files and addresses each one by a key.",
  "",
  "Block storage attaches to one machine and is addressed by offset.",
].join("\n");

const PAGE_URL = "https://docs.demo.example/guides/well-architected";

interface Subject {
  readonly facade: SourceFacade;
  readonly storage: InMemoryObjectStorage;
  readonly retriever: FakeUrlRetriever;
  readonly sources: SqliteSourceRepository;
  readonly database: SqliteDatabase;
  readonly clock: FixedClock;
}

async function createSubject(
  extractor: DocumentTextExtractor = new StubDocumentTextExtractor(),
): Promise<Subject> {
  const database = createMigratedDatabase();
  const certifications = new SqliteCertificationRepository(database);
  const objectives = new SqliteObjectiveRepository(database);

  await certifications.save(TRACK);
  await certifications.save(OTHER_TRACK);
  await objectives.save(OBJECTIVE);
  await objectives.save(SECOND_OBJECTIVE);
  await objectives.save(ARCHIVED_OBJECTIVE);
  await objectives.save(OTHER_TRACK_OBJECTIVE);

  const sources = new SqliteSourceRepository(database);
  const storage = new InMemoryObjectStorage();
  const retriever = new FakeUrlRetriever();
  const clock = new FixedClock(NOW);

  return {
    facade: new SourceFacade({
      sources,
      unitOfWork: new SqliteSourceUnitOfWork(database),
      storage,
      extractor,
      retriever,
      clock,
      ids: new SequentialIdGenerator("source-id"),
    }),
    storage,
    retriever,
    sources,
    database,
    clock,
  };
}

/** Bytes of a plain-text upload, which the stub extractor decodes. */
function fileBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("SourceFacade", () => {
  let subject: Subject;

  beforeEach(async () => {
    subject = await createSubject();
  });

  describe("importPastedText", () => {
    it("records the source, the snapshot, and the chunks together", async () => {
      const result = await subject.facade.importPastedText(TRACK.slug, {
        title: "Fictional storage notes",
        authority: "USER_AUTHORED",
        text: PASTED,
        isMarkdown: false,
      });

      expect(result.source).toMatchObject({
        certificationId: TRACK.id,
        title: "Fictional storage notes",
        sourceType: "PASTED_TEXT",
        authority: "USER_AUTHORED",
        // A paste has no origin, which is also why it cannot be refreshed.
        originalLocation: null,
        status: "ACTIVE",
        createdAt: NOW,
        updatedAt: NOW,
      });
      expect(result.chunkCount).toBeGreaterThan(0);

      await expect(subject.sources.findById(result.source.id)).resolves.toEqual(
        result.source,
      );
      await expect(
        subject.sources.findSnapshotById(result.snapshot.id),
      ).resolves.toEqual(result.snapshot);
      await expect(
        subject.sources.countChunks(result.snapshot.id),
      ).resolves.toBe(result.chunkCount);
    });

    it("writes the text to storage under the key the snapshot names", async () => {
      // The acceptance criterion "an imported source is stored outside the database".
      const { snapshot } = await subject.facade.importPastedText(TRACK.slug, {
        title: "Fictional storage notes",
        authority: "USER_AUTHORED",
        text: PASTED,
        isMarkdown: false,
      });

      expect(snapshot.objectKey).toBe(
        objectKeyForContentHash(sha256Hex(PASTED)),
      );
      expect(snapshot.objectKey.startsWith("sources/")).toBe(true);
      expect(subject.storage.writes).toEqual([snapshot.objectKey]);
      await expect(subject.storage.text(snapshot.objectKey)).resolves.toBe(
        PASTED,
      );
    });

    it("identifies the snapshot by the hash of the normalized text", async () => {
      // Normalizing before hashing is what makes a re-fetch of a page that only changed
      // its line endings correctly recognised as unchanged.
      const { snapshot } = await subject.facade.importPastedText(TRACK.slug, {
        title: "Fictional storage notes",
        authority: "USER_AUTHORED",
        text: `${PASTED}\r\n\r\n\r\n`,
        isMarkdown: false,
      });

      expect(snapshot.contentHash).toBe(sha256Hex(PASTED));
      expect(snapshot.charCount).toBe(PASTED.length);
      expect(snapshot.byteSize).toBe(
        new TextEncoder().encode(PASTED).byteLength,
      );
    });

    it("records markdown as markdown when the owner says so", async () => {
      const markdown = await subject.facade.importPastedText(TRACK.slug, {
        title: "Fictional notes",
        authority: "USER_AUTHORED",
        text: PASTED,
        isMarkdown: true,
      });

      expect(markdown.source.sourceType).toBe("MARKDOWN");
    });

    it("refuses text with nothing in it", async () => {
      await expect(
        subject.facade.importPastedText(TRACK.slug, {
          title: "Nothing",
          authority: "USER_AUTHORED",
          text: "   \n\n \t ",
          isMarkdown: false,
        }),
      ).rejects.toBeInstanceOf(SourceEmptyError);

      // And nothing was written anywhere, so a failed import leaves no half source.
      expect(subject.storage.size).toBe(0);
      await expect(
        subject.sources.listByCertification(TRACK.id),
      ).resolves.toEqual([]);
    });

    it("refuses a document past the character limit", async () => {
      await expect(
        subject.facade.importPastedText(TRACK.slug, {
          title: "Far too much",
          authority: "USER_AUTHORED",
          text: "a".repeat(MAX_PASTED_CHARS + 1),
          isMarkdown: false,
        }),
      ).rejects.toBeInstanceOf(SourceTooLargeError);

      expect(subject.storage.size).toBe(0);
    });

    it("says how long the document was and what the limit is", async () => {
      await expect(
        subject.facade.importPastedText(TRACK.slug, {
          title: "Far too much",
          authority: "USER_AUTHORED",
          text: "a".repeat(MAX_PASTED_CHARS + 1),
          isMarkdown: false,
        }),
      ).rejects.toThrow(/1,000,001 characters.*1,000,000/);
    });

    it("refuses an unknown study track", async () => {
      await expect(
        subject.facade.importPastedText("no-such-track", {
          title: "Fictional storage notes",
          authority: "USER_AUTHORED",
          text: PASTED,
          isMarkdown: false,
        }),
      ).rejects.toBeInstanceOf(SourceNotFoundError);
    });
  });

  describe("importFile", () => {
    it("imports a .txt upload as plain text", async () => {
      const result = await subject.facade.importFile(TRACK.slug, {
        title: "Fictional storage notes",
        authority: "TRUSTED_THIRD_PARTY",
        filename: "storage-notes.txt",
        bytes: fileBytes(PASTED),
      });

      expect(result.source).toMatchObject({
        sourceType: "PASTED_TEXT",
        // A filename is a label rather than an address, so it is recorded but does not
        // make the source refreshable.
        originalLocation: "storage-notes.txt",
      });
      await expect(
        subject.storage.text(result.snapshot.objectKey),
      ).resolves.toBe(PASTED);
    });

    it("imports a .md upload as markdown", async () => {
      const result = await subject.facade.importFile(TRACK.slug, {
        title: "Fictional storage notes",
        authority: "USER_AUTHORED",
        filename: "storage-notes.MD",
        bytes: fileBytes(PASTED),
      });

      expect(result.source.sourceType).toBe("MARKDOWN");
    });

    it("imports a .pdf upload as extracted text", async () => {
      const extracted = "The extracted text of a fictional exam guide.";
      const pdf = await createSubject(
        new StubDocumentTextExtractor(extracted, 4),
      );

      const result = await pdf.facade.importFile(TRACK.slug, {
        title: "Fictional exam guide",
        authority: "OFFICIAL",
        filename: "exam-guide.pdf",
        bytes: fileBytes("%PDF-1.7 not really a pdf"),
      });

      expect(result.source.sourceType).toBe("TEXT_PDF");
      // The extracted text is stored, not the original bytes: nothing in the product
      // renders the upload.
      await expect(pdf.storage.text(result.snapshot.objectKey)).resolves.toBe(
        extracted,
      );
      expect(result.snapshot.contentHash).toBe(sha256Hex(extracted));
    });

    it("takes the filename as the title when none was given", async () => {
      const result = await subject.facade.importFile(TRACK.slug, {
        title: "",
        authority: "USER_AUTHORED",
        filename: "demo_exam-guide.txt",
        bytes: fileBytes(PASTED),
      });

      expect(result.source.title).toBe("demo exam guide");
    });

    it("keeps a title the owner typed", async () => {
      const result = await subject.facade.importFile(TRACK.slug, {
        title: "What the owner called it",
        authority: "USER_AUTHORED",
        filename: "demo_exam-guide.txt",
        bytes: fileBytes(PASTED),
      });

      expect(result.source.title).toBe("What the owner called it");
    });

    it("refuses a text file with nothing in it", async () => {
      await expect(
        subject.facade.importFile(TRACK.slug, {
          title: "Empty",
          authority: "USER_AUTHORED",
          filename: "empty.txt",
          bytes: fileBytes("   \n"),
        }),
      ).rejects.toBeInstanceOf(SourceEmptyError);
    });

    describe("a scanned PDF", () => {
      it("fails rather than importing an empty source", async () => {
        // The case that would otherwise look like success: `pdf.js` reads the file
        // without complaint and finds no text layer, so the import must refuse.
        const scanned = await createSubject(
          new StubDocumentTextExtractor(null, 12),
        );

        await expect(
          scanned.facade.importFile(TRACK.slug, {
            title: "A photographed exam guide",
            authority: "OFFICIAL",
            filename: "scan.pdf",
            bytes: fileBytes("%PDF-1.7 images only"),
          }),
        ).rejects.toBeInstanceOf(SourceEmptyError);

        expect(scanned.storage.size).toBe(0);
        await expect(
          scanned.sources.listByCertification(TRACK.id),
        ).resolves.toEqual([]);
      });

      it("says that the file is most likely a scan", async () => {
        const scanned = await createSubject(
          new StubDocumentTextExtractor(null),
        );

        await expect(
          scanned.facade.importFile(TRACK.slug, {
            title: "A photographed exam guide",
            authority: "OFFICIAL",
            filename: "scan.pdf",
            bytes: fileBytes("%PDF-1.7 images only"),
          }),
        ).rejects.toThrow(/scan/i);
      });
    });

    it("surfaces the reader's own explanation for a PDF it cannot open", async () => {
      const unreadable = await createSubject(
        new StubDocumentTextExtractor(unreadablePdfError()),
      );

      const failure = unreadable.facade.importFile(TRACK.slug, {
        title: "A broken file",
        authority: "OFFICIAL",
        filename: "broken.pdf",
        bytes: fileBytes("not a pdf at all"),
      });

      await expect(failure).rejects.toBeInstanceOf(DocumentUnreadableError);
      await expect(failure).rejects.toThrow(
        /corrupt, password protected, or a scan with no text layer/,
      );
      expect(unreadable.storage.size).toBe(0);
    });
  });

  describe("importUrl", () => {
    beforeEach(() => {
      subject.retriever.script(PAGE_URL, {
        text: "Well-architected guidance for a fictional cloud.",
        // A different final URL, to prove which one is recorded.
        finalUrl:
          "https://docs.demo.example/guides/well-architected/index.html",
        contentType: "text/html",
      });
    });

    it("records the page as a web source with the address the owner typed", async () => {
      const result = await subject.facade.importUrl(TRACK.slug, {
        title: "Well-architected guidance",
        authority: "OFFICIAL",
        url: PAGE_URL,
      });

      expect(result.source).toMatchObject({
        sourceType: "WEB_URL",
        // Not the final URL after redirects: a refresh must re-follow the chain, because
        // the redirect is part of how that address behaves.
        originalLocation: PAGE_URL,
      });
      expect(subject.retriever.requests).toEqual([PAGE_URL]);
    });

    it("stores the retrieved text and chunks it", async () => {
      const result = await subject.facade.importUrl(TRACK.slug, {
        title: "Well-architected guidance",
        authority: "OFFICIAL",
        url: PAGE_URL,
      });

      await expect(
        subject.storage.text(result.snapshot.objectKey),
      ).resolves.toBe("Well-architected guidance for a fictional cloud.");
      await expect(
        subject.sources.listChunks(result.snapshot.id),
      ).resolves.toHaveLength(result.chunkCount);
    });

    it("derives a title from the host and last path segment when none was given", async () => {
      const result = await subject.facade.importUrl(TRACK.slug, {
        title: "",
        authority: "OFFICIAL",
        url: PAGE_URL,
      });

      expect(result.source.title).toBe("docs.demo.example: well architected");
    });

    it("refuses a page with no readable text", async () => {
      subject.retriever.script("https://demo.example/empty", {
        text: "   \n\n",
        finalUrl: "https://demo.example/empty",
        contentType: "text/html",
      });

      await expect(
        subject.facade.importUrl(TRACK.slug, {
          title: "An empty page",
          authority: "GENERAL_WEB",
          url: "https://demo.example/empty",
        }),
      ).rejects.toBeInstanceOf(SourceEmptyError);
    });

    it("lets a rejected address through as the retriever's own error", async () => {
      // Every safety control lives in the retriever, and the facade adds nothing to its
      // explanation.
      const refusal = new Error(
        "That address points inside a private network.",
      );

      subject.retriever.script("http://10.0.0.1/admin", refusal);

      await expect(
        subject.facade.importUrl(TRACK.slug, {
          title: "Somewhere private",
          authority: "UNKNOWN",
          url: "http://10.0.0.1/admin",
        }),
      ).rejects.toThrow(refusal);
      expect(subject.storage.size).toBe(0);
    });
  });

  describe("refresh", () => {
    const FIRST = "The first version of a fictional guidance page.";
    const SECOND = "The second version of a fictional guidance page, revised.";

    async function importPage(): Promise<string> {
      const result = await subject.facade.importUrl(TRACK.slug, {
        title: "Well-architected guidance",
        authority: "OFFICIAL",
        url: PAGE_URL,
      });

      return result.source.id;
    }

    it("adds no snapshot when the page has not changed", async () => {
      subject.retriever.scriptText(PAGE_URL, FIRST);

      const sourceId = await importPage();
      const refreshed = await subject.facade.refresh(TRACK.slug, sourceId);

      expect(refreshed.changed).toBe(false);
      // The existing snapshot is carried back, so the page can say when the content was
      // last seen rather than only "unchanged".
      expect(refreshed.snapshot.contentHash).toBe(sha256Hex(FIRST));
      expect(refreshed.chunkCount).toBeGreaterThan(0);
      await expect(
        subject.sources.listSnapshots(sourceId),
      ).resolves.toHaveLength(1);
    });

    it("appends a second snapshot when the page has changed, leaving the first", async () => {
      subject.retriever.script(PAGE_URL, {
        text: FIRST,
        finalUrl: PAGE_URL,
        contentType: "text/html",
      });
      subject.retriever.script(PAGE_URL, {
        text: SECOND,
        finalUrl: PAGE_URL,
        contentType: "text/html",
      });

      const sourceId = await importPage();
      const refreshed = await subject.facade.refresh(TRACK.slug, sourceId);

      expect(refreshed.changed).toBe(true);

      const snapshots = await subject.sources.listSnapshots(sourceId);

      expect(snapshots).toHaveLength(2);
      // Nothing was replaced: both versions are readable, which is what lets a later
      // slice tell which one a question was written from.
      expect(snapshots.map((snapshot) => snapshot.contentHash)).toEqual([
        sha256Hex(SECOND),
        sha256Hex(FIRST),
      ]);
      await expect(
        subject.storage.text(objectKeyForContentHash(sha256Hex(FIRST))),
      ).resolves.toBe(FIRST);
      await expect(
        subject.storage.text(objectKeyForContentHash(sha256Hex(SECOND))),
      ).resolves.toBe(SECOND);
    });

    it("chunks the new snapshot rather than reusing the old chunks", async () => {
      subject.retriever.script(PAGE_URL, {
        text: FIRST,
        finalUrl: PAGE_URL,
        contentType: "text/html",
      });
      subject.retriever.script(PAGE_URL, {
        text: SECOND,
        finalUrl: PAGE_URL,
        contentType: "text/html",
      });

      const sourceId = await importPage();
      const refreshed = await subject.facade.refresh(TRACK.slug, sourceId);
      const chunks = await subject.sources.listChunks(refreshed.snapshot.id);

      expect(chunks.map((chunk) => chunk.text)).toEqual([SECOND]);
      expect(refreshed.chunkCount).toBe(chunks.length);
    });

    it.each([
      ["plain pasted text", false],
      ["a markdown document", true],
    ] as const)(
      "refuses to refresh %s, which has no address to read again",
      async (_label, isMarkdown) => {
        const pasted = await subject.facade.importPastedText(TRACK.slug, {
          title: "Fictional storage notes",
          authority: "USER_AUTHORED",
          text: PASTED,
          isMarkdown,
        });

        await expect(
          subject.facade.refresh(TRACK.slug, pasted.source.id),
        ).rejects.toBeInstanceOf(SourceNotRefreshableError);
        expect(subject.retriever.requests).toEqual([]);
      },
    );

    it("refuses to refresh an uploaded file, whose bytes were never kept", async () => {
      const uploaded = await subject.facade.importFile(TRACK.slug, {
        title: "Fictional exam guide",
        authority: "OFFICIAL",
        filename: "exam-guide.txt",
        bytes: new TextEncoder().encode(PASTED),
      });

      await expect(
        subject.facade.refresh(TRACK.slug, uploaded.source.id),
      ).rejects.toBeInstanceOf(SourceNotRefreshableError);
      expect(subject.retriever.requests).toEqual([]);
    });

    it("refuses a source of another track", async () => {
      subject.retriever.scriptText(PAGE_URL, FIRST);

      const sourceId = await importPage();

      await expect(
        subject.facade.refresh(OTHER_TRACK.slug, sourceId),
      ).rejects.toBeInstanceOf(SourceNotFoundError);
    });

    it("keeps the existing snapshot when the page has gone blank", async () => {
      subject.retriever.script(PAGE_URL, {
        text: FIRST,
        finalUrl: PAGE_URL,
        contentType: "text/html",
      });
      subject.retriever.script(PAGE_URL, {
        text: "  \n ",
        finalUrl: PAGE_URL,
        contentType: "text/html",
      });

      const sourceId = await importPage();

      await expect(
        subject.facade.refresh(TRACK.slug, sourceId),
      ).rejects.toBeInstanceOf(SourceEmptyError);
      await expect(
        subject.sources.listSnapshots(sourceId),
      ).resolves.toHaveLength(1);
    });
  });

  describe("findLibraryBySlug", () => {
    it("is empty for a track with no sources", async () => {
      const view = await subject.facade.findLibraryBySlug(TRACK.slug);

      expect(view?.certification.id).toBe(TRACK.id);
      expect(view?.entries).toEqual([]);
    });

    it("reports nothing for an unknown slug, so the page can 404", async () => {
      await expect(
        subject.facade.findLibraryBySlug("no-such-track"),
      ).resolves.toBeNull();
    });

    it("counts the snapshots, the newest snapshot's chunks, and the links", async () => {
      subject.retriever.script(PAGE_URL, {
        text: "The first version of a fictional page.",
        finalUrl: PAGE_URL,
        contentType: "text/html",
      });
      subject.retriever.script(PAGE_URL, {
        text: "The second version of a fictional page, revised.",
        finalUrl: PAGE_URL,
        contentType: "text/html",
      });

      const imported = await subject.facade.importUrl(TRACK.slug, {
        title: "Well-architected guidance",
        authority: "OFFICIAL",
        url: PAGE_URL,
      });

      await subject.facade.refresh(TRACK.slug, imported.source.id);
      await subject.facade.linkObjective(
        TRACK.slug,
        imported.source.id,
        OBJECTIVE.id,
      );

      const view = await subject.facade.findLibraryBySlug(TRACK.slug);

      expect(view?.entries).toHaveLength(1);
      expect(view?.entries[0]).toMatchObject({
        snapshotCount: 2,
        chunkCount: 1,
        objectiveCount: 1,
      });
      // The newest snapshot, which is what the list calls the source's current content.
      expect(view?.entries[0]?.latestSnapshot?.contentHash).toBe(
        sha256Hex("The second version of a fictional page, revised."),
      );
    });

    it("lists the track's own sources only, newest first", async () => {
      const older = await subject.facade.importPastedText(TRACK.slug, {
        title: "Older notes",
        authority: "USER_AUTHORED",
        text: "The older of two fictional documents.",
        isMarkdown: false,
      });

      subject.clock.set("2026-06-02T12:00:00.000Z");

      const newer = await subject.facade.importPastedText(TRACK.slug, {
        title: "Newer notes",
        authority: "USER_AUTHORED",
        text: "The newer of two fictional documents.",
        isMarkdown: false,
      });

      await subject.facade.importPastedText(OTHER_TRACK.slug, {
        title: "Another track's notes",
        authority: "USER_AUTHORED",
        text: "A document belonging to a different study track.",
        isMarkdown: false,
      });

      const view = await subject.facade.findLibraryBySlug(TRACK.slug);

      expect(view?.entries.map((entry) => entry.source.id)).toEqual([
        newer.source.id,
        older.source.id,
      ]);
    });

    it("includes an archived source, so the page can group it", async () => {
      const imported = await subject.facade.importPastedText(TRACK.slug, {
        title: "Retired notes",
        authority: "USER_AUTHORED",
        text: PASTED,
        isMarkdown: false,
      });

      await subject.facade.archive(TRACK.slug, imported.source.id);

      const view = await subject.facade.findLibraryBySlug(TRACK.slug);

      expect(view?.entries[0]?.source.status).toBe("ARCHIVED");
    });
  });

  describe("countActiveSources", () => {
    it("counts the active sources of one track", async () => {
      const first = await subject.facade.importPastedText(TRACK.slug, {
        title: "First",
        authority: "USER_AUTHORED",
        text: "The first of two fictional documents.",
        isMarkdown: false,
      });

      await subject.facade.importPastedText(TRACK.slug, {
        title: "Second",
        authority: "USER_AUTHORED",
        text: "The second of two fictional documents.",
        isMarkdown: false,
      });
      await subject.facade.archive(TRACK.slug, first.source.id);

      await expect(subject.facade.countActiveSources(TRACK.id)).resolves.toBe(
        1,
      );
      await expect(
        subject.facade.countActiveSources(OTHER_TRACK.id),
      ).resolves.toBe(0);
    });
  });

  describe("findDetail", () => {
    it("reports nothing for an unknown slug or an unknown source", async () => {
      await expect(
        subject.facade.findDetail("no-such-track", "source-id-1"),
      ).resolves.toBeNull();
      await expect(
        subject.facade.findDetail(TRACK.slug, "no-such-source"),
      ).resolves.toBeNull();
    });

    it("reports nothing for a source belonging to another track", async () => {
      // The address is simply wrong, and this is a single-user application with nothing
      // to conceal — so "not found" rather than "forbidden".
      const other = await subject.facade.importPastedText(OTHER_TRACK.slug, {
        title: "Another track's notes",
        authority: "USER_AUTHORED",
        text: PASTED,
        isMarkdown: false,
      });

      await expect(
        subject.facade.findDetail(TRACK.slug, other.source.id),
      ).resolves.toBeNull();
      await expect(
        subject.facade.findDetail(OTHER_TRACK.slug, other.source.id),
      ).resolves.not.toBeNull();
    });

    it("previews the newest snapshot and says when it was cut short", async () => {
      const long = "A fictional sentence about durable storage. ".repeat(80);
      const imported = await subject.facade.importPastedText(TRACK.slug, {
        title: "A long document",
        authority: "USER_AUTHORED",
        text: long,
        isMarkdown: false,
      });
      const stored = (await subject.storage.text(
        imported.snapshot.objectKey,
      )) as string;

      const detail = await subject.facade.findDetail(
        TRACK.slug,
        imported.source.id,
      );

      expect(stored.length).toBeGreaterThan(SNAPSHOT_PREVIEW_CHARS);
      expect(detail?.preview).toHaveLength(SNAPSHOT_PREVIEW_CHARS);
      expect(detail?.preview).toBe(stored.slice(0, SNAPSHOT_PREVIEW_CHARS));
      expect(detail?.previewTruncated).toBe(true);
    });

    it("shows a short document whole", async () => {
      const imported = await subject.facade.importPastedText(TRACK.slug, {
        title: "Fictional storage notes",
        authority: "USER_AUTHORED",
        text: PASTED,
        isMarkdown: false,
      });

      const detail = await subject.facade.findDetail(
        TRACK.slug,
        imported.source.id,
      );

      expect(detail?.preview).toBe(PASTED);
      expect(detail?.previewTruncated).toBe(false);
    });

    it("says the stored text is missing rather than failing", async () => {
      const imported = await subject.facade.importPastedText(TRACK.slug, {
        title: "Fictional storage notes",
        authority: "USER_AUTHORED",
        text: PASTED,
        isMarkdown: false,
      });

      subject.storage.forget(imported.snapshot.objectKey);

      const detail = await subject.facade.findDetail(
        TRACK.slug,
        imported.source.id,
      );

      expect(detail?.preview).toBeNull();
      expect(detail?.previewTruncated).toBe(false);
      expect(detail?.snapshots).toHaveLength(1);
    });

    it("counts the chunks of every snapshot, so the list needs no second query", async () => {
      subject.retriever.script(PAGE_URL, {
        text: "The first version of a fictional page.",
        finalUrl: PAGE_URL,
        contentType: "text/html",
      });
      subject.retriever.script(PAGE_URL, {
        text: "The second version of a fictional page, revised.",
        finalUrl: PAGE_URL,
        contentType: "text/html",
      });

      const imported = await subject.facade.importUrl(TRACK.slug, {
        title: "Well-architected guidance",
        authority: "OFFICIAL",
        url: PAGE_URL,
      });
      const refreshed = await subject.facade.refresh(
        TRACK.slug,
        imported.source.id,
      );

      const detail = await subject.facade.findDetail(
        TRACK.slug,
        imported.source.id,
      );

      expect(detail?.snapshots.map((snapshot) => snapshot.id)).toEqual([
        refreshed.snapshot.id,
        imported.snapshot.id,
      ]);
      expect(detail?.chunkCounts).toEqual({
        [imported.snapshot.id]: imported.chunkCount,
        [refreshed.snapshot.id]: refreshed.chunkCount,
      });
    });

    it("marks a web source refreshable and a paste not", async () => {
      subject.retriever.scriptText(PAGE_URL, "A fictional guidance page.");

      const web = await subject.facade.importUrl(TRACK.slug, {
        title: "Well-architected guidance",
        authority: "OFFICIAL",
        url: PAGE_URL,
      });
      const pasted = await subject.facade.importPastedText(TRACK.slug, {
        title: "Fictional storage notes",
        authority: "USER_AUTHORED",
        text: PASTED,
        isMarkdown: false,
      });

      await expect(
        subject.facade.findDetail(TRACK.slug, web.source.id),
      ).resolves.toMatchObject({ refreshable: true });
      await expect(
        subject.facade.findDetail(TRACK.slug, pasted.source.id),
      ).resolves.toMatchObject({ refreshable: false });
    });

    it("separates the linked objectives from the ones still available", async () => {
      const imported = await subject.facade.importPastedText(TRACK.slug, {
        title: "Fictional storage notes",
        authority: "USER_AUTHORED",
        text: PASTED,
        isMarkdown: false,
      });

      await subject.facade.linkObjective(
        TRACK.slug,
        imported.source.id,
        OBJECTIVE.id,
      );

      const detail = await subject.facade.findDetail(
        TRACK.slug,
        imported.source.id,
      );

      expect(detail?.linkedObjectives.map((objective) => objective.id)).toEqual(
        [OBJECTIVE.id],
      );
      // An archived objective is not offered: it is not something to map new work to.
      expect(
        detail?.linkableObjectives.map((objective) => objective.id),
      ).toEqual([SECOND_OBJECTIVE.id]);
    });
  });

  describe("readSnapshotText", () => {
    it("reads back what an import stored", async () => {
      const imported = await subject.facade.importPastedText(TRACK.slug, {
        title: "Fictional storage notes",
        authority: "USER_AUTHORED",
        text: PASTED,
        isMarkdown: false,
      });

      await expect(
        subject.facade.readSnapshotText(imported.snapshot),
      ).resolves.toBe(PASTED);
    });

    it("reports nothing when the object has gone missing", async () => {
      const imported = await subject.facade.importPastedText(TRACK.slug, {
        title: "Fictional storage notes",
        authority: "USER_AUTHORED",
        text: PASTED,
        isMarkdown: false,
      });

      subject.storage.forget(imported.snapshot.objectKey);

      await expect(
        subject.facade.readSnapshotText(imported.snapshot),
      ).resolves.toBeNull();
    });
  });

  describe("editSource", () => {
    it("renames a source and changes its authority without touching the content", async () => {
      const imported = await subject.facade.importPastedText(TRACK.slug, {
        title: "First guess at a title",
        authority: "UNKNOWN",
        text: PASTED,
        isMarkdown: false,
      });

      subject.clock.set("2026-06-05T12:00:00.000Z");

      const edited = await subject.facade.editSource(
        TRACK.slug,
        imported.source.id,
        { title: "Fictional exam guide, 2026", authority: "OFFICIAL" },
      );

      expect(edited).toMatchObject({
        title: "Fictional exam guide, 2026",
        authority: "OFFICIAL",
        createdAt: NOW,
        updatedAt: "2026-06-05T12:00:00.000Z",
      });
      await expect(
        subject.sources.listSnapshots(imported.source.id),
      ).resolves.toMatchObject([{ id: imported.snapshot.id }]);
    });

    it("refuses a source of another track", async () => {
      const imported = await subject.facade.importPastedText(TRACK.slug, {
        title: "Fictional storage notes",
        authority: "USER_AUTHORED",
        text: PASTED,
        isMarkdown: false,
      });

      await expect(
        subject.facade.editSource(OTHER_TRACK.slug, imported.source.id, {
          title: "Stolen",
          authority: "OFFICIAL",
        }),
      ).rejects.toBeInstanceOf(SourceNotFoundError);
    });
  });

  describe("objective links", () => {
    let sourceId: string;

    beforeEach(async () => {
      const imported = await subject.facade.importPastedText(TRACK.slug, {
        title: "Fictional storage notes",
        authority: "USER_AUTHORED",
        text: PASTED,
        isMarkdown: false,
      });

      sourceId = imported.source.id;
    });

    it("maps an objective of the same track", async () => {
      await subject.facade.linkObjective(TRACK.slug, sourceId, OBJECTIVE.id);

      await expect(
        subject.sources.listObjectiveLinks(sourceId),
      ).resolves.toEqual([OBJECTIVE.id]);
    });

    it("refuses an objective belonging to another track", async () => {
      // Re-checked inside the transaction that writes the link, so a link can never
      // cross study tracks.
      await expect(
        subject.facade.linkObjective(
          TRACK.slug,
          sourceId,
          OTHER_TRACK_OBJECTIVE.id,
        ),
      ).rejects.toBeInstanceOf(SourceObjectiveInvalidError);

      await expect(
        subject.sources.listObjectiveLinks(sourceId),
      ).resolves.toEqual([]);
    });

    it("refuses an objective that does not exist", async () => {
      await expect(
        subject.facade.linkObjective(TRACK.slug, sourceId, "objective-nope"),
      ).rejects.toBeInstanceOf(SourceObjectiveInvalidError);
    });

    it("reports a duplicate link as a domain error rather than a constraint failure", async () => {
      await subject.facade.linkObjective(TRACK.slug, sourceId, OBJECTIVE.id);

      await expect(
        subject.facade.linkObjective(TRACK.slug, sourceId, OBJECTIVE.id),
      ).rejects.toBeInstanceOf(SourceObjectiveAlreadyLinkedError);

      await expect(
        subject.sources.listObjectiveLinks(sourceId),
      ).resolves.toHaveLength(1);
    });

    it("removes one link and leaves the rest", async () => {
      await subject.facade.linkObjective(TRACK.slug, sourceId, OBJECTIVE.id);
      await subject.facade.linkObjective(
        TRACK.slug,
        sourceId,
        SECOND_OBJECTIVE.id,
      );

      await subject.facade.unlinkObjective(TRACK.slug, sourceId, OBJECTIVE.id);

      await expect(
        subject.sources.listObjectiveLinks(sourceId),
      ).resolves.toEqual([SECOND_OBJECTIVE.id]);
    });

    it("refuses to unlink through another track's address", async () => {
      await subject.facade.linkObjective(TRACK.slug, sourceId, OBJECTIVE.id);

      await expect(
        subject.facade.unlinkObjective(
          OTHER_TRACK.slug,
          sourceId,
          OBJECTIVE.id,
        ),
      ).rejects.toBeInstanceOf(SourceNotFoundError);
      await expect(
        subject.sources.listObjectiveLinks(sourceId),
      ).resolves.toHaveLength(1);
    });
  });

  describe("archive and restore", () => {
    it("takes a source out of use and brings it back, keeping its content", async () => {
      // Archived rather than deleted: a question generated from this text has to stay
      // verifiable, which is why there is no delete in this slice.
      const imported = await subject.facade.importPastedText(TRACK.slug, {
        title: "Fictional storage notes",
        authority: "USER_AUTHORED",
        text: PASTED,
        isMarkdown: false,
      });

      subject.clock.set("2026-06-03T12:00:00.000Z");
      await subject.facade.archive(TRACK.slug, imported.source.id);

      await expect(
        subject.sources.findById(imported.source.id),
      ).resolves.toMatchObject({
        status: "ARCHIVED",
        updatedAt: "2026-06-03T12:00:00.000Z",
      });
      await expect(
        subject.facade.readSnapshotText(imported.snapshot),
      ).resolves.toBe(PASTED);

      subject.clock.set("2026-06-04T12:00:00.000Z");
      await subject.facade.restore(TRACK.slug, imported.source.id);

      await expect(
        subject.sources.findById(imported.source.id),
      ).resolves.toMatchObject({
        status: "ACTIVE",
        updatedAt: "2026-06-04T12:00:00.000Z",
      });
    });

    it("refuses a source of another track", async () => {
      const imported = await subject.facade.importPastedText(TRACK.slug, {
        title: "Fictional storage notes",
        authority: "USER_AUTHORED",
        text: PASTED,
        isMarkdown: false,
      });

      await expect(
        subject.facade.archive(OTHER_TRACK.slug, imported.source.id),
      ).rejects.toBeInstanceOf(SourceNotFoundError);
      await expect(
        subject.facade.restore(OTHER_TRACK.slug, imported.source.id),
      ).rejects.toBeInstanceOf(SourceNotFoundError);
    });
  });
});
