import type { Certification } from "@/modules/certifications/domain/certification";
import {
  describePriority,
  describeStudyType,
} from "@/modules/certifications/domain/certification";

interface CertificationMetaProps {
  readonly certification: Certification;
  /** Detail views show exam code, version, and session length as well. */
  readonly detailed?: boolean;
}

/**
 * Metadata pairs for a study track.
 *
 * Optional values are omitted rather than rendered as a placeholder, so the list
 * never implies information the owner has not supplied.
 */
export function CertificationMeta({
  certification,
  detailed = false,
}: CertificationMetaProps) {
  const items: readonly { readonly term: string; readonly value: string }[] = [
    { term: "Provider", value: certification.provider },
    { term: "Study type", value: describeStudyType(certification.studyType) },
    { term: "Priority", value: describePriority(certification.priority) },
    ...(certification.targetDate !== null
      ? [{ term: "Target date", value: certification.targetDate }]
      : []),
    ...(detailed && certification.examCode !== null
      ? [{ term: "Exam code", value: certification.examCode }]
      : []),
    ...(detailed && certification.version !== null
      ? [{ term: "Version", value: certification.version }]
      : []),
    ...(detailed
      ? [
          {
            term: "Session length",
            value: `${certification.defaultSessionMinutes} minutes`,
          },
        ]
      : []),
  ];

  return (
    <dl className="meta">
      {items.map((item) => (
        <div key={item.term} className="meta-item">
          <dt>{item.term}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
