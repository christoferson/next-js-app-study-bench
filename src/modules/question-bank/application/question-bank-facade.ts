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
import {
  QuestionNotDeletableError,
  QuestionNotFoundError,
  QuestionObjectiveMismatchError,
} from "@/modules/question-bank/domain/errors";
import type {
  Choice,
  Question,
  QuestionContent,
  QuestionId,
  QuestionQualityStatus,
  QuestionRevision,
  QuestionType,
  QuestionWithRevision,
} from "@/modules/question-bank/domain/question";
import { assertValidContent } from "@/modules/question-bank/domain/question-content";
import { choiceId } from "@/modules/question-bank/domain/question-content";
import {
  assertCanApprove,
  assertCanDispute,
  assertCanResolveDispute,
  assertLifecycleTransition,
} from "@/modules/question-bank/domain/question-lifecycle";
import type {
  QuestionDependencyChecker,
  QuestionDependencyKind,
} from "@/modules/question-bank/ports/question-dependency-checker";
import { describeDependencyKind } from "@/modules/question-bank/ports/question-dependency-checker";
import type {
  QuestionRepository,
  QuestionSearchCriteria,
} from "@/modules/question-bank/ports/question-repository";
import type { QuestionBankUnitOfWork } from "@/modules/question-bank/ports/unit-of-work";
import type { QuestionFilterInput, QuestionInput } from "./schemas";

/**
 * Question-bank capability facade.
 *
 * Owns the manual authoring workflow: revision creation, lifecycle and quality
 * transitions, objective mapping, bounded bank search, and deletion eligibility.
 * Server Actions and pages call this facade; they never touch SQL, revision
 * numbering, or transition rules themselves.
 */

/** Page size for the bank list. */
export const BANK_PAGE_SIZE = 20;

/** Bank list view: one bounded page plus the filter choices the view renders. */
export interface QuestionBankView {
  readonly certification: Certification;
  readonly items: readonly QuestionWithRevision[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageCount: number;
  /** Objectives offered in the objective filter, archived ones included. */
  readonly objectives: readonly Objective[];
  readonly filters: QuestionFilterInput;
  /** Total questions in this bank regardless of the active filters. */
  readonly unfilteredCount: number;
}

/** Detail view: the current revision, history, mappings, and deletability. */
export interface QuestionDetailView {
  readonly certification: Certification;
  readonly question: Question;
  readonly currentRevision: QuestionRevision;
  readonly revisions: readonly QuestionRevision[];
  readonly linkedObjectives: readonly Objective[];
  /** Objectives of this track not yet mapped, for the add control. */
  readonly linkableObjectives: readonly Objective[];
  readonly deletable: boolean;
  readonly blockingDependencies: readonly string[];
}

/** Edit-form view: the revision being edited plus its question. */
export interface QuestionFormView {
  readonly certification: Certification;
  readonly question: Question;
  readonly revision: QuestionRevision;
}

/** One historical revision rendered read-only. */
export interface QuestionRevisionView {
  readonly certification: Certification;
  readonly question: Question;
  readonly revision: QuestionRevision;
  readonly isCurrent: boolean;
}

export interface QuestionBankFacadeDependencies {
  readonly questions: QuestionRepository;
  readonly certifications: CertificationRepository;
  readonly objectives: ObjectiveRepository;
  readonly unitOfWork: QuestionBankUnitOfWork;
  readonly dependencies: QuestionDependencyChecker;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export class QuestionBankFacade {
  constructor(private readonly deps: QuestionBankFacadeDependencies) {}

  /**
   * Bounded bank page for one track.
   *
   * Always paginated: `spec/ARCHITECTURE.md` section 8 forbids unbounded bank
   * queries, so the repository is given an explicit limit and the view reports
   * the total so the owner knows what is not on screen.
   */
  async findBankBySlug(
    slug: CertificationSlug,
    filters: QuestionFilterInput,
  ): Promise<QuestionBankView | null> {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      return null;
    }

    const objectives = await this.deps.objectives.listByCertification(
      certification.id,
    );
    const page = Math.max(1, filters.page);
    const criteria: QuestionSearchCriteria = {
      certificationId: certification.id,
      limit: BANK_PAGE_SIZE,
      offset: (page - 1) * BANK_PAGE_SIZE,
      ...(filters.lifecycle !== null
        ? { lifecycleStatus: filters.lifecycle }
        : {}),
      ...(filters.quality !== null ? { qualityStatus: filters.quality } : {}),
      ...(filters.type !== null ? { questionType: filters.type } : {}),
      // An objective filter naming an objective outside this track is ignored
      // rather than rejected: the certification condition already scopes the
      // query, so the result would be empty and misleading.
      ...(filters.objective !== null &&
      objectives.some((objective) => objective.id === filters.objective)
        ? { objectiveId: filters.objective }
        : {}),
      ...(filters.q !== null ? { stemContains: filters.q } : {}),
    };

    const [result, counts] = await Promise.all([
      this.deps.questions.search(criteria),
      this.deps.questions.countsByCertification(certification.id),
    ]);

    return {
      certification,
      items: result.items,
      totalCount: result.totalCount,
      page,
      pageCount: Math.max(1, Math.ceil(result.totalCount / BANK_PAGE_SIZE)),
      objectives,
      filters,
      unfilteredCount: counts.total,
    };
  }

  /** Active and total counts, for the link on the track page. */
  async countBank(certificationId: CertificationId) {
    return this.deps.questions.countsByCertification(certificationId);
  }

  async findDetail(
    slug: CertificationSlug,
    questionId: QuestionId,
  ): Promise<QuestionDetailView | null> {
    const found = await this.findScoped(slug, questionId);

    if (found === null) {
      return null;
    }

    const { certification, question, revision } = found;
    const [revisions, linkedIds, objectives, eligibility] = await Promise.all([
      this.deps.questions.listRevisions(question.id),
      this.deps.questions.listObjectiveLinks(question.id),
      this.deps.objectives.listByCertification(certification.id),
      this.deps.dependencies.checkDeletionEligibility(question.id),
    ]);

    const linked = new Set(linkedIds);

    return {
      certification,
      question,
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
      deletable: eligibility.deletable,
      blockingDependencies: eligibility.blockingDependencies.map(
        describeDependencyKind,
      ),
    };
  }

  async findEditForm(
    slug: CertificationSlug,
    questionId: QuestionId,
  ): Promise<QuestionFormView | null> {
    const found = await this.findScoped(slug, questionId);

    if (found === null) {
      return null;
    }

    return {
      certification: found.certification,
      question: found.question,
      revision: found.revision,
    };
  }

  /** The create form only needs the track it will belong to. */
  async findNewQuestionForm(
    slug: CertificationSlug,
  ): Promise<Certification | null> {
    return this.deps.certifications.findBySlug(slug);
  }

  async findRevisionView(
    slug: CertificationSlug,
    questionId: QuestionId,
    revisionNumber: number,
  ): Promise<QuestionRevisionView | null> {
    const found = await this.findScoped(slug, questionId);

    if (found === null) {
      return null;
    }

    const revision = await this.deps.questions.findRevision(
      questionId,
      revisionNumber,
    );

    if (revision === null) {
      return null;
    }

    return {
      certification: found.certification,
      question: found.question,
      revision,
      isCurrent: revision.id === found.question.currentRevisionId,
    };
  }

  /**
   * Creates a question as a draft with revision 1.
   *
   * The root and its first revision are written in one transaction: a root
   * without content is not a valid aggregate (`SPEC.md` section 9.6).
   * `generationMode` is `MANUAL` and `generationRunId` is `null` because this is
   * the owner-authoring path; provenance is recorded at creation rather than
   * inferred later. A generated question is written by the ai-generation module,
   * which supplies its own mode and run reference.
   */
  async createQuestion(
    certificationId: CertificationId,
    input: QuestionInput,
  ): Promise<Question> {
    const content = toContent(input);

    assertValidContent(content);

    return this.deps.unitOfWork.transaction(
      async ({ questions, certifications }) => {
        if ((await certifications.findById(certificationId)) === null) {
          throw new CertificationNotFoundError(certificationId);
        }

        const now = this.deps.clock.now();
        const questionId = this.deps.ids.nextId();
        const question: Question = {
          id: questionId,
          certificationId,
          currentRevisionId: this.deps.ids.nextId(),
          lifecycleStatus: "DRAFT",
          qualityStatus: "UNREVIEWED",
          generationMode: "MANUAL",
          generationRunId: null,
          disputeReason: null,
          createdAt: now,
          updatedAt: now,
        };

        await questions.create(question, {
          id: question.currentRevisionId,
          questionId,
          revisionNumber: 1,
          stem: input.stem,
          instructions: input.instructions,
          questionType: input.questionType,
          content,
          explanation: input.explanation,
          difficulty: input.difficulty,
          tags: input.tags,
          language: input.language,
          createdAt: now,
        });

        return question;
      },
    );
  }

  /**
   * Appends a new revision and points the question at it.
   *
   * Existing revisions are never touched, so earlier wording stays inspectable
   * (`spec/DOMAIN-RULES.md` section 1.1). Neither status changes: an edit is not
   * a lifecycle or review event, so editing a retired or disputed question is
   * allowed and leaves it retired or disputed.
   */
  async reviseQuestion(
    questionId: QuestionId,
    input: QuestionInput,
  ): Promise<QuestionRevision> {
    const content = toContent(input);

    assertValidContent(content);

    return this.deps.unitOfWork.transaction(async ({ questions }) => {
      const existing = await questions.findById(questionId);

      if (existing === null) {
        throw new QuestionNotFoundError(questionId);
      }

      const revisions = await questions.listRevisions(questionId);
      const highest = revisions.reduce(
        (maximum, revision) => Math.max(maximum, revision.revisionNumber),
        0,
      );
      const now = this.deps.clock.now();
      const revision: QuestionRevision = {
        id: this.deps.ids.nextId(),
        questionId,
        revisionNumber: highest + 1,
        stem: input.stem,
        instructions: input.instructions,
        questionType: input.questionType,
        content,
        explanation: input.explanation,
        difficulty: input.difficulty,
        tags: input.tags,
        language: input.language,
        createdAt: now,
      };

      await questions.appendRevision(revision, now);

      return revision;
    });
  }

  async activateQuestion(questionId: QuestionId): Promise<void> {
    await this.transitionLifecycle(questionId, "ACTIVE");
  }

  async retireQuestion(questionId: QuestionId): Promise<void> {
    await this.transitionLifecycle(questionId, "RETIRED");
  }

  /** Restore is the `RETIRED` to `ACTIVE` transition. */
  async restoreQuestion(questionId: QuestionId): Promise<void> {
    await this.transitionLifecycle(questionId, "ACTIVE");
  }

  async approveQuestion(questionId: QuestionId): Promise<void> {
    const question = await this.requireQuestion(questionId);

    assertCanApprove(question);

    await this.deps.questions.setQualityStatus(
      questionId,
      "USER_APPROVED",
      null,
      this.deps.clock.now(),
    );
  }

  /**
   * Marks a question outdated, which is the owner's own call.
   *
   * Offered next to the "built on an older snapshot of this source" notice on the question's
   * page (`SPEC.md` section 26.2). Deliberately *not* applied by the refresh that produced
   * the newer snapshot: a refresh often changes nothing that matters to a question, and
   * downgrading every question of a refreshed source automatically would make refreshing a
   * source something the owner learns to avoid. The detection is the notice; this is the
   * decision.
   *
   * `assertCanApprove` is reused rather than a rule of its own, because it says exactly what
   * needs saying here too: a disputed question already carries a stronger judgement and a
   * reason attached to it, and overwriting that with "outdated" would lose the reason. The
   * owner resolves the dispute first.
   */
  async markQuestionOutdated(questionId: QuestionId): Promise<void> {
    const question = await this.requireQuestion(questionId);

    assertCanApprove(question);

    await this.deps.questions.setQualityStatus(
      questionId,
      "OUTDATED",
      null,
      this.deps.clock.now(),
    );
  }

  /** Records a dispute with the owner's reason; lifecycle is unaffected. */
  async disputeQuestion(questionId: QuestionId, reason: string): Promise<void> {
    const question = await this.requireQuestion(questionId);

    assertCanDispute(question);

    await this.deps.questions.setQualityStatus(
      questionId,
      "DISPUTED",
      reason,
      this.deps.clock.now(),
    );
  }

  /** Clears the dispute into the quality state the owner chose. */
  async resolveDispute(
    questionId: QuestionId,
    resolution: QuestionQualityStatus,
  ): Promise<void> {
    const question = await this.requireQuestion(questionId);

    assertCanResolveDispute(question, resolution);

    await this.deps.questions.setQualityStatus(
      questionId,
      resolution,
      null,
      this.deps.clock.now(),
    );
  }

  /**
   * Maps an objective to a question.
   *
   * The objective must belong to the question's certification: a mapping across
   * tracks would put a question in a study map it was never written for. The
   * check and the write share one transaction.
   */
  async linkObjective(
    questionId: QuestionId,
    objectiveId: ObjectiveId,
  ): Promise<void> {
    await this.deps.unitOfWork.transaction(
      async ({ questions, objectives }) => {
        const question = await questions.findById(questionId);

        if (question === null) {
          throw new QuestionNotFoundError(questionId);
        }

        const objective = await objectives.findById(objectiveId);

        if (
          objective === null ||
          objective.certificationId !== question.certificationId
        ) {
          throw new QuestionObjectiveMismatchError(objectiveId);
        }

        const existing = await questions.listObjectiveLinks(questionId);

        await questions.replaceObjectiveLinks(
          questionId,
          [...existing, objectiveId],
          this.deps.clock.now(),
        );
      },
    );
  }

  async unlinkObjective(
    questionId: QuestionId,
    objectiveId: ObjectiveId,
  ): Promise<void> {
    await this.deps.unitOfWork.transaction(async ({ questions }) => {
      const question = await questions.findById(questionId);

      if (question === null) {
        throw new QuestionNotFoundError(questionId);
      }

      const existing = await questions.listObjectiveLinks(questionId);

      await questions.replaceObjectiveLinks(
        questionId,
        existing.filter((id) => id !== objectiveId),
        this.deps.clock.now(),
      );
    });
  }

  /** Deletion eligibility, so a view never offers a delete that would fail. */
  async checkDeletable(questionId: QuestionId): Promise<{
    readonly deletable: boolean;
    readonly blockingDependencies: readonly QuestionDependencyKind[];
  }> {
    await this.requireQuestion(questionId);

    return this.deps.dependencies.checkDeletionEligibility(questionId);
  }

  /**
   * Hard-deletes a question, root and revisions and objective links together.
   *
   * The dependency check runs first and refuses the deletion if anything depends
   * on the question (`SPEC.md` section 6.3.2). Study history is never
   * cascade-deleted to make a question deletable
   * (`spec/DOMAIN-RULES.md` section 1.3): the owner retires it instead.
   */
  async deleteQuestion(questionId: QuestionId): Promise<CertificationId> {
    const question = await this.requireQuestion(questionId);
    const eligibility =
      await this.deps.dependencies.checkDeletionEligibility(questionId);

    if (!eligibility.deletable) {
      throw new QuestionNotDeletableError(
        eligibility.blockingDependencies.map(describeDependencyKind),
      );
    }

    await this.deps.unitOfWork.transaction(async ({ questions }) => {
      await questions.delete(questionId);
    });

    return question.certificationId;
  }

  private async transitionLifecycle(
    questionId: QuestionId,
    to: Question["lifecycleStatus"],
  ): Promise<void> {
    const question = await this.requireQuestion(questionId);

    assertLifecycleTransition(question.lifecycleStatus, to);

    await this.deps.questions.setLifecycleStatus(
      questionId,
      to,
      this.deps.clock.now(),
    );
  }

  private async requireQuestion(questionId: QuestionId): Promise<Question> {
    const question = await this.deps.questions.findById(questionId);

    if (question === null) {
      throw new QuestionNotFoundError(questionId);
    }

    return question;
  }

  /**
   * Loads a question and asserts it belongs to `slug`'s certification.
   *
   * Returns `null` for both an unknown question and a question of another track,
   * so a guessed or stale address is a 404 rather than a leak of another track's
   * content.
   */
  private async findScoped(
    slug: CertificationSlug,
    questionId: QuestionId,
  ): Promise<
    (QuestionWithRevision & { readonly certification: Certification }) | null
  > {
    const certification = await this.deps.certifications.findBySlug(slug);

    if (certification === null) {
      return null;
    }

    const found = await this.deps.questions.findWithCurrentRevision(questionId);

    if (found === null || found.question.certificationId !== certification.id) {
      return null;
    }

    return { ...found, certification };
  }
}

/**
 * Builds the content union from parsed form input.
 *
 * Exhaustive over the input union, so a fourth question type cannot be added
 * without deciding how its content is assembled
 * (`spec/CODING-STANDARDS.md` section 1.4). Choice identifiers come from the row
 * index, so they are stable within a revision and never owner-supplied.
 */
function toContent(input: QuestionInput): QuestionContent {
  switch (input.questionType) {
    case "SINGLE_CHOICE": {
      const choices = toChoices(input.choiceTexts);
      const firstCorrect = input.correctChoiceIndexes[0];

      return {
        type: "SINGLE_CHOICE",
        choices,
        // An unmarked answer becomes an empty id, which the domain rejects with
        // a message on the correct-answer field rather than a type error here.
        correctChoiceId:
          firstCorrect === undefined ? "" : choiceId(firstCorrect),
      };
    }
    case "MULTIPLE_RESPONSE": {
      return {
        type: "MULTIPLE_RESPONSE",
        choices: toChoices(input.choiceTexts),
        correctChoiceIds: input.correctChoiceIndexes.map(choiceId),
      };
    }
    case "SHORT_ANSWER":
      return {
        type: "SHORT_ANSWER",
        expectedConcepts: input.expectedConcepts,
      };
  }
}

/**
 * Turns the submitted choice texts into choices.
 *
 * Blank rows keep their index so a correct-answer marker still refers to the row
 * the owner clicked, then drop out; a marker pointing at a blank row therefore
 * fails the domain's subset check with a message the owner can act on.
 */
function toChoices(choiceTexts: readonly string[]): readonly Choice[] {
  return choiceTexts
    .map((text, index) => ({ id: choiceId(index), text }))
    .filter((choice) => choice.text.length > 0);
}

/** Re-exported for views that need the question type list in filter order. */
export type { QuestionType };
