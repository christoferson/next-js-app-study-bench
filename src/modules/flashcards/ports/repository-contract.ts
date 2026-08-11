import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MINUTES_PER_DAY } from "@/platform/clock";
import type { CertificationRepository } from "@/modules/certifications/ports/certification-repository";
import type { ObjectiveRepository } from "@/modules/certifications/ports/objective-repository";
import {
  certificationFixture,
  objectiveFixture,
} from "@/modules/certifications/infrastructure/test-support";
import type { QuestionRepository } from "@/modules/question-bank/ports/question-repository";
import {
  questionFixture,
  revisionFixture,
} from "@/modules/question-bank/infrastructure/test-support";
import { FlashcardNotFoundError } from "@/modules/flashcards/domain/errors";
import type { FlashcardLifecycleStatus } from "@/modules/flashcards/domain/flashcard";
import {
  cardRevisionFixture,
  clozeContent,
  contentFixtures,
  flashcardFixture,
  reviewRecordFixture,
  scenarioContent,
  scheduleFixture,
  vocabularyContent,
} from "@/modules/flashcards/infrastructure/test-support";
import type { FlashcardRepository } from "./flashcard-repository";

/**
 * Shared flashcard-repository contract.
 *
 * Defines the domain-observable behaviour every flashcard persistence adapter must
 * provide, so the PostgreSQL adapter in D13 runs these same assertions rather than
 * a parallel set (`spec/ARCHITECTURE.md` section 7.4).
 */

export interface FlashcardContractSubject {
  readonly flashcards: FlashcardRepository;
  readonly certifications: CertificationRepository;
  readonly objectives: ObjectiveRepository;
  readonly questions: QuestionRepository;
  /** Called after each test so state never leaks between cases. */
  dispose(): void;
}

const NOW = "2026-06-01T12:00:00.000Z";
const LATER = "2026-06-02T12:00:00.000Z";
const UNBOUNDED = { limit: 50, offset: 0 };

export function describeFlashcardRepositoryContract(
  adapterName: string,
  createSubject: () => FlashcardContractSubject,
): void {
  describe(`${adapterName} flashcard repository contract`, () => {
    let subject: FlashcardContractSubject;

    beforeEach(async () => {
      subject = createSubject();
      // Cards reference a certification, so every case starts from one saved
      // track plus one objective they can be mapped to.
      await subject.certifications.save(certificationFixture());
      await subject.objectives.save(objectiveFixture());
    });

    afterEach(() => {
      subject.dispose();
    });

    it("round-trips a card and its first revision", async () => {
      const flashcard = flashcardFixture();
      const revision = cardRevisionFixture({
        notes: "Asked on the practice exam.",
        tags: ["storage", "s3"],
        language: "en",
      });

      await subject.flashcards.create(flashcard, revision);

      await expect(subject.flashcards.findById(flashcard.id)).resolves.toEqual(
        flashcard,
      );
      await expect(
        subject.flashcards.findWithCurrentRevision(flashcard.id),
      ).resolves.toEqual({ flashcard, revision });
    });

    it("keeps every card type intact through a round trip", async () => {
      for (const [index, content] of contentFixtures().entries()) {
        const id = `card-${content.type}`;
        const revisionId = `rev-${index}`;

        await subject.flashcards.create(
          flashcardFixture({ id, currentRevisionId: revisionId }),
          cardRevisionFixture({
            id: revisionId,
            flashcardId: id,
            content,
          }),
        );

        const found = await subject.flashcards.findWithCurrentRevision(id);

        // Byte-for-byte: a reversed card must not come back as a basic one, and
        // a vocabulary card's null reading must not come back as undefined.
        expect(found?.revision.content).toEqual(content);
        expect(found?.revision.cardType).toBe(content.type);
      }

      await expect(
        subject.flashcards.countsByCertification(certificationFixture().id),
      ).resolves.toEqual({ total: 5, active: 0 });
    });

    it("keeps a vocabulary card's optional fields distinguishable from blank", async () => {
      await subject.flashcards.create(
        flashcardFixture(),
        cardRevisionFixture({
          content: {
            type: "VOCABULARY",
            term: "AZ",
            reading: null,
            meaning: "Availability Zone",
            exampleSentence: null,
          },
        }),
      );

      const found = await subject.flashcards.findWithCurrentRevision(
        flashcardFixture().id,
      );

      expect(found?.revision.content).toEqual({
        type: "VOCABULARY",
        term: "AZ",
        reading: null,
        meaning: "Availability Zone",
        exampleSentence: null,
      });
    });

    it("returns null for an unknown card", async () => {
      await expect(subject.flashcards.findById("missing")).resolves.toBeNull();
      await expect(
        subject.flashcards.findWithCurrentRevision("missing"),
      ).resolves.toBeNull();
      await expect(
        subject.flashcards.findSchedule("missing"),
      ).resolves.toBeNull();
      await expect(
        subject.flashcards.listRevisions("missing"),
      ).resolves.toEqual([]);
    });

    it("appends a revision, moves the pointer, and leaves revision 1 alone", async () => {
      const flashcard = flashcardFixture();
      const first = cardRevisionFixture({
        content: {
          type: "BASIC",
          front: "Original front",
          back: "Original back",
        },
      });

      await subject.flashcards.create(flashcard, first);

      const second = cardRevisionFixture({
        id: "card-revision-2",
        revisionNumber: 2,
        content: {
          type: "BASIC",
          front: "Corrected front",
          back: "Corrected back",
        },
        createdAt: LATER,
      });

      await subject.flashcards.appendRevision(second, LATER);

      const root = await subject.flashcards.findById(flashcard.id);

      expect(root?.currentRevisionId).toBe(second.id);
      expect(root?.updatedAt).toBe(LATER);

      const revisions = await subject.flashcards.listRevisions(flashcard.id);

      expect(revisions.map((revision) => revision.revisionNumber)).toEqual([
        1, 2,
      ]);
      // The whole point of append-only history: revision 1 still reads exactly as
      // it was written.
      expect(revisions[0]).toEqual(first);
      await expect(
        subject.flashcards.findRevision(flashcard.id, 1),
      ).resolves.toEqual(first);
    });

    it("allows an edit that changes the card type", async () => {
      const flashcard = flashcardFixture();

      await subject.flashcards.create(flashcard, cardRevisionFixture());
      await subject.flashcards.appendRevision(
        cardRevisionFixture({
          id: "card-revision-2",
          revisionNumber: 2,
          content: vocabularyContent(),
          createdAt: LATER,
        }),
        LATER,
      );

      const found = await subject.flashcards.findWithCurrentRevision(
        flashcard.id,
      );

      expect(found?.revision.cardType).toBe("VOCABULARY");
      // The earlier revision keeps its own type, so the history still shows what
      // was studied.
      const first = await subject.flashcards.findRevision(flashcard.id, 1);

      expect(first?.cardType).toBe("BASIC");
    });

    it("refuses a duplicate revision number", async () => {
      await subject.flashcards.create(
        flashcardFixture(),
        cardRevisionFixture(),
      );

      await expect(
        subject.flashcards.appendRevision(
          cardRevisionFixture({ id: "card-revision-clash", revisionNumber: 1 }),
          LATER,
        ),
      ).rejects.toThrow();
    });

    it("updates the lifecycle status", async () => {
      const flashcard = flashcardFixture();

      await subject.flashcards.create(flashcard, cardRevisionFixture());
      await subject.flashcards.setLifecycleStatus(
        flashcard.id,
        "ACTIVE",
        LATER,
      );

      const found = await subject.flashcards.findById(flashcard.id);

      expect(found?.lifecycleStatus).toBe("ACTIVE");
      expect(found?.updatedAt).toBe(LATER);
    });

    it("reports not found when updating a card that does not exist", async () => {
      await expect(
        subject.flashcards.setLifecycleStatus("missing", "ACTIVE", LATER),
      ).rejects.toBeInstanceOf(FlashcardNotFoundError);
      await expect(
        subject.flashcards.replaceObjectiveLinks("missing", [], LATER),
      ).rejects.toBeInstanceOf(FlashcardNotFoundError);
      await expect(
        subject.flashcards.saveSchedule("missing", scheduleFixture(), LATER),
      ).rejects.toBeInstanceOf(FlashcardNotFoundError);
    });

    it("filters the bank by lifecycle, card type, and text", async () => {
      await seedBank(subject);

      const certificationId = certificationFixture().id;

      const drafts = await subject.flashcards.search({
        certificationId,
        lifecycleStatus: "DRAFT",
        ...UNBOUNDED,
      });

      expect(drafts.items.map((item) => item.flashcard.id)).toEqual([
        "card-draft",
      ]);

      const active = await subject.flashcards.search({
        certificationId,
        lifecycleStatus: "ACTIVE",
        ...UNBOUNDED,
      });

      expect(active.items.map((item) => item.flashcard.id).sort()).toEqual([
        "card-active",
        "card-active-2",
      ]);

      const retired = await subject.flashcards.search({
        certificationId,
        lifecycleStatus: "RETIRED",
        ...UNBOUNDED,
      });

      expect(retired.items.map((item) => item.flashcard.id)).toEqual([
        "card-retired",
      ]);

      const clozes = await subject.flashcards.search({
        certificationId,
        cardType: "CLOZE",
        ...UNBOUNDED,
      });

      expect(clozes.items.map((item) => item.flashcard.id)).toEqual([
        "card-active-2",
      ]);
    });

    it("searches every field of every card type through the flattened text", async () => {
      await seedBank(subject);

      const certificationId = certificationFixture().id;
      const cases = [
        // A vocabulary card found by its reading, which is not the prompt side.
        { text: "xuéxí", expected: ["card-draft"] },
        // A cloze card found by the text inside the deletion markers.
        { text: "globally unique", expected: ["card-active-2"] },
        // A scenario card found by its answer.
        { text: "Standard-IA", expected: ["card-retired"] },
      ];

      for (const entry of cases) {
        const page = await subject.flashcards.search({
          certificationId,
          textContains: entry.text,
          ...UNBOUNDED,
        });

        expect(page.items.map((item) => item.flashcard.id)).toEqual(
          entry.expected,
        );
      }
    });

    it("matches text case-insensitively and treats wildcards literally", async () => {
      await seedBank(subject);

      const certificationId = certificationFixture().id;

      await expect(
        subject.flashcards
          .search({ certificationId, textContains: "SIMPLE", ...UNBOUNDED })
          .then((page) => page.items.length),
      ).resolves.toBe(1);

      // A bare `%` would match every card if it were passed through as a
      // wildcard.
      await expect(
        subject.flashcards
          .search({ certificationId, textContains: "%", ...UNBOUNDED })
          .then((page) => page.items.length),
      ).resolves.toBe(0);
    });

    it("never returns another track's cards", async () => {
      await seedBank(subject);
      await subject.certifications.save(
        certificationFixture({ id: "certification-2", slug: "other-track" }),
      );
      await subject.flashcards.create(
        flashcardFixture({
          id: "card-other",
          certificationId: "certification-2",
          currentRevisionId: "rev-other",
        }),
        cardRevisionFixture({ id: "rev-other", flashcardId: "card-other" }),
      );

      const page = await subject.flashcards.search({
        certificationId: certificationFixture().id,
        ...UNBOUNDED,
      });

      expect(page.items.map((item) => item.flashcard.id)).not.toContain(
        "card-other",
      );
      await expect(
        subject.flashcards.countsByCertification(certificationFixture().id),
      ).resolves.toEqual({ total: 4, active: 2 });
    });

    it("bounds the page and reports the total that matched", async () => {
      await seedBank(subject);

      const page = await subject.flashcards.search({
        certificationId: certificationFixture().id,
        limit: 2,
        offset: 0,
      });

      expect(page.items).toHaveLength(2);
      expect(page.totalCount).toBe(4);
      expect(page.limit).toBe(2);

      const second = await subject.flashcards.search({
        certificationId: certificationFixture().id,
        limit: 2,
        offset: 2,
      });

      expect(second.items).toHaveLength(2);
      expect(
        new Set([
          ...page.items.map((item) => item.flashcard.id),
          ...second.items.map((item) => item.flashcard.id),
        ]).size,
      ).toBe(4);
    });

    it("counts an empty bank as zero", async () => {
      await expect(
        subject.flashcards.countsByCertification(certificationFixture().id),
      ).resolves.toEqual({ total: 0, active: 0 });
    });

    it("replaces objective links and filters by them", async () => {
      const flashcard = flashcardFixture();

      await subject.flashcards.create(flashcard, cardRevisionFixture());
      await subject.objectives.save(
        objectiveFixture({ id: "objective-2", displayOrder: 2 }),
      );

      await subject.flashcards.replaceObjectiveLinks(
        flashcard.id,
        ["objective-1", "objective-2", "objective-1"],
        LATER,
      );

      // Duplicates collapse; ordering follows the objective display order.
      await expect(
        subject.flashcards.listObjectiveLinks(flashcard.id),
      ).resolves.toEqual(["objective-1", "objective-2"]);

      const filtered = await subject.flashcards.search({
        certificationId: certificationFixture().id,
        objectiveId: "objective-2",
        ...UNBOUNDED,
      });

      expect(filtered.items.map((item) => item.flashcard.id)).toEqual([
        flashcard.id,
      ]);

      await subject.flashcards.replaceObjectiveLinks(
        flashcard.id,
        ["objective-2"],
        LATER,
      );

      await expect(
        subject.flashcards.listObjectiveLinks(flashcard.id),
      ).resolves.toEqual(["objective-2"]);
      await expect(
        subject.flashcards
          .search({
            certificationId: certificationFixture().id,
            objectiveId: "objective-1",
            ...UNBOUNDED,
          })
          .then((page) => page.items),
      ).resolves.toEqual([]);
    });

    it("inserts a schedule on the first review and replaces it afterwards", async () => {
      const flashcard = flashcardFixture();

      await subject.flashcards.create(flashcard, cardRevisionFixture());

      // A card that has never been reviewed has no schedule at all, which is the
      // definition of a new card.
      await expect(
        subject.flashcards.findSchedule(flashcard.id),
      ).resolves.toBeNull();

      const first = scheduleFixture();

      await subject.flashcards.saveSchedule(flashcard.id, first, NOW);

      await expect(
        subject.flashcards.findSchedule(flashcard.id),
      ).resolves.toEqual(first);

      const second = scheduleFixture({
        intervalMinutes: 6 * MINUTES_PER_DAY,
        dueAt: "2026-06-08T12:00:00.000Z",
        reviewCount: 2,
        lapseCount: 1,
        lastReviewedAt: LATER,
      });

      await subject.flashcards.saveSchedule(flashcard.id, second, LATER);

      // One row per card: the second save replaced the first rather than adding
      // to it.
      await expect(
        subject.flashcards.findSchedule(flashcard.id),
      ).resolves.toEqual(second);
    });

    it("records reviews and returns them newest first", async () => {
      const flashcard = flashcardFixture();

      await subject.flashcards.create(flashcard, cardRevisionFixture());
      await subject.flashcards.appendRevision(
        cardRevisionFixture({
          id: "card-revision-2",
          revisionNumber: 2,
          createdAt: LATER,
        }),
        LATER,
      );

      const older = reviewRecordFixture({
        id: "review-older",
        rating: "AGAIN",
        reviewedAt: NOW,
        intervalMinutes: 10,
        dueAt: "2026-06-01T12:10:00.000Z",
      });
      const newer = reviewRecordFixture({
        id: "review-newer",
        // Answered against revision 2, so the history names the text that was on
        // screen at the time.
        flashcardRevisionId: "card-revision-2",
        rating: "GOOD",
        reviewedAt: LATER,
      });

      await subject.flashcards.recordReview(older);
      await subject.flashcards.recordReview(newer);

      const reviews = await subject.flashcards.listReviews(flashcard.id, 10);

      expect(reviews).toEqual([newer, older]);
      // Bounded like every other read.
      await expect(
        subject.flashcards
          .listReviews(flashcard.id, 1)
          .then((page) => page.map((review) => review.id)),
      ).resolves.toEqual(["review-newer"]);
    });

    it("returns no reviews for a card that has never been reviewed", async () => {
      await subject.flashcards.create(
        flashcardFixture(),
        cardRevisionFixture(),
      );

      await expect(
        subject.flashcards.listReviews(flashcardFixture().id, 10),
      ).resolves.toEqual([]);
    });

    it("returns only active due cards, never draft, retired, or archived", async () => {
      await seedBank(subject);

      const due = await subject.flashcards.findDueCards({
        certificationId: certificationFixture().id,
        now: NOW,
        limit: 10,
      });

      // Both active cards are due because neither has ever been reviewed.
      expect(due.map((entry) => entry.flashcard.id).sort()).toEqual([
        "card-active",
        "card-active-2",
      ]);
      expect(due.every((entry) => entry.schedule === null)).toBe(true);
      await expect(
        subject.flashcards.countDueCards(certificationFixture().id, NOW),
      ).resolves.toBe(2);
    });

    it("excludes a card scheduled into the future and includes one due exactly now", async () => {
      await seedBank(subject);

      await subject.flashcards.saveSchedule(
        "card-active",
        scheduleFixture({ dueAt: NOW }),
        NOW,
      );
      await subject.flashcards.saveSchedule(
        "card-active-2",
        scheduleFixture({ dueAt: "2026-06-01T12:00:00.001Z" }),
        NOW,
      );

      const due = await subject.flashcards.findDueCards({
        certificationId: certificationFixture().id,
        now: NOW,
        limit: 10,
      });

      // Due exactly now counts as due; one millisecond later does not.
      expect(due.map((entry) => entry.flashcard.id)).toEqual(["card-active"]);
      await expect(
        subject.flashcards.countDueCards(certificationFixture().id, NOW),
      ).resolves.toBe(1);
    });

    it("carries a due card's current schedule so the strategy can extend it", async () => {
      await seedBank(subject);

      const schedule = scheduleFixture({
        dueAt: "2026-05-01T00:00:00.000Z",
        intervalMinutes: 3 * MINUTES_PER_DAY,
        lapseCount: 2,
        reviewCount: 5,
      });

      await subject.flashcards.saveSchedule("card-active", schedule, NOW);
      await subject.flashcards.setLifecycleStatus(
        "card-active-2",
        "DRAFT",
        NOW,
      );

      const due = await subject.flashcards.findDueCards({
        certificationId: certificationFixture().id,
        now: NOW,
        limit: 10,
      });

      expect(due).toHaveLength(1);
      expect(due[0]?.schedule).toEqual(schedule);
      expect(due[0]?.revision.content).toEqual({
        type: "BASIC",
        front: "What does S3 stand for?",
        back: "Simple Storage Service",
      });
    });

    it("orders due cards deterministically, longest waiting first", async () => {
      await seedBank(subject);
      // A third active card, so the ordering has something to sort.
      await subject.flashcards.create(
        flashcardFixture({
          id: "card-active-3",
          currentRevisionId: "rev-active-3",
          lifecycleStatus: "ACTIVE",
          createdAt: "2026-05-20T00:00:00.000Z",
          updatedAt: "2026-05-20T00:00:00.000Z",
        }),
        cardRevisionFixture({
          id: "rev-active-3",
          flashcardId: "card-active-3",
        }),
      );

      await subject.flashcards.saveSchedule(
        "card-active",
        scheduleFixture({ dueAt: "2026-05-10T00:00:00.000Z" }),
        NOW,
      );
      await subject.flashcards.saveSchedule(
        "card-active-2",
        scheduleFixture({ dueAt: "2026-05-05T00:00:00.000Z" }),
        NOW,
      );

      const criteria = {
        certificationId: certificationFixture().id,
        now: NOW,
        limit: 10,
      };
      const first = await subject.flashcards.findDueCards(criteria);

      // Most overdue first; the never-reviewed card sorts by its creation time,
      // which is later than both due dates here.
      expect(first.map((entry) => entry.flashcard.id)).toEqual([
        "card-active-2",
        "card-active",
        "card-active-3",
      ]);

      // Repeating the query returns the same order, so reloading the review
      // screen offers the same card until it is rated.
      const second = await subject.flashcards.findDueCards(criteria);

      expect(second.map((entry) => entry.flashcard.id)).toEqual(
        first.map((entry) => entry.flashcard.id),
      );
    });

    it("bounds the due queue", async () => {
      await seedBank(subject);

      const due = await subject.flashcards.findDueCards({
        certificationId: certificationFixture().id,
        now: NOW,
        limit: 1,
      });

      expect(due).toHaveLength(1);
    });

    it("never returns another track's due cards", async () => {
      await seedBank(subject);
      await subject.certifications.save(
        certificationFixture({ id: "certification-2", slug: "other-track" }),
      );
      await subject.flashcards.create(
        flashcardFixture({
          id: "card-other",
          certificationId: "certification-2",
          currentRevisionId: "rev-other",
          lifecycleStatus: "ACTIVE",
        }),
        cardRevisionFixture({ id: "rev-other", flashcardId: "card-other" }),
      );

      const due = await subject.flashcards.findDueCards({
        certificationId: certificationFixture().id,
        now: NOW,
        limit: 10,
      });

      expect(due.map((entry) => entry.flashcard.id)).not.toContain(
        "card-other",
      );
    });

    it("records and reports the source question a card was converted from", async () => {
      await subject.questions.create(questionFixture(), revisionFixture());

      const converted = flashcardFixture({
        id: "card-converted",
        currentRevisionId: "rev-converted",
        sourceQuestionId: questionFixture().id,
      });

      await subject.flashcards.create(
        converted,
        cardRevisionFixture({
          id: "rev-converted",
          flashcardId: converted.id,
        }),
      );

      await expect(subject.flashcards.findById(converted.id)).resolves.toEqual(
        converted,
      );
      await expect(
        subject.flashcards
          .listBySourceQuestion(questionFixture().id)
          .then((cards) => cards.map((card) => card.id)),
      ).resolves.toEqual(["card-converted"]);
      await expect(
        subject.flashcards.listBySourceQuestion("question-unknown"),
      ).resolves.toEqual([]);
    });

    it("leaves a manually written card with no source question", async () => {
      await subject.flashcards.create(
        flashcardFixture(),
        cardRevisionFixture(),
      );

      const found = await subject.flashcards.findById(flashcardFixture().id);

      expect(found?.sourceQuestionId).toBeNull();
    });
  });
}

/**
 * Four cards covering the reachable lifecycle states and several card types.
 *
 * Written through the repository rather than raw SQL so the seed exercises the
 * adapter under test.
 */
async function seedBank(subject: FlashcardContractSubject): Promise<void> {
  const entries = [
    {
      id: "card-draft",
      lifecycleStatus: "DRAFT" as const,
      content: vocabularyContent(),
    },
    {
      id: "card-active",
      lifecycleStatus: "ACTIVE" as const,
      content: {
        type: "BASIC" as const,
        front: "What does S3 stand for?",
        back: "Simple Storage Service",
      },
    },
    {
      id: "card-active-2",
      lifecycleStatus: "ACTIVE" as const,
      content: clozeContent(),
    },
    {
      id: "card-retired",
      lifecycleStatus: "RETIRED" as const,
      content: scenarioContent(),
    },
  ] satisfies readonly {
    id: string;
    lifecycleStatus: FlashcardLifecycleStatus;
    content: ReturnType<typeof vocabularyContent>;
  }[];

  for (const [index, entry] of entries.entries()) {
    const revisionId = `rev-${entry.id}`;
    // Distinct creation times so the due ordering has a stable tiebreak to use.
    const createdAt = `2026-05-${String(index + 21).padStart(2, "0")}T00:00:00.000Z`;

    await subject.flashcards.create(
      flashcardFixture({
        id: entry.id,
        currentRevisionId: revisionId,
        lifecycleStatus: entry.lifecycleStatus,
        createdAt,
        updatedAt: createdAt,
      }),
      cardRevisionFixture({
        id: revisionId,
        flashcardId: entry.id,
        content: entry.content,
        createdAt,
      }),
    );
  }
}
