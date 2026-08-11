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
  {
    id: "0002",
    description: "questions, question_revisions, question_objective_links",
    sql: `
CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  certification_id TEXT NOT NULL
    REFERENCES certifications (id) ON DELETE CASCADE,
  -- Nullable only to break the circular foreign key with question_revisions:
  -- the root row is inserted first, then the revision, then this pointer is
  -- set, all inside one transaction. The domain type is non-nullable and the
  -- repository refuses to map a root whose pointer is still NULL.
  current_revision_id TEXT
    REFERENCES question_revisions (id) ON DELETE RESTRICT,
  lifecycle_status TEXT NOT NULL
    CHECK (lifecycle_status IN ('DRAFT', 'ACTIVE', 'RETIRED', 'ARCHIVED')),
  quality_status TEXT NOT NULL
    CHECK (quality_status IN ('UNREVIEWED', 'AI_REVIEWED', 'SOURCE_CHECKED',
      'USER_APPROVED', 'DISPUTED', 'OUTDATED')),
  generation_mode TEXT NOT NULL
    CHECK (generation_mode IN ('MANUAL', 'MODEL_KNOWLEDGE', 'SOURCE_GROUNDED',
      'HYBRID', 'IMPORTED', 'VARIANT', 'WEB_RESEARCH')),
  -- A reason belongs to a dispute and only to a dispute, so the two columns are
  -- constrained together rather than trusting application code alone.
  dispute_reason TEXT
    CHECK ((quality_status = 'DISPUTED') OR (dispute_reason IS NULL)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX questions_bank_idx
  ON questions (certification_id, lifecycle_status, quality_status);

CREATE TABLE question_revisions (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  stem TEXT NOT NULL,
  instructions TEXT,
  -- The discriminator is stored in its own column as well as inside the JSON
  -- payload, so the bank can filter by question type without parsing JSON.
  question_type TEXT NOT NULL
    CHECK (question_type IN ('SINGLE_CHOICE', 'MULTIPLE_RESPONSE',
      'SHORT_ANSWER')),
  -- Validated JSON: written only after the domain has checked the content, and
  -- re-validated with a zod schema when read back.
  content_payload TEXT NOT NULL,
  explanation TEXT,
  difficulty INTEGER CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND 5),
  -- JSON array of tag strings; empty array when the owner set no tags.
  tags TEXT NOT NULL,
  language TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (question_id, revision_number)
) STRICT;

CREATE INDEX question_revisions_question_idx
  ON question_revisions (question_id, revision_number);

CREATE TABLE question_objective_links (
  question_id TEXT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  objective_id TEXT NOT NULL
    REFERENCES certification_objectives (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (question_id, objective_id)
) STRICT;

CREATE INDEX question_objective_links_objective_idx
  ON question_objective_links (objective_id, question_id);
`,
  },
  {
    id: "0003",
    description:
      "flashcards, flashcard_revisions, flashcard_objective_links, flashcard_reviews, review_schedules",
    sql: `
CREATE TABLE flashcards (
  id TEXT PRIMARY KEY,
  certification_id TEXT NOT NULL
    REFERENCES certifications (id) ON DELETE CASCADE,
  -- Nullable only to break the circular foreign key with flashcard_revisions,
  -- exactly as questions.current_revision_id is: root, then revision, then
  -- pointer, all in one transaction.
  current_revision_id TEXT
    REFERENCES flashcard_revisions (id) ON DELETE RESTRICT,
  lifecycle_status TEXT NOT NULL
    CHECK (lifecycle_status IN ('DRAFT', 'ACTIVE', 'RETIRED', 'ARCHIVED')),
  -- Provenance for a card converted from a question. RESTRICT, not SET NULL:
  -- the card is a dependent of the question, so deleting the question would
  -- silently erase where the card came from. The question-bank dependency
  -- checker reports the same thing before the owner reaches this constraint.
  source_question_id TEXT REFERENCES questions (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX flashcards_bank_idx
  ON flashcards (certification_id, lifecycle_status);

CREATE INDEX flashcards_source_question_idx
  ON flashcards (source_question_id);

CREATE TABLE flashcard_revisions (
  id TEXT PRIMARY KEY,
  flashcard_id TEXT NOT NULL REFERENCES flashcards (id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  -- The discriminator lives in its own column as well as inside the JSON
  -- payload, so the bank can filter by card type without parsing JSON.
  card_type TEXT NOT NULL
    CHECK (card_type IN ('BASIC', 'REVERSED', 'CLOZE', 'VOCABULARY',
      'SCENARIO')),
  -- Validated JSON: written only after the domain has checked the content and
  -- re-validated with a zod schema when read back.
  content_payload TEXT NOT NULL,
  -- The card's text fields flattened by the domain, so the bank can search card
  -- text without matching JSON keys or adding a full-text index.
  search_text TEXT NOT NULL,
  notes TEXT,
  -- JSON array of tag strings; empty array when the owner set no tags.
  tags TEXT NOT NULL,
  language TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (flashcard_id, revision_number)
) STRICT;

CREATE INDEX flashcard_revisions_card_idx
  ON flashcard_revisions (flashcard_id, revision_number);

CREATE TABLE flashcard_objective_links (
  flashcard_id TEXT NOT NULL REFERENCES flashcards (id) ON DELETE CASCADE,
  objective_id TEXT NOT NULL
    REFERENCES certification_objectives (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (flashcard_id, objective_id)
) STRICT;

CREATE INDEX flashcard_objective_links_objective_idx
  ON flashcard_objective_links (objective_id, flashcard_id);

CREATE TABLE flashcard_reviews (
  id TEXT PRIMARY KEY,
  flashcard_id TEXT NOT NULL REFERENCES flashcards (id) ON DELETE CASCADE,
  -- Historical integrity (spec/DOMAIN-RULES.md section 1.4): a review records
  -- the exact revision that was studied, and RESTRICT keeps that revision from
  -- being removed while a review still refers to it.
  flashcard_revision_id TEXT NOT NULL
    REFERENCES flashcard_revisions (id) ON DELETE RESTRICT,
  rating TEXT NOT NULL
    CHECK (rating IN ('AGAIN', 'HARD', 'GOOD', 'EASY')),
  reviewed_at TEXT NOT NULL,
  -- The interval and due date this rating produced, so the history explains the
  -- schedule even after the scheduling algorithm is replaced.
  interval_minutes INTEGER NOT NULL CHECK (interval_minutes > 0),
  due_at TEXT NOT NULL,
  -- Which scheduling strategy produced them.
  scheduler_id TEXT NOT NULL
) STRICT;

CREATE INDEX flashcard_reviews_card_idx
  ON flashcard_reviews (flashcard_id, reviewed_at);

CREATE TABLE review_schedules (
  -- One row per flashcard, so the primary key is the card itself.
  flashcard_id TEXT PRIMARY KEY
    REFERENCES flashcards (id) ON DELETE CASCADE,
  -- Intervals are whole minutes: the shortest interval the specified algorithm
  -- produces is 10 minutes and the longest are whole days, so one integer unit
  -- covers both without floating-point drift.
  interval_minutes INTEGER NOT NULL CHECK (interval_minutes > 0),
  due_at TEXT NOT NULL,
  lapse_count INTEGER NOT NULL CHECK (lapse_count >= 0),
  -- A schedule row exists only after a review, so the count starts at 1. A card
  -- with no row is a new card.
  review_count INTEGER NOT NULL CHECK (review_count >= 1),
  last_reviewed_at TEXT NOT NULL,
  scheduler_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX review_schedules_due_idx ON review_schedules (due_at);
`,
  },
];
