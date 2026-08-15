import { DomainError } from "@/shared/domain-error";
import type { GenerationFailureCategory } from "./generation-run";
import { describeFailureCategory } from "./generation-run";

/**
 * Domain errors for the ai-generation module.
 *
 * Expected failures are explicit error types with stable codes, each mapping its
 * message to the form field that caused it (`spec/ARCHITECTURE.md` section 6.5).
 *
 * None of these errors carries a provider message, request identifier, or stack
 * trace. A provider failure is reduced to a category before it reaches this
 * module's error types, so nothing that could contain account or credential
 * detail can be rendered or logged (`spec/SECURITY.md`).
 */

export type GenerationDomainErrorCode =
  | "GENERATION_RUN_NOT_FOUND"
  | "GENERATION_NOT_CONFIGURED"
  | "GENERATION_BATCH_TOO_LARGE"
  | "GENERATED_DRAFT_NOT_REJECTABLE"
  | "IMPORT_ALREADY_APPLIED"
  | "IMPORT_NOTHING_TO_APPLY"
  | "SYLLABUS_UNREADABLE"
  | "PERSONA_NOT_FOUND"
  | "PERSONA_TEMPLATE_NOT_FOUND"
  | "PERSONA_IN_USE"
  | "PERSONA_ARCHETYPE_MISMATCH"
  | "PERSONA_FILE_UNREADABLE";

/**
 * A persona cannot be deleted while a study track is assigned it.
 *
 * The tracks are named, because "unassign it first" is not actionable without knowing
 * where: the owner has to open a track's edit form to change it. Recorded runs are
 * deliberately *not* a reason to refuse — a run stores the persona key and version as
 * text, not a foreign key, so a deleted persona leaves its history readable.
 *
 * The database has the same rule as a foreign key with `ON DELETE RESTRICT` (migration
 * 0010). This check exists so the owner reads a sentence instead of a constraint
 * violation; the constraint exists so no other write path can get around it.
 */
export class PersonaInUseError extends DomainError {
  readonly code = "PERSONA_IN_USE";

  constructor(
    readonly personaId: string,
    readonly trackNames: readonly string[],
  ) {
    super(
      `That persona is assigned to ${describeTrackList(trackNames)}. Change ${
        trackNames.length === 1 ? "that track" : "those tracks"
      } to another persona first.`,
    );
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": [this.message] };
  }
}

/**
 * The chosen persona is for a different kind of study than the track.
 *
 * A refusal rather than a warning, for the reason `stored-persona.ts` states: the
 * archetype decides which machinery applies to a track, so a language persona on a
 * technical track would make generation and enrichment disagree about the subject.
 * Reachable from a stale form — the select offers only compatible personas — or from a
 * track whose study type was changed after a persona was assigned.
 */
export class PersonaArchetypeMismatchError extends DomainError {
  readonly code = "PERSONA_ARCHETYPE_MISMATCH";

  constructor(
    readonly personaId: string,
    readonly detail: string,
  ) {
    super(detail);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { personaId: [this.detail] };
  }
}

/** "the Foo track", "the Foo and Bar tracks", "3 study tracks". */
function describeTrackList(names: readonly string[]): string {
  if (names.length === 0) {
    // Unreachable: the error is only raised when a track was found.
    return "a study track";
  }

  if (names.length === 1) {
    return `the study track "${names[0]}"`;
  }

  if (names.length <= 3) {
    const quoted = names.map((name) => `"${name}"`);

    return `the study tracks ${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
  }

  return `${names.length} study tracks`;
}

/**
 * The persona the owner asked to edit or delete no longer exists.
 *
 * Reachable from a stale settings list in a second tab. A form-level message rather
 * than a 404, because the list the owner came from is still a usable page.
 */
export class PersonaNotFoundError extends DomainError {
  readonly code = "PERSONA_NOT_FOUND";

  constructor(readonly personaId: string) {
    super(`No persona matches "${personaId}".`);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": ["That persona no longer exists."] };
  }
}

/**
 * The template a new persona was to be copied from is not one this build has.
 *
 * The picker renders from the same constant this is matched against, so the only ways
 * here are a hand-edited URL and a page left open across a deployment that removed a
 * template.
 */
export class PersonaTemplateNotFoundError extends DomainError {
  readonly code = "PERSONA_TEMPLATE_NOT_FOUND";

  constructor(readonly templateKey: string) {
    super(`No persona template matches "${templateKey}".`);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return {
      templateKey: ["Choose one of the starting points listed."],
    };
  }
}

/**
 * A persona file could not be read as JSON at all.
 *
 * Distinct from a validation failure, which lands on the field that failed: this is the
 * case where there is no structure to attribute anything to — an empty upload, a PDF
 * renamed to `.json`, a truncated file. The message names which input to fix, because the
 * form offers two.
 *
 * The parser's own message is deliberately not carried through. "Unexpected token < in
 * JSON at position 0" is not something the owner can act on, and the actionable part is
 * always the same: choose a file this application exported.
 */
export class PersonaFileUnreadableError extends DomainError {
  readonly code = "PERSONA_FILE_UNREADABLE";

  constructor(
    readonly field: "personaFile" | "pastedJson",
    message: string,
  ) {
    super(message);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { [this.field]: [this.message] };
  }
}

export class GenerationRunNotFoundError extends DomainError {
  readonly code = "GENERATION_RUN_NOT_FOUND";

  constructor(readonly runId: string) {
    super(`No generation run matches "${runId}".`);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": ["That generation run no longer exists."] };
  }
}

/**
 * The batch limit, enforced in the facade as well as in the schema.
 *
 * Two enforcement points on purpose: the schema stops a hostile form post, and
 * the facade stops a caller that bypassed the schema. Cost control must not
 * depend on one layer being reached (`SPEC.md` section 11.6).
 */
export class GenerationBatchTooLargeError extends DomainError {
  readonly code = "GENERATION_BATCH_TOO_LARGE";

  constructor(
    readonly requested: number,
    readonly maximum: number,
  ) {
    super(`A batch may contain at most ${maximum} items.`);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return {
      itemCount: [
        `Ask for ${this.maximum} items or fewer. Generation is synchronous and each item costs a model call.`,
      ],
    };
  }
}

/**
 * A draft the owner asked to reject can no longer be rejected.
 *
 * Reachable from a stale run page: the draft was activated or already rejected in
 * another tab. Deleting an activated item would remove content the owner has since
 * put into study.
 */
export class GeneratedDraftNotRejectableError extends DomainError {
  readonly code = "GENERATED_DRAFT_NOT_REJECTABLE";

  constructor(readonly reason: string) {
    super(reason);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": [this.reason] };
  }
}

/**
 * The owner asked to apply an objective import that has already been applied.
 *
 * The ordinary way here is a confirm page still open in a second tab, or a browser
 * back-and-resubmit. Applying twice would silently double every objective in the tree,
 * which is why the run row carries `applied_at` and why this is a refusal rather than a
 * no-op: the owner needs to know that their second Apply did nothing *because the first
 * one worked*, not because it failed.
 */
export class ObjectiveImportAlreadyAppliedError extends DomainError {
  readonly code = "IMPORT_ALREADY_APPLIED";

  constructor(readonly runId: string) {
    super("This proposed outline has already been added to the track.");
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return {
      "": [
        "This proposed outline has already been added to the track, so nothing was added again. Open the track to see the objectives it created.",
      ],
    };
  }
}

/**
 * The owner asked to apply a run that proposed nothing.
 *
 * Reachable from a failed extraction's page, or from a run of another kind whose
 * identifier was typed into the apply form.
 */
export class ObjectiveImportNothingToApplyError extends DomainError {
  readonly code = "IMPORT_NOTHING_TO_APPLY";

  constructor(readonly runId: string) {
    super("That run has no proposed outline to add.");
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return {
      "": [
        "That run has no proposed outline to add. Upload the syllabus again to extract one.",
      ],
    };
  }
}

/**
 * The uploaded document produced nothing usable.
 *
 * A form error rather than a failed run, because no model was called: an unreadable
 * file, a scan with no text layer, or an empty paste is a problem with the upload, and
 * recording a run for it would claim a model call that never happened. The message is
 * this application's own — never the PDF library's, which can carry byte offsets and
 * paths (`spec/SECURITY.md`).
 */
export class SyllabusUnreadableError extends DomainError {
  readonly code = "SYLLABUS_UNREADABLE";

  constructor(readonly detail: string) {
    super(detail);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { document: [this.detail] };
  }
}

/**
 * Generation was attempted without usable model configuration.
 *
 * Raised at composition in production, and surfaced on the generate form so the
 * owner sees a configuration problem rather than a failed run.
 */
export class GenerationNotConfiguredError extends DomainError {
  readonly code = "GENERATION_NOT_CONFIGURED";

  constructor(readonly detail: string) {
    super(detail);
  }

  fieldMessages(): Readonly<Record<string, readonly string[]>> {
    return { "": [this.detail] };
  }
}

/**
 * A provider failure reduced to a category.
 *
 * Not a `DomainError`: it never reaches a form. The facade catches it, records
 * the category on the run, and returns the run — a failed run is a recorded
 * outcome the owner can read, not an exception the interface has to render.
 */
export class ProviderFailure extends Error {
  constructor(
    readonly category: GenerationFailureCategory,
    /** Safe, category-derived text. Never the provider's own message. */
    message: string = describeFailureCategory(category),
  ) {
    super(message);
    this.name = "ProviderFailure";
  }
}
