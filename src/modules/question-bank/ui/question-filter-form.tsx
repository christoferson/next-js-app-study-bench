import type { Objective } from "@/modules/certifications/domain/objective";
import {
  describeObjectiveOption,
  listObjectiveOptions,
} from "@/modules/certifications/domain/objective";
import type { QuestionFilterInput } from "@/modules/question-bank/application/schemas";
import {
  QUESTION_LIFECYCLE_STATUSES,
  QUESTION_QUALITY_STATUSES,
  QUESTION_TYPES,
  describeLifecycleStatus,
  describeQualityStatus,
  describeQuestionType,
} from "@/modules/question-bank/domain/question";

interface QuestionFilterFormProps {
  readonly action: string;
  readonly filters: QuestionFilterInput;
  readonly objectives: readonly Objective[];
}

/**
 * Bank filters as a plain `GET` form.
 *
 * A `GET` form keeps the filter state in the URL, so a filtered bank is
 * bookmarkable and shareable with a later session, and needs no client
 * JavaScript. Submitting resets to page one because the page field is not
 * carried over.
 */
export function QuestionFilterForm({
  action,
  filters,
  objectives,
}: QuestionFilterFormProps) {
  return (
    <form action={action} className="filter-form" method="get">
      <div className="field">
        <label htmlFor="q">Search question text</label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={filters.q ?? ""}
          placeholder="Words in the question"
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
            {QUESTION_LIFECYCLE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {describeLifecycleStatus(status)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="quality">Review state</label>
          <select
            id="quality"
            name="quality"
            defaultValue={filters.quality ?? ""}
          >
            <option value="">Any review state</option>
            {QUESTION_QUALITY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {describeQualityStatus(status)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="type">Question type</label>
          <select id="type" name="type" defaultValue={filters.type ?? ""}>
            <option value="">Any type</option>
            {QUESTION_TYPES.map((questionType) => (
              <option key={questionType} value={questionType}>
                {describeQuestionType(questionType)}
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
