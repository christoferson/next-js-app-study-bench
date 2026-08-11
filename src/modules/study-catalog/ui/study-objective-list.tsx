import type { StudyObjectiveSummary } from "@/modules/study-catalog/domain/study-track";

interface StudyObjectiveListProps {
  readonly objectives: readonly StudyObjectiveSummary[];
}

/** Read-only list of demo objectives for a track. */
export function StudyObjectiveList({ objectives }: StudyObjectiveListProps) {
  return (
    <ul className="objective-list">
      {objectives.map((objective) => (
        <li key={objective.id} className="objective">
          <p className="objective-reference">{objective.reference}</p>
          <p className="objective-title">{objective.title}</p>
          <p className="objective-focus">{objective.focus}</p>
        </li>
      ))}
    </ul>
  );
}
