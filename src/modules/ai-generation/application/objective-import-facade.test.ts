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
import { DETERMINISTIC_MODEL_PROVIDER } from "@/modules/ai-generation/domain/import-strategy";
import { FakeLanguageModelGateway } from "@/modules/ai-generation/infrastructure/fake-language-model-gateway";
import { SqliteGenerationRunRepository } from "@/modules/ai-generation/infrastructure/sqlite-generation-run-repository";
import { SqliteGenerationUnitOfWork } from "@/modules/ai-generation/infrastructure/sqlite-generation-unit-of-work";
import { SqlitePersonaRepository } from "@/modules/ai-generation/infrastructure/sqlite-persona-repository";
import { storedPersonaFixture } from "@/modules/ai-generation/infrastructure/persona-test-support";
import type { StoredPersona } from "@/modules/ai-generation/domain/stored-persona";
import { SYNTHETIC_SYLLABUS } from "@/modules/ai-generation/infrastructure/test-support";
import type {
  DocumentKind,
  DocumentTextExtraction,
  DocumentTextExtractor,
} from "@/platform/documents/document-text-extractor";
import { DocumentUnreadableError } from "@/platform/documents/document-text-extractor";
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
  return {
    // The AI extraction unless a test says otherwise: it is the flow every existing
    // assertion in this file is about, and the deterministic one has its own describe.
    strategyKey: "GENERIC_OUTLINE",
    pastedText: null,
    additionalInstructions: null,
    personaId: null,
    ...overrides,
  };
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
      personas: new SqlitePersonaRepository(database),
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

  /**
   * The same persona resolution the generate form has, for the same reason: an extraction
   * is a paid model call whose instructions come from a persona, and the owner who wrote
   * their own should not have it silently ignored on this screen alone.
   */
  describe("a stored persona", () => {
    const STORED_ROLE =
      "You are the owner's own syllabus reader, and you copy rather than infer.";

    async function storeAndAssign(): Promise<StoredPersona> {
      const persona = storedPersonaFixture({ role: STORED_ROLE, version: 4 });

      await new SqlitePersonaRepository(database).insert(persona);
      await new SqliteCertificationRepository(database).save({
        ...TRACK,
        personaId: persona.id,
      });

      return persona;
    }

    it("offers the assignable personas and the track's assignment on the form", async () => {
      const persona = await storeAndAssign();
      const view = await facade().findImportForm(TRACK.slug);

      expect(view?.personaChoices.map((choice) => choice.id)).toEqual([
        persona.id,
      ]);
      expect(view?.assignedPersonaId).toBe(persona.id);
      expect(view?.persona.id).toBe(persona.personaKey);
    });

    it("uses it for the prompt and records its key and version", async () => {
      const persona = await storeAndAssign();
      const gateway = new FakeLanguageModelGateway();
      const result = await facadeWith(
        new StubExtractor({ text: SYNTHETIC_SYLLABUS }),
        gateway,
      ).extractObjectives(TRACK.slug, request(), upload());

      expect(gateway.promptsSent[0]?.system).toContain(STORED_ROLE);
      expect(result.run.personaId).toBe(persona.personaKey);
      expect(result.run.personaVersion).toBe(4);
    });

    it("lets a choice on the form override the assignment", async () => {
      await storeAndAssign();

      const chosen = storedPersonaFixture({
        id: "persona-2",
        personaKey: "my-other-reader",
        label: "My other reader",
        role: "You are a second reader entirely.",
      });

      await new SqlitePersonaRepository(database).insert(chosen);

      const gateway = new FakeLanguageModelGateway();
      const result = await facadeWith(
        new StubExtractor({ text: SYNTHETIC_SYLLABUS }),
        gateway,
      ).extractObjectives(
        TRACK.slug,
        request({ personaId: chosen.id }),
        upload(),
      );

      expect(gateway.promptsSent[0]?.system).toContain(
        "You are a second reader entirely.",
      );
      expect(result.run.personaId).toBe(chosen.personaKey);
    });

    it("leaves an unassigned track on the built-in persona", async () => {
      await new SqlitePersonaRepository(database).insert(
        storedPersonaFixture({ role: STORED_ROLE }),
      );

      const result = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );

      expect(result.run.personaId).toBe("technical-certification");
      expect(result.run.personaVersion).toBe(1);
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

  /**
   * Importing into a track that already has objectives: the merge.
   *
   * Slice A skipped a whole root whose title or code matched, which made "upload the
   * grammar appendix a week later" throw away every grammar point in the file. Slice B
   * asks a second model call for a verdict per extracted objective instead, so the
   * properties under test are different: additions land *inside* the existing hierarchy,
   * enrichments touch one column of one row, skips write nothing, and the owner can
   * decline any of it individually.
   *
   * The fake gateway's merge fixture is extractive in both directions — it reads the
   * existing objectives and the extracted ones out of the rendered prompt and matches them
   * on folded titles. That is what makes these tests worth running: a facade that stopped
   * sending the existing hierarchy would produce a plan that adds everything at the top
   * level, and every assertion below about nesting and enrichment would fail.
   */
  describe("merging into an existing outline", () => {
    /** The synthetic syllabus's first root, as though the owner already had it. */
    async function saveExistingRoot(
      overrides: Parameters<typeof objectiveFixture>[0] = {},
    ): Promise<void> {
      await objectives.save(
        objectiveFixture({
          id: "objective-existing",
          code: "1",
          title: "Demo Foundations",
          displayOrder: 1,
          ...overrides,
        }),
      );
    }

    it("does not merge at all when the track has no objectives yet", async () => {
      // The whole point of the skip: an empty track has nothing to reconcile against, so
      // the second call is not made and the payload is the plain tree.
      const gateway = new FakeLanguageModelGateway();
      const { run, mergeCounts } = await facadeWith(
        new StubExtractor({ text: SYNTHETIC_SYLLABUS }),
        gateway,
      ).extractObjectives(TRACK.slug, request(), upload());

      expect(mergeCounts).toBeNull();
      expect(gateway.turnsTaken).toBe(1);

      const view = await facade().findConfirmation(TRACK.slug, run.id);

      expect(view?.merge).toBeNull();
      expect(view?.addableCount).toBe(6);
    });

    it("calls the model a second time when the track has objectives", async () => {
      await saveExistingRoot();

      const gateway = new FakeLanguageModelGateway();
      const { mergeCounts } = await facadeWith(
        new StubExtractor({ text: SYNTHETIC_SYLLABUS }),
        gateway,
      ).extractObjectives(TRACK.slug, request(), upload());

      expect(gateway.turnsTaken).toBe(2);
      // The extracted root the track already has is skipped; its two children are added
      // *under* it, which is the behaviour slice A could not express.
      expect(mergeCounts).toEqual({ adds: 5, enriches: 0, skips: 1 });

      const merge = gateway.promptsSent[1]?.user ?? "";

      expect(merge).toContain("objective-existing");
      expect(merge).toContain("ref: n1");
    });

    it("describes each verdict on the confirm view", async () => {
      await saveExistingRoot();

      const { run } = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );
      const view = await facade().findConfirmation(TRACK.slug, run.id);

      // The whole proposal is still counted: the preview has to agree with the document.
      expect(view?.nodeCount).toBe(6);
      expect(view?.merge?.counts).toEqual({ adds: 5, enriches: 0, skips: 1 });
      expect(view?.merge?.existingConsidered).toBe(1);
      expect(view?.merge?.existingTruncated).toBe(false);
      expect(view?.addableCount).toBe(5);
      // Every addition and enrichment starts ticked; skips have no key at all.
      expect(view?.merge?.defaultCheckedKeys).toHaveLength(5);
      expect(
        view?.merge?.items.map((item) => [item.item.kind, item.parentLabel]),
      ).toEqual([
        ["SKIP", null],
        ["ADD", "Demo Foundations"],
        ["ADD", "Demo Foundations"],
        ["ADD", null],
        ["ADD", "Demo Operations"],
        ["ADD", "Demo Operations"],
      ]);
    });

    it("adds the new material inside the existing hierarchy", async () => {
      await saveExistingRoot();

      const { run } = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );
      const applied = await facade().applyImport(
        TRACK.slug,
        run.id,
        "AI_PROPOSED",
      );

      expect(applied).toMatchObject({
        added: 5,
        enriched: 0,
        skipped: 1,
        omitted: 0,
      });

      const stored = await objectives.listByCertification(TRACK.id);
      const under = (parentId: string | null) =>
        byDisplayOrder(
          stored.filter((one) => one.parentObjectiveId === parentId),
        ).map((one) => one.title);

      // Not two copies of "Demo Foundations": the extracted root was skipped, and its
      // children were written under the objective the owner already had.
      expect(under(null)).toEqual(["Demo Foundations", "Demo Operations"]);
      expect(under("objective-existing")).toEqual([
        "Describe demo components",
        "Describe demo boundaries",
      ]);
      expect(stored).toHaveLength(6);
    });

    it("appends under an existing parent without renumbering its children", async () => {
      await saveExistingRoot();
      await objectives.save(
        objectiveFixture({
          id: "objective-existing-child",
          parentObjectiveId: "objective-existing",
          code: "1.1",
          title: "A child the owner wrote themselves",
          displayOrder: 1,
        }),
      );

      const { run } = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );

      await facade().applyImport(TRACK.slug, run.id, "OFFICIAL_SYLLABUS");

      const stored = await objectives.listByCertification(TRACK.id);
      const children = byDisplayOrder(
        stored.filter((one) => one.parentObjectiveId === "objective-existing"),
      );

      expect(children.map((one) => one.title)).toEqual([
        "A child the owner wrote themselves",
        "Describe demo components",
        "Describe demo boundaries",
      ]);
      expect(children[0]?.displayOrder).toBe(1);
    });

    it("writes nothing at all about an objective it skips", async () => {
      // A skip is the majority verdict on a re-upload, so "writes nothing" is the property
      // that keeps re-importing safe. Asserted on the row rather than on the count, because
      // a merge that rewrote a row identically would still bump `updatedAt`.
      await saveExistingRoot({
        weight: 99,
        sourceType: "USER_DEFINED",
        description: "What the owner wrote about it.",
      });

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

      const stored = await objectives.listByCertification(TRACK.id);
      const existing = stored.find((one) => one.id === "objective-existing");

      expect(applied.skipped).toBe(1);
      expect(existing).toEqual(
        objectiveFixture({
          id: "objective-existing",
          code: "1",
          title: "Demo Foundations",
          displayOrder: 1,
          weight: 99,
          sourceType: "USER_DEFINED",
          description: "What the owner wrote about it.",
        }),
      );
    });

    it("writes only what the owner left checked", async () => {
      await saveExistingRoot();

      const { run } = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );
      const view = await facade().findConfirmation(TRACK.slug, run.id);
      // "Demo Operations" and its two children, dropping both additions under the root
      // the owner already had.
      const keys = (view?.merge?.defaultCheckedKeys ?? []).filter(
        (key) => key !== "add:n2" && key !== "add:n3",
      );
      const applied = await facade().applyImport(
        TRACK.slug,
        run.id,
        "AI_PROPOSED",
        keys,
      );

      expect(applied.added).toBe(3);

      const stored = await objectives.listByCertification(TRACK.id);

      expect(
        stored.filter((one) => one.parentObjectiveId === "objective-existing"),
      ).toEqual([]);
      expect(stored).toHaveLength(4);
    });

    it("drops the children of an addition the owner declined", async () => {
      // Unticking a new category takes what belongs inside it with it, cascading, and the
      // count is reported rather than folded into the skips: reparenting the points onto
      // the objective above would put them somewhere the owner did not agree to.
      await saveExistingRoot();

      const { run } = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );
      const applied = await facade().applyImport(
        TRACK.slug,
        run.id,
        "AI_PROPOSED",
        ["add:n2", "add:n3", "add:n5", "add:n6"],
      );

      expect(applied.added).toBe(2);
      expect(applied.omitted).toBe(2);

      const stored = await objectives.listByCertification(TRACK.id);

      expect(stored.map((one) => one.title)).not.toContain("Demo Operations");
    });

    it("refuses the apply when the owner unticks everything", async () => {
      await saveExistingRoot();

      const { run } = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );

      await expect(
        facade().applyImport(TRACK.slug, run.id, "AI_PROPOSED", []),
      ).rejects.toThrow(ObjectiveImportNothingToApplyError);

      // Nothing written, and the run is still appliable: unticking everything is a change
      // of mind, not a spent proposal.
      await expect(
        objectives.listByCertification(TRACK.id),
      ).resolves.toHaveLength(1);
      await expect(runs.findById(run.id)).resolves.toMatchObject({
        appliedAt: null,
      });
    });

    it("refuses a second apply of a merged proposal", async () => {
      await saveExistingRoot();

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

    it("ignores archived objectives, which cannot be enriched or nested under", async () => {
      // An archived objective is not part of the outline the owner is working in, so the
      // merge is not shown it and cannot aim a verdict at it.
      await saveExistingRoot({ status: "ARCHIVED" });

      const gateway = new FakeLanguageModelGateway();
      const { mergeCounts } = await facadeWith(
        new StubExtractor({ text: SYNTHETIC_SYLLABUS }),
        gateway,
      ).extractObjectives(TRACK.slug, request(), upload());

      expect(mergeCounts).toBeNull();
      expect(gateway.turnsTaken).toBe(1);
    });

    it("sums both calls' tokens onto the one run", async () => {
      await saveExistingRoot();

      const { run } = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );

      // Two calls at the fake gateway's fixed usage: one import is one run, and the
      // honest number on it is what the import cost in total.
      expect(run.usageMetadata).toEqual({
        inputTokens: 840,
        outputTokens: 520,
        totalTokens: 1360,
      });
    });

    it("keeps the extraction when the merge cannot be validated", async () => {
      // The expensive half already succeeded. Losing it because the reconciliation went
      // bad would make the owner pay for the document twice.
      await saveExistingRoot();

      const result = await facadeWith(
        new StubExtractor({ text: SYNTHETIC_SYLLABUS }),
        new FakeLanguageModelGateway({ objectiveMergeMode: "MALFORMED" }),
      ).extractObjectives(TRACK.slug, request(), upload());

      expect(result.run.status).toBe("COMPLETED");
      expect(result.proposedCount).toBe(6);
      expect(result.mergeCounts).toBeNull();

      const view = await facade().findConfirmation(TRACK.slug, result.run.id);

      // Degraded to the plain tree: the whole proposal, appended, which is slice A's
      // behaviour and a usable answer.
      expect(view?.merge).toBeNull();
      expect(view?.addableCount).toBe(6);
    });

    it("reads a payload written before the merge existed as a plain tree", async () => {
      // A run recorded last week must still open. Its payload has no `kind` at all.
      const { run } = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );

      expect(run.proposedPayload).not.toContain('"kind"');

      await saveExistingRoot();

      const view = await facade().findConfirmation(TRACK.slug, run.id);

      expect(view?.merge).toBeNull();
      expect(view?.nodeCount).toBe(6);

      const applied = await facade().applyImport(
        TRACK.slug,
        run.id,
        "AI_PROPOSED",
      );

      expect(applied.added).toBe(6);
    });

    it("round-trips a merge payload through the run row", async () => {
      await saveExistingRoot();

      const { run } = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );
      const stored = JSON.parse(run.proposedPayload ?? "{}") as Record<
        string,
        unknown
      >;

      // Both halves on one row: the discriminator, the tree the refs point into, the
      // plan, and the merge's own provenance beside the outline's.
      expect(stored.kind).toBe("MERGE");
      expect(stored.objectives).toHaveLength(2);
      expect(stored.templateId).toBe("objective-merge");
      expect(stored.templateVersion).toBe(1);
      expect(stored.existingConsidered).toBe(1);
      expect(run.promptTemplateId).toBe("objective-import");

      // And read back by a second request, which is what the confirm page is.
      const view = await facade().findConfirmation(TRACK.slug, run.id);

      expect(view?.merge?.items).toHaveLength(6);
      expect(view?.tree?.roots).toHaveLength(2);
    });

    it("drops a verdict whose objective was archived after the merge ran", async () => {
      // The hierarchy is re-read at apply time rather than trusted from the payload, so a
      // verdict aimed at something the owner has since put away is dropped — one verdict,
      // not the whole apply.
      await saveExistingRoot({ title: "Describe demo components" });

      const { run } = await facade().extractObjectives(
        TRACK.slug,
        request(),
        upload(),
      );

      await objectives.archive("objective-existing", START);

      const applied = await facade().applyImport(
        TRACK.slug,
        run.id,
        "AI_PROPOSED",
      );

      expect(applied.enriched).toBe(0);
      expect(applied.added).toBeGreaterThan(0);

      const stored = await objectives.listByCertification(TRACK.id);
      const archived = stored.find((one) => one.id === "objective-existing");

      expect(archived?.description).toBeNull();
    });
  });

  /**
   * The deterministic strategy: parsers instead of a model call.
   *
   * What is asserted here is the seam, not the parsing — the parsers have their own tests
   * and `hsk-import-strategy.test.ts` covers the roles. This is about the four things the
   * facade owns: no model is called, several files are read in one submission, the run
   * records honest provenance for a call that never happened, and the result reaches the
   * confirm and apply steps unchanged.
   */
  describe("a deterministic import", () => {
    const GRAMMAR = JSON.stringify([
      { 类别: "甲类", 类别名称: "甲一", 细目: "细目甲", 语法内容: "第一条" },
      { 类别: "甲类", 类别名称: "甲一", 细目: "", 语法内容: "第二条" },
    ]);

    const SYLLABUS = [
      "1． 听力",
      "◎ 第一部分，共20题。考生做这一部分的题。",
      "2． 阅读",
      "◎ 第一部分，共15题。考生做这一部分的题。",
      "3． 书写",
      "◎ 第一部分，共10题。考生做这一部分的题。",
    ].join("\n");

    function textUpload(filename: string, text: string): UploadedDocument {
      return {
        filename,
        bytes: new TextEncoder().encode(text),
        kind: "PLAIN_TEXT",
      };
    }

    /**
     * A facade whose extractor is never consulted for plain text.
     *
     * The stub is given a failure so that any accidental call to it would be visible: a
     * plain-text upload is decoded by the extractor port in production, so what the test
     * asserts through `passThroughExtractor` is the text reaching the parsers.
     */
    function deterministicFacade(gateway = new FakeLanguageModelGateway()) {
      return facadeWith(passThroughExtractor(), gateway);
    }

    it("calls no model at all", async () => {
      const gateway = new FakeLanguageModelGateway();
      const result = await deterministicFacade(gateway).extractObjectives(
        TRACK.slug,
        request({ strategyKey: "HSK_EXAMINATION" }),
        [textUpload("grammar.json", GRAMMAR)],
      );

      expect(gateway.promptsSent).toEqual([]);
      expect(result.proposedCount).toBeGreaterThan(0);
    });

    it("reads several files in one submission", async () => {
      const result = await deterministicFacade().extractObjectives(
        TRACK.slug,
        request({ strategyKey: "HSK_EXAMINATION" }),
        [
          textUpload("syllabus.txt", SYLLABUS),
          textUpload("grammar.json", GRAMMAR),
        ],
      );

      expect(
        result.fileReadings.map((one) => [one.filename, one.role]),
      ).toEqual([
        ["syllabus.txt", "SYLLABUS_STRUCTURE"],
        ["grammar.json", "GRAMMAR_APPENDIX"],
      ]);

      const view = await deterministicFacade().findConfirmation(
        TRACK.slug,
        result.run.id,
      );

      expect(view?.tree?.roots.map((root) => root.title)).toEqual([
        "Listening",
        "Reading",
        "Writing",
        "Grammar",
      ]);
    });

    it("imports one file on its own", async () => {
      const result = await deterministicFacade().extractObjectives(
        TRACK.slug,
        request({ strategyKey: "HSK_EXAMINATION" }),
        [textUpload("grammar.json", GRAMMAR)],
      );
      const view = await deterministicFacade().findConfirmation(
        TRACK.slug,
        result.run.id,
      );

      expect(view?.tree?.roots.map((root) => root.title)).toEqual(["Grammar"]);
    });

    it("honours a role the owner set instead of classifying", async () => {
      const result = await deterministicFacade().extractObjectives(
        TRACK.slug,
        request({ strategyKey: "HSK_EXAMINATION" }),
        [
          { ...textUpload("grammar.json", GRAMMAR), role: "IGNORE" },
          textUpload("syllabus.txt", SYLLABUS),
        ],
      );

      expect(result.fileReadings[0]?.role).toBe("IGNORE");
      expect(result.fileReadings[0]?.roleWasChosen).toBe(true);

      const view = await deterministicFacade().findConfirmation(
        TRACK.slug,
        result.run.id,
      );

      expect(view?.tree?.roots.map((root) => root.title)).toEqual([
        "Listening",
        "Reading",
        "Writing",
      ]);
    });

    it("records honest provenance for a call that never happened", async () => {
      const result = await deterministicFacade().extractObjectives(
        TRACK.slug,
        request({ strategyKey: "HSK_EXAMINATION" }),
        [textUpload("grammar.json", GRAMMAR)],
      );
      const stored = await runs.findById(result.run.id);

      // A real provider name with zero tokens would be a false record, and leaving the run
      // out of the history would hide an import that can write objectives.
      expect(stored?.modelProvider).toBe(DETERMINISTIC_MODEL_PROVIDER);
      expect(stored?.modelId).toBe("HSK_EXAMINATION");
      expect(stored?.generationMode).toBe("IMPORTED");
      expect(stored?.itemKind).toBe("OBJECTIVE_IMPORT");
      expect(stored?.status).toBe("COMPLETED");
      expect(stored?.usageMetadata).toBeNull();
      expect(stored?.completedAt).toBe(START);
      expect(stored?.proposedPayload).not.toBeNull();
    });

    it("says on the confirm view that no model was called", async () => {
      const result = await deterministicFacade().extractObjectives(
        TRACK.slug,
        request({ strategyKey: "HSK_EXAMINATION" }),
        [textUpload("grammar.json", GRAMMAR)],
      );
      const view = await deterministicFacade().findConfirmation(
        TRACK.slug,
        result.run.id,
      );

      expect(view?.strategy.key).toBe("HSK_EXAMINATION");
      expect(view?.strategy.callsModel).toBe(false);
    });

    it("applies through the ordinary confirm step", async () => {
      const result = await deterministicFacade().extractObjectives(
        TRACK.slug,
        request({ strategyKey: "HSK_EXAMINATION" }),
        [textUpload("grammar.json", GRAMMAR)],
      );
      const applied = await deterministicFacade().applyImport(
        TRACK.slug,
        result.run.id,
        "OFFICIAL_SYLLABUS",
      );

      expect(applied.added).toBe(result.proposedCount);

      const stored = await objectives.listByCertification(TRACK.id);

      expect(stored.map((one) => one.title)).toContain("Grammar");
      expect(
        stored.every((one) => one.sourceType === "OFFICIAL_SYLLABUS"),
      ).toBe(true);
    });

    it("merges a re-upload rather than duplicating it", async () => {
      const first = await deterministicFacade().extractObjectives(
        TRACK.slug,
        request({ strategyKey: "HSK_EXAMINATION" }),
        [textUpload("grammar.json", GRAMMAR)],
      );

      await deterministicFacade().applyImport(
        TRACK.slug,
        first.run.id,
        "OFFICIAL_SYLLABUS",
      );

      // The same upload again: the case the owner will actually hit when they come back
      // with one more file a week later. A deterministic *parse* still gets an AI merge,
      // because reconciling two outlines is the part no parser can do.
      const second = await deterministicFacade().extractObjectives(
        TRACK.slug,
        request({ strategyKey: "HSK_EXAMINATION" }),
        [textUpload("grammar.json", GRAMMAR)],
      );

      expect(second.mergeCounts?.adds).toBe(0);

      const view = await deterministicFacade().findConfirmation(
        TRACK.slug,
        second.run.id,
      );

      expect(view?.addableCount).toBe(0);
      expect(view?.merge).not.toBeNull();

      await deterministicFacade().applyImport(
        TRACK.slug,
        second.run.id,
        "OFFICIAL_SYLLABUS",
      );

      // Nothing added. The second upload of the same file can only enrich or skip what is
      // already there, which is exactly what slice A could not do without dropping it all.
      await expect(
        objectives.listByCertification(TRACK.id),
      ).resolves.toHaveLength(first.proposedCount);
    });

    it("enriches an existing objective's description and nothing else", async () => {
      // The merge's one and only write to something the owner already had, asserted on the
      // deterministic path because its parsed nodes carry the descriptions that give an
      // enrichment something to say.
      const first = await deterministicFacade().extractObjectives(
        TRACK.slug,
        request({ strategyKey: "HSK_EXAMINATION" }),
        [textUpload("grammar.json", GRAMMAR)],
      );

      await deterministicFacade().applyImport(
        TRACK.slug,
        first.run.id,
        "OFFICIAL_SYLLABUS",
      );

      const before = await objectives.listByCertification(TRACK.id);
      const second = await deterministicFacade().extractObjectives(
        TRACK.slug,
        request({ strategyKey: "HSK_EXAMINATION" }),
        [textUpload("grammar.json", GRAMMAR)],
      );
      const applied = await deterministicFacade().applyImport(
        TRACK.slug,
        second.run.id,
        "AI_PROPOSED",
      );

      expect(applied.enriched).toBeGreaterThan(0);

      const after = await objectives.listByCertification(TRACK.id);
      const changed = after.filter(
        (one) =>
          one.description !==
          before.find((other) => other.id === one.id)?.description,
      );

      expect(changed).toHaveLength(applied.enriched);
      // Every other column survives, including the source type: an enrichment does not
      // relabel an objective the owner already had as coming from this import.
      for (const objective of changed) {
        const original = before.find((one) => one.id === objective.id);

        expect(objective).toMatchObject({
          title: original?.title,
          code: original?.code,
          weight: original?.weight,
          parentObjectiveId: original?.parentObjectiveId,
          displayOrder: original?.displayOrder,
          sourceType: "OFFICIAL_SYLLABUS",
          status: "ACTIVE",
        });
      }
    });

    it("records the merge's tokens even though the parse spent none", async () => {
      // The parse really was free, so the run's usage is the merge's alone — and it must
      // not be `null`, because a model call was made and billed.
      const first = await deterministicFacade().extractObjectives(
        TRACK.slug,
        request({ strategyKey: "HSK_EXAMINATION" }),
        [textUpload("grammar.json", GRAMMAR)],
      );

      expect(first.run.usageMetadata).toBeNull();

      await deterministicFacade().applyImport(
        TRACK.slug,
        first.run.id,
        "OFFICIAL_SYLLABUS",
      );

      const second = await deterministicFacade().extractObjectives(
        TRACK.slug,
        request({ strategyKey: "HSK_EXAMINATION" }),
        [textUpload("grammar.json", GRAMMAR)],
      );

      expect(second.run.usageMetadata).toEqual({
        inputTokens: 420,
        outputTokens: 260,
        totalTokens: 680,
      });
      // The provenance stays honest about which half called nothing: the run says
      // `deterministic`, and the payload names the model the merge used.
      expect(second.run.modelProvider).toBe(DETERMINISTIC_MODEL_PROVIDER);
      expect(second.run.proposedPayload).toContain('"kind":"MERGE"');
    });

    it("records a failed run when no file could be read", async () => {
      // Not an exception: a submission that parsed to nothing is a real outcome the owner
      // should be able to read, and the confirm page explains it.
      const result = await deterministicFacade().extractObjectives(
        TRACK.slug,
        request({ strategyKey: "HSK_EXAMINATION" }),
        [textUpload("cover.txt", "Nothing structural in here at all.")],
      );

      expect(result.proposedCount).toBe(0);
      expect(result.fileReadings[0]?.role).toBe("UNRECOGNIZED");
      expect(result.run.status).toBe("FAILED");
      expect(result.run.failureReason).toBe("NO_USABLE_ITEMS");
    });

    it("refuses a submission with no files rather than recording an empty run", async () => {
      await expect(
        deterministicFacade().extractObjectives(
          TRACK.slug,
          request({ strategyKey: "HSK_EXAMINATION" }),
          [],
        ),
      ).rejects.toThrow(SyllabusUnreadableError);

      const history = await runs.list({
        certificationId: TRACK.id,
        limit: 10,
        offset: 0,
      });

      expect(history.items).toEqual([]);
    });
  });
});

/**
 * An extractor that hands plain-text bytes back as text.
 *
 * The real adapter decodes UTF-8 for `PLAIN_TEXT` and parses PDFs; the deterministic
 * strategy only ever needs the former, so this stands in for it without pulling the PDF
 * library into a facade test.
 */
function passThroughExtractor(): DocumentTextExtractor {
  return {
    async extract(
      bytes: Uint8Array,
      kind: DocumentKind,
    ): Promise<DocumentTextExtraction> {
      if (kind === "PDF") {
        throw new DocumentUnreadableError("No PDF is expected in this test.");
      }

      return {
        text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        pageCount: 1,
      };
    },
  };
}
