/**
 * Ordered SQLite migrations.
 *
 * Migrations are declared as data rather than loaded from `.sql` files so that
 * the same ordered list is available to the Next.js server bundle, the seed
 * script, and in-memory test databases without filesystem lookups.
 *
 * Rules (`spec/ARCHITECTURE.md` section 7.6): append new migrations, never edit
 * an applied one, keep the list ordered, keep it repeatable on a clean
 * environment.
 */
export interface Migration {
  /** Stable ordered identifier, also the primary key in `schema_migrations`. */
  readonly id: string;
  readonly description: string;
  /** Executed as one statement batch inside a single transaction. */
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: "0001",
    description: "certifications and certification_objectives",
    sql: `
CREATE TABLE certifications (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  exam_code TEXT,
  version TEXT,
  study_type TEXT NOT NULL
    CHECK (study_type IN ('TECHNICAL_CERTIFICATION', 'LANGUAGE_PROFICIENCY', 'GENERAL')),
  description TEXT NOT NULL,
  target_date TEXT,
  priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 5),
  default_session_minutes INTEGER NOT NULL
    CHECK (default_session_minutes BETWEEN 5 AND 240),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  origin TEXT NOT NULL CHECK (origin IN ('OWNER', 'DEMO')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX certifications_status_idx ON certifications (status, name);

CREATE TABLE certification_objectives (
  id TEXT PRIMARY KEY,
  certification_id TEXT NOT NULL
    REFERENCES certifications (id) ON DELETE CASCADE,
  parent_objective_id TEXT
    REFERENCES certification_objectives (id) ON DELETE RESTRICT,
  code TEXT,
  title TEXT NOT NULL,
  description TEXT,
  weight REAL CHECK (weight IS NULL OR (weight >= 0 AND weight <= 100)),
  source_type TEXT NOT NULL
    CHECK (source_type IN ('OFFICIAL', 'OFFICIAL_SYLLABUS', 'USER_DEFINED', 'AI_PROPOSED', 'IMPORTED')),
  display_order INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (parent_objective_id IS NULL OR parent_objective_id <> id)
) STRICT;

CREATE INDEX certification_objectives_tree_idx
  ON certification_objectives (certification_id, parent_objective_id, display_order);
`,
  },
];
