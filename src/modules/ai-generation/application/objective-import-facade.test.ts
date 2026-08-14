import { beforeEach, describe, expect, it } from "vitest";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import { CertificationNotFoundError } from "@/modules/certifications/domain/errors";
import { SqliteCertificationRepository } from "@/modules/certifications/infrastructure/sqlite-certification-repository";
import { SqliteObjectiveRepository } from "@/modules/certifications/infrastructure/sqlite-objective-repository";
import {
  FixedClock,
  SequentialIdGenerator,
  certificationFixture,
  createMigratedDatabase,
  objectiveFixture,
} from "@/modules/certifications/infrastructure/test-support";
import {
  ObjectiveImportAlreadyAppliedError,
  ObjectiveImportNothingToApplyError,
  SyllabusUnreadableError,
} from "@/modules/ai-generation/domain/errors";
import { FakeLanguageModelGateway } from "@/modules/ai-generation/infrastructure/fake-language-model-gateway";
import { SqliteGenerationRunRepository } from "@/modules/ai-generation/infrastructure/sqlite-generation-run-repository";
import { SqliteGenerationUnitOfWork } from "@/modules/ai-generation/infrastructure/sqlite-generation-unit-of-work";
import { SYNTHETIC_SYLLABUS } from "@/modules/ai-generation/infrastructure/test-support";
import type {
  DocumentKind,
  DocumentTextExtraction,
  DocumentTextExtractor,
} from "@/modules/ai-generation/ports/document-text-extractor";
import { DocumentUnreadableError } from "@/modules/ai-generation/ports/document-text-extractor";
import { ObjectiveImportFacade } from "./objective-import-facade";
import type { UploadedDocument } from "./objective-import-facade";
import { MAX_SYLLABUS_CHARACTERS } from "./schemas";
import type { ObjectiveImportRequestInput } from "./schemas";

/**
 * The objective import end to end, over the real SQLite adapters and the fake gateway.
 *
 * The extractor is stubbed and the gateway is the deterministic one; everything else —
 * the run repository, the objective repository, the transaction runner, the migrated
 * schema — is production code (`spec/TESTING.md` section 5). The stub extractor is the
 * point of having a port: a facade test should not be parsing PDFs, and the real
 * adapter has its own test.
 *
 * Four properties are what these tests exist for:
 *
 * 1. Extraction writes a run and **nothing else**. No objective exists until apply.
 * 2. The proposal survives on the run row, so the confirm page can be refreshed.
 * 3. Apply inserts the whole tree once, in order, after what was already there.
 * 4. A second apply is refused rather than doubling the outline.
 */

const TRACK = certificationFixture();
const START = "2026-05-01T08:00:00.000Z";

/** An extractor that returns whatever the test says the document contained. */
class StubExtractor implements DocumentTextExtractor {
  readonly calls: {
    readonly kind: DocumentKind;
    readonly byteLength: number;
  }[] = [];

  constructor(
    private readonly outcome:
      { readonly text: string } | { readonly fail: string },
  ) {}

  async extract(
    bytes: Uint8Array,
    kind: DocumentKind,
  ): Promise<DocumentTextExtraction> {
    this.calls.push({ kind, byteLength: bytes.byteLength });

    if ("fail" in this.outcome) {
      throw new DocumentUnreadableError(this.outcome.fail);
    }

    return { text: this.outcome.text, pageCount: 1 };
  }
}

function request(
  overrides: Partial<ObjectiveImportRequestInput> = {},
): ObjectiveImportRequestInput {
  return { pastedText: null, additionalInstructions: null, ...overrides };
}

function upload(
  bytes: Uint8Array = new TextEncoder().encode("a pdf's bytes"),
  kind: DocumentKind = "PDF",
): UploadedDocument {
  return { filename: "demo-exam-guide.pdf", bytes, kind };
}

/**
 * Objectives in display order.
 *
 * The repository returns rows, and the order this feature is judged on is the one the
 * owner sees, so the assertions sort explicitly rather than relying on how SQLite
 * happened to return them. A copy, because sorting the caller's array in place would
 * make one assertion's setup depend on an earlier one's.
 */
function byDisplayOrder<T extends { readonly displayOrder: number }>(
  list: readonly T[],
): readonly T[] {
  return [...list].sort(
    (left, right) => left.displayOrder - right.displayOrder,
  );
}

describe("ObjectiveImportFacade", () => {
  let database: SqliteDatabase;
  let clock: FixedClock;
  let ids: SequentialIdGenerator;
  let runs: SqliteGenerationRunRepository;
  let objectives: SqliteObjectiveRepository;

  function facadeWith(
    extractor: DocumentTextExtractor,
    gateway: FakeLanguageModelGateway = new FakeLanguageModelGateway(),
  ): ObjectiveImportFacade {
    return new ObjectiveImportFacade({
      certifications: new SqliteCertificationRepository(database),
      unitOfWork: new SqliteGenerationUnitOfWork(database),
      gateway,
      extractor,
      clock,
      ids,
    });
  }

  /** The ordinary facade: a document that extracts to the synthetic syllabus. */
  function facade(): ObjectiveImportFacade {
    return facadeWith(new StubExtractor({ text: SYNTHETIC_SYLLABUS }));
  }

  beforeEach(async () => {
    database = createMigratedDatabase();
    clock = new FixedClock(START);
    ids = new SequentialIdGenerator("import");
    runs = new SqliteGenerationRunRepository(database);
    objectives = new SqliteObjectiveRepository(database);

    await new SqliteCertificationRepository(database).save(TRACK);
  });

  describe("the upload form", () => {
    it("describes the track, the persona, and the limits", async () => {
      const view = await facade().findImportForm(TRACK.slug);

      expect(view?.certification.id).toBe(TRACK.id);
      expect(view?.persona.id).toBe("technical-certification");
      expect(view?.maxCharacters).toBe(MAX_SYLLABUS_CHARACTERS);
      expect(view?.existingObjectiveCount).toBe(0);
    });

    it("is absent for a track that does not exist", async () => {
      await expect(
        facade().findImportForm("no-such-track"),
      ).resolves.toBeNull();
    });
  });

  describe("extraction", () => {
    it("records a completed run carrying the proposed tree", async () => {
      const result = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );

      expect(result.run.status).toBe("COMPLETED");
      expect(result.run.itemKind).toBe("OBJECTIVE_IMPORT");
      expect(result.run.promptTemplateId).toBe("objective-import");
      // Grounded in a document the owner supplied, not written from model knowledge.
      expect(result.run.generationMode).toBe("SOURCE_GROUNDED");
      expect(result.proposedCount).toBe(6);
      // The count of objectives proposed, not of documents read.
      expect(result.run.successfulItemCount).toBe(6);
      expect(result.run.requestedItemCount).toBe(1);
      expect(result.run.proposedPayload).not.toBeNull();
      expect(result.run.appliedAt).toBeNull();

      // The row, not just the returned value: the confirm page reads the row.
      const stored = await runs.findById(result.run.id);

      expect(stored?.proposedPayload).toBe(result.run.proposedPayload);
    });

    it("adds no objective to the track", async () => {
      // The single most important assertion in this file. Extraction costs a model call
      // and changes nothing the owner can see except their run history.
      await facade().extractObjectives(TRACK.slug, request(), upload());

      await expect(objectives.listByCertification(TRACK.id)).resolves.toEqual(
        [],
      );
    });

    it("sends the extracted document to the model inside the document delimiters", async () => {
      const gateway = new FakeLanguageModelGateway();

      await facadeWith(
        new StubExtractor({ text: SYNTHETIC_SYLLABUS }),
        gateway,
      ).extractObjectives(TRACK.slug, request(), upload());

      const prompt = gateway.promptsSent[0];

      expect(prompt?.user).toContain("<owner_uploaded_document>");
      expect(prompt?.user).toContain("1. Demo Foundations (40%)");
      // Never in the system instructions — the assertion the template test makes about
      // rendering, made again here about what the facade actually passed.
      expect(prompt?.system).not.toContain("Demo Foundations");
    });

    it("accepts pasted text with no file at all", async () => {
      const extractor = new StubExtractor({ text: "never used" });
      const result = await facadeWith(extractor).extractObjectives(
        TRACK.slug,
        request({ pastedText: SYNTHETIC_SYLLABUS }),
        null,
      );

      expect(extractor.calls).toEqual([]);
      expect(result.proposedCount).toBe(6);
    });

    it("normalizes extracted text, so ligatures and broken spacing do not reach the model", async () => {
      const gateway = new FakeLanguageModelGateway();

      await facadeWith(
        new StubExtractor({
          // The ligature and the doubled spacing are what a PDF extractor really emits.
          text: "1.  Deﬁne  demo   components\r\n\n\n\n2. Demo Operations",
        }),
        gateway,
      ).extractObjectives(TRACK.slug, request(), upload());

      const sent = gateway.promptsSent[0]?.user ?? "";

      expect(sent).toContain("1. Define demo components");
      expect(sent).not.toContain("ﬁ");
      expect(sent).not.toContain("\r");
      expect(sent).not.toContain("\n\n\n");
    });

    it("truncates a document longer than the character cap and says so", async () => {
      // Reported rather than hidden: the end of a long document really is lost, and the
      // confirm page tells the owner to check for a missing final section.
      const result = await facadeWith(
        new StubExtractor({
          text: `${SYNTHETIC_SYLLABUS}\n${"x".repeat(MAX_SYLLABUS_CHARACTERS)}`,
        }),
      ).extractObjectives(TRACK.slug, request(), upload());

      expect(result.truncated).toBe(true);
      expect(result.run.status).toBe("COMPLETED");
    });

    it("does not report truncation for a document that fits", async () => {
      const result = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );

      expect(result.truncated).toBe(false);
    });

    it("refuses an unreadable file without recording a run", async () => {
      // No model was called, so a run row would claim a call that never happened.
      const facadeUnderTest = facadeWith(
        new StubExtractor({ fail: "That PDF could not be read." }),
      );

      await expect(
        facadeUnderTest.extractObjectives(TRACK.slug, request(), upload()),
      ).rejects.toThrow(SyllabusUnreadableError);

      const history = await runs.list({
        certificationId: TRACK.id,
        limit: 10,
        offset: 0,
      });

      expect(history.totalCount).toBe(0);
    });

    it("refuses an empty file and an empty paste", async () => {
      await expect(
        facade().extractObjectives(
          TRACK.slug,
          request(),
          upload(new Uint8Array(0)),
        ),
      ).rejects.toThrow(SyllabusUnreadableError);

      await expect(
        facadeWith(new StubExtractor({ text: "   \n  " })).extractObjectives(
          TRACK.slug,
          request(),
          upload(),
        ),
      ).rejects.toThrow(SyllabusUnreadableError);
    });

    it("records a failed run when the model cannot produce a usable outline", async () => {
      // A failed run is a recorded outcome the owner can read, not an exception: the
      // call was made and paid for.
      const result = await facadeWith(
        new StubExtractor({ text: SYNTHETIC_SYLLABUS }),
        new FakeLanguageModelGateway({ objectiveImportMode: "MALFORMED" }),
      ).extractObjectives(TRACK.slug, request(), upload());

      expect(result.run.status).toBe("FAILED");
      expect(result.run.failureReason).toBe("MALFORMED_OUTPUT");
      expect(result.run.proposedPayload).toBeNull();
      expect(result.proposedCount).toBe(0);
      await expect(objectives.listByCertification(TRACK.id)).resolves.toEqual(
        [],
      );
    });

    it("completes with an empty proposal for a document that states no outline", async () => {
      // A real Bedrock extraction against a page of prose is what put this test here. The
      // schema used to require at least one objective, so the model invented one titled
      // "No objectives found in document" — and the confirm page offered to add it. An
      // empty proposal is now a valid, completed answer that applies to nothing.
      const result = await facadeWith(
        new StubExtractor({
          text: "A paragraph of prose with no numbered outline anywhere in it.",
        }),
      ).extractObjectives(TRACK.slug, request(), upload());

      expect(result.run.status).toBe("COMPLETED");
      expect(result.proposedCount).toBe(0);
      expect(result.run.successfulItemCount).toBe(0);

      const view = await facade().findConfirmation(TRACK.slug, result.run.id);

      // Empty, not unreadable: the confirm page distinguishes the two.
      expect(view?.nodeCount).toBe(0);
      expect(view?.tree?.roots).toEqual([]);

      await expect(
        facade().applyImport(TRACK.slug, result.run.id, "AI_PROPOSED"),
      ).rejects.toThrow(ObjectiveImportNothingToApplyError);
      await expect(objectives.listByCertification(TRACK.id)).resolves.toEqual(
        [],
      );
    });

    it("refuses a track that does not exist", async () => {
      await expect(
        facade().extractObjectives("no-such-track", request(), upload()),
      ).rejects.toThrow(CertificationNotFoundError);
    });
  });

  describe("the confirm view", () => {
    it("reads the proposal back from the run row", async () => {
      const { run } = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );
      const view = await facade().findConfirmation(TRACK.slug, run.id);

      expect(view?.nodeCount).toBe(6);
      expect(view?.applied).toBe(false);
      expect(view?.tree?.roots).toHaveLength(2);
      expect(view?.tree?.roots[0]?.title).toBe("Demo Foundations");
      expect(view?.tree?.roots[0]?.weight).toBe(40);
      expect(view?.tree?.roots[0]?.children).toHaveLength(2);
    });

    it("is absent for a run belonging to another track", async () => {
      // Scoped in the query as well as the route, so a run identifier cannot be read
      // through a different track's URL.
      const other = certificationFixture({
        id: "certification-2",
        slug: "demo-other-track",
        name: "Demo Other Track",
      });

      await new SqliteCertificationRepository(database).save(other);

      const { run } = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );

      await expect(
        facade().findConfirmation(other.slug, run.id),
      ).resolves.toBeNull();
    });

    it("is absent for a run identifier that does not exist", async () => {
      await expect(
        facade().findConfirmation(TRACK.slug, "no-such-run"),
      ).resolves.toBeNull();
    });
  });

  describe("applying a proposal", () => {
    it("inserts the whole tree in document order, with the chosen source type", async () => {
      const { run } = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );
      const applied = await facade().applyImport(
        TRACK.slug,
        run.id,
        "OFFICIAL_SYLLABUS",
      );

      expect(applied.added).toBe(6);

      const stored = await objectives.listByCertification(TRACK.id);
      const roots = stored.filter((one) => one.parentObjectiveId === null);

      expect(stored).toHaveLength(6);
      expect(
        byDisplayOrder(roots).map((one) => [
          one.code,
          one.title,
          one.weight,
          one.displayOrder,
        ]),
      ).toEqual([
        ["1", "Demo Foundations", 40, 1],
        ["2", "Demo Operations", 60, 2],
      ]);

      const firstRoot = roots.find((one) => one.code === "1");
      const children = byDisplayOrder(
        stored.filter((one) => one.parentObjectiveId === firstRoot?.id),
      );

      expect(children.map((one) => [one.code, one.displayOrder])).toEqual([
        ["1.1", 1],
        ["1.2", 2],
      ]);

      for (const objective of stored) {
        expect(objective.sourceType).toBe("OFFICIAL_SYLLABUS");
        expect(objective.status).toBe("ACTIVE");
        expect(objective.certificationId).toBe(TRACK.id);
      }
    });

    it("records the owner's unofficial choice instead when they choose it", async () => {
      // The provenance claim is the owner's to make: a model reading a PDF is not the
      // authority that makes an objective official.
      const { run } = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );

      await facade().applyImport(TRACK.slug, run.id, "AI_PROPOSED");

      const stored = await objectives.listByCertification(TRACK.id);

      expect(stored.every((one) => one.sourceType === "AI_PROPOSED")).toBe(
        true,
      );
    });

    it("appends after existing objectives and leaves them untouched", async () => {
      await objectives.save(
        objectiveFixture({
          id: "objective-existing",
          code: "Existing",
          title: "An objective the owner typed",
          displayOrder: 1,
        }),
      );

      const { run } = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );

      await facade().applyImport(TRACK.slug, run.id, "AI_PROPOSED");

      const stored = await objectives.listByCertification(TRACK.id);
      const existing = stored.find((one) => one.id === "objective-existing");

      expect(existing?.title).toBe("An objective the owner typed");
      expect(existing?.displayOrder).toBe(1);
      expect(existing?.sourceType).toBe(objectiveFixture().sourceType);
      expect(
        byDisplayOrder(
          stored.filter((one) => one.parentObjectiveId === null),
        ).map((one) => one.displayOrder),
      ).toEqual([1, 2, 3]);
    });

    it("marks the run applied, so the confirm page stops offering it", async () => {
      const { run } = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );

      await facade().applyImport(TRACK.slug, run.id, "AI_PROPOSED");

      const view = await facade().findConfirmation(TRACK.slug, run.id);

      expect(view?.applied).toBe(true);
      expect(view?.run.appliedAt).toBe(START);
    });

    it("refuses a second apply rather than doubling the outline", async () => {
      // The case a stale tab or a browser back-and-resubmit produces. Doubling would be
      // silent and would leave the owner with twelve objectives and no way to tell which
      // six to delete.
      const { run } = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );

      await facade().applyImport(TRACK.slug, run.id, "AI_PROPOSED");

      await expect(
        facade().applyImport(TRACK.slug, run.id, "AI_PROPOSED"),
      ).rejects.toThrow(ObjectiveImportAlreadyAppliedError);

      await expect(
        objectives.listByCertification(TRACK.id),
      ).resolves.toHaveLength(6);
    });

    it("discarding applies nothing and leaves the run in the history", async () => {
      // Discard is a navigation away, so "discarded" is the absence of an apply. What is
      // asserted is that the absence is harmless: no objective, and the run still there.
      const { run } = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );

      await expect(objectives.listByCertification(TRACK.id)).resolves.toEqual(
        [],
      );

      const stored = await runs.findById(run.id);

      expect(stored?.status).toBe("COMPLETED");
      expect(stored?.appliedAt).toBeNull();
    });

    it("refuses to apply a failed run, which proposed nothing", async () => {
      const { run } = await facadeWith(
        new StubExtractor({ text: SYNTHETIC_SYLLABUS }),
        new FakeLanguageModelGateway({ objectiveImportMode: "MALFORMED" }),
      ).extractObjectives(TRACK.slug, request(), upload());

      await expect(
        facade().applyImport(TRACK.slug, run.id, "AI_PROPOSED"),
      ).rejects.toThrow(ObjectiveImportNothingToApplyError);
    });

    it("refuses to apply a run identifier that does not exist", async () => {
      await expect(
        facade().applyImport(TRACK.slug, "no-such-run", "AI_PROPOSED"),
      ).rejects.toThrow(ObjectiveImportNothingToApplyError);
    });

    it("refuses to apply another track's run", async () => {
      const other = certificationFixture({
        id: "certification-2",
        slug: "demo-other-track",
        name: "Demo Other Track",
      });

      await new SqliteCertificationRepository(database).save(other);

      const { run } = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );

      await expect(
        facade().applyImport(other.slug, run.id, "AI_PROPOSED"),
      ).rejects.toThrow(ObjectiveImportNothingToApplyError);
      await expect(objectives.listByCertification(other.id)).resolves.toEqual(
        [],
      );
    });
  });
});
