# StudyBench Progress

## Current milestone

D6 — Bedrock AI Foundation and Raw-Knowledge Generation

## Status

Completed on 2026-08-12. Awaiting explicit authorization for D7.

## Completed milestones

- D1 — Foundation and Demo Study Catalog (2026-08-10)
- D2 — Local Persistence and Certification Management (2026-08-11)
- D3 — Manual Question Bank (2026-08-11)
- D4 — Flashcards and Review Scheduling (2026-08-11)
- D5 — Quick Study Sessions and Progress (2026-08-11)
- D6 — Bedrock AI Foundation and Raw-Knowledge Generation (2026-08-12)

## In progress

- None

## Planned milestones

- D7 — AI Tutor and Question Quality Workflow (proposed next, not authorized)
- D4 — Flashcards and Review Scheduling
- D5 — Quick Study Sessions and Progress
- D6 — Bedrock AI Foundation and Raw-Knowledge Generation
- D7 — AI Tutor and Question Quality Workflow
- D8 — Source Library and Grounded Generation
- D9 — Printable Study Packs and Data Exports
- D10 — Polly Audio Generation
- D11 — Transcribe Speech Input and Evaluation
- D12 — Offline and Installable PWA
- D13 — PostgreSQL, S3, ECS, and Production Hardening

## Decisions

- The application is personal and single-user.
- The repository is `next-js-app-study-bench`.
- The product name is `StudyBench`.
- The application uses a single full-stack Next.js deployment.
- Local application persistence will use SQLite beginning in D2.
- Production application persistence will use PostgreSQL beginning in D13.
- Local object storage will use the filesystem.
- Production object storage will use Amazon S3.
- AI integration will use Amazon Bedrock behind an application-defined gateway.
- Raw model knowledge is a valid question-generation source.
- Source-grounded generation is supported but is not mandatory for every question.
- Every generated question must retain provenance metadata.
- Questions are maintained in a persistent, editable question bank.
- The normal study experience uses pre-generated bank content.
- AWS and HSK use different study and generation strategies.
- D1 uses a deterministic, read-only demo study catalog.
- D1 contains no database and no AWS service integration.
- Architecture examples in `SPEC.md` are reference approaches unless explicitly
  marked mandatory.
- 2026-08-10: Engineering guidance was split from `CLAUDE.md` into eight `spec/`
  reference files. `CLAUDE.md` is now an always-loaded entry point that routes to
  them. The duplicated D1 instructions were removed from `CLAUDE.md`; `SPEC.md`
  section 19 remains authoritative for D1 scope. No rule changed in substance.
- 2026-08-10: `.claude/settings.json` was added with a read-only and
  routine-command allowlist plus a deny list for destructive git commands, `.env`
  reads, and `SPEC.md` writes. Local overrides belong in the git-ignored
  `.claude/settings.local.json`.
- 2026-08-10 (D1): Next.js 15 App Router with React 19, TypeScript 5.9 strict
  mode, Node.js 22 (recorded in `.nvmrc`), npm with committed lockfile.
- 2026-08-10 (D1): TypeScript is pinned to major version 5. TypeScript 6.0
  rejects untyped side-effect CSS imports (`TS2882`) and Next.js 15 ships no
  `*.css` ambient declaration. A TS 6 upgrade needs a CSS declaration shim or
  Next 16.
- 2026-08-10 (D1): `eslint-config-next` is pinned to major version 15 to match
  Next.js 15. `@eslint/eslintrc` (`FlatCompat`) is a dev dependency because
  `eslint-config-next@15` ships eslintrc-style configs that ESLint 9 flat config
  cannot consume directly.
- 2026-08-10 (D1): Testing uses Vitest 4 with jsdom and Testing Library. The
  Vitest config is `vitest.config.mts` because Vitest 4 deprecates ESM syntax in
  CJS-loaded `.ts` configs.
- 2026-08-10 (D1): Styling is a single plain-CSS stylesheet (`globals.css`) with
  CSS custom properties as design tokens. No CSS framework or component library.
- 2026-08-10 (D1): `.prettierignore` excludes `SPEC.md`, `PROGRESS.md`,
  `CLAUDE.md`, and `spec/` so `npm run format` never rewrites authored
  specification documents.
- 2026-08-10 (D1): The SPEC 19.4 reference directories
  `modules/study-catalog/application/` and `shared/ui/` were not created — D1
  has no code for them and empty directories are prohibited
  (`spec/ARCHITECTURE.md` section 3). The composition root is
  `src/modules/study-catalog/composition.ts`.
- 2026-08-11 (D2): Local persistence uses `better-sqlite3` (no ORM) at
  `./data/study-bench.db`, git-ignored. Every connection is opened through one
  factory (`src/platform/database/sqlite.ts`) that sets `foreign_keys = ON`,
  `journal_mode = WAL`, `busy_timeout = 5000`. Tables are STRICT.
- 2026-08-11 (D2): Migrations use a small hand-rolled runner (ordered
  migrations applied transactionally, tracked in a STRICT `schema_migrations`
  table). Migrations run automatically when the database is first opened, so
  `npm install && npm run dev` is the full setup.
- 2026-08-11 (D2): Runtime validation uses `zod` at the Server Action
  boundary; it is the single schema-validation library for the project.
- 2026-08-11 (D2): The D1 `study-catalog` module (port, `DemoStudyCatalog`,
  demo data, UI) was removed and replaced by
  `src/modules/certifications/` (domain, ports, application facade,
  SQLite infrastructure, UI, composition root). Home and detail pages now read
  from the facade. D1's demo content is available through the explicit
  `npm run seed` command (idempotent by slug, never automatic).
- 2026-08-11 (D2): D1 study types migrated to the SPEC 6.1 enum:
  AWS demo track → `TECHNICAL_CERTIFICATION`, HSK → `LANGUAGE_PROFICIENCY`.
- 2026-08-11 (D2): `personaId` on certifications is deferred to D6 — no
  placeholder column or field exists (personas do not exist before D6).
- 2026-08-11 (D2): Slugs are derived from the name at creation (kebab-case,
  unique with a bounded numeric-suffix fallback) and remain stable on edit so
  links keep resolving. `new` is a reserved slug.
- 2026-08-11 (D2): IDs come from an injectable `IdGenerator`
  (`crypto.randomUUID()` in production) and time from an injectable `Clock`
  (UTC ISO text in SQLite), keeping tests deterministic.
- 2026-08-11 (D2): The unit of work uses explicit
  `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` with an in-process queue because
  better-sqlite3's native `transaction()` rejects async callbacks.
- 2026-08-11 (D2): No hard deletion in D2; certifications and objectives are
  archived and restorable. Archived tracks are hidden by default behind a
  "Show archived" affordance.
- 2026-08-11 (D3): New `src/modules/question-bank/` module mirrors the
  certifications layering. Question content is a discriminated union
  (SINGLE_CHOICE, MULTIPLE_RESPONSE, SHORT_ANSWER) persisted as validated JSON
  in a TEXT column with the discriminator in its own column; JSON is
  re-validated with zod on read. Exhaustive switches make a future question
  type a compile-time error.
- 2026-08-11 (D3): Migration `0002` adds STRICT tables `questions`,
  `question_revisions` (UNIQUE question_id + revision_number),
  `question_objective_links` (UNIQUE question_id + objective_id). Migration
  `0001` unchanged. `questions.current_revision_id` is nullable in SQL only;
  the invariant is enforced in the domain and repository.
- 2026-08-11 (D3): Revisions are append-only — the repository port has no
  update-revision method. Editing creates revision N+1 and bumps the current
  pointer in one transaction.
- 2026-08-11 (D3): Database composition was extracted to
  `src/platform/database/composition.ts` so certifications and question-bank
  share one connection, one migration run, and one transaction runner. Shared
  form/error helpers moved to `src/shared/`; the D2 files re-export them.
- 2026-08-11 (D3): Hard deletion goes through a `QuestionDependencyChecker`
  port. D3 wires a `NoDependencyChecker` (truthfully: attempts, sessions,
  artifacts, variants, and reviews do not exist yet); D5+ swap in real checks
  in the composition root without facade changes.
- 2026-08-11 (D3): Difficulty is a nullable integer 1–5 (ordering matters for
  D5 session composition). Per-choice `choiceExplanations` deferred (SPEC 6.3
  "may contain"); most valuable once D7 AI review produces them.
- 2026-08-11 (D3): Bank list queries are bounded (page size 20); an unbounded
  bank query is not expressible through the repository criteria. Stem search
  uses LIKE with escaping; no FTS dependency.
- 2026-08-11 (D3): Dispute is allowed from DRAFT as well as ACTIVE (a dispute
  records content doubt, not availability). `ARCHIVED` exists in the lifecycle
  enum per SPEC but no D3 flow produces it; retire plus eligible deletion
  cover D3 needs, and archival becomes meaningful once attempts exist.
- 2026-08-11 (D4): New `src/modules/flashcards/` module mirrors the
  question-bank layering. Card content is a five-type discriminated union
  (BASIC, REVERSED, CLOZE, VOCABULARY, SCENARIO) with the same validated-JSON
  persistence pattern; revisions are append-only. Cards have lifecycle only —
  no quality dimension (SPEC gives flashcards none).
- 2026-08-11 (D4): Migration `0003` adds STRICT tables `flashcards`,
  `flashcard_revisions`, `flashcard_objective_links`, `review_schedules`
  (one row per card), `flashcard_reviews` (append-only history referencing
  the reviewed revision id per DOMAIN-RULES 1.4). Migrations 0001/0002
  unchanged.
- 2026-08-11 (D4): Review scheduling is a strategy
  (`ReviewSchedulingStrategy` port, `DeterministicReviewScheduler`
  implementation) with the exact SPEC 6.5 interval rules, whole-minute
  intervals, injected Clock, and DB-independent unit tests. "New card" means
  no `review_schedules` row exists. Reviewing a card records the review row
  and updates the schedule in one transaction.
- 2026-08-11 (D4): Flashcards converted from a question record
  `source_question_id` and are treated as blocking dependents of that
  question: the D3 `NoDependencyChecker` was replaced by a real
  `FlashcardQuestionDependencyChecker` (ON DELETE RESTRICT), so a question
  with derived cards can be retired but not hard-deleted. Converted cards are
  independent after creation; edits do not sync.
- 2026-08-11 (D4): Due-card query is bounded and deterministically ordered
  (due-at, then created-at, then id); DRAFT, RETIRED, and ARCHIVED cards are
  excluded. The review screen reveals via minimal client state; a rating
  posted with a stale revision id is attributed to the card's current
  revision (last-write-wins, documented in `resolveReviewedRevision`).
- 2026-08-11 (D5): New `src/modules/study-sessions/` module. Sessions are
  composed deterministically by a pure-domain composer strategy following
  the DOMAIN-RULES 2.2 priority order (overdue cards, confident-incorrect,
  other incorrect, weak objectives, unseen objectives, never-attempted,
  retention), with mode and track filtering, dedup, exclusion of
  draft/retired/archived/disputed content, and frozen revision ids at
  composition. Candidate queries live in the question-bank and flashcards
  repositories (`findStudyCandidates` / `findDueCandidates`, bounded).
- 2026-08-11 (D5): Migration `0004` adds STRICT tables `study_sessions`,
  `session_certifications`, `study_session_items`, `question_attempts`
  (RESTRICT FKs to questions, revisions, and flashcards — attempts and
  session items are protected history).
- 2026-08-11 (D5): DIAGNOSTIC is a session mode (not a separate flag).
  Diagnostics are offered only when enough active questions exist; skipping
  leaves objectives UNSEEN with no zero scores. Mistake-review availability
  and composition share one predicate so the mode can never be offered and
  then fail.
- 2026-08-11 (D5): Choice questions are auto-graded
  (evaluationMode DETERMINISTIC; MULTIPLE_RESPONSE is exact set equality, no
  partial credit). SHORT_ANSWER is self-assessed after reveal
  (evaluationMode SELF_ASSESSED). Confidence (GUESS/UNCERTAIN/FAIRLY_SURE/
  CONFIDENT) is required on every question answer.
- 2026-08-11 (D5): Every completed item persists immediately in one
  transaction (attempt + item completion; card rating + schedule update +
  item completion). Sessions resume at the same frozen item after
  interruption; editing a question mid-session does not change the session.
  One session in progress at a time; starting a new one abandons the old.
- 2026-08-11 (D5): The question dependency checker is now a composite:
  derived flashcards (D4) plus attempts and study-session history (D5) block
  hard deletion; retirement stays available.
- 2026-08-11 (D5): `/progress` renders the SPEC 6.8 evidence-based measures
  (coverage, accuracy by track/objective/type, recent mistakes, due counts,
  unseen objectives, session history, confidence calibration, bank counts)
  and no pass probability. The route is forced dynamic so it is not
  prerendered against the build machine's database.
- 2026-08-12 (D6): New `src/modules/ai-generation/` module. AI goes through a
  `LanguageModelGateway` port with two adapters: `BedrockLanguageModelGateway`
  (Converse API with forced tool use, temperature 0; the only place
  `@aws-sdk/client-bedrock-runtime` is imported — asserted by a module
  boundary test) and a deterministic `FakeLanguageModelGateway` for all
  default tests (zero AWS calls in `npm test`). `converse` on the port is
  deferred to D7.
- 2026-08-12 (D6): Configuration per SPEC 17: `LANGUAGE_MODEL_PROVIDER`
  (fake|bedrock, fake by default in development; `APP_ENV=production` without
  bedrock fails loudly at composition), `BEDROCK_MODEL_ID` (default
  `us.anthropic.claude-sonnet-4-5-20250929-v1:0` cross-region inference
  profile), `AWS_REGION`/credentials via the AWS default provider chain —
  never in code, config files, or logs.
- 2026-08-12 (D6): Personas via a registry keyed by study type (no scattered
  provider checks): `technical-certification` v1 and `hsk` v1, with
  structurally different versioned prompt templates
  (`question-model-knowledge` v1, `flashcard-model-knowledge` v1) stored
  outside route handlers and fixture-tested. Owner free-text instructions go
  into the user message, never system instructions.
- 2026-08-12 (D6): Migration `0005` adds STRICT
  `generation_runs` (all SPEC 10.3 provenance fields, input hash, token
  usage, status PENDING/COMPLETED/PARTIAL/FAILED) plus nullable
  `generation_run_id` on questions and flashcards and
  `flashcards.generation_mode` (default MANUAL). Items carry only the run id;
  full provenance lives on the run so they cannot disagree.
- 2026-08-12 (D6): Generation flow: zod-validated structured output with one
  bounded repair attempt, then deterministic checks (SPEC 11.3) before
  persistence; invalid items count as failed and the run becomes
  COMPLETED/PARTIAL/FAILED. Drafts land as DRAFT/UNREVIEWED/MODEL_KNOWLEDGE
  in one transaction, objective-linked, badged "AI generated — model
  knowledge" and never labeled official. Accept = the normal edit/activate
  workflow; reject deletes only while still DRAFT at revision 1. Batch cap 10
  items; duplicate input hash shows a notice with a link and an explicit
  "generate anyway".
- 2026-08-12 (D6): Live Bedrock verified once end-to-end (us-east-1, Sonnet
  4.5 inference profile, 2699 total tokens): output landed as a DRAFT with
  correct provenance. An opt-in live smoke test exists via `npm run
  test:live` (excluded from `npm test`).
- 2026-08-12 (D6): `npm run seed` now also seeds demo bank content through
  the real facades when a track's bank is empty (5 questions + 2 cards on
  AWS, 2 questions + 5 cards on HSK, all ACTIVE, objective-linked, clearly
  fictional). A bank with any existing item is left untouched.
- 2026-08-12 (D6): The seed script has its own small composition wiring
  (`src/seed/composition.ts`) because module composition roots import
  `server-only`, which plain `tsx` cannot resolve; dropping that marker from
  app roots would weaken client/server isolation.
- 2026-08-12 (post-D6, user-authorized, not a milestone): Real-content
  import tooling (`npm run import:real`, `src/import/`). Parses the owner's
  AWS AIP-C01 exam guide and HSK 5 vocabulary list from the git-ignored
  `external/sources/` directory at runtime (no copyrighted content in the
  repo; parser tests use synthetic fixtures). Created track
  `aws-certified-generative-ai-developer-professional` (5 weighted domains +
  20 tasks, OFFICIAL_SYLLABUS) and track `hsk-5-chinese` (1,600 ACTIVE
  vocabulary cards, IMPORTED). Kangxi-radical and ligature normalization
  handled in `text-normalization.ts`.
- 2026-08-13 (post-D6 "Batch A", user-authorized, not a milestone): UI
  polish per owner feedback — fake-provider notice on generation pages
  (provider name from composition/run provenance), a/b/c/d choice letters
  (presentational only), compact per-choice ✓/✗ answer feedback replacing
  the boxy layout (tokens `--color-correct`/`--color-incorrect`, glyphs not
  color-only), tree-ordered indented objective selects via
  `listObjectiveOptions` (single ordering source), clearer card-type labels
  via `describeCardTypeChoice`. Plus 5 live Bedrock starter runs: 3
  questions per real AWS domain (15 drafts, ~16.6k tokens).
- 2026-08-13 (post-D6 "Batch B", user-authorized, not a milestone): HSK
  syllabus import (`npm run import:hsk-syllabus`): 117 new objectives on
  `hsk-5-chinese` — Listening/Reading/Writing exam-part structure and 70
  official grammar points (OFFICIAL_SYLLABUS), 9 topics + 12 language tasks
  from an unofficial compilation (AI_PROPOSED, "(unofficial)" in titles).
  VOCABULARY card content gained optional meanings[], synonyms[],
  antonyms[], examples[] (hanzi/pinyin/english), usageNotes; CLOZE gained
  optional per-blank hints (`{{answer|hint}}`) — all additive, old payloads
  valid, no data migration. New ENRICH_VOCABULARY generation kind: enriching
  creates a new card revision (card stays ACTIVE/MANUAL; the revision
  carries the run id via new `flashcard_revisions.generation_run_id`,
  migration `0006`, which also widens the run-kind CHECK with a careful
  table rebuild preserving provenance links). HSK drill generation is
  objective-kind aware (grammar patterns fed into prompts; templates bumped
  to v2, `vocabulary-enrichment` v1 added). Language-proficiency track pages
  lead with "Build study material" entry points. Pilot: first 100 words
  enriched (93 succeeded, ~48.7k tokens; 7 rejected — numbered homograph
  terms like `本2` cannot pass the example-uses-the-word check, fix deferred
  to import normalization) plus 2 drill runs (10 drafts).
- Known deferred items: ORDERING question type (needed for HSK Writing
  Part 1 word-ordering drills), homograph numbering normalization at import,
  enrichment of the remaining ~1,500 vocabulary words pending owner quality
  review of the pilot.

## Deviations

- None from `SPEC.md` D2–D5 requirements. D1 structural deviation (omitted
  empty directories) remains permitted by SPEC 19.4. "View attempt history"
  from SPEC 6.3 was delivered in D5 with attempts. Flashcard hard deletion is
  not in D4 scope (SPEC 22.2 lists none) and was not added.
- `npm run test:integration` (preferred name in CLAUDE.md section 10) does
  not exist yet; no milestone has introduced a distinct integration suite.
  Repository behavior is covered by contract tests inside `npm test`.

## Known limitations

- Responsiveness at a 360-pixel viewport is verified by stylesheet review, not
  real-browser device emulation; color contrast was chosen conservatively but
  not measured with a contrast tool.
- `npm audit` reports 3 high-severity advisories in transitive dependencies of
  Next.js 15 (`postcss`, `sharp`); the only offered fix is Next 16, a breaking
  upgrade out of scope. Revisit no later than D13 production hardening.
- Manual UI verification of D2 flows was performed by driving the real Server
  Actions over HTTP against the production build (including hostile payloads
  for the invalid-parent and cycle invariants), not by clicking in a browser.
- `better-sqlite3` native-module compilation on platforms without a prebuilt
  binary was not exercised.

## Validation results (2026-08-12, after D6)

- `npm run format:check` — passed
- `npm run lint` — passed
- `npm run type-check` — passed
- `npm test` — passed (60 files, 1161 tests, zero AWS calls; includes
  deterministic-check tests for every SPEC 11.3 rule, prompt-template
  fixture tests, generation facade flows against the fake gateway, and a
  module-boundary test pinning the AWS SDK to the one adapter)
- `npm run build` — passed (27 routes)
- Manual (D6, fake provider, scratch database): seed populated both banks
  and a second seed changed nothing; generated 3 AWS questions and 4 HSK
  flashcards as drafts with full run provenance (persona and template ids +
  versions, token counts); rejected a draft; edited another to revision 2
  and activated it through the normal workflow; duplicate-batch notice fired
  and "generate anyway" created a new run; a failed run rendered a safe
  error with zero credential/stack leakage (scanned the HTML); a quick
  session composed 8 items from seeded content.
- Manual (D6, live Bedrock): one live run through the app (1 AWS question,
  us-east-1, Sonnet 4.5 inference profile, 2096 in / 603 out tokens) landed
  as DRAFT/UNREVIEWED/MODEL_KNOWLEDGE with correct provenance; the opt-in
  live smoke test also passed. Default `npm test` makes no AWS calls.
- Manual (regression, orchestrator): `/health` unchanged; generate and
  run-list routes 200; seeded demo content visible in both banks (10 "Demo
  question" occurrences on the AWS bank page; vocabulary/cloze/reversed
  cards on HSK); `npm run seed` on the real dev database inserted demo bank
  content alongside the pre-existing tracks.
- Historical note (D5 validation, 2026-08-11): 46 files / 874 tests passed
  with the same gates; a 12-item mixed session, resumption, frozen
  revisions, mistake review, diagnostics, and `/progress` were all verified
  manually; three defects found and fixed during that verification (empty
  duration parsed as 0, `/progress` statically prerendered, mistake review
  offerable with only retired mistakes).

## Next proposed milestone

D7 — AI Tutor and Question Quality Workflow. Not authorized; waiting for
explicit user authorization.
