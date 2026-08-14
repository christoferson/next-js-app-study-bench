import type { Clock } from "@/platform/clock";
import type { IdGenerator } from "@/platform/id-generator";
import type {
  Certification,
  CertificationId,
  CertificationSlug,
} from "@/modules/certifications/domain/certification";
import { CertificationNotFoundError } from "@/modules/certifications/domain/errors";
import type {
  Objective,
  ObjectiveId,
} from "@/modules/certifications/domain/objective";
import type { CertificationRepository } from "@/modules/certifications/ports/certification-repository";
import type { ObjectiveRepository } from "@/modules/certifications/ports/objective-repository";
import type {
  QuestionContent,
  QuestionId,
  QuestionRevision,
} from "@/modules/question-bank/domain/question";
import { describeExpectedAnswer } from "@/modules/question-bank/domain/question";
import {
  FlashcardNotFoundError,
  FlashcardNotReviewableError,
  FlashcardObjectiveMismatchError,
  QuestionNotConvertibleError,
} from "@/modules/flashcards/domain/errors";
import type {
  Flashcard,
  FlashcardContent,
  FlashcardId,
  FlashcardLifecycleStatus,
  FlashcardRevision,
  FlashcardWithRevision,
} from "@/modules/flashcards/domain/flashcard";
import { assertValidContent } from "@/modules/flashcards/domain/flashcard-content";
import {
  assertLifecycleTransition,
  isReviewEligible,
} from "@/modules/flashcards/domain/flashcard-lifecycle";
import type {
  RecallRating,
  ReviewSchedule,
  ReviewSchedulingStrategy,
} from "@/modules/flashcards/domain/review-scheduling";
import type {
  DueFlashcard,
  FlashcardRepository,
  FlashcardReviewRecord,
  FlashcardSearchCriteria,
} from "@/modules/flashcards/ports/flashcard-repository";
import type { FlashcardUnitOfWork } from "@/modules/flashcards/ports/unit-of-work";
import type { FlashcardFilterInput, FlashcardInput } from "./schemas";

/**
 * Flashcard capability facade.
 *
 * Owns the authoring workflow (revision creation, lifecycle transitions,
 * objective mapping, bounded bank search), the review workflow (due queue, rating,
 * history), and conversion from a question. Server Actions and pages call this
 * facade; they never touch SQL, revision numbering, transition rules, or the
 * scheduling algorithm themselves.
 */

/** Page size for the flashcard bank list. */
export const CARD_PAGE_SIZE = 20;

/**
 * How many due cards to fetch when showing one.
 *
 * The review screen shows a single card, but reading a small window rather than
 * exactly one lets the view report how much is left without a second query, and
 * keeps the read bounded (`spec/ARCHITECTURE.md` section 8).
 */
export const DUE_QUEUE_WINDOW = 20;

/** How many reviews the history view shows. */
export const REVIEW_HISTORY_LIMIT = 50;

/** Bank list view: one bounded page plus the filter choices the view renders. */
export interface FlashcardBankView {
  readonly certification: Certification;
  readonly items: readonly FlashcardWithRevision[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageCount: number;
  /** Objectives offered in the objective filter, archived ones included. */
  readonly objectives: readonly Objective[];
  readonly filters: FlashcardFilterInput;
  /** Total cards in this bank regardless of the active filters. */
  readonly unfilteredCount: number;
  readonly dueCount: number;
}

/** Detail view: the current revision, history, mappings, and review history. */
export interface FlashcardDetailView {
  readonly certification: Certification;
  readonly flashcard: Flashcard;
  readonly currentRevision: FlashcardRevision;
  readonly revisions: readonly FlashcardRevision[];
  readonly linkedObjectives: readonly Objective[];
  /** Objectives of this track not yet mapped, for the add control. */
  readonly linkableObjectives: readonly Objective[];
  readonly schedule: ReviewSchedule | null;
  readonly reviews: readonly FlashcardReviewRecord[];
  /** Set when the card was converted from a question. */
  readonly sourceQuestionId: QuestionId | null;
}

/** Edit-form view: the revision being edited plus its card. */
export interface FlashcardFormView {
  readonly certification: Certification;
  readonly flashcard: Flashcard;
  readonly revision: FlashcardRevision;
}

/** One historical revision rendered read-only. */
export interface FlashcardRevisionView {
  readonly certification: Certification;
  readonly flashcard: Flashcard;
  readonly revision: FlashcardRevision;
  readonly isCurrent: boolean;
}

/**
 * Review-screen view: the next due card, or nothing left to review.
 *
 * `remainingCount` includes the card on screen, so the view can say "3 due" while
 * showing the first of them.
 */
export interface ReviewSessionView {
  readonly certification: Certification;
  readonly card: DueFlashcard | null;
  readonly remainingCount: number;
  /** Active cards in this track, so an empty queue can explain itself. */
  readonly activeCount: number;
}

/** What a recorded review did, so the view can confirm it. */
export interface ReviewOutcome {
  readonly flashcardId: FlashcardId;
  readonly rating: RecallRating;
  readonly schedule: ReviewSchedule;
}

export interface FlashcardFacadeDependencies {
  readonly flashcards: FlashcardRepository;
  readonly certifications: CertificationRepository;
  readonly objectives: ObjectiveRepository;
  readonly unitOfWork: FlashcardUnitOfWork;
  /** The replaceable scheduling algorithm (`SPEC.md` section 6.5). */
  readonly scheduler: ReviewSchedulingStrategy;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export class FlashcardFacade {
  constructor(private readonly deps: FlashcardFacadeDependencies) {}

  /**
   * Bounded bank page for one track.
   *
   * Always paginated: `spec/ARCHITECTURE.md` section 8 forbids unbounded bank
   * queries, so the repository is given an explicit limit and the view reports the
   * total so the owner knows what is not on screen.
   */
  async findBankBySlug(
    slug: CertificationSlug,
    filters: FlashcardFilterInput,
  ): Promise<FlashcardBankView | null> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      return null;
    }

    const objectives = await this.deps.objectives.listByCertification(
      certification.id,
    );
    const page = Math.max(1, filters.page);
    const criteria: FlashcardSearchCriteria = {
      certificationId: certification.id,
      limit: CARD_PAGE_SIZE,
      offset: (page - 1) * CARD_PAGE_SIZE,
      ...(filters.lifecycle !== null
        ? { lifecycleStatus: filters.lifecycle }
        : {}),
      ...(filters.type !== null ? { cardType: filters.type } : {}),
      // An objective filter naming an objective outside this track is ignored
      // rather than rejected: the certification condition already scopes the
      // query, so the result would be empty and misleading.
      ...(filters.objective !== null &&
      objectives.some((objective) => objective.id === filters.objective)
        ? { objectiveId: filters.objective }
        : {}),
      ...(filters.q !== null ? { textContains: filters.q } : {}),
    };

    const [result, counts, dueCount] = await Promise.all([
      this.deps.flashcards.search(criteria),
      this.deps.flashcards.countsByCertification(certification.id),
      this.deps.flashcards.countDueCards(
        certification.id,
        this.deps.clock.now(),
      ),
    ]);

    return {
      certification,
      items: result.items,
      totalCount: result.totalCount,
      page,
      pageCount: Math.max(1, Math.ceil(result.totalCount / CARD_PAGE_SIZE)),
      objectives,
      filters,
      unfilteredCount: counts.total,
      dueCount,
    };
  }

  /** Active and total counts plus the due count, for the track page. */
  async countBank(certificationId: CertificationId): Promise<{
    readonly total: number;
    readonly active: number;
    readonly due: number;
  }> {
    const [counts, due] = await Promise.all([
      this.deps.flashcards.countsByCertification(certificationId),
      this.deps.flashcards.countDueCards(
        certificationId,
        this.deps.clock.now(),
      ),
    ]);

    return { total: counts.total, active: counts.active, due };
  }

  async findDetail(
    slug: CertificationSlug,
    flashcardId: FlashcardId,
  ): Promise<FlashcardDetailView | null> {
    const found = await this.findScoped(slug, flashcardId);

    if (found === null) {
      return null;
    }

    const { certification, flashcard, revision } = found;
    const [revisions, linkedIds, objectives, schedule, reviews] =
      await Promise.all([
        this.deps.flashcards.listRevisions(flashcard.id),
        this.deps.flashcards.listObjectiveLinks(flashcard.id),
        this.deps.objectives.listByCertification(certification.id),
        this.deps.flashcards.findSchedule(flashcard.id),
        this.deps.flashcards.listReviews(flashcard.id, REVIEW_HISTORY_LIMIT),
      ]);

    const linked = new Set(linkedIds);

    return {
      certification,
      flashcard,
      currentRevision: revision,
      // Newest first: the current revision is what the owner reads most.
      revisions: [...revisions].reverse(),
      linkedObjectives: objectives.filter((objective) =>
        linked.has(objective.id),
      ),
      linkableObjectives: objectives.filter(
        (objective) =>
          !linked.has(objective.id) && objective.status === "ACTIVE",
      ),
      schedule,
      reviews,
      sourceQuestionId: flashcard.sourceQuestionId,
    };
  }

  async findEditForm(
    slug: CertificationSlug,
    flashcardId: FlashcardId,
  ): Promise<FlashcardFormView | null> {
    const found = await this.findScoped(slug, flashcardId);

    if (found === null) {
      return null;
    }

    return {
      certification: found.certification,
      flashcard: found.flashcard,
      revision: found.revision,
    };
  }

  /** The create form only needs the track the card will belong to. */
  async findNewCardForm(
    slug: CertificationSlug,
  ): Promise<Certification | null> {
    return this.deps.certifications.findBySlug(slug);
  }

  async findRevisionView(
    slug: CertificationSlug,
    flashcardId: FlashcardId,
    revisionNumber: number,
  ): Promise<FlashcardRevisionView | null> {
    const found = await this.findScoped(slug, flashcardId);

    if (found === null) {
      return null;
    }

    const revision = await this.deps.flashcards.findRevision(
      flashcardId,
      revisionNumber,
    );

    if (revision === null) {
      return null;
    }

    return {
      certification: found.certification,
      flashcard: found.flashcard,
      revision,
      isCurrent: revision.id === found.flashcard.currentRevisionId,
    };
  }

  /**
   * The next card to review in one track.
   *
   * Reads a bounded window of the due queue and shows its first entry. The queue
   * is deterministically ordered, so reloading the page offers the same card until
   * it is rated — there is no hidden cursor and nothing to lose if the tab is
   * closed.
   */
  async findReviewSession(
    slug: CertificationSlug,
  ): Promise<ReviewSessionView | null> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      return null;
    }

    const now = this.deps.clock.now();
    const [due, counts, dueCount] = await Promise.all([
      this.deps.flashcards.findDueCards({
        certificationId: certification.id,
        now,
        limit: DUE_QUEUE_WINDOW,
      }),
      this.deps.flashcards.countsByCertification(certification.id),
      this.deps.flashcards.countDueCards(certification.id, now),
    ]);

    return {
      certification,
      card: due[0] ?? null,
      remainingCount: dueCount,
      activeCount: counts.active,
    };
  }

  /**
   * Creates a card as a draft with revision 1.
   *
   * The root and its first revision are written in one transaction: a root without
   * content is not a valid aggregate (`SPEC.md` section 9.6).
   */
  async createFlashcard(
    certificationId: CertificationId,
    input: FlashcardInput,
  ): Promise<Flashcard> {
    const content = toContent(input);

    assertValidContent(content);

    return this.deps.unitOfWork.transaction(
      async ({ flashcards, certifications }) => {
        if ((await certifications.findById(certificationId)) === null) {
          throw new CertificationNotFoundError(certificationId);
        }

        const now = this.deps.clock.now();
        const flashcardId = this.deps.ids.nextId();
        const flashcard: Flashcard = {
          id: flashcardId,
          certificationId,
          currentRevisionId: this.deps.ids.nextId(),
          lifecycleStatus: "DRAFT",
          sourceQuestionId: null,
          generationMode: "MANUAL",
          generationRunId: null,
          createdAt: now,
          updatedAt: now,
        };

        await flashcards.create(flashcard, {
          id: flashcard.currentRevisionId,
          flashcardId,
          revisionNumber: 1,
          cardType: content.type,
          content,
          notes: input.notes,
          tags: input.tags,
          language: input.language,
          // The owner wrote this text, so no run wrote it.
          generationRunId: null,
          createdAt: now,
        });

        return flashcard;
      },
    );
  }

  /**
   * Appends a new revision and points the card at it.
   *
   * Existing revisions are never touched, so earlier wording stays inspectable and
   * every recorded review still names the text it was answered against
   * (`spec/DOMAIN-RULES.md` sections 1.1 and 1.4). Neither the lifecycle status nor
   * the schedule changes: an edit is not a study event, so a reviewed card keeps
   * its due date and its history, and a retired card stays retired.
   */
  async reviseFlashcard(
    flashcardId: FlashcardId,
    input: FlashcardInput,
  ): Promise<FlashcardRevision> {
    const content = toContent(input);

    assertValidContent(content);

    return this.deps.unitOfWork.transaction(async ({ flashcards }) => {
      const existing = await flashcards.findById(flashcardId);

      if (existing === null) {
        throw new FlashcardNotFoundError(flashcardId);
      }

      const revisions = await flashcards.listRevisions(flashcardId);
      const highest = revisions.reduce(
        (maximum, revision) => Math.max(maximum, revision.revisionNumber),
        0,
      );
      const now = this.deps.clock.now();
      const revision: FlashcardRevision = {
        id: this.deps.ids.nextId(),
        flashcardId,
        revisionNumber: highest + 1,
        cardType: content.type,
        content,
        notes: input.notes,
        tags: input.tags,
        language: input.language,
        // A hand edit, even to a card a run created: this text is the owner's.
        generationRunId: null,
        createdAt: now,
      };

      await flashcards.appendRevision(revision, now);

      return revision;
    });
  }

  async activateFlashcard(flashcardId: FlashcardId): Promise<void> {
    await this.transitionLifecycle(flashcardId, "ACTIVE");
  }

  async retireFlashcard(flashcardId: FlashcardId): Promise<void> {
    await this.transitionLifecycle(flashcardId, "RETIRED");
  }

  /** Restore is the `RETIRED` to `ACTIVE` transition. */
  async restoreFlashcard(flashcardId: FlashcardId): Promise<void> {
    await this.transitionLifecycle(flashcardId, "ACTIVE");
  }

  /**
   * Maps an objective to a card.
   *
   * The objective must belong to the card's certification: a mapping across tracks
   * would put a card in a study map it was never written for. The check and the
   * write share one transaction.
   */
  async linkObjective(
    flashcardId: FlashcardId,
    objectiveId: ObjectiveId,
  ): Promise<void> {
    await this.deps.unitOfWork.transaction(
      async ({ flashcards, objectives }) => {
        const flashcard = await flashcards.findById(flashcardId);

        if (flashcard === null) {
          throw new FlashcardNotFoundError(flashcardId);
        }

        const objective = await objectives.findById(objectiveId);

        if (
          objective === null ||
          objective.certificationId !== flashcard.certificationId
        ) {
          throw new FlashcardObjectiveMismatchError(objectiveId);
        }

        const existing = await flashcards.listObjectiveLinks(flashcardId);

        await flashcards.replaceObjectiveLinks(
          flashcardId,
          [...existing, objectiveId],
          this.deps.clock.now(),
        );
      },
    );
  }

  async unlinkObjective(
    flashcardId: FlashcardId,
    objectiveId: ObjectiveId,
  ): Promise<void> {
    await this.deps.unitOfWork.transaction(async ({ flashcards }) => {
      const flashcard = await flashcards.findById(flashcardId);

      if (flashcard === null) {
        throw new FlashcardNotFoundError(flashcardId);
      }

      const existing = await flashcards.listObjectiveLinks(flashcardId);

      await flashcards.replaceObjectiveLinks(
        flashcardId,
        existing.filter((id) => id !== objectiveId),
        this.deps.clock.now(),
      );
    });
  }

  /**
   * Records a recall rating and reschedules the card.
   *
   * One transaction writes both the review record and the schedule, so a rating can
   * never be counted without moving the due date and the due date can never move
   * without a review that explains it (`SPEC.md` section 22.3).
   *
   * The card's eligibility is re-checked inside the transaction rather than trusted
   * from the page that submitted the rating: a review screen left open in another
   * tab may be describing a card that has since been retired, and putting a
   * withdrawn card back on a schedule would contradict the exclusion rule.
   *
   * `revisionId` is the revision the owner actually read, submitted with the
   * rating. If the card was edited between the render and the rating, the review
   * still names the text that was on screen.
   */
  async reviewCard(
    flashcardId: FlashcardId,
    revisionId: string,
    rating: RecallRating,
  ): Promise<ReviewOutcome> {
    return this.deps.unitOfWork.transaction(async ({ flashcards }) => {
      const flashcard = await flashcards.findById(flashcardId);

      if (flashcard === null) {
        throw new FlashcardNotFoundError(flashcardId);
      }

      if (!isReviewEligible(flashcard)) {
        throw new FlashcardNotReviewableError(flashcard.lifecycleStatus);
      }

      const current = await flashcards.findSchedule(flashcardId);
      const schedule = this.deps.scheduler.schedule({ rating, current });
      // The submitted revision is accepted only if it belongs to this card;
      // otherwise the review is attributed to what the card shows now, so a
      // tampered or stale identifier cannot point the history at another card.
      const reviewedRevisionId = await this.resolveReviewedRevision(
        flashcards,
        flashcard,
        revisionId,
      );

      await flashcards.recordReview({
        id: this.deps.ids.nextId(),
        flashcardId,
        flashcardRevisionId: reviewedRevisionId,
        rating,
        reviewedAt: schedule.lastReviewedAt,
        intervalMinutes: schedule.intervalMinutes,
        dueAt: schedule.dueAt,
        schedulerId: schedule.schedulerId,
      });
      await flashcards.saveSchedule(
        flashcardId,
        schedule,
        schedule.lastReviewedAt,
      );

      return { flashcardId, rating, schedule };
    });
  }

  /**
   * Creates a flashcard from an active question.
   *
   * The card is a draft copy: it carries the question's objective mappings and
   * records `sourceQuestionId` as provenance, and from then on the two are
   * independent — editing either never changes the other
   * (`SPEC.md` section 6.4, "link it to a source").
   *
   * Only an `ACTIVE` question converts. A draft would copy wording the owner has
   * not finished, and a retired or archived one would return withdrawn content to
   * study.
   */
  async convertQuestion(questionId: QuestionId): Promise<Flashcard> {
    return this.deps.unitOfWork.transaction(
      async ({ flashcards, questions }) => {
        const found = await questions.findWithCurrentRevision(questionId);

        if (found === null) {
          throw new QuestionNotConvertibleError(
            "That question no longer exists.",
          );
        }

        if (found.question.lifecycleStatus !== "ACTIVE") {
          throw new QuestionNotConvertibleError(
            "Only an active question can be turned into a flashcard. Activate it first.",
          );
        }

        const content = toCardContentFromQuestion(found.revision);

        assertValidContent(content);

        const now = this.deps.clock.now();
        const flashcardId = this.deps.ids.nextId();
        const flashcard: Flashcard = {
          id: flashcardId,
          certificationId: found.question.certificationId,
          currentRevisionId: this.deps.ids.nextId(),
          lifecycleStatus: "DRAFT",
          sourceQuestionId: questionId,
          // A conversion copies owner-authored content, so the card is `MANUAL`
          // even when the question it came from was generated: no model produced
          // this card's text.
          generationMode: "MANUAL",
          generationRunId: null,
          createdAt: now,
          updatedAt: now,
        };

        await flashcards.create(flashcard, {
          id: flashcard.currentRevisionId,
          flashcardId,
          revisionNumber: 1,
          cardType: content.type,
          content,
          // The question's explanation becomes the card's owner-only note: it is
          // context for the owner, not part of either face.
          notes: found.revision.explanation,
          tags: found.revision.tags,
          language: found.revision.language,
          // Copied owner-authored text, for the same reason the card is `MANUAL`.
          generationRunId: null,
          createdAt: now,
        });

        // Objective mappings carry over, because the card teaches the same part of
        // the syllabus. Both belong to the same certification, so the mappings are
        // valid by construction.
        const objectiveIds = await questions.listObjectiveLinks(questionId);

        if (objectiveIds.length > 0) {
          await flashcards.replaceObjectiveLinks(
            flashcardId,
            objectiveIds,
            now,
          );
        }

        return flashcard;
      },
    );
  }

  private async transitionLifecycle(
    flashcardId: FlashcardId,
    to: FlashcardLifecycleStatus,
  ): Promise<void> {
    const flashcard = await this.requireFlashcard(flashcardId);

    assertLifecycleTransition(flashcard.lifecycleStatus, to);

    await this.deps.flashcards.setLifecycleStatus(
      flashcardId,
      to,
      this.deps.clock.now(),
    );
  }

  private async requireFlashcard(flashcardId: FlashcardId): Promise<Flashcard> {
    const flashcard = await this.deps.flashcards.findById(flashcardId);

    if (flashcard === null) {
      throw new FlashcardNotFoundError(flashcardId);
    }

    return flashcard;
  }

  /** The submitted revision if it belongs to this card, else the current one. */
  private async resolveReviewedRevision(
    flashcards: FlashcardRepository,
    flashcard: Flashcard,
    revisionId: string,
  ): Promise<string> {
    if (revisionId === flashcard.currentRevisionId) {
      return revisionId;
    }

    const revisions = await flashcards.listRevisions(flashcard.id);

    return revisions.some((revision) => revision.id === revisionId)
      ? revisionId
      : flashcard.currentRevisionId;
  }

  /**
   * Loads a card and asserts it belongs to `slug`'s certification.
   *
   * Returns `null` for both an unknown card and a card of another track, so a
   * guessed or stale address is a 404 rather than a leak of another track's
   * content.
   */
  private async findScoped(
    slug: CertificationSlug,
    flashcardId: FlashcardId,
  ): Promise<
    (FlashcardWithRevision & { readonly certification: Certification }) | null
  > {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      return null;
    }

    const found =
      await this.deps.flashcards.findWithCurrentRevision(flashcardId);

    if (
      found === null ||
      found.flashcard.certificationId !== certification.id
    ) {
      return null;
    }

    return { ...found, certification };
  }
}

/**
 * Builds the content union from parsed form input.
 *
 * Exhaustive over the input union, so a sixth card type cannot be added without
 * deciding how its content is assembled (`spec/CODING-STANDARDS.md` section 1.4).
 */
function toContent(input: FlashcardInput): FlashcardContent {
  switch (input.cardType) {
    case "BASIC":
      return { type: "BASIC", front: input.front, back: input.back };
    case "REVERSED":
      return { type: "REVERSED", front: input.front, back: input.back };
    case "CLOZE":
      return { type: "CLOZE", text: input.text };
    case "VOCABULARY":
      return {
        type: "VOCABULARY",
        term: input.term,
        reading: input.reading,
        meaning: input.meaning,
        exampleSentence: input.exampleSentence,
        // An absent or empty list means the field was left blank, which is the
        // card not carrying that field rather than carrying an empty one.
        // Omitting the key keeps a hand-written card's payload identical to what
        // it was before these fields existed.
        ...optionalList("meanings", input.meanings),
        ...optionalList("synonyms", input.synonyms),
        ...optionalList("antonyms", input.antonyms),
        ...optionalList("examples", input.examples),
        ...(input.usageNotes === undefined || input.usageNotes === null
          ? {}
          : { usageNotes: input.usageNotes }),
      };
    case "SCENARIO":
      return {
        type: "SCENARIO",
        scenario: input.scenario,
        question: input.question,
        answer: input.answer,
      };
  }
}

/**
 * One optional list field, present only when it has entries.
 *
 * `{ examples: [] }` and no `examples` key are the same card, and a stored empty
 * array would make one card's payload differ from another's for no reason the
 * owner could see, so the empty case omits the key.
 */
function optionalList<Key extends string, Entry>(
  key: Key,
  entries: readonly Entry[] | undefined,
): Partial<Record<Key, readonly Entry[]>> {
  return entries === undefined || entries.length === 0
    ? {}
    : ({ [key]: entries } as Record<Key, readonly Entry[]>);
}

/**
 * Maps a question revision onto card content.
 *
 * Every question type becomes a `BASIC` card: the stem prompts and the expected
 * answer is revealed. The alternatives were considered and rejected —
 * a `SCENARIO` card would invent a situation the question does not have, and a
 * `CLOZE` card would need deletion markers no question supplies. The converted
 * card is a draft, so the owner can change its type before activating it, which is
 * a better default than guessing.
 *
 * Choice lists are deliberately not copied into the front face: a flashcard is a
 * recall prompt, and keeping the distractors would turn it into a
 * multiple-choice question rendered as a card.
 */
function toCardContentFromQuestion(
  revision: QuestionRevision,
): FlashcardContent {
  return {
    type: "BASIC",
    front: revision.stem,
    back: answerText(revision.content),
  };
}

/** The question's expected answer as one readable back face. */
function answerText(content: QuestionContent): string {
  const described = describeExpectedAnswer(content);

  // A question with no marked answer would produce an unstudiable card, so the
  // domain's content check rejects it with a message rather than storing a blank
  // face.
  return described === "—" ? "" : described;
}
