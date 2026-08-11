import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  InvalidLifecycleTransitionError,
  InvalidQualityTransitionError,
  InvalidQuestionContentError,
  QuestionNotDeletableError,
  QuestionNotFoundError,
  QuestionObjectiveMismatchError,
} from "@/modules/question-bank/domain/errors";
import type { QuestionId } from "@/modules/question-bank/domain/question";
import { FlashcardQuestionDependencyChecker } from "@/modules/flashcards/infrastructure/flashcard-question-dependency-checker";
import { SqliteFlashcardRepository } from "@/modules/flashcards/infrastructure/sqlite-flashcard-repository";
import { SqliteQuestionBankUnitOfWork } from "@/modules/question-bank/infrastructure/sqlite-question-bank-unit-of-work";
import { SqliteQuestionRepository } from "@/modules/question-bank/infrastructure/sqlite-question-repository";
import type {
  QuestionDependencyChecker,
  QuestionDeletionEligibility,
} from "@/modules/question-bank/ports/question-dependency-checker";
import { QuestionBankFacade } from "./question-bank-facade";
import type { QuestionFilterInput, QuestionInput } from "./schemas";

/**
 * Facade behaviour over the real SQLite adapter, with an injected clock and ID
 * generator so revision numbering, timestamps, and identifiers are deterministic.
 */

const TRACK = certificationFixture();
const SECOND_TRACK = certificationFixture({
  id: "certification-2",
  slug: "second-track",
  name: "Second Track",
});

function singleChoiceInput(
  overrides: Partial<
    Extract<QuestionInput, { questionType: "SINGLE_CHOICE" }>
  > = {},
): QuestionInput {
  return {
    questionType: "SINGLE_CHOICE",
    stem: "Which service stores objects?",
    instructions: null,
    explanation: null,
    difficulty: null,
    tags: [],
    language: null,
    choiceTexts: ["Amazon S3", "Amazon EBS"],
    correctChoiceIndexes: [0],
    ...overrides,
  };
}

function shortAnswerInput(): QuestionInput {
  return {
    questionType: "SHORT_ANSWER",
    stem: "Describe object storage durability.",
    instructions: null,
    explanation: null,
    difficulty: 3,
    tags: ["storage"],
    language: "en",
    expectedConcepts: ["eleven nines", "replication"],
  };
}

const NO_FILTERS: QuestionFilterInput = {
  lifecycle: null,
  quality: null,
  type: null,
  objective: null,
  q: null,
  page: 1,
};

/** Records the ids it was asked about, and blocks whichever it is told to. */
class StubDependencyChecker implements QuestionDependencyChecker {
  readonly asked: string[] = [];

  constructor(private readonly blocked: ReadonlySet<string> = new Set()) {}

  async checkDeletionEligibility(
    id: QuestionId,
  ): Promise<QuestionDeletionEligibility> {
    this.asked.push(id);

    return this.blocked.has(id)
      ? { deletable: false, blockingDependencies: ["ATTEMPTS"] }
      : { deletable: true, blockingDependencies: [] };
  }
}

describe("QuestionBankFacade", () => {
  let database: SqliteDatabase;
  let clock: FixedClock;
  let dependencies: QuestionDependencyChecker;
  let facade: QuestionBankFacade;

  function buildFacade(checker: QuestionDependencyChecker): QuestionBankFacade {
    dependencies = checker;

    return new QuestionBankFacade({
      questions: new SqliteQuestionRepository(database),
      certifications: new SqliteCertificationRepository(database),
      objectives: new SqliteObjectiveRepository(database),
      unitOfWork: new SqliteQuestionBankUnitOfWork(database),
      dependencies: checker,
      clock,
      ids: new SequentialIdGenerator("gen"),
    });
  }

  beforeEach(async () => {
    database = createMigratedDatabase();
    clock = new FixedClock();
    // The composed checker, so this suite exercises the same dependency source
    // production does. D3 composed `NoDependencyChecker` here; D4 replaced it
    // because converted flashcards are the first real dependents of a question.
    facade = buildFacade(
      new FlashcardQuestionDependencyChecker(
        new SqliteFlashcardRepository(database),
      ),
    );

    const certifications = new SqliteCertificationRepository(database);
    const objectives = new SqliteObjectiveRepository(database);

    await certifications.save(TRACK);
    await certifications.save(SECOND_TRACK);
    await objectives.save(objectiveFixture());
    await objectives.save(
      objectiveFixture({
        id: "objective-other",
        certificationId: SECOND_TRACK.id,
        title: "Objective of another track",
      }),
    );
  });

  afterEach(() => {
    database.close();
  });

  describe("creating a question", () => {
    it("creates a manual draft with revision 1", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      expect(created.lifecycleStatus).toBe("DRAFT");
      expect(created.qualityStatus).toBe("UNREVIEWED");
      expect(created.generationMode).toBe("MANUAL");
      expect(created.disputeReason).toBeNull();

      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.currentRevision.revisionNumber).toBe(1);
      expect(view?.currentRevision.content).toEqual({
        type: "SINGLE_CHOICE",
        choices: [
          { id: "choice-1", text: "Amazon S3" },
          { id: "choice-2", text: "Amazon EBS" },
        ],
        correctChoiceId: "choice-1",
      });
      expect(view?.revisions).toHaveLength(1);
    });

    it("stores short-answer content and its metadata", async () => {
      const created = await facade.createQuestion(TRACK.id, shortAnswerInput());
      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.currentRevision.content).toEqual({
        type: "SHORT_ANSWER",
        expectedConcepts: ["eleven nines", "replication"],
      });
      expect(view?.currentRevision.difficulty).toBe(3);
      expect(view?.currentRevision.tags).toEqual(["storage"]);
      expect(view?.currentRevision.language).toBe("en");
    });

    it("drops blank choice rows and still marks the row the owner chose", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput({
          choiceTexts: ["Amazon S3", "Amazon EBS", "", ""],
          correctChoiceIndexes: [1],
        }),
      );
      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.currentRevision.content).toEqual({
        type: "SINGLE_CHOICE",
        choices: [
          { id: "choice-1", text: "Amazon S3" },
          { id: "choice-2", text: "Amazon EBS" },
        ],
        correctChoiceId: "choice-2",
      });
    });

    it("rejects a single-choice question with no marked answer", async () => {
      await expect(
        facade.createQuestion(
          TRACK.id,
          singleChoiceInput({ correctChoiceIndexes: [] }),
        ),
      ).rejects.toBeInstanceOf(InvalidQuestionContentError);
    });

    it("rejects a marked answer that points at a blank row", async () => {
      await expect(
        facade.createQuestion(
          TRACK.id,
          singleChoiceInput({
            choiceTexts: ["Amazon S3", "Amazon EBS", ""],
            correctChoiceIndexes: [2],
          }),
        ),
      ).rejects.toBeInstanceOf(InvalidQuestionContentError);
    });

    it("rejects fewer than two usable choices", async () => {
      await expect(
        facade.createQuestion(
          TRACK.id,
          singleChoiceInput({
            choiceTexts: ["Only one", ""],
            correctChoiceIndexes: [0],
          }),
        ),
      ).rejects.toBeInstanceOf(InvalidQuestionContentError);
    });

    it("rejects an unknown certification and writes nothing", async () => {
      await expect(
        facade.createQuestion("missing", singleChoiceInput()),
      ).rejects.toBeInstanceOf(CertificationNotFoundError);

      await expect(facade.countBank(TRACK.id)).resolves.toEqual({
        total: 0,
        active: 0,
      });
    });
  });

  describe("editing a question", () => {
    it("appends revision 2 and leaves revision 1 as written", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput({ stem: "Original wording?" }),
      );

      clock.set("2026-03-01T09:00:00.000Z");

      const revision = await facade.reviseQuestion(
        created.id,
        singleChoiceInput({ stem: "Corrected wording?" }),
      );

      expect(revision.revisionNumber).toBe(2);

      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.currentRevision.stem).toBe("Corrected wording?");
      expect(view?.revisions).toHaveLength(2);
      // History is newest first in the view; revision 1 is unchanged.
      expect(view?.revisions.at(-1)?.revisionNumber).toBe(1);
      expect(view?.revisions.at(-1)?.stem).toBe("Original wording?");

      const first = await facade.findRevisionView(TRACK.slug, created.id, 1);

      expect(first?.revision.stem).toBe("Original wording?");
      expect(first?.isCurrent).toBe(false);
    });

    it("leaves both statuses untouched when a retired question is edited", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      await facade.activateQuestion(created.id);
      await facade.retireQuestion(created.id);
      await facade.reviseQuestion(
        created.id,
        singleChoiceInput({ stem: "Fixed while retired?" }),
      );

      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.question.lifecycleStatus).toBe("RETIRED");
      expect(view?.question.qualityStatus).toBe("UNREVIEWED");
      expect(view?.currentRevision.stem).toBe("Fixed while retired?");
    });

    it("keeps a dispute and its reason when a disputed question is edited", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      await facade.disputeQuestion(created.id, "The answer is stale.");
      await facade.reviseQuestion(
        created.id,
        singleChoiceInput({ stem: "Refreshed?" }),
      );

      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.question.qualityStatus).toBe("DISPUTED");
      expect(view?.question.disputeReason).toBe("The answer is stale.");
    });

    it("rejects an edit that would make the question unanswerable", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      await expect(
        facade.reviseQuestion(
          created.id,
          singleChoiceInput({ correctChoiceIndexes: [] }),
        ),
      ).rejects.toBeInstanceOf(InvalidQuestionContentError);

      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.revisions).toHaveLength(1);
    });

    it("reports not found for an unknown question", async () => {
      await expect(
        facade.reviseQuestion("missing", singleChoiceInput()),
      ).rejects.toBeInstanceOf(QuestionNotFoundError);
    });
  });

  describe("lifecycle actions", () => {
    it("activates a draft, retires it, and restores it", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      await facade.activateQuestion(created.id);
      await expect(
        facade
          .findDetail(TRACK.slug, created.id)
          .then((view) => view?.question.lifecycleStatus),
      ).resolves.toBe("ACTIVE");

      await facade.retireQuestion(created.id);
      await expect(
        facade
          .findDetail(TRACK.slug, created.id)
          .then((view) => view?.question.lifecycleStatus),
      ).resolves.toBe("RETIRED");

      await facade.restoreQuestion(created.id);
      await expect(
        facade
          .findDetail(TRACK.slug, created.id)
          .then((view) => view?.question.lifecycleStatus),
      ).resolves.toBe("ACTIVE");
    });

    it("refuses to retire a draft", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      await expect(facade.retireQuestion(created.id)).rejects.toBeInstanceOf(
        InvalidLifecycleTransitionError,
      );
    });

    it("keeps the review state when availability changes", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      await facade.approveQuestion(created.id);
      await facade.activateQuestion(created.id);

      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.question.qualityStatus).toBe("USER_APPROVED");
      expect(view?.question.lifecycleStatus).toBe("ACTIVE");
    });
  });

  describe("disputes", () => {
    it("records a dispute with its reason without changing availability", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      await facade.activateQuestion(created.id);
      await facade.disputeQuestion(created.id, "Two answers look correct.");

      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.question.qualityStatus).toBe("DISPUTED");
      expect(view?.question.disputeReason).toBe("Two answers look correct.");
      expect(view?.question.lifecycleStatus).toBe("ACTIVE");
    });

    it("resolves a dispute and clears the reason", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      await facade.disputeQuestion(created.id, "Needs a source.");
      await facade.resolveDispute(created.id, "USER_APPROVED");

      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.question.qualityStatus).toBe("USER_APPROVED");
      expect(view?.question.disputeReason).toBeNull();
    });

    it("refuses to dispute a question twice", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      await facade.disputeQuestion(created.id, "First doubt.");

      await expect(
        facade.disputeQuestion(created.id, "Second doubt."),
      ).rejects.toBeInstanceOf(InvalidQualityTransitionError);
    });

    it("refuses to resolve a question that is not disputed", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      await expect(
        facade.resolveDispute(created.id, "USER_APPROVED"),
      ).rejects.toBeInstanceOf(InvalidQualityTransitionError);
    });

    it("refuses to approve a disputed question directly", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      await facade.disputeQuestion(created.id, "Unclear wording.");

      await expect(facade.approveQuestion(created.id)).rejects.toBeInstanceOf(
        InvalidQualityTransitionError,
      );
    });
  });

  describe("objective mappings", () => {
    it("maps and unmaps an objective of the same track", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      await facade.linkObjective(created.id, "objective-1");

      const mapped = await facade.findDetail(TRACK.slug, created.id);

      expect(mapped?.linkedObjectives.map((item) => item.id)).toEqual([
        "objective-1",
      ]);
      expect(mapped?.linkableObjectives).toEqual([]);

      await facade.unlinkObjective(created.id, "objective-1");

      const unmapped = await facade.findDetail(TRACK.slug, created.id);

      expect(unmapped?.linkedObjectives).toEqual([]);
      expect(unmapped?.linkableObjectives.map((item) => item.id)).toEqual([
        "objective-1",
      ]);
    });

    it("refuses an objective from another study track", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      await expect(
        facade.linkObjective(created.id, "objective-other"),
      ).rejects.toBeInstanceOf(QuestionObjectiveMismatchError);

      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.linkedObjectives).toEqual([]);
    });

    it("refuses an objective that does not exist", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      await expect(
        facade.linkObjective(created.id, "missing"),
      ).rejects.toBeInstanceOf(QuestionObjectiveMismatchError);
    });

    it("maps the same objective twice without duplicating it", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      await facade.linkObjective(created.id, "objective-1");
      await facade.linkObjective(created.id, "objective-1");

      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.linkedObjectives).toHaveLength(1);
    });
  });

  describe("the bank view", () => {
    it("filters by lifecycle, quality, type, objective, and stem text", async () => {
      const draft = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput({ stem: "A draft about buckets?" }),
      );
      const active = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput({ stem: "An active question about volumes?" }),
      );
      const disputed = await facade.createQuestion(
        TRACK.id,
        shortAnswerInput(),
      );

      await facade.activateQuestion(active.id);
      await facade.activateQuestion(disputed.id);
      await facade.retireQuestion(disputed.id);
      await facade.disputeQuestion(disputed.id, "Concepts are vague.");
      await facade.linkObjective(active.id, "objective-1");

      const drafts = await bankIds({ lifecycle: "DRAFT" });

      expect(drafts).toEqual([draft.id]);

      const actives = await bankIds({ lifecycle: "ACTIVE" });

      expect(actives).toEqual([active.id]);

      const retired = await bankIds({ lifecycle: "RETIRED" });

      expect(retired).toEqual([disputed.id]);

      const disputes = await bankIds({ quality: "DISPUTED" });

      expect(disputes).toEqual([disputed.id]);

      const shortAnswers = await bankIds({ type: "SHORT_ANSWER" });

      expect(shortAnswers).toEqual([disputed.id]);

      const mapped = await bankIds({ objective: "objective-1" });

      expect(mapped).toEqual([active.id]);

      const searched = await bankIds({ q: "buckets" });

      expect(searched).toEqual([draft.id]);

      async function bankIds(
        overrides: Partial<QuestionFilterInput>,
      ): Promise<readonly string[]> {
        const view = await facade.findBankBySlug(TRACK.slug, {
          ...NO_FILTERS,
          ...overrides,
        });

        return (view?.items ?? []).map((item) => item.question.id);
      }
    });

    it("ignores an objective filter naming another track's objective", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );
      const view = await facade.findBankBySlug(TRACK.slug, {
        ...NO_FILTERS,
        objective: "objective-other",
      });

      expect(view?.items.map((item) => item.question.id)).toEqual([created.id]);
    });

    it("reports the unfiltered total alongside the filtered one", async () => {
      await facade.createQuestion(TRACK.id, singleChoiceInput());
      const active = await facade.createQuestion(TRACK.id, singleChoiceInput());

      await facade.activateQuestion(active.id);

      const view = await facade.findBankBySlug(TRACK.slug, {
        ...NO_FILTERS,
        lifecycle: "ACTIVE",
      });

      expect(view?.totalCount).toBe(1);
      expect(view?.unfilteredCount).toBe(2);
      expect(view?.pageCount).toBe(1);
    });

    it("serves each study track its own bank", async () => {
      const first = await facade.createQuestion(TRACK.id, singleChoiceInput());
      const second = await facade.createQuestion(
        SECOND_TRACK.id,
        shortAnswerInput(),
      );

      const firstBank = await facade.findBankBySlug(TRACK.slug, NO_FILTERS);
      const secondBank = await facade.findBankBySlug(
        SECOND_TRACK.slug,
        NO_FILTERS,
      );

      expect(firstBank?.items.map((item) => item.question.id)).toEqual([
        first.id,
      ]);
      expect(secondBank?.items.map((item) => item.question.id)).toEqual([
        second.id,
      ]);
      await expect(facade.countBank(TRACK.id)).resolves.toEqual({
        total: 1,
        active: 0,
      });
    });

    it("returns null for an unknown study track", async () => {
      await expect(
        facade.findBankBySlug("no-such-track", NO_FILTERS),
      ).resolves.toBeNull();
    });
  });

  describe("cross-track addressing", () => {
    it("hides a question addressed through the wrong track", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      await expect(
        facade.findDetail(SECOND_TRACK.slug, created.id),
      ).resolves.toBeNull();
      await expect(
        facade.findEditForm(SECOND_TRACK.slug, created.id),
      ).resolves.toBeNull();
      await expect(
        facade.findRevisionView(SECOND_TRACK.slug, created.id, 1),
      ).resolves.toBeNull();
    });

    it("returns null for an unknown question or revision", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      await expect(
        facade.findDetail(TRACK.slug, "missing"),
      ).resolves.toBeNull();
      await expect(
        facade.findRevisionView(TRACK.slug, created.id, 7),
      ).resolves.toBeNull();
    });
  });

  describe("deletion", () => {
    it("consults the dependency checker and removes everything atomically", async () => {
      const checker = new StubDependencyChecker();

      facade = buildFacade(checker);

      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      await facade.reviseQuestion(
        created.id,
        singleChoiceInput({ stem: "Second wording?" }),
      );
      await facade.linkObjective(created.id, "objective-1");

      const certificationId = await facade.deleteQuestion(created.id);

      expect(certificationId).toBe(TRACK.id);
      expect(checker.asked).toContain(created.id);
      await expect(
        facade.findDetail(TRACK.slug, created.id),
      ).resolves.toBeNull();
      await expect(facade.countBank(TRACK.id)).resolves.toEqual({
        total: 0,
        active: 0,
      });

      const questions = new SqliteQuestionRepository(database);

      await expect(questions.listRevisions(created.id)).resolves.toEqual([]);
      // The objective itself is untouched; only the mapping went away.
      await expect(
        new SqliteObjectiveRepository(database).findById("objective-1"),
      ).resolves.not.toBeNull();
    });

    it("refuses to delete a question with dependent history", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      facade = buildFacade(new StubDependencyChecker(new Set([created.id])));

      await expect(facade.deleteQuestion(created.id)).rejects.toBeInstanceOf(
        QuestionNotDeletableError,
      );
      await expect(
        facade.findDetail(TRACK.slug, created.id),
      ).resolves.not.toBeNull();
    });

    it("reports the blocking dependencies in the detail view", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      facade = buildFacade(new StubDependencyChecker(new Set([created.id])));

      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.deletable).toBe(false);
      expect(view?.blockingDependencies).toEqual(["answer attempts"]);
    });

    it("reports a question with no dependents as deletable", async () => {
      const created = await facade.createQuestion(
        TRACK.id,
        singleChoiceInput(),
      );

      await expect(facade.checkDeletable(created.id)).resolves.toEqual({
        deletable: true,
        blockingDependencies: [],
      });
      expect(dependencies).toBeInstanceOf(FlashcardQuestionDependencyChecker);
    });

    it("reports not found when deleting an unknown question", async () => {
      await expect(facade.deleteQuestion("missing")).rejects.toBeInstanceOf(
        QuestionNotFoundError,
      );
    });
  });
});
