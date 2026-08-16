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
  {
    id: "0007",
    description: "media_assets: cached synthesized audio",
    sql: `
-- Synthesized audio (SPEC 10, "media_assets"; SPEC 12.1 and 12.3).
--
-- The row is metadata and a key; the bytes live on the filesystem locally and in
-- S3 in production (\`spec/ARCHITECTURE.md\` section 7.7). Storing an MP3 in a
-- STRICT text column would make every bank query carry audio, and it would make
-- the S3 move a data migration rather than an adapter swap.
--
-- cache_key is the whole point of the table. It is the SPEC 12.3 digest —
-- sha256 over normalized text, language, voice, engine, speech rate, and the
-- remaining speech configuration — and its UNIQUE constraint is what makes
-- "identical synthesis requests reuse cached audio" a property of the schema
-- rather than of a check someone remembered to write. Two concurrent requests
-- for the same phrase cannot both insert.
--
-- There is deliberately no reference to a flashcard, a revision, or a question.
-- An asset is keyed by what was spoken, not by what happened to ask for it, so
-- the same term on two cards is synthesized once and editing a card neither
-- orphans nor invalidates audio for text that is still correct. The cost is that
-- deleting a card does not delete its audio; that is what the owner-facing
-- delete control is for.
--
-- duration_seconds is nullable because the SynthesizeSpeech response does not
-- report it: Polly returns an audio stream and a request-character count, and
-- getting a duration would mean decoding the MP3 or asking for speech marks in a
-- second billed call. A null here means "not measured", which is honest, and no
-- feature in this milestone needs the number.
CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,
  -- Relative to the storage root, never an absolute path and never anything the
  -- browser sent. The playback route reads it from this column only.
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  duration_seconds REAL
    CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  voice_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  language TEXT NOT NULL,
  -- Stored as the SSML-style rate word or percentage that was requested, so the
  -- row explains its own cache key.
  speech_rate TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

-- Newest first, for the owner's audio list and its size total.
CREATE INDEX media_assets_created_idx ON media_assets (created_at DESC);
`,
  },
  {
    id: "0008",
    description:
      "OBJECTIVE_IMPORT runs with a proposed payload the owner confirms",
    sql: `
-- Importing an objective tree is a fourth kind of generation request: a model reads
-- a syllabus the owner uploaded and proposes a tree, and *nothing is written to the
-- bank until the owner confirms it*. Three consequences shape this migration.
--
-- 1. item_kind must allow 'OBJECTIVE_IMPORT'. SQLite cannot alter a CHECK in place,
--    so the table is rebuilt exactly as 0006 rebuilt it, including the link backup:
--    questions.generation_run_id, flashcards.generation_run_id and
--    flashcard_revisions.generation_run_id all reference this table
--    ON DELETE SET NULL, so a bare DROP TABLE would make the whole bank forget its
--    provenance. PRAGMA foreign_keys = OFF is not available — it is a no-op inside
--    the transaction the migration runner wraps each migration in — so the links are
--    copied out and written back within that one transaction.
--
--    0006 backed up two columns; this one backs up three, because 0006 itself added
--    the third after its own rebuild.
--
-- 2. proposed_payload holds the validated tree between extraction and confirmation.
--    It is on the run row rather than in a session or a hidden form field so the
--    confirm page is an ordinary shareable, refreshable URL, and so a tree the owner
--    never applied leaves the same readable record as one they did. It is TEXT
--    holding JSON, validated by a schema on the way out (never cast), for the reason
--    usage_metadata is: the database is an external boundary. NULL for every run of
--    the other three kinds, which propose nothing.
--
-- 3. applied_at is the idempotence guard. Applying a tree twice would silently
--    double every objective, and a stale confirm page in a second tab is the
--    ordinary way that happens. The column records when the tree was inserted, so a
--    second apply is refused by reading the row rather than by trusting the browser.
--    It is deliberately not a new status value: PENDING/COMPLETED/PARTIAL/FAILED
--    describe whether the *model call* worked, and an extraction that succeeded is
--    COMPLETED whether or not the owner went on to apply it.

CREATE TABLE generation_link_backup_0008 (
  item_table TEXT NOT NULL,
  item_id TEXT NOT NULL,
  generation_run_id TEXT NOT NULL
) STRICT;

INSERT INTO generation_link_backup_0008 (item_table, item_id, generation_run_id)
  SELECT 'questions', id, generation_run_id
    FROM questions WHERE generation_run_id IS NOT NULL;

INSERT INTO generation_link_backup_0008 (item_table, item_id, generation_run_id)
  SELECT 'flashcards', id, generation_run_id
    FROM flashcards WHERE generation_run_id IS NOT NULL;

INSERT INTO generation_link_backup_0008 (item_table, item_id, generation_run_id)
  SELECT 'flashcard_revisions', id, generation_run_id
    FROM flashcard_revisions WHERE generation_run_id IS NOT NULL;

-- Identical to the 0006 definition apart from the widened item_kind CHECK and the
-- two new columns. Repeated in full rather than patched, for the reason 0006 gives:
-- a rebuilt table is defined by the statement that creates it.
CREATE TABLE generation_runs_0008 (
  id TEXT PRIMARY KEY,
  certification_id TEXT NOT NULL
    REFERENCES certifications (id) ON DELETE CASCADE,
  -- OBJECTIVE_IMPORT, like ENRICH_VOCABULARY, creates no bank items. Unlike it, it
  -- creates nothing at all until the owner applies the run: the model's answer lives
  -- in proposed_payload and the objectives are inserted by a later, separate action.
  item_kind TEXT NOT NULL
    CHECK (item_kind IN ('QUESTION', 'FLASHCARD', 'ENRICH_VOCABULARY',
      'OBJECTIVE_IMPORT')),
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
  -- The validated tree an OBJECTIVE_IMPORT run proposed, as JSON. NULL for every
  -- other kind, and NULL for an import run that failed before producing one.
  proposed_payload TEXT,
  -- When the proposed tree was inserted into the objective hierarchy. NULL means
  -- "not applied", which is what makes a second apply refusable.
  applied_at TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('PENDING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  CHECK ((status = 'PENDING') = (completed_at IS NULL)),
  -- Nothing can be applied that was never proposed.
  CHECK (applied_at IS NULL OR proposed_payload IS NOT NULL)
) STRICT;

INSERT INTO generation_runs_0008 (id, certification_id, item_kind,
    generation_mode, model_provider, model_id, persona_id, persona_version,
    prompt_template_id, prompt_template_version, input_hash,
    selected_source_snapshot_ids, requested_item_count, successful_item_count,
    failed_item_count, usage_metadata, failure_reason, proposed_payload,
    applied_at, started_at, completed_at, status)
  SELECT id, certification_id, item_kind, generation_mode, model_provider,
         model_id, persona_id, persona_version, prompt_template_id,
         prompt_template_version, input_hash, selected_source_snapshot_ids,
         requested_item_count, successful_item_count, failed_item_count,
         usage_metadata, failure_reason, NULL, NULL, started_at, completed_at,
         status
    FROM generation_runs;

DROP TABLE generation_runs;

ALTER TABLE generation_runs_0008 RENAME TO generation_runs;

CREATE INDEX generation_runs_track_idx
  ON generation_runs (certification_id, started_at);

CREATE INDEX generation_runs_input_hash_idx
  ON generation_runs (certification_id, input_hash);

-- The links the DROP nulled, restored from the backup.
UPDATE questions
  SET generation_run_id = (
    SELECT b.generation_run_id FROM generation_link_backup_0008 b
      WHERE b.item_table = 'questions' AND b.item_id = questions.id)
  WHERE id IN (
    SELECT item_id FROM generation_link_backup_0008
      WHERE item_table = 'questions');

UPDATE flashcards
  SET generation_run_id = (
    SELECT b.generation_run_id FROM generation_link_backup_0008 b
      WHERE b.item_table = 'flashcards' AND b.item_id = flashcards.id)
  WHERE id IN (
    SELECT item_id FROM generation_link_backup_0008
      WHERE item_table = 'flashcards');

UPDATE flashcard_revisions
  SET generation_run_id = (
    SELECT b.generation_run_id FROM generation_link_backup_0008 b
      WHERE b.item_table = 'flashcard_revisions'
        AND b.item_id = flashcard_revisions.id)
  WHERE id IN (
    SELECT item_id FROM generation_link_backup_0008
      WHERE item_table = 'flashcard_revisions');

-- No index is recreated for flashcard_revisions: dropping generation_runs drops
-- only the indexes on generation_runs itself, so the one 0006 created is untouched.
DROP TABLE generation_link_backup_0008;
`,
  },
  {
    id: "0009",
    description: "owner-editable personas created from curated templates",
    sql: `
-- Editable personas.
--
-- Until now a persona was code: two constants in
-- \`modules/ai-generation/domain/personas.ts\`, selected by study type. That is right
-- for a registry the owner cannot change, and wrong as soon as they want a persona
-- per track — "AWS Professional" wants deeper tradeoff questions than "AWS
-- Associate", and neither is expressible by editing a shared constant without
-- changing the other track's output.
--
-- So a persona becomes data the owner owns, created by copying a curated template
-- and then edited freely. Three consequences shape this table.
--
-- 1. persona_key is a stable identifier separate from the primary key. A run records
--    which persona produced it (\`generation_runs.persona_id\`), and that recorded
--    value must stay readable after a rename: the key is derived once from the label
--    at creation and never changes, so a run generated in August can still be
--    explained in December. UNIQUE, because a duplicate key would make that
--    provenance ambiguous. Nothing references it yet — the runtime still uses the
--    code personas — which is exactly why it is cheap to get right now.
--
-- 2. version is on the row, not in a history table. Editing bumps it, so a run's
--    recorded (key, version) pair names the text that produced it, and the owner can
--    see that a persona has moved on since. Keeping every past text would be a
--    second table nothing in this slice reads; the version alone is what makes a
--    stale recording legible.
--
-- 3. archetype is a fixed code, not free text and not derived from the label. It is
--    what a later slice wires behaviour to — a LANGUAGE persona reaches the
--    vocabulary-enrichment machinery, a TECHNICAL one does not — and behaviour must
--    never be chosen by searching a label for "HSK"
--    (\`spec/CODING-STANDARDS.md\`). CHECK-constrained, so the two values are a
--    property of the schema.
--
-- The four list columns hold JSON arrays. SQLite has no array type, and a child
-- table per list would be four tables to read an ordered set of bullet points the
-- owner edits as one textarea. Each is validated by a schema on the way out, never
-- cast, for the reason \`generation_runs.usage_metadata\` is: the database is an
-- external boundary.
--
-- No rows are seeded. The two built-in personas stay in code and stay in use; this
-- table starts empty and the templates appear in the picker instead. Seeding copies
-- of the built-ins would create two sources of truth for the persona the runtime
-- actually applies, and nothing selects a stored persona until the next slice.
CREATE TABLE personas (
  id TEXT PRIMARY KEY,
  -- Derived from the label at creation, then immutable. See note 1.
  persona_key TEXT NOT NULL UNIQUE,
  archetype TEXT NOT NULL CHECK (archetype IN ('TECHNICAL', 'LANGUAGE')),
  version INTEGER NOT NULL CHECK (version >= 1),
  label TEXT NOT NULL,
  role TEXT NOT NULL,
  -- JSON arrays of strings, in the order the owner wrote them.
  guidance TEXT NOT NULL,
  card_guidance TEXT NOT NULL,
  prohibitions TEXT NOT NULL,
  default_question_types TEXT NOT NULL,
  default_card_types TEXT NOT NULL,
  language_instruction TEXT NOT NULL,
  -- Null means "no single content language", which a technical persona often is.
  content_language TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- The management list, ordered by label.
CREATE INDEX personas_label_idx ON personas (label);
`,
  },
  {
    id: "0010",
    description: "track-level persona assignment",
    sql: `
-- \`certifications.persona_id\` — the field \`SPEC.md\` section 6.1 has always listed and
-- that every milestone until now deliberately left out, because there was nothing to
-- point it at. 0009 gave the owner personas; this column is what makes them usable.
--
-- Three decisions.
--
-- 1. Nullable, and NULL is the ordinary state. NULL means "decide by study type", which
--    is exactly what the runtime did before this column existed, so every existing track
--    keeps behaving as it does today and no backfill invents an assignment the owner
--    never made.
--
-- 2. A real foreign key, ON DELETE RESTRICT. The alternative — an opaque text column
--    with no constraint — was considered and rejected: an assigned persona that has been
--    deleted would leave a track pointing at nothing, and every reader would have to
--    decide what to do about it. RESTRICT makes "a persona a track uses cannot be
--    deleted" a property of the schema. \`PersonaFacade.deletePersona\` refuses first,
--    with a message that says which tracks to change, so the owner meets an explanation
--    rather than a constraint error; the constraint is the floor under that check, not
--    the owner-facing mechanism.
--
--    A foreign key between two tables that different modules own is deliberate. Modules
--    own code, not tables (\`spec/ARCHITECTURE.md\` section 7): the certifications module
--    never learns what a persona is — it stores and returns an opaque identifier — and
--    the ai-generation module, which may depend on certifications, is the only side that
--    resolves that identifier into a persona.
--
-- 3. Runs are not touched, and that is the point of \`persona_key\`.
--    \`generation_runs.persona_id\` and \`persona_version\` are plain TEXT and INTEGER
--    with no reference to this table (see 0005), so deleting a persona can never orphan
--    or rewrite a recorded run: the run keeps the key and version strings that name the
--    text which produced it. Provenance survives deletion; assignment does not.
ALTER TABLE certifications ADD COLUMN persona_id TEXT
  REFERENCES personas (id) ON DELETE RESTRICT;

-- Answers one question: does any track use this persona? Asked before every deletion.
CREATE INDEX certifications_persona_idx ON certifications (persona_id);
`,
  },
  {
    id: "0011",
    description: "QUESTION_REVIEW runs that judge one question revision",
    sql: `
-- Reviewing a question is a fifth kind of generation request, and the one that writes
-- nothing at all. A model is shown one revision, exactly as it stands, and answers with
-- a verdict and a list of findings. It does not rewrite the question, it does not append
-- a revision, and it does not change the lifecycle
-- (\`spec/AI-GUIDELINES.md\` section 1.10). What lands in the database is the *finding*,
-- and the owner decides what to do about it.
--
-- Three consequences shape this migration.
--
-- 1. item_kind must allow 'QUESTION_REVIEW'. SQLite cannot alter a CHECK in place, so
--    the table is rebuilt exactly as 0006 and 0008 rebuilt it, link backup included:
--    questions.generation_run_id, flashcards.generation_run_id and
--    flashcard_revisions.generation_run_id all reference this table
--    ON DELETE SET NULL, so a bare DROP TABLE would make the whole bank forget its
--    provenance. PRAGMA foreign_keys = OFF is a no-op inside the transaction the
--    migration runner wraps each migration in, so the links are copied out and written
--    back within that one transaction.
--
-- 2. The findings live in proposed_payload, which 0008 added and this migration reuses
--    unchanged. That column already means "validated JSON this run produced that is not
--    itself bank content", which is precisely what a finding list is, and it is read
--    back through an application schema rather than cast
--    (\`application/question-review-schema.ts\`). A second JSON column would have meant
--    two columns with one meaning.
--
--    applied_at stays NULL for a review run, and there is no CHECK forcing otherwise:
--    'applied' means "the proposal was written into the bank", and a review proposes
--    nothing to write. The recommendation a review carries is acted on — or not — through
--    the question's own dispute and approval actions, which are recorded on the question,
--    not here.
--
-- 3. Two new nullable columns name what was reviewed: subject_question_id and
--    subject_revision_id. They are on the run row because a review is *about* one
--    revision and that fact is the run's own identity — without it a stored finding list
--    is a paragraph about nothing, and re-reviewing after an edit would be
--    indistinguishable from reviewing the same text twice.
--
--    Both are ON DELETE SET NULL, deliberately, and the direction matters: a run is
--    historical and must survive the deletion of what it looked at, while a question
--    must stay deletable when nothing in the *bank* depends on it. RESTRICT here would
--    have made an AI review a hidden reason a draft could no longer be deleted, which
--    is a worse outcome than a run row that says "the question this reviewed is gone".
--    (Hard question deletion is refused for real dependents by
--    QuestionDependencyChecker; a review run is deliberately not one of them.)
--
--    Purging a whole track deletes its questions first and then
--    \`DELETE FROM generation_runs WHERE certification_id = :id\`
--    (\`SqliteCertificationRepository.purge\`), so the SET NULL fires on rows that are
--    about to be deleted anyway and the two orders agree. Nothing else deletes a run.

CREATE TABLE generation_link_backup_0011 (
  item_table TEXT NOT NULL,
  item_id TEXT NOT NULL,
  generation_run_id TEXT NOT NULL
) STRICT;

INSERT INTO generation_link_backup_0011 (item_table, item_id, generation_run_id)
  SELECT 'questions', id, generation_run_id
    FROM questions WHERE generation_run_id IS NOT NULL;

INSERT INTO generation_link_backup_0011 (item_table, item_id, generation_run_id)
  SELECT 'flashcards', id, generation_run_id
    FROM flashcards WHERE generation_run_id IS NOT NULL;

INSERT INTO generation_link_backup_0011 (item_table, item_id, generation_run_id)
  SELECT 'flashcard_revisions', id, generation_run_id
    FROM flashcard_revisions WHERE generation_run_id IS NOT NULL;

-- Identical to the 0008 definition apart from the widened item_kind CHECK and the two
-- subject columns. Repeated in full rather than patched, for the reason 0006 gives: a
-- rebuilt table is defined by the statement that creates it.
CREATE TABLE generation_runs_0011 (
  id TEXT PRIMARY KEY,
  certification_id TEXT NOT NULL
    REFERENCES certifications (id) ON DELETE CASCADE,
  -- QUESTION_REVIEW writes no bank item and proposes nothing to apply. It produces a
  -- judgement about an item that already exists.
  item_kind TEXT NOT NULL
    CHECK (item_kind IN ('QUESTION', 'FLASHCARD', 'ENRICH_VOCABULARY',
      'OBJECTIVE_IMPORT', 'QUESTION_REVIEW')),
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
  -- The validated tree an OBJECTIVE_IMPORT run proposed, or the validated findings a
  -- QUESTION_REVIEW run produced, as JSON. NULL for the kinds that produce neither, and
  -- NULL for a run that failed before producing one.
  proposed_payload TEXT,
  applied_at TEXT,
  -- The question a QUESTION_REVIEW run judged, and the revision it was shown. NULL for
  -- every other kind, and NULL once the question has been deleted.
  subject_question_id TEXT
    REFERENCES questions (id) ON DELETE SET NULL,
  subject_revision_id TEXT
    REFERENCES question_revisions (id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('PENDING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  CHECK ((status = 'PENDING') = (completed_at IS NULL)),
  -- Nothing can be applied that was never proposed.
  CHECK (applied_at IS NULL OR proposed_payload IS NOT NULL),
  -- A revision is only ever named together with the question it belongs to.
  CHECK (subject_revision_id IS NULL OR subject_question_id IS NOT NULL)
) STRICT;

INSERT INTO generation_runs_0011 (id, certification_id, item_kind,
    generation_mode, model_provider, model_id, persona_id, persona_version,
    prompt_template_id, prompt_template_version, input_hash,
    selected_source_snapshot_ids, requested_item_count, successful_item_count,
    failed_item_count, usage_metadata, failure_reason, proposed_payload,
    applied_at, subject_question_id, subject_revision_id, started_at,
    completed_at, status)
  SELECT id, certification_id, item_kind, generation_mode, model_provider,
         model_id, persona_id, persona_version, prompt_template_id,
         prompt_template_version, input_hash, selected_source_snapshot_ids,
         requested_item_count, successful_item_count, failed_item_count,
         usage_metadata, failure_reason, proposed_payload, applied_at, NULL,
         NULL, started_at, completed_at, status
    FROM generation_runs;

DROP TABLE generation_runs;

ALTER TABLE generation_runs_0011 RENAME TO generation_runs;

CREATE INDEX generation_runs_track_idx
  ON generation_runs (certification_id, started_at);

CREATE INDEX generation_runs_input_hash_idx
  ON generation_runs (certification_id, input_hash);

-- Answers the one question the question page asks: what has AI said about this
-- question, most recent first?
CREATE INDEX generation_runs_subject_idx
  ON generation_runs (subject_question_id, started_at);

-- The links the DROP nulled, restored from the backup.
UPDATE questions
  SET generation_run_id = (
    SELECT b.generation_run_id FROM generation_link_backup_0011 b
      WHERE b.item_table = 'questions' AND b.item_id = questions.id)
  WHERE id IN (
    SELECT item_id FROM generation_link_backup_0011
      WHERE item_table = 'questions');

UPDATE flashcards
  SET generation_run_id = (
    SELECT b.generation_run_id FROM generation_link_backup_0011 b
      WHERE b.item_table = 'flashcards' AND b.item_id = flashcards.id)
  WHERE id IN (
    SELECT item_id FROM generation_link_backup_0011
      WHERE item_table = 'flashcards');

UPDATE flashcard_revisions
  SET generation_run_id = (
    SELECT b.generation_run_id FROM generation_link_backup_0011 b
      WHERE b.item_table = 'flashcard_revisions'
        AND b.item_id = flashcard_revisions.id)
  WHERE id IN (
    SELECT item_id FROM generation_link_backup_0011
      WHERE item_table = 'flashcard_revisions');

DROP TABLE generation_link_backup_0011;
`,
  },
  {
    id: "0012",
    description:
      "TUTOR_EXPLANATION runs that answer one ask about one revision",
    sql: `
-- Asking the tutor is a sixth kind of generation request, and the second that writes
-- nothing into the bank. A model is shown one revision, exactly as it stands, together
-- with one ask — explain the answer, explain why choice c is wrong, explain it more
-- simply, give an example, ask me a follow-up question — and answers in prose. It does
-- not rewrite the question, it does not append a revision, it does not change the
-- lifecycle, and unlike a review it does not even change the quality state: explaining
-- something is not a judgement about it (\`spec/AI-GUIDELINES.md\` section 1.10).
--
-- This migration is 0011 again with one value added, and deliberately so.
--
-- 1. item_kind must allow 'TUTOR_EXPLANATION'. SQLite cannot alter a CHECK in place, so
--    the table is rebuilt exactly as 0006, 0008 and 0011 rebuilt it, link backup
--    included: questions.generation_run_id, flashcards.generation_run_id and
--    flashcard_revisions.generation_run_id all reference this table
--    ON DELETE SET NULL, so a bare DROP TABLE would make the whole bank forget its
--    provenance. PRAGMA foreign_keys = OFF is a no-op inside the transaction the
--    migration runner wraps each migration in, so the links are copied out and written
--    back within that one transaction.
--
-- 2. Nothing else changes. The answer lives in proposed_payload as validated JSON, read
--    back through an application schema (\`application/tutor-schema.ts\`) rather than
--    cast, and the two columns 0011 added — subject_question_id and subject_revision_id —
--    already say exactly what a tutor exchange needs to record: which question was being
--    studied, and which revision the tutor was actually shown. That second column is the
--    acceptance criterion made durable (\`SPEC.md\` section 25.3, "the tutor receives the
--    exact revision being discussed"): an exchange whose revision has since been edited
--    is visibly about wording the owner no longer has.
--
--    applied_at stays NULL for a tutor run, for the reason it stays NULL for a review:
--    'applied' means "the proposal was written into the bank", and an explanation
--    proposes nothing. That includes the follow-up question, which is tutoring content to
--    read rather than a draft to accept — putting a question into the bank goes through
--    the generation pipeline, which already exists.
--
-- 3. No new index. The findings panel and the tutor panel both ask the same question of
--    the same column — what has AI said about this question, most recent first — and
--    generation_runs_subject_idx on (subject_question_id, started_at) already answers it.
--    The two are separated by item_kind, which is a filter on a handful of rows per
--    question rather than a scan.

CREATE TABLE generation_link_backup_0012 (
  item_table TEXT NOT NULL,
  item_id TEXT NOT NULL,
  generation_run_id TEXT NOT NULL
) STRICT;

INSERT INTO generation_link_backup_0012 (item_table, item_id, generation_run_id)
  SELECT 'questions', id, generation_run_id
    FROM questions WHERE generation_run_id IS NOT NULL;

INSERT INTO generation_link_backup_0012 (item_table, item_id, generation_run_id)
  SELECT 'flashcards', id, generation_run_id
    FROM flashcards WHERE generation_run_id IS NOT NULL;

INSERT INTO generation_link_backup_0012 (item_table, item_id, generation_run_id)
  SELECT 'flashcard_revisions', id, generation_run_id
    FROM flashcard_revisions WHERE generation_run_id IS NOT NULL;

-- Identical to the 0011 definition apart from the widened item_kind CHECK. Repeated in
-- full rather than patched, for the reason 0006 gives: a rebuilt table is defined by the
-- statement that creates it.
CREATE TABLE generation_runs_0012 (
  id TEXT PRIMARY KEY,
  certification_id TEXT NOT NULL
    REFERENCES certifications (id) ON DELETE CASCADE,
  -- TUTOR_EXPLANATION writes no bank item and proposes nothing to apply. It produces one
  -- answer to one ask about an item that already exists.
  item_kind TEXT NOT NULL
    CHECK (item_kind IN ('QUESTION', 'FLASHCARD', 'ENRICH_VOCABULARY',
      'OBJECTIVE_IMPORT', 'QUESTION_REVIEW', 'TUTOR_EXPLANATION')),
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
  -- The validated tree an OBJECTIVE_IMPORT run proposed, the validated findings a
  -- QUESTION_REVIEW run produced, or the validated answer a TUTOR_EXPLANATION run gave,
  -- as JSON. NULL for the kinds that produce none of those, and NULL for a run that
  -- failed before producing one.
  proposed_payload TEXT,
  applied_at TEXT,
  -- The question a QUESTION_REVIEW or TUTOR_EXPLANATION run was about, and the revision
  -- it was shown. NULL for every other kind, and NULL once the question has been deleted.
  subject_question_id TEXT
    REFERENCES questions (id) ON DELETE SET NULL,
  subject_revision_id TEXT
    REFERENCES question_revisions (id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('PENDING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  CHECK ((status = 'PENDING') = (completed_at IS NULL)),
  -- Nothing can be applied that was never proposed.
  CHECK (applied_at IS NULL OR proposed_payload IS NOT NULL),
  -- A revision is only ever named together with the question it belongs to.
  CHECK (subject_revision_id IS NULL OR subject_question_id IS NOT NULL)
) STRICT;

INSERT INTO generation_runs_0012 (id, certification_id, item_kind,
    generation_mode, model_provider, model_id, persona_id, persona_version,
    prompt_template_id, prompt_template_version, input_hash,
    selected_source_snapshot_ids, requested_item_count, successful_item_count,
    failed_item_count, usage_metadata, failure_reason, proposed_payload,
    applied_at, subject_question_id, subject_revision_id, started_at,
    completed_at, status)
  SELECT id, certification_id, item_kind, generation_mode, model_provider,
         model_id, persona_id, persona_version, prompt_template_id,
         prompt_template_version, input_hash, selected_source_snapshot_ids,
         requested_item_count, successful_item_count, failed_item_count,
         usage_metadata, failure_reason, proposed_payload, applied_at,
         subject_question_id, subject_revision_id, started_at,
         completed_at, status
    FROM generation_runs;

DROP TABLE generation_runs;

ALTER TABLE generation_runs_0012 RENAME TO generation_runs;

CREATE INDEX generation_runs_track_idx
  ON generation_runs (certification_id, started_at);

CREATE INDEX generation_runs_input_hash_idx
  ON generation_runs (certification_id, input_hash);

-- Answers the one question both the findings panel and the tutor panel ask: what has AI
-- said about this question, most recent first?
CREATE INDEX generation_runs_subject_idx
  ON generation_runs (subject_question_id, started_at);

-- The links the DROP nulled, restored from the backup.
UPDATE questions
  SET generation_run_id = (
    SELECT b.generation_run_id FROM generation_link_backup_0012 b
      WHERE b.item_table = 'questions' AND b.item_id = questions.id)
  WHERE id IN (
    SELECT item_id FROM generation_link_backup_0012
      WHERE item_table = 'questions');

UPDATE flashcards
  SET generation_run_id = (
    SELECT b.generation_run_id FROM generation_link_backup_0012 b
      WHERE b.item_table = 'flashcards' AND b.item_id = flashcards.id)
  WHERE id IN (
    SELECT item_id FROM generation_link_backup_0012
      WHERE item_table = 'flashcards');

UPDATE flashcard_revisions
  SET generation_run_id = (
    SELECT b.generation_run_id FROM generation_link_backup_0012 b
      WHERE b.item_table = 'flashcard_revisions'
        AND b.item_id = flashcard_revisions.id)
  WHERE id IN (
    SELECT item_id FROM generation_link_backup_0012
      WHERE item_table = 'flashcard_revisions');

DROP TABLE generation_link_backup_0012;
`,
  },
  {
    id: "0013",
    description:
      "ANSWER_EVALUATION and QUESTION_CHALLENGE runs that judge without writing",
    sql: `
-- Two more kinds of generation request, and both of them write nothing.
--
-- ANSWER_EVALUATION grades one written answer. A model is shown a short-answer question,
-- the concepts a correct answer has to mention, and the answer the owner actually typed in
-- a session, and it says which concepts the answer covered. It is deliberately *advisory*:
-- the attempt keeps the owner's own SELF_ASSESSED verdict, and this run records what the
-- model thought of it. That is why this migration does not touch question_attempts at all
-- — there is no AI_EVALUATED evaluation mode to add, because the AI does not evaluate the
-- attempt, it advises the person who does (\`domain/answer-evaluation.ts\`).
--
-- QUESTION_CHALLENGE adjudicates one objection. The owner has read a question, disagrees
-- with the answer it marks correct, and says why; a model argues both readings and comes
-- down on one side, with a recommendation the owner may act on. It is separate from
-- QUESTION_REVIEW because the question it answers is different — "is this person right?"
-- rather than "is this question sound?" — and reading them back as the same kind would
-- lose which of the two a run actually was.
--
-- Neither kind may rewrite the question, and the schema is what stops them: a challenge's
-- payload can carry a *note* about what a revision would change and has nowhere to put the
-- revision itself, so upholding a challenge produces a prefilled dispute button or a note
-- beside the edit form the owner already has (\`spec/AI-GUIDELINES.md\` section 1.10, "no
-- hidden question rewrites"; \`SPEC.md\` section 25.2 items 11 and 12).
--
-- This migration is 0012 again with two values added.
--
-- 1. item_kind must allow 'ANSWER_EVALUATION' and 'QUESTION_CHALLENGE'. SQLite cannot
--    alter a CHECK in place, so the table is rebuilt exactly as 0006, 0008, 0011 and 0012
--    rebuilt it, link backup included: questions.generation_run_id,
--    flashcards.generation_run_id and flashcard_revisions.generation_run_id all reference
--    this table ON DELETE SET NULL, so a bare DROP TABLE would make the whole bank forget
--    its provenance. PRAGMA foreign_keys = OFF is a no-op inside the transaction the
--    migration runner wraps each migration in, so the links are copied out and written
--    back within that one transaction.
--
-- 2. Nothing else changes. Both payloads live in proposed_payload as validated JSON, read
--    back through an application schema rather than cast. subject_question_id and
--    subject_revision_id already say what both kinds need to record: which question was
--    involved, and the exact wording the model was shown. For a grading that second column
--    is what makes a stale grading visible — the concepts it was judged against are the
--    ones in *that* revision, and an edit afterwards makes the grading historical rather
--    than wrong. applied_at stays NULL for both, because neither proposes anything to
--    write into the bank.
--
-- 3. No new index. Both panels ask the question generation_runs_subject_idx on
--    (subject_question_id, started_at) already answers, separated by item_kind, which is a
--    filter on a handful of rows per question rather than a scan.

CREATE TABLE generation_link_backup_0013 (
  item_table TEXT NOT NULL,
  item_id TEXT NOT NULL,
  generation_run_id TEXT NOT NULL
) STRICT;

INSERT INTO generation_link_backup_0013 (item_table, item_id, generation_run_id)
  SELECT 'questions', id, generation_run_id
    FROM questions WHERE generation_run_id IS NOT NULL;

INSERT INTO generation_link_backup_0013 (item_table, item_id, generation_run_id)
  SELECT 'flashcards', id, generation_run_id
    FROM flashcards WHERE generation_run_id IS NOT NULL;

INSERT INTO generation_link_backup_0013 (item_table, item_id, generation_run_id)
  SELECT 'flashcard_revisions', id, generation_run_id
    FROM flashcard_revisions WHERE generation_run_id IS NOT NULL;

-- Identical to the 0012 definition apart from the widened item_kind CHECK. Repeated in
-- full rather than patched, for the reason 0006 gives: a rebuilt table is defined by the
-- statement that creates it.
CREATE TABLE generation_runs_0013 (
  id TEXT PRIMARY KEY,
  certification_id TEXT NOT NULL
    REFERENCES certifications (id) ON DELETE CASCADE,
  -- ANSWER_EVALUATION and QUESTION_CHALLENGE both write no bank item and propose nothing
  -- to apply. One judges text the owner wrote; the other judges an objection the owner
  -- raised about an item that already exists.
  item_kind TEXT NOT NULL
    CHECK (item_kind IN ('QUESTION', 'FLASHCARD', 'ENRICH_VOCABULARY',
      'OBJECTIVE_IMPORT', 'QUESTION_REVIEW', 'TUTOR_EXPLANATION',
      'ANSWER_EVALUATION', 'QUESTION_CHALLENGE')),
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
  -- Whatever the run's kind produces for the owner to read, as validated JSON: an
  -- OBJECTIVE_IMPORT tree, QUESTION_REVIEW findings, a TUTOR_EXPLANATION answer, an
  -- ANSWER_EVALUATION grading, or a QUESTION_CHALLENGE outcome. NULL for the kinds that
  -- produce none of those, and NULL for a run that failed before producing one.
  proposed_payload TEXT,
  applied_at TEXT,
  -- The question a QUESTION_REVIEW, TUTOR_EXPLANATION, ANSWER_EVALUATION or
  -- QUESTION_CHALLENGE run was about, and the revision it was shown. NULL for every other
  -- kind, and NULL once the question has been deleted.
  subject_question_id TEXT
    REFERENCES questions (id) ON DELETE SET NULL,
  subject_revision_id TEXT
    REFERENCES question_revisions (id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('PENDING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  CHECK ((status = 'PENDING') = (completed_at IS NULL)),
  -- Nothing can be applied that was never proposed.
  CHECK (applied_at IS NULL OR proposed_payload IS NOT NULL),
  -- A revision is only ever named together with the question it belongs to.
  CHECK (subject_revision_id IS NULL OR subject_question_id IS NOT NULL)
) STRICT;

INSERT INTO generation_runs_0013 (id, certification_id, item_kind,
    generation_mode, model_provider, model_id, persona_id, persona_version,
    prompt_template_id, prompt_template_version, input_hash,
    selected_source_snapshot_ids, requested_item_count, successful_item_count,
    failed_item_count, usage_metadata, failure_reason, proposed_payload,
    applied_at, subject_question_id, subject_revision_id, started_at,
    completed_at, status)
  SELECT id, certification_id, item_kind, generation_mode, model_provider,
         model_id, persona_id, persona_version, prompt_template_id,
         prompt_template_version, input_hash, selected_source_snapshot_ids,
         requested_item_count, successful_item_count, failed_item_count,
         usage_metadata, failure_reason, proposed_payload, applied_at,
         subject_question_id, subject_revision_id, started_at,
         completed_at, status
    FROM generation_runs;

DROP TABLE generation_runs;

ALTER TABLE generation_runs_0013 RENAME TO generation_runs;

CREATE INDEX generation_runs_track_idx
  ON generation_runs (certification_id, started_at);

CREATE INDEX generation_runs_input_hash_idx
  ON generation_runs (certification_id, input_hash);

-- Answers the one question every per-question AI panel asks: what has AI said about this
-- question, most recent first?
CREATE INDEX generation_runs_subject_idx
  ON generation_runs (subject_question_id, started_at);

-- The links the DROP nulled, restored from the backup.
UPDATE questions
  SET generation_run_id = (
    SELECT b.generation_run_id FROM generation_link_backup_0013 b
      WHERE b.item_table = 'questions' AND b.item_id = questions.id)
  WHERE id IN (
    SELECT item_id FROM generation_link_backup_0013
      WHERE item_table = 'questions');

UPDATE flashcards
  SET generation_run_id = (
    SELECT b.generation_run_id FROM generation_link_backup_0013 b
      WHERE b.item_table = 'flashcards' AND b.item_id = flashcards.id)
  WHERE id IN (
    SELECT item_id FROM generation_link_backup_0013
      WHERE item_table = 'flashcards');

UPDATE flashcard_revisions
  SET generation_run_id = (
    SELECT b.generation_run_id FROM generation_link_backup_0013 b
      WHERE b.item_table = 'flashcard_revisions'
        AND b.item_id = flashcard_revisions.id)
  WHERE id IN (
    SELECT item_id FROM generation_link_backup_0013
      WHERE item_table = 'flashcard_revisions');

DROP TABLE generation_link_backup_0013;
`,
  },
];
