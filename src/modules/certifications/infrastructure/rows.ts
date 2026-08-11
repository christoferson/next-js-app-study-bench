import type {
  Certification,
  ContentOrigin,
  LifecycleStatus,
  StudyType,
} from "@/modules/certifications/domain/certification";
import { STUDY_TYPES } from "@/modules/certifications/domain/certification";
import type {
  Objective,
  ObjectiveSourceType,
} from "@/modules/certifications/domain/objective";
import { OBJECTIVE_SOURCE_TYPES } from "@/modules/certifications/domain/objective";

/**
 * Row mapping for the SQLite certification tables.
 *
 * Rows are validated on the way out rather than cast: the database is an
 * external boundary, and a value that no longer matches a domain union (for
 * example after a hand-edited local database) must fail loudly instead of
 * flowing into the domain as a lie.
 */

export interface CertificationRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly provider: string;
  readonly exam_code: string | null;
  readonly version: string | null;
  readonly study_type: string;
  readonly description: string;
  readonly target_date: string | null;
  readonly priority: number;
  readonly default_session_minutes: number;
  readonly status: string;
  readonly origin: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ObjectiveRow {
  readonly id: string;
  readonly certification_id: string;
  readonly parent_objective_id: string | null;
  readonly code: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly weight: number | null;
  readonly source_type: string;
  readonly display_order: number;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export function toCertification(row: CertificationRow): Certification {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    provider: row.provider,
    examCode: row.exam_code,
    version: row.version,
    studyType: toStudyType(row.study_type),
    description: row.description,
    targetDate: row.target_date,
    priority: row.priority,
    defaultSessionMinutes: row.default_session_minutes,
    status: toLifecycleStatus(row.status),
    origin: toContentOrigin(row.origin),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toObjective(row: ObjectiveRow): Objective {
  return {
    id: row.id,
    certificationId: row.certification_id,
    parentObjectiveId: row.parent_objective_id,
    code: row.code,
    title: row.title,
    description: row.description,
    weight: row.weight,
    sourceType: toObjectiveSourceType(row.source_type),
    displayOrder: row.display_order,
    status: toLifecycleStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStudyType(value: string): StudyType {
  const studyType = STUDY_TYPES.find((candidate) => candidate === value);

  if (studyType === undefined) {
    throw new Error(`Unsupported stored study type: ${value}`);
  }

  return studyType;
}

function toObjectiveSourceType(value: string): ObjectiveSourceType {
  const sourceType = OBJECTIVE_SOURCE_TYPES.find(
    (candidate) => candidate === value,
  );

  if (sourceType === undefined) {
    throw new Error(`Unsupported stored objective source type: ${value}`);
  }

  return sourceType;
}

function toLifecycleStatus(value: string): LifecycleStatus {
  if (value === "ACTIVE" || value === "ARCHIVED") {
    return value;
  }

  throw new Error(`Unsupported stored lifecycle status: ${value}`);
}

function toContentOrigin(value: string): ContentOrigin {
  if (value === "OWNER" || value === "DEMO") {
    return value;
  }

  throw new Error(`Unsupported stored content origin: ${value}`);
}
