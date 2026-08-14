import type { Objective } from "@/modules/certifications/domain/objective";
import {
  describeObjectiveOption,
  listObjectiveOptions,
} from "@/modules/certifications/domain/objective";
import type { FlashcardFilterInput } from "@/modules/flashcards/application/schemas";
import {
  CARD_TYPES,
  FLASHCARD_LIFECYCLE_STATUSES,
  describeCardTypeChoice,
  describeFlashcardLifecycleStatus,
} from "@/modules/flashcards/domain/flashcard";

interface FlashcardFilterFormProps {
  readonly action: string;
  readonly filters: FlashcardFilterInput;
  readonly objectives: readonly Objective[];
}

/**
 * Bank filters as a plain `GET` form.
 *
 * A `GET` form keeps the filter state in the URL, so a filtered bank is
 * bookmarkable and needs no client JavaScript. Submitting resets to page one
 * because the page field is not carried over.
 */
export function FlashcardFilterForm({
  action,
  filters,
  objectives,
}: FlashcardFilterFormProps) {
  return (
    <form action={action} className="filter-form" method="get">
      <div className="field">
        <label htmlFor="q">Search card text</label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={filters.q ?? ""}
          placeholder="Words on either side of a card"
        />
      </div>

      <div className="filter-row">
        <div className="field">
          <label htmlFor="lifecycle">Status</label>
          <select
            id="lifecycle"
            name="lifecycle"
            defaultValue={filters.lifecycle ?? ""}
          >
            <option value="">Any status</option>
            {FLASHCARD_LIFECYCLE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {describeFlashcardLifecycleStatus(status)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="type">Card type</label>
          <select id="type" name="type" defaultValue={filters.type ?? ""}>
            <option value="">Any type</option>
            {CARD_TYPES.map((cardType) => (
              <option key={cardType} value={cardType}>
                {describeCardTypeChoice(cardType)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="objective">Objective</label>
          <select
            id="objective"
            name="objective"
            defaultValue={filters.objective ?? ""}
          >
            <option value="">Any objective</option>
            {listObjectiveOptions(objectives).map((option) => (
              <option key={option.objective.id} value={option.objective.id}>
                {describeObjectiveOption(option)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" className="button-quiet">
          Apply filters
        </button>
        {/* A link rather than a reset button: reset would restore the applied
            filters, while the owner wants the unfiltered bank. */}
        <a className="button-quiet" href={action}>
          Clear filters
        </a>
      </div>
    </form>
  );
}
