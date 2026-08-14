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
  {
    id: "0004",
    description:
      "study_sessions, session_certifications, study_session_items, question_attempts",
    sql: `
CREATE TABLE study_sessions (
  id TEXT PRIMARY KEY,
  -- The requested mode, kept for the whole life of the session so history says
  -- what kind of session it was. DIAGNOSTIC is a mode rather than a flag: a
  -- diagnostic differs only in how the composer selects and how the summary
  -- reads, and one enum keeps "is this session diagnostic" a single question.
  mode TEXT NOT NULL
    CHECK (mode IN ('SINGLE_TRACK', 'MIXED_TRACKS', 'QUESTIONS_ONLY',
      'FLASHCARDS_ONLY', 'MISTAKE_REVIEW', 'DIAGNOSTIC')),
  status TEXT NOT NULL
    CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'ABANDONED')),
  -- An estimate, never a deadline (SPEC 6.6: "estimate duration rather than
  -- enforce a hard timer"). It sizes the composed item list and nothing else.
  target_minutes INTEGER NOT NULL CHECK (target_minutes BETWEEN 5 AND 240),
  created_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE INDEX study_sessions_status_idx
  ON study_sessions (status, created_at);

-- Track selection is a join table rather than a JSON column because a mixed
-- session names several tracks and progress reporting groups by track: a join
-- lets the query filter and group in SQL instead of parsing JSON per row.
CREATE TABLE session_certifications (
  session_id TEXT NOT NULL REFERENCES study_sessions (id) ON DELETE CASCADE,
  certification_id TEXT NOT NULL
    REFERENCES certifications (id) ON DELETE RESTRICT,
  PRIMARY KEY (session_id, certification_id)
) STRICT;

CREATE INDEX session_certifications_track_idx
  ON session_certifications (certification_id, session_id);

CREATE TABLE study_session_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES study_sessions (id) ON DELETE CASCADE,
  -- 1-based position in the composed order, so "item 3 of 8" needs no counting.
  position INTEGER NOT NULL CHECK (position >= 1),
  item_type TEXT NOT NULL CHECK (item_type IN ('QUESTION', 'FLASHCARD')),
  -- Frozen references (spec/DOMAIN-RULES.md 2.3): the revision selected when the
  -- session was created, so a later edit cannot change an in-progress session.
  -- RESTRICT on the revisions for the same reason a review record restricts one:
  -- the row would otherwise stop explaining what was studied.
  question_id TEXT REFERENCES questions (id) ON DELETE RESTRICT,
  question_revision_id TEXT
    REFERENCES question_revisions (id) ON DELETE RESTRICT,
  flashcard_id TEXT REFERENCES flashcards (id) ON DELETE RESTRICT,
  flashcard_revision_id TEXT
    REFERENCES flashcard_revisions (id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'SKIPPED')),
  completed_at TEXT,
  -- Exactly one content reference per item, matching its type. Enforced in SQL
  -- as well as in the domain so a half-populated item cannot be committed.
  CHECK (
    (item_type = 'QUESTION'
       AND question_id IS NOT NULL AND question_revision_id IS NOT NULL
       AND flashcard_id IS NULL AND flashcard_revision_id IS NULL)
    OR
    (item_type = 'FLASHCARD'
       AND flashcard_id IS NOT NULL AND flashcard_revision_id IS NOT NULL
       AND question_id IS NULL AND question_revision_id IS NULL)
  ),
  -- No duplicate positions, which is also what makes the composed order stable.
  UNIQUE (session_id, position)
) STRICT;

CREATE INDEX study_session_items_session_idx
  ON study_session_items (session_id, position);

CREATE INDEX study_session_items_question_idx
  ON study_session_items (question_id);

CREATE INDEX study_session_items_flashcard_idx
  ON study_session_items (flashcard_id);

CREATE TABLE question_attempts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES study_sessions (id) ON DELETE CASCADE,
  -- SPEC 10.1: an attempt must reference the question and the exact revision.
  -- RESTRICT on both, so answered content can be retired but never deleted out
  -- from under its own history (spec/DOMAIN-RULES.md 1.3).
  question_id TEXT NOT NULL REFERENCES questions (id) ON DELETE RESTRICT,
  question_revision_id TEXT NOT NULL
    REFERENCES question_revisions (id) ON DELETE RESTRICT,
  -- Validated JSON in the shape the answered question type requires, written
  -- only after the domain has checked it and re-validated with zod on read.
  submitted_answer TEXT NOT NULL,
  -- 0 or 1: STRICT SQLite has no boolean type.
  is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  confidence TEXT NOT NULL
    CHECK (confidence IN ('GUESS', 'UNCERTAIN', 'FAIRLY_SURE', 'CONFIDENT')),
  -- Nullable: measured from the render, so it is absent when the page was
  -- restored from history or the browser sent no timing.
  duration_seconds INTEGER
    CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  attempted_at TEXT NOT NULL,
  evaluation_mode TEXT NOT NULL
    CHECK (evaluation_mode IN ('DETERMINISTIC', 'SELF_ASSESSED')),
  -- The feedback shown at the time. Null in D5: feedback is derived from the
  -- frozen revision, and there is no AI explanation to snapshot until D7.
  feedback_snapshot TEXT
) STRICT;

CREATE INDEX question_attempts_question_idx
  ON question_attempts (question_id, attempted_at);

CREATE INDEX question_attempts_session_idx
  ON question_attempts (session_id, attempted_at);
`,
  },
  {
    id: "0005",
    description:
      "generation_runs plus generation provenance on questions and flashcards",
    sql: `
CREATE TABLE generation_runs (
  id TEXT PRIMARY KEY,
  -- The track the batch was generated for. CASCADE: a run describes how that
  -- track's content was made and means nothing once the track is gone.
  certification_id TEXT NOT NULL
    REFERENCES certifications (id) ON DELETE CASCADE,
  -- What was asked for. Questions and flashcards are generated by separate
  -- requests, so a run produces one kind of item.
  item_kind TEXT NOT NULL CHECK (item_kind IN ('QUESTION', 'FLASHCARD')),
  -- SPEC 10.3 provenance. D6 writes MODEL_KNOWLEDGE only; the CHECK lists the
  -- whole enum so a later mode needs no schema change.
  generation_mode TEXT NOT NULL
    CHECK (generation_mode IN ('MANUAL', 'MODEL_KNOWLEDGE', 'SOURCE_GROUNDED',
      'HYBRID', 'IMPORTED', 'VARIANT', 'WEB_RESEARCH')),
  model_provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  persona_version INTEGER NOT NULL CHECK (persona_version >= 1),
  prompt_template_id TEXT NOT NULL,
  prompt_template_version INTEGER NOT NULL CHECK (prompt_template_version >= 1),
  -- Fingerprint of the request that produced the run, so an equivalent batch can
  -- be recognised before it is generated again (SPEC 11.6 cost controls).
  input_hash TEXT NOT NULL,
  -- JSON array of source snapshot ids. Always '[]' in D6: model-knowledge
  -- generation has no sources, and fabricating one would be a false claim
  -- (spec/AI-GUIDELINES.md section 1.2).
  selected_source_snapshot_ids TEXT NOT NULL,
  requested_item_count INTEGER NOT NULL CHECK (requested_item_count >= 1),
  successful_item_count INTEGER NOT NULL CHECK (successful_item_count >= 0),
  failed_item_count INTEGER NOT NULL CHECK (failed_item_count >= 0),
  -- JSON token counts when the provider reports them, else NULL. Never
  -- credentials: SPEC 10.3 forbids secrets in generation metadata.
  usage_metadata TEXT,
  -- Owner-facing failure summary: a category and a short message, never a stack
  -- trace or provider payload (spec/SECURITY.md logging rules).
  failure_reason TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('PENDING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  -- A finished run has an end time; a pending one does not.
  CHECK ((status = 'PENDING') = (completed_at IS NULL))
) STRICT;

CREATE INDEX generation_runs_track_idx
  ON generation_runs (certification_id, started_at);

CREATE INDEX generation_runs_input_hash_idx
  ON generation_runs (certification_id, input_hash);

-- Provenance on the item is the run id alone. The run row already holds the
-- model, persona, and template, so copying them onto every item would let the
-- two disagree. SET NULL: deleting a run is not part of D6, but if a run ever
-- goes the item must survive as content.
ALTER TABLE questions ADD COLUMN generation_run_id TEXT
  REFERENCES generation_runs (id) ON DELETE SET NULL;

CREATE INDEX questions_generation_run_idx
  ON questions (generation_run_id);

-- Flashcards gain the generation mode they had no need for before D6: every card
-- until now was written by the owner or converted from a question, both MANUAL.
-- The default backfills existing rows truthfully.
ALTER TABLE flashcards ADD COLUMN generation_mode TEXT NOT NULL
  DEFAULT 'MANUAL'
  CHECK (generation_mode IN ('MANUAL', 'MODEL_KNOWLEDGE', 'SOURCE_GROUNDED',
    'HYBRID', 'IMPORTED', 'VARIANT', 'WEB_RESEARCH'));

ALTER TABLE flashcards ADD COLUMN generation_run_id TEXT
  REFERENCES generation_runs (id) ON DELETE SET NULL;

CREATE INDEX flashcards_generation_run_idx
  ON flashcards (generation_run_id);
`,
  },
  {
    id: "0006",
    description:
      "ENRICH_VOCABULARY runs plus generation provenance on flashcard revisions",
    sql: `
-- Enrichment is a third kind of generation request: it rewrites cards the owner
-- already has instead of writing new ones, so it needs its own item kind. The
-- CHECK on generation_runs.item_kind has to be widened to allow it, and SQLite
-- cannot alter a CHECK in place — the table must be rebuilt.
--
-- Rebuilding generation_runs has one hazard worth stating, because it silently
-- destroys data if missed. Both questions.generation_run_id and
-- flashcards.generation_run_id reference this table ON DELETE SET NULL, so
-- DROP TABLE generation_runs nulls every one of them: the whole bank would
-- forget where its generated content came from. PRAGMA foreign_keys = OFF is
-- not a way out, because the pragma is a no-op inside a transaction and the
-- migration runner wraps each migration in one. So the links are copied out
-- first and written back afterwards, which keeps the rebuild inside the one
-- transaction the runner provides.

CREATE TABLE generation_link_backup (
  item_table TEXT NOT NULL,
  item_id TEXT NOT NULL,
  generation_run_id TEXT NOT NULL
) STRICT;

INSERT INTO generation_link_backup (item_table, item_id, generation_run_id)
  SELECT 'questions', id, generation_run_id
    FROM questions WHERE generation_run_id IS NOT NULL;

INSERT INTO generation_link_backup (item_table, item_id, generation_run_id)
  SELECT 'flashcards', id, generation_run_id
    FROM flashcards WHERE generation_run_id IS NOT NULL;

-- Identical to the 0005 definition apart from the item_kind CHECK. Repeated in
-- full rather than patched, because a rebuilt table is defined by the statement
-- that creates it and a reader comparing the two should see the whole thing.
CREATE TABLE generation_runs_widened (
  id TEXT PRIMARY KEY,
  certification_id TEXT NOT NULL
    REFERENCES certifications (id) ON DELETE CASCADE,
  -- ENRICH_VOCABULARY produces no new items: it appends a revision to each
  -- vocabulary card it enriches, which is why the run's items are found through
  -- flashcard_revisions.generation_run_id below rather than through
  -- flashcards.generation_run_id, which stays the record of what created a card.
  item_kind TEXT NOT NULL
    CHECK (item_kind IN ('QUESTION', 'FLASHCARD', 'ENRICH_VOCABULARY')),
  generation_mode TEXT NOT NULL
    CHECK (generation_mode IN ('MANUAL', 'MODEL_KNOWLEDGE', 'SOURCE_GROUNDED',
      'HYBRID', 'IMPORTED', 'VARIANT', 'WEB_RESEARCH')),
  model_provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  persona_version INTEGER NOT NULL CHECK (persona_version >= 1),
  prompt_template_id TEXT NOT NULL,
  prompt_template_version INTEGER NOT NULL CHECK (prompt_template_version >= 1),
  input_hash TEXT NOT NULL,
  selected_source_snapshot_ids TEXT NOT NULL,
  requested_item_count INTEGER NOT NULL CHECK (requested_item_count >= 1),
  successful_item_count INTEGER NOT NULL CHECK (successful_item_count >= 0),
  failed_item_count INTEGER NOT NULL CHECK (failed_item_count >= 0),
  usage_metadata TEXT,
  failure_reason TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('PENDING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  CHECK ((status = 'PENDING') = (completed_at IS NULL))
) STRICT;

INSERT INTO generation_runs_widened
  SELECT id, certification_id, item_kind, generation_mode, model_provider,
         model_id, persona_id, persona_version, prompt_template_id,
         prompt_template_version, input_hash, selected_source_snapshot_ids,
         requested_item_count, successful_item_count, failed_item_count,
         usage_metadata, failure_reason, started_at, completed_at, status
    FROM generation_runs;

DROP TABLE generation_runs;

ALTER TABLE generation_runs_widened RENAME TO generation_runs;

CREATE INDEX generation_runs_track_idx
  ON generation_runs (certification_id, started_at);

CREATE INDEX generation_runs_input_hash_idx
  ON generation_runs (certification_id, input_hash);

-- The links the DROP nulled, restored from the backup.
UPDATE questions
  SET generation_run_id = (
    SELECT b.generation_run_id FROM generation_link_backup b
      WHERE b.item_table = 'questions' AND b.item_id = questions.id)
  WHERE id IN (
    SELECT item_id FROM generation_link_backup WHERE item_table = 'questions');

UPDATE flashcards
  SET generation_run_id = (
    SELECT b.generation_run_id FROM generation_link_backup b
      WHERE b.item_table = 'flashcards' AND b.item_id = flashcards.id)
  WHERE id IN (
    SELECT item_id FROM generation_link_backup WHERE item_table = 'flashcards');

DROP TABLE generation_link_backup;

-- Which run wrote this revision, for revisions a model produced.
--
-- Provenance belongs on the revision because that is what enrichment creates:
-- the card was written by the owner and stays theirs, and one particular
-- revision of it was written by a model. Recording the run on the card instead
-- would overwrite how the card came to exist, and recording the card ids inside
-- the run row is not available — usage_metadata is strictly token counts
-- (SPEC 10.3) and selected_source_snapshot_ids means something else.
--
-- NULL for every revision written before this migration and for every revision
-- the owner writes by hand, which is the truthful backfill. SET NULL for the
-- same reason as the item columns: if a run ever goes, the revision is still
-- the owner's content.
ALTER TABLE flashcard_revisions ADD COLUMN generation_run_id TEXT
  REFERENCES generation_runs (id) ON DELETE SET NULL;

CREATE INDEX flashcard_revisions_generation_run_idx
  ON flashcard_revisions (generation_run_id);
`,
  },
];
