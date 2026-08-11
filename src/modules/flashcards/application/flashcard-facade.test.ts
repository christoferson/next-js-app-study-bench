import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MINUTES_PER_DAY } from "@/platform/clock";
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
import { SqliteQuestionRepository } from "@/modules/question-bank/infrastructure/sqlite-question-repository";
import {
  multipleResponseContent,
  questionFixture,
  revisionFixture,
  shortAnswerContent,
} from "@/modules/question-bank/infrastructure/test-support";
import {
  FlashcardNotFoundError,
  FlashcardNotReviewableError,
  FlashcardObjectiveMismatchError,
  InvalidFlashcardContentError,
  InvalidFlashcardLifecycleTransitionError,
  QuestionNotConvertibleError,
} from "@/modules/flashcards/domain/errors";
import { DETERMINISTIC_SCHEDULER_ID } from "@/modules/flashcards/domain/review-scheduling";
import { DeterministicReviewScheduler } from "@/modules/flashcards/domain/review-scheduling";
import { SqliteFlashcardRepository } from "@/modules/flashcards/infrastructure/sqlite-flashcard-repository";
import { SqliteFlashcardUnitOfWork } from "@/modules/flashcards/infrastructure/sqlite-flashcard-unit-of-work";
import type { FlashcardRepository } from "@/modules/flashcards/ports/flashcard-repository";
import { FlashcardFacade } from "./flashcard-facade";
import type { FlashcardFilterInput, FlashcardInput } from "./schemas";

/**
 * Facade behaviour over the real SQLite adapter, with an injected clock, ID
 * generator, and scheduling strategy, so due dates, revision numbering, and
 * identifiers are deterministic.
 */

const TRACK = certificationFixture();
const SECOND_TRACK = certificationFixture({
  id: "certification-2",
  slug: "second-track",
  name: "Second Track",
});

const START = "2026-03-01T08:00:00.000Z";

const NO_FILTERS: FlashcardFilterInput = {
  lifecycle: null,
  type: null,
  objective: null,
  q: null,
  page: 1,
};

function basicInput(
  overrides: Partial<Extract<FlashcardInput, { cardType: "BASIC" }>> = {},
): FlashcardInput {
  return {
    cardType: "BASIC",
    front: "What does S3 stand for?",
    back: "Simple Storage Service",
    notes: null,
    tags: [],
    language: null,
    ...overrides,
  };
}

function reversedInput(): FlashcardInput {
  return {
    cardType: "REVERSED",
    front: "ephemeral",
    back: "lasting for a very short time",
    notes: null,
    tags: [],
    language: "en",
  };
}

function clozeInput(
  text = "An S3 bucket name must be {{globally unique}}.",
): FlashcardInput {
  return {
    cardType: "CLOZE",
    text,
    notes: null,
    tags: [],
    language: null,
  };
}

/** The demo vocabulary card from `SPEC.md` section 6.4. */
function vocabularyInput(): FlashcardInput {
  return {
    cardType: "VOCABULARY",
    term: "学习",
    reading: "xuéxí",
    meaning: "to study; to learn",
    exampleSentence: "我每天学习汉语。",
    notes: null,
    tags: ["hsk1"],
    language: "zh",
  };
}

function scenarioInput(): FlashcardInput {
  return {
    cardType: "SCENARIO",
    scenario: "A workload writes 20 GB of logs a day and reads them rarely.",
    question: "Which storage class fits?",
    answer: "S3 Standard-IA.",
    notes: null,
    tags: [],
    language: null,
  };
}

describe("FlashcardFacade", () => {
  let database: SqliteDatabase;
  let clock: FixedClock;
  let flashcards: FlashcardRepository;
  let questions: SqliteQuestionRepository;
  let facade: FlashcardFacade;

  /** Creates a card and activates it, which is the state review needs. */
  async function createActiveCard(
    input: FlashcardInput = basicInput(),
  ): Promise<string> {
    const created = await facade.createFlashcard(TRACK.id, input);

    await facade.activateFlashcard(created.id);

    return created.id;
  }

  /** Rates the card currently on the review screen for `TRACK`. */
  async function reviewNextCard(
    rating: "AGAIN" | "HARD" | "GOOD" | "EASY",
  ): Promise<string> {
    const session = await facade.findReviewSession(TRACK.slug);
    const card = session?.card;

    if (card === undefined || card === null) {
      throw new Error("Expected a due card on the review screen.");
    }

    await facade.reviewCard(card.flashcard.id, card.revision.id, rating);

    return card.flashcard.id;
  }

  beforeEach(async () => {
    database = createMigratedDatabase();
    clock = new FixedClock(START);
    flashcards = new SqliteFlashcardRepository(database);
    questions = new SqliteQuestionRepository(database);
    facade = new FlashcardFacade({
      flashcards,
      certifications: new SqliteCertificationRepository(database),
      objectives: new SqliteObjectiveRepository(database),
      unitOfWork: new SqliteFlashcardUnitOfWork(database),
      // The production strategy, sharing the test clock: the facade's due dates
      // are asserted against the specified algorithm, not against a stub.
      scheduler: new DeterministicReviewScheduler(clock),
      clock,
      ids: new SequentialIdGenerator("gen"),
    });

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

  describe("creating a card", () => {
    it("creates a draft with revision 1", async () => {
      const created = await facade.createFlashcard(TRACK.id, basicInput());

      expect(created.lifecycleStatus).toBe("DRAFT");
      expect(created.sourceQuestionId).toBeNull();

      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.currentRevision.revisionNumber).toBe(1);
      expect(view?.currentRevision.content).toEqual({
        type: "BASIC",
        front: "What does S3 stand for?",
        back: "Simple Storage Service",
      });
      expect(view?.revisions).toHaveLength(1);
      expect(view?.schedule).toBeNull();
      expect(view?.reviews).toEqual([]);
    });

    it("creates all five card types manually", async () => {
      const inputs: readonly FlashcardInput[] = [
        basicInput(),
        reversedInput(),
        clozeInput(),
        vocabularyInput(),
        scenarioInput(),
      ];
      const stored: string[] = [];

      for (const input of inputs) {
        const created = await facade.createFlashcard(TRACK.id, input);
        const view = await facade.findDetail(TRACK.slug, created.id);

        stored.push(view?.currentRevision.cardType ?? "missing");
      }

      expect(stored).toEqual([
        "BASIC",
        "REVERSED",
        "CLOZE",
        "VOCABULARY",
        "SCENARIO",
      ]);
    });

    it("keeps a reversed card distinct from a basic one", async () => {
      const created = await facade.createFlashcard(TRACK.id, reversedInput());
      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.currentRevision.content).toEqual({
        type: "REVERSED",
        front: "ephemeral",
        back: "lasting for a very short time",
      });
    });

    it("stores a vocabulary card's reading, example, and metadata", async () => {
      const created = await facade.createFlashcard(TRACK.id, vocabularyInput());
      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.currentRevision.content).toEqual({
        type: "VOCABULARY",
        term: "学习",
        reading: "xuéxí",
        meaning: "to study; to learn",
        exampleSentence: "我每天学习汉语。",
      });
      expect(view?.currentRevision.tags).toEqual(["hsk1"]);
      expect(view?.currentRevision.language).toBe("zh");
    });

    it("rejects a cloze card with no deletion and writes nothing", async () => {
      await expect(
        facade.createFlashcard(
          TRACK.id,
          clozeInput("A bucket name must be globally unique."),
        ),
      ).rejects.toBeInstanceOf(InvalidFlashcardContentError);

      await expect(facade.countBank(TRACK.id)).resolves.toEqual({
        total: 0,
        active: 0,
        due: 0,
      });
    });

    it("rejects an unknown certification and writes nothing", async () => {
      await expect(
        facade.createFlashcard("missing", basicInput()),
      ).rejects.toBeInstanceOf(CertificationNotFoundError);

      await expect(facade.countBank(TRACK.id)).resolves.toEqual({
        total: 0,
        active: 0,
        due: 0,
      });
    });
  });

  describe("editing a card", () => {
    it("appends revision 2 and leaves revision 1 as written", async () => {
      const created = await facade.createFlashcard(
        TRACK.id,
        basicInput({ back: "Simple Storage Serivce" }),
      );

      clock.set("2026-03-02T08:00:00.000Z");

      const revision = await facade.reviseFlashcard(
        created.id,
        basicInput({ back: "Simple Storage Service" }),
      );

      expect(revision.revisionNumber).toBe(2);

      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.revisions).toHaveLength(2);
      // Newest first in the view, so revision 1 is last and unchanged.
      expect(view?.revisions.at(-1)?.revisionNumber).toBe(1);

      const first = await facade.findRevisionView(TRACK.slug, created.id, 1);

      expect(first?.revision.content).toEqual({
        type: "BASIC",
        front: "What does S3 stand for?",
        back: "Simple Storage Serivce",
      });
      expect(first?.isCurrent).toBe(false);
    });

    it("changes a card's type by appending a revision", async () => {
      const created = await facade.createFlashcard(TRACK.id, basicInput());

      await facade.reviseFlashcard(created.id, vocabularyInput());

      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.currentRevision.cardType).toBe("VOCABULARY");
      expect(view?.revisions.at(-1)?.cardType).toBe("BASIC");
    });

    it("keeps the review history and the schedule when a reviewed card is edited", async () => {
      const id = await createActiveCard();

      await facade.reviewCard(
        id,
        (await facade.findDetail(TRACK.slug, id))?.currentRevision.id ?? "",
        "GOOD",
      );

      const scheduled = await facade.findDetail(TRACK.slug, id);
      const reviewedRevisionId = scheduled?.reviews[0]?.flashcardRevisionId;

      clock.set("2026-03-02T08:00:00.000Z");
      await facade.reviseFlashcard(id, basicInput({ back: "Corrected." }));

      const view = await facade.findDetail(TRACK.slug, id);

      expect(view?.reviews).toHaveLength(1);
      // The review still names revision 1, which is the text that was rated.
      expect(view?.reviews[0]?.flashcardRevisionId).toBe(reviewedRevisionId);
      expect(view?.reviews[0]?.flashcardRevisionId).not.toBe(
        view?.currentRevision.id,
      );
      // An edit is not a study event: the due date does not move.
      expect(view?.schedule).toEqual(scheduled?.schedule);
      expect(view?.flashcard.lifecycleStatus).toBe("ACTIVE");
    });

    it("leaves a retired card retired when it is corrected", async () => {
      const id = await createActiveCard();

      await facade.retireFlashcard(id);
      await facade.reviseFlashcard(id, basicInput({ back: "Fixed." }));

      const view = await facade.findDetail(TRACK.slug, id);

      expect(view?.flashcard.lifecycleStatus).toBe("RETIRED");
    });

    it("rejects an unstudiable edit and keeps the current revision", async () => {
      const created = await facade.createFlashcard(TRACK.id, clozeInput());

      await expect(
        facade.reviseFlashcard(created.id, clozeInput("No deletion here.")),
      ).rejects.toBeInstanceOf(InvalidFlashcardContentError);

      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.revisions).toHaveLength(1);
      expect(view?.currentRevision.content).toEqual({
        type: "CLOZE",
        text: "An S3 bucket name must be {{globally unique}}.",
      });
    });

    it("reports not found when editing an unknown card", async () => {
      await expect(
        facade.reviseFlashcard("missing", basicInput()),
      ).rejects.toBeInstanceOf(FlashcardNotFoundError);
    });
  });

  describe("lifecycle", () => {
    it("activates, retires, and restores a card", async () => {
      const created = await facade.createFlashcard(TRACK.id, basicInput());

      await facade.activateFlashcard(created.id);
      await expect(
        facade.findDetail(TRACK.slug, created.id),
      ).resolves.toMatchObject({
        flashcard: { lifecycleStatus: "ACTIVE" },
      });

      await facade.retireFlashcard(created.id);
      await expect(
        facade.findDetail(TRACK.slug, created.id),
      ).resolves.toMatchObject({
        flashcard: { lifecycleStatus: "RETIRED" },
      });

      await facade.restoreFlashcard(created.id);
      await expect(
        facade.findDetail(TRACK.slug, created.id),
      ).resolves.toMatchObject({
        flashcard: { lifecycleStatus: "ACTIVE" },
      });
    });

    it("rejects retiring a draft", async () => {
      const created = await facade.createFlashcard(TRACK.id, basicInput());

      await expect(facade.retireFlashcard(created.id)).rejects.toBeInstanceOf(
        InvalidFlashcardLifecycleTransitionError,
      );
    });

    it("rejects activating a card that is already active", async () => {
      const id = await createActiveCard();

      await expect(facade.activateFlashcard(id)).rejects.toBeInstanceOf(
        InvalidFlashcardLifecycleTransitionError,
      );
    });

    it("reports not found for an unknown card", async () => {
      await expect(facade.activateFlashcard("missing")).rejects.toBeInstanceOf(
        FlashcardNotFoundError,
      );
    });
  });

  describe("objective mapping", () => {
    it("links and unlinks an objective of the card's track", async () => {
      const created = await facade.createFlashcard(TRACK.id, basicInput());

      await facade.linkObjective(created.id, "objective-1");

      const linked = await facade.findDetail(TRACK.slug, created.id);

      expect(linked?.linkedObjectives.map((each) => each.id)).toEqual([
        "objective-1",
      ]);
      expect(linked?.linkableObjectives).toEqual([]);

      await facade.unlinkObjective(created.id, "objective-1");

      const unlinked = await facade.findDetail(TRACK.slug, created.id);

      expect(unlinked?.linkedObjectives).toEqual([]);
      expect(unlinked?.linkableObjectives.map((each) => each.id)).toEqual([
        "objective-1",
      ]);
    });

    it("rejects an objective from another study track", async () => {
      const created = await facade.createFlashcard(TRACK.id, basicInput());

      await expect(
        facade.linkObjective(created.id, "objective-other"),
      ).rejects.toBeInstanceOf(FlashcardObjectiveMismatchError);

      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.linkedObjectives).toEqual([]);
    });

    it("rejects an unknown objective", async () => {
      const created = await facade.createFlashcard(TRACK.id, basicInput());

      await expect(
        facade.linkObjective(created.id, "missing"),
      ).rejects.toBeInstanceOf(FlashcardObjectiveMismatchError);
    });

    it("linking the same objective twice leaves one mapping", async () => {
      const created = await facade.createFlashcard(TRACK.id, basicInput());

      await facade.linkObjective(created.id, "objective-1");
      await facade.linkObjective(created.id, "objective-1");

      const view = await facade.findDetail(TRACK.slug, created.id);

      expect(view?.linkedObjectives).toHaveLength(1);
    });
  });

  describe("the review queue", () => {
    it("offers nothing to review when the bank has no active cards", async () => {
      await facade.createFlashcard(TRACK.id, basicInput());

      const session = await facade.findReviewSession(TRACK.slug);

      expect(session?.card).toBeNull();
      expect(session?.remainingCount).toBe(0);
      expect(session?.activeCount).toBe(0);
    });

    it("offers a newly activated card immediately", async () => {
      const id = await createActiveCard();
      const session = await facade.findReviewSession(TRACK.slug);

      expect(session?.card?.flashcard.id).toBe(id);
      // A card that has never been reviewed has no schedule: the "new card" case.
      expect(session?.card?.schedule).toBeNull();
      expect(session?.remainingCount).toBe(1);
      expect(session?.activeCount).toBe(1);
    });

    it("offers the same card until it is rated", async () => {
      await createActiveCard();
      await createActiveCard(reversedInput());

      const first = await facade.findReviewSession(TRACK.slug);
      const again = await facade.findReviewSession(TRACK.slug);

      expect(again?.card?.flashcard.id).toBe(first?.card?.flashcard.id);
    });

    it("takes a rated card out of the queue until it is due again", async () => {
      const id = await createActiveCard();

      await reviewNextCard("GOOD");

      const after = await facade.findReviewSession(TRACK.slug);

      expect(after?.card).toBeNull();
      expect(after?.remainingCount).toBe(0);
      expect(after?.activeCount).toBe(1);

      // Three days later the same card is due again.
      clock.set("2026-03-04T08:00:00.000Z");

      const later = await facade.findReviewSession(TRACK.slug);

      expect(later?.card?.flashcard.id).toBe(id);
      expect(later?.card?.schedule?.reviewCount).toBe(1);
    });

    it("excludes a retired card from the queue and the due count", async () => {
      const kept = await createActiveCard();
      const retired = await createActiveCard(reversedInput());

      await facade.retireFlashcard(retired);

      const session = await facade.findReviewSession(TRACK.slug);

      expect(session?.card?.flashcard.id).toBe(kept);
      expect(session?.remainingCount).toBe(1);

      await facade.retireFlashcard(kept);

      const empty = await facade.findReviewSession(TRACK.slug);

      expect(empty?.card).toBeNull();
      expect(empty?.remainingCount).toBe(0);
      expect(empty?.activeCount).toBe(0);
    });

    it("returns null for an unknown study track", async () => {
      await expect(
        facade.findReviewSession("no-such-track"),
      ).resolves.toBeNull();
    });
  });

  describe("recording a review", () => {
    it("writes the review record and the schedule together", async () => {
      const id = await createActiveCard();
      const detail = await facade.findDetail(TRACK.slug, id);
      const revisionId = detail?.currentRevision.id ?? "";

      const outcome = await facade.reviewCard(id, revisionId, "GOOD");

      expect(outcome.schedule.intervalMinutes).toBe(3 * MINUTES_PER_DAY);
      expect(outcome.schedule.dueAt).toBe("2026-03-04T08:00:00.000Z");
      expect(outcome.schedule.reviewCount).toBe(1);
      expect(outcome.schedule.lapseCount).toBe(0);
      expect(outcome.schedule.schedulerId).toBe(DETERMINISTIC_SCHEDULER_ID);

      const view = await facade.findDetail(TRACK.slug, id);

      expect(view?.schedule).toEqual(outcome.schedule);
      expect(view?.reviews).toHaveLength(1);
      expect(view?.reviews[0]).toMatchObject({
        flashcardId: id,
        flashcardRevisionId: revisionId,
        rating: "GOOD",
        reviewedAt: START,
        intervalMinutes: 3 * MINUTES_PER_DAY,
        dueAt: "2026-03-04T08:00:00.000Z",
        schedulerId: DETERMINISTIC_SCHEDULER_ID,
      });
    });

    it("follows the specified growth on repeated success", async () => {
      const id = await createActiveCard();
      const revisionId =
        (await facade.findDetail(TRACK.slug, id))?.currentRevision.id ?? "";

      const first = await facade.reviewCard(id, revisionId, "GOOD");

      clock.set(first.schedule.dueAt);

      const second = await facade.reviewCard(id, revisionId, "GOOD");

      clock.set(second.schedule.dueAt);

      const third = await facade.reviewCard(id, revisionId, "GOOD");

      expect([
        first.schedule.intervalMinutes,
        second.schedule.intervalMinutes,
        third.schedule.intervalMinutes,
      ]).toEqual([
        3 * MINUTES_PER_DAY,
        6 * MINUTES_PER_DAY,
        12 * MINUTES_PER_DAY,
      ]);

      const view = await facade.findDetail(TRACK.slug, id);

      // History is newest first and keeps every interval it produced.
      expect(view?.reviews.map((review) => review.intervalMinutes)).toEqual([
        12 * MINUTES_PER_DAY,
        6 * MINUTES_PER_DAY,
        3 * MINUTES_PER_DAY,
      ]);
      expect(view?.schedule?.reviewCount).toBe(3);
    });

    it("counts a lapse and returns the card to the ten-minute step", async () => {
      const id = await createActiveCard();
      const revisionId =
        (await facade.findDetail(TRACK.slug, id))?.currentRevision.id ?? "";

      await facade.reviewCard(id, revisionId, "EASY");
      clock.set("2026-03-08T08:00:00.000Z");

      const lapsed = await facade.reviewCard(id, revisionId, "AGAIN");

      expect(lapsed.schedule.intervalMinutes).toBe(10);
      expect(lapsed.schedule.dueAt).toBe("2026-03-08T08:10:00.000Z");
      expect(lapsed.schedule.lapseCount).toBe(1);

      // The card is due again ten minutes later, and the lapse survives a
      // later success.
      clock.set("2026-03-08T08:10:00.000Z");

      const recovered = await facade.reviewCard(id, revisionId, "GOOD");

      expect(recovered.schedule.lapseCount).toBe(1);
      expect(recovered.schedule.reviewCount).toBe(3);
    });

    it("rejects a rating for a retired card and records nothing", async () => {
      const id = await createActiveCard();
      const revisionId =
        (await facade.findDetail(TRACK.slug, id))?.currentRevision.id ?? "";

      // The review screen was rendered before the card was retired elsewhere.
      await facade.retireFlashcard(id);

      await expect(
        facade.reviewCard(id, revisionId, "GOOD"),
      ).rejects.toBeInstanceOf(FlashcardNotReviewableError);

      const view = await facade.findDetail(TRACK.slug, id);

      expect(view?.reviews).toEqual([]);
      expect(view?.schedule).toBeNull();
    });

    it("rejects a rating for a draft card", async () => {
      const created = await facade.createFlashcard(TRACK.id, basicInput());

      await expect(
        facade.reviewCard(created.id, created.currentRevisionId, "GOOD"),
      ).rejects.toBeInstanceOf(FlashcardNotReviewableError);
    });

    it("reports not found for a rating on an unknown card", async () => {
      await expect(
        facade.reviewCard("missing", "revision", "GOOD"),
      ).rejects.toBeInstanceOf(FlashcardNotFoundError);
    });

    it("records the revision that was on screen when the card was edited meanwhile", async () => {
      const id = await createActiveCard();
      const onScreen =
        (await facade.findDetail(TRACK.slug, id))?.currentRevision.id ?? "";

      // Another tab corrects the card between the render and the rating.
      await facade.reviseFlashcard(id, basicInput({ back: "Corrected." }));

      await facade.reviewCard(id, onScreen, "HARD");

      const view = await facade.findDetail(TRACK.slug, id);

      expect(view?.reviews[0]?.flashcardRevisionId).toBe(onScreen);
      expect(view?.currentRevision.id).not.toBe(onScreen);
    });

    it("attributes a rating naming a foreign revision to the current one", async () => {
      const other = await createActiveCard(reversedInput());
      const id = await createActiveCard();
      const foreign =
        (await facade.findDetail(TRACK.slug, other))?.currentRevision.id ?? "";

      await facade.reviewCard(id, foreign, "GOOD");

      const view = await facade.findDetail(TRACK.slug, id);

      expect(view?.reviews[0]?.flashcardRevisionId).toBe(
        view?.currentRevision.id,
      );
    });

    it("rolls back the schedule when recording the review fails", async () => {
      const id = await createActiveCard();
      const revisionId =
        (await facade.findDetail(TRACK.slug, id))?.currentRevision.id ?? "";

      // A review row whose id already exists is the cheapest way to make the
      // first write of the pair fail after the transaction has begun.
      await facade.reviewCard(id, revisionId, "GOOD");

      const before = await facade.findDetail(TRACK.slug, id);

      clock.set("2026-03-04T08:00:00.000Z");
      database
        .prepare(
          `INSERT INTO flashcard_reviews (id, flashcard_id, flashcard_revision_id,
             rating, reviewed_at, interval_minutes, due_at, scheduler_id)
           VALUES (@id, @flashcardId, @revisionId, 'GOOD', @now, 10, @now, 'x')`,
        )
        .run({
          // The generator's next id, claimed before the facade can use it.
          id: "gen-4",
          flashcardId: id,
          revisionId,
          now: "2026-03-04T08:00:00.000Z",
        });

      await expect(facade.reviewCard(id, revisionId, "EASY")).rejects.toThrow(
        /UNIQUE/i,
      );

      const after = await facade.findDetail(TRACK.slug, id);

      // The failed rating left the schedule exactly as the previous review set it.
      expect(after?.schedule).toEqual(before?.schedule);
    });
  });

  describe("the bank view", () => {
    it("reports the due count alongside the bank totals", async () => {
      await createActiveCard();
      await facade.createFlashcard(TRACK.id, reversedInput());

      const view = await facade.findBankBySlug(TRACK.slug, NO_FILTERS);

      expect(view?.totalCount).toBe(2);
      expect(view?.unfilteredCount).toBe(2);
      expect(view?.dueCount).toBe(1);
      await expect(facade.countBank(TRACK.id)).resolves.toEqual({
        total: 2,
        active: 1,
        due: 1,
      });
    });

    it("filters by lifecycle, type, objective, and text", async () => {
      const active = await createActiveCard();
      const draft = await facade.createFlashcard(TRACK.id, vocabularyInput());

      await facade.linkObjective(draft.id, "objective-1");

      const byLifecycle = await facade.findBankBySlug(TRACK.slug, {
        ...NO_FILTERS,
        lifecycle: "ACTIVE",
      });

      expect(byLifecycle?.items.map((item) => item.flashcard.id)).toEqual([
        active,
      ]);

      const byType = await facade.findBankBySlug(TRACK.slug, {
        ...NO_FILTERS,
        type: "VOCABULARY",
      });

      expect(byType?.items.map((item) => item.flashcard.id)).toEqual([
        draft.id,
      ]);

      const byObjective = await facade.findBankBySlug(TRACK.slug, {
        ...NO_FILTERS,
        objective: "objective-1",
      });

      expect(byObjective?.items.map((item) => item.flashcard.id)).toEqual([
        draft.id,
      ]);

      // Text search reaches every field of every card type, not just a front.
      const byText = await facade.findBankBySlug(TRACK.slug, {
        ...NO_FILTERS,
        q: "xuéxí",
      });

      expect(byText?.items.map((item) => item.flashcard.id)).toEqual([
        draft.id,
      ]);
    });

    it("ignores an objective filter from another track rather than showing nothing", async () => {
      const id = await createActiveCard();

      const view = await facade.findBankBySlug(TRACK.slug, {
        ...NO_FILTERS,
        objective: "objective-other",
      });

      expect(view?.items.map((item) => item.flashcard.id)).toEqual([id]);
    });

    it("returns null for an unknown study track", async () => {
      await expect(
        facade.findBankBySlug("no-such-track", NO_FILTERS),
      ).resolves.toBeNull();
    });

    it("hides a card of another track behind a 404", async () => {
      const created = await facade.createFlashcard(TRACK.id, basicInput());

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

    it("returns null for a revision number that does not exist", async () => {
      const created = await facade.createFlashcard(TRACK.id, basicInput());

      await expect(
        facade.findRevisionView(TRACK.slug, created.id, 7),
      ).resolves.toBeNull();
    });

    it("offers the edit form for a card of the addressed track", async () => {
      const created = await facade.createFlashcard(TRACK.id, scenarioInput());
      const form = await facade.findEditForm(TRACK.slug, created.id);

      expect(form?.revision.cardType).toBe("SCENARIO");
      expect(form?.certification.slug).toBe(TRACK.slug);
      await expect(facade.findNewCardForm(TRACK.slug)).resolves.toMatchObject({
        id: TRACK.id,
      });
      await expect(facade.findNewCardForm("no-such-track")).resolves.toBeNull();
    });
  });

  describe("converting a question", () => {
    /** Saves an active question with its revision and objective mapping. */
    async function seedQuestion(
      overrides: Parameters<typeof questionFixture>[0] = {},
      revisionOverrides: Parameters<typeof revisionFixture>[0] = {},
    ): Promise<string> {
      const question = questionFixture({
        lifecycleStatus: "ACTIVE",
        ...overrides,
      });

      await questions.create(
        question,
        revisionFixture({
          id: `${question.id}-revision-1`,
          questionId: question.id,
          ...revisionOverrides,
        }),
      );

      return question.id;
    }

    it("creates a draft basic card carrying the question's answer", async () => {
      const questionId = await seedQuestion();

      await questions.replaceObjectiveLinks(questionId, ["objective-1"], START);

      const card = await facade.convertQuestion(questionId);

      expect(card.lifecycleStatus).toBe("DRAFT");
      expect(card.sourceQuestionId).toBe(questionId);
      expect(card.certificationId).toBe(TRACK.id);

      const view = await facade.findDetail(TRACK.slug, card.id);

      expect(view?.currentRevision.content).toEqual({
        type: "BASIC",
        front: "Which service stores objects?",
        back: "Amazon S3",
      });
      // The distractor is deliberately not carried into the card.
      expect(JSON.stringify(view?.currentRevision.content)).not.toContain(
        "Amazon EBS",
      );
      expect(view?.linkedObjectives.map((each) => each.id)).toEqual([
        "objective-1",
      ]);
      expect(view?.sourceQuestionId).toBe(questionId);
    });

    it("joins a multiple-response answer and copies the explanation into notes", async () => {
      const questionId = await seedQuestion(
        { id: "question-multi" },
        {
          questionType: "MULTIPLE_RESPONSE",
          content: multipleResponseContent(),
          stem: "Which two are S3 properties?",
          explanation: "Colour is not a storage property.",
          tags: ["storage"],
          language: "en",
        },
      );

      const card = await facade.convertQuestion(questionId);
      const view = await facade.findDetail(TRACK.slug, card.id);

      expect(view?.currentRevision.content).toEqual({
        type: "BASIC",
        front: "Which two are S3 properties?",
        back: "Durability; Availability",
      });
      expect(view?.currentRevision.notes).toBe(
        "Colour is not a storage property.",
      );
      expect(view?.currentRevision.tags).toEqual(["storage"]);
      expect(view?.currentRevision.language).toBe("en");
    });

    it("converts a short-answer question into its expected concepts", async () => {
      const questionId = await seedQuestion(
        { id: "question-short" },
        {
          questionType: "SHORT_ANSWER",
          content: shortAnswerContent(),
          stem: "Describe object storage durability.",
        },
      );

      const card = await facade.convertQuestion(questionId);
      const view = await facade.findDetail(TRACK.slug, card.id);

      expect(view?.currentRevision.content).toEqual({
        type: "BASIC",
        front: "Describe object storage durability.",
        back: "object storage; eleven nines",
      });
    });

    it("leaves the card and the question independent after conversion", async () => {
      const questionId = await seedQuestion();
      const card = await facade.convertQuestion(questionId);

      clock.set("2026-03-02T08:00:00.000Z");
      await facade.reviseFlashcard(
        card.id,
        basicInput({ front: "S3 in full?", back: "Simple Storage Service" }),
      );

      const view = await facade.findDetail(TRACK.slug, card.id);
      const question = await questions.findWithCurrentRevision(questionId);

      expect(view?.currentRevision.content).toMatchObject({
        front: "S3 in full?",
      });
      // The question is untouched, and the provenance pointer survives the edit.
      expect(question?.revision.stem).toBe("Which service stores objects?");
      expect(question?.revision.revisionNumber).toBe(1);
      expect(view?.flashcard.sourceQuestionId).toBe(questionId);
    });

    it("refuses to convert a draft question", async () => {
      const questionId = await seedQuestion({
        id: "question-draft",
        lifecycleStatus: "DRAFT",
      });

      await expect(facade.convertQuestion(questionId)).rejects.toBeInstanceOf(
        QuestionNotConvertibleError,
      );

      await expect(facade.countBank(TRACK.id)).resolves.toEqual({
        total: 0,
        active: 0,
        due: 0,
      });
    });

    it("refuses to convert a retired question", async () => {
      const questionId = await seedQuestion({
        id: "question-retired",
        lifecycleStatus: "RETIRED",
      });

      await expect(facade.convertQuestion(questionId)).rejects.toBeInstanceOf(
        QuestionNotConvertibleError,
      );
    });

    it("refuses to convert an unknown question", async () => {
      await expect(facade.convertQuestion("missing")).rejects.toBeInstanceOf(
        QuestionNotConvertibleError,
      );
    });

    it("converts the same question twice into two independent cards", async () => {
      const questionId = await seedQuestion();

      const first = await facade.convertQuestion(questionId);
      const second = await facade.convertQuestion(questionId);

      expect(second.id).not.toBe(first.id);

      const derived = await flashcards.listBySourceQuestion(questionId);

      expect(derived).toHaveLength(2);
    });
  });
});
