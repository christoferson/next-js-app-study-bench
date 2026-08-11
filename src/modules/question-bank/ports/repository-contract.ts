import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CertificationRepository } from "@/modules/certifications/ports/certification-repository";
import type { ObjectiveRepository } from "@/modules/certifications/ports/objective-repository";
import {
  certificationFixture,
  objectiveFixture,
} from "@/modules/certifications/infrastructure/test-support";
import { QuestionNotFoundError } from "@/modules/question-bank/domain/errors";
import {
  multipleResponseContent,
  questionFixture,
  revisionFixture,
  shortAnswerContent,
} from "@/modules/question-bank/infrastructure/test-support";
import type { QuestionRepository } from "./question-repository";

/**
 * Shared question-repository contract.
 *
 * Defines the domain-observable behaviour every question-bank persistence adapter
 * must provide, so the PostgreSQL adapter in D13 runs these same assertions
 * rather than a parallel set (`spec/ARCHITECTURE.md` section 7.4).
 */

export interface QuestionContractSubject {
  readonly questions: QuestionRepository;
  readonly certifications: CertificationRepository;
  readonly objectives: ObjectiveRepository;
  /** Called after each test so state never leaks between cases. */
  dispose(): void;
}

const LATER = "2026-06-01T12:00:00.000Z";
const UNBOUNDED = { limit: 50, offset: 0 };

export function describeQuestionRepositoryContract(
  adapterName: string,
  createSubject: () => QuestionContractSubject,
): void {
  describe(`${adapterName} question repository contract`, () => {
    let subject: QuestionContractSubject;

    beforeEach(async () => {
      subject = createSubject();
      // Questions reference a certification, so every case starts from one
      // saved track plus one objective it can be mapped to.
      await subject.certifications.save(certificationFixture());
      await subject.objectives.save(objectiveFixture());
    });

    afterEach(() => {
      subject.dispose();
    });

    it("round-trips a question and its first revision", async () => {
      const question = questionFixture();
      const revision = revisionFixture({
        instructions: "Choose one.",
        explanation: "S3 stores objects.",
        difficulty: 2,
        tags: ["storage", "s3"],
        language: "en",
      });

      await subject.questions.create(question, revision);

      await expect(subject.questions.findById(question.id)).resolves.toEqual(
        question,
      );
      await expect(
        subject.questions.findWithCurrentRevision(question.id),
      ).resolves.toEqual({ question, revision });
    });

    it("keeps each content variant intact through a round trip", async () => {
      const cases = [
        { id: "q-single", content: revisionFixture().content },
        { id: "q-multiple", content: multipleResponseContent() },
        { id: "q-short", content: shortAnswerContent() },
      ] as const;

      for (const [index, entry] of cases.entries()) {
        const question = questionFixture({
          id: entry.id,
          currentRevisionId: `rev-${index}`,
        });

        await subject.questions.create(
          question,
          revisionFixture({
            id: `rev-${index}`,
            questionId: entry.id,
            questionType: entry.content.type,
            content: entry.content,
          }),
        );

        const found = await subject.questions.findWithCurrentRevision(entry.id);

        expect(found?.revision.content).toEqual(entry.content);
        expect(found?.revision.questionType).toBe(entry.content.type);
      }
    });

    it("returns null for an unknown question", async () => {
      await expect(subject.questions.findById("missing")).resolves.toBeNull();
      await expect(
        subject.questions.findWithCurrentRevision("missing"),
      ).resolves.toBeNull();
    });

    it("appends a revision, moves the pointer, and leaves revision 1 alone", async () => {
      const question = questionFixture();
      const first = revisionFixture({ stem: "Original wording?" });

      await subject.questions.create(question, first);

      const second = revisionFixture({
        id: "revision-2",
        revisionNumber: 2,
        stem: "Corrected wording?",
        createdAt: LATER,
      });

      await subject.questions.appendRevision(second, LATER);

      const root = await subject.questions.findById(question.id);

      expect(root?.currentRevisionId).toBe(second.id);
      expect(root?.updatedAt).toBe(LATER);

      const revisions = await subject.questions.listRevisions(question.id);

      expect(revisions.map((revision) => revision.revisionNumber)).toEqual([
        1, 2,
      ]);
      // The whole point of append-only history: revision 1 still reads exactly
      // as it was written.
      expect(revisions[0]).toEqual(first);
      await expect(
        subject.questions.findRevision(question.id, 1),
      ).resolves.toEqual(first);
    });

    it("refuses a duplicate revision number", async () => {
      const question = questionFixture();

      await subject.questions.create(question, revisionFixture());

      await expect(
        subject.questions.appendRevision(
          revisionFixture({ id: "revision-clash", revisionNumber: 1 }),
          LATER,
        ),
      ).rejects.toThrow();
    });

    it("updates lifecycle and quality independently", async () => {
      const question = questionFixture();

      await subject.questions.create(question, revisionFixture());

      await subject.questions.setLifecycleStatus(question.id, "ACTIVE", LATER);
      await subject.questions.setQualityStatus(
        question.id,
        "DISPUTED",
        "The answer changed in 2026.",
        LATER,
      );

      const found = await subject.questions.findById(question.id);

      expect(found?.lifecycleStatus).toBe("ACTIVE");
      expect(found?.qualityStatus).toBe("DISPUTED");
      expect(found?.disputeReason).toBe("The answer changed in 2026.");

      await subject.questions.setQualityStatus(
        question.id,
        "USER_APPROVED",
        null,
        LATER,
      );

      const resolved = await subject.questions.findById(question.id);

      expect(resolved?.qualityStatus).toBe("USER_APPROVED");
      expect(resolved?.disputeReason).toBeNull();
      // Resolving the dispute left availability untouched.
      expect(resolved?.lifecycleStatus).toBe("ACTIVE");
    });

    it("reports not found when updating a question that does not exist", async () => {
      await expect(
        subject.questions.setLifecycleStatus("missing", "ACTIVE", LATER),
      ).rejects.toBeInstanceOf(QuestionNotFoundError);
      await expect(
        subject.questions.setQualityStatus("missing", "DISPUTED", "x", LATER),
      ).rejects.toBeInstanceOf(QuestionNotFoundError);
      await expect(subject.questions.delete("missing")).rejects.toBeInstanceOf(
        QuestionNotFoundError,
      );
    });

    it("filters the bank by lifecycle, quality, type, and stem", async () => {
      await seedBank(subject);

      const certificationId = certificationFixture().id;

      const drafts = await subject.questions.search({
        certificationId,
        lifecycleStatus: "DRAFT",
        ...UNBOUNDED,
      });

      expect(drafts.items.map((item) => item.question.id)).toEqual(["q-draft"]);

      const active = await subject.questions.search({
        certificationId,
        lifecycleStatus: "ACTIVE",
        ...UNBOUNDED,
      });

      expect(active.items.map((item) => item.question.id).sort()).toEqual([
        "q-active",
        "q-disputed",
      ]);

      const retired = await subject.questions.search({
        certificationId,
        lifecycleStatus: "RETIRED",
        ...UNBOUNDED,
      });

      expect(retired.items.map((item) => item.question.id)).toEqual([
        "q-retired",
      ]);

      const disputed = await subject.questions.search({
        certificationId,
        qualityStatus: "DISPUTED",
        ...UNBOUNDED,
      });

      expect(disputed.items.map((item) => item.question.id)).toEqual([
        "q-disputed",
      ]);

      const shortAnswers = await subject.questions.search({
        certificationId,
        questionType: "SHORT_ANSWER",
        ...UNBOUNDED,
      });

      expect(shortAnswers.items.map((item) => item.question.id)).toEqual([
        "q-retired",
      ]);

      const matches = await subject.questions.search({
        certificationId,
        stemContains: "retired",
        ...UNBOUNDED,
      });

      expect(matches.items.map((item) => item.question.id)).toEqual([
        "q-retired",
      ]);
    });

    it("matches the stem case-insensitively and treats wildcards literally", async () => {
      await seedBank(subject);

      const certificationId = certificationFixture().id;

      await expect(
        subject.questions
          .search({ certificationId, stemContains: "RETIRED", ...UNBOUNDED })
          .then((page) => page.items.length),
      ).resolves.toBe(1);

      // A bare `%` would match every stem if it were passed through as a
      // wildcard.
      await expect(
        subject.questions
          .search({ certificationId, stemContains: "%", ...UNBOUNDED })
          .then((page) => page.items.length),
      ).resolves.toBe(0);
    });

    it("never returns another certification's questions", async () => {
      await seedBank(subject);
      await subject.certifications.save(
        certificationFixture({ id: "certification-2", slug: "other-track" }),
      );
      await subject.questions.create(
        questionFixture({
          id: "q-other",
          certificationId: "certification-2",
          currentRevisionId: "rev-other",
        }),
        revisionFixture({ id: "rev-other", questionId: "q-other" }),
      );

      const page = await subject.questions.search({
        certificationId: certificationFixture().id,
        ...UNBOUNDED,
      });

      expect(page.items.map((item) => item.question.id)).not.toContain(
        "q-other",
      );
    });

    it("bounds the page and reports the total that matched", async () => {
      await seedBank(subject);

      const page = await subject.questions.search({
        certificationId: certificationFixture().id,
        limit: 2,
        offset: 0,
      });

      expect(page.items).toHaveLength(2);
      expect(page.totalCount).toBe(4);
      expect(page.limit).toBe(2);

      const second = await subject.questions.search({
        certificationId: certificationFixture().id,
        limit: 2,
        offset: 2,
      });

      expect(second.items).toHaveLength(2);
      expect(second.totalCount).toBe(4);
      expect(
        new Set([
          ...page.items.map((item) => item.question.id),
          ...second.items.map((item) => item.question.id),
        ]).size,
      ).toBe(4);
    });

    it("counts the bank by lifecycle", async () => {
      await seedBank(subject);

      await expect(
        subject.questions.countsByCertification(certificationFixture().id),
      ).resolves.toEqual({ total: 4, active: 2 });
    });

    it("counts an empty bank as zero", async () => {
      await expect(
        subject.questions.countsByCertification(certificationFixture().id),
      ).resolves.toEqual({ total: 0, active: 0 });
    });

    it("replaces objective links and filters by them", async () => {
      const question = questionFixture();

      await subject.questions.create(question, revisionFixture());
      await subject.objectives.save(
        objectiveFixture({ id: "objective-2", displayOrder: 2 }),
      );

      await subject.questions.replaceObjectiveLinks(
        question.id,
        ["objective-1", "objective-2", "objective-1"],
        LATER,
      );

      // Duplicates collapse; ordering follows the objective display order.
      await expect(
        subject.questions.listObjectiveLinks(question.id),
      ).resolves.toEqual(["objective-1", "objective-2"]);

      const filtered = await subject.questions.search({
        certificationId: certificationFixture().id,
        objectiveId: "objective-2",
        ...UNBOUNDED,
      });

      expect(filtered.items.map((item) => item.question.id)).toEqual([
        question.id,
      ]);

      await subject.questions.replaceObjectiveLinks(
        question.id,
        ["objective-2"],
        LATER,
      );

      await expect(
        subject.questions.listObjectiveLinks(question.id),
      ).resolves.toEqual(["objective-2"]);
      await expect(
        subject.questions
          .search({
            certificationId: certificationFixture().id,
            objectiveId: "objective-1",
            ...UNBOUNDED,
          })
          .then((page) => page.items),
      ).resolves.toEqual([]);
    });

    it("reports not found when mapping objectives to an unknown question", async () => {
      await expect(
        subject.questions.replaceObjectiveLinks("missing", [], LATER),
      ).rejects.toBeInstanceOf(QuestionNotFoundError);
    });

    it("deletes the root, every revision, and every objective link", async () => {
      const question = questionFixture();

      await subject.questions.create(question, revisionFixture());
      await subject.questions.appendRevision(
        revisionFixture({ id: "revision-2", revisionNumber: 2 }),
        LATER,
      );
      await subject.questions.replaceObjectiveLinks(
        question.id,
        ["objective-1"],
        LATER,
      );

      await subject.questions.delete(question.id);

      await expect(subject.questions.findById(question.id)).resolves.toBeNull();
      await expect(
        subject.questions.listRevisions(question.id),
      ).resolves.toEqual([]);
      await expect(
        subject.questions.findRevision(question.id, 1),
      ).resolves.toBeNull();
      await expect(
        subject.questions.countsByCertification(certificationFixture().id),
      ).resolves.toEqual({ total: 0, active: 0 });
      // The objective survives; only the mapping went with the question.
      await expect(
        subject.objectives.findById("objective-1"),
      ).resolves.not.toBeNull();
    });
  });
}

/**
 * Four questions covering each lifecycle state plus one dispute.
 *
 * Written through the repository rather than raw SQL so the seed exercises the
 * adapter under test.
 */
async function seedBank(subject: QuestionContractSubject): Promise<void> {
  const entries = [
    {
      id: "q-draft",
      lifecycleStatus: "DRAFT" as const,
      qualityStatus: "UNREVIEWED" as const,
      stem: "A draft question?",
      questionType: "SINGLE_CHOICE" as const,
    },
    {
      id: "q-active",
      lifecycleStatus: "ACTIVE" as const,
      qualityStatus: "USER_APPROVED" as const,
      stem: "An active question?",
      questionType: "SINGLE_CHOICE" as const,
    },
    {
      id: "q-disputed",
      lifecycleStatus: "ACTIVE" as const,
      qualityStatus: "DISPUTED" as const,
      stem: "A questionable question?",
      questionType: "MULTIPLE_RESPONSE" as const,
    },
    {
      id: "q-retired",
      lifecycleStatus: "RETIRED" as const,
      qualityStatus: "OUTDATED" as const,
      stem: "A retired question?",
      questionType: "SHORT_ANSWER" as const,
    },
  ];

  for (const entry of entries) {
    const revisionId = `rev-${entry.id}`;

    await subject.questions.create(
      questionFixture({
        id: entry.id,
        currentRevisionId: revisionId,
        lifecycleStatus: entry.lifecycleStatus,
        qualityStatus: entry.qualityStatus,
        disputeReason:
          entry.qualityStatus === "DISPUTED" ? "Needs a source check." : null,
      }),
      revisionFixture({
        id: revisionId,
        questionId: entry.id,
        stem: entry.stem,
        questionType: entry.questionType,
        content:
          entry.questionType === "SHORT_ANSWER"
            ? shortAnswerContent()
            : entry.questionType === "MULTIPLE_RESPONSE"
              ? multipleResponseContent()
              : revisionFixture().content,
      }),
    );
  }
}
