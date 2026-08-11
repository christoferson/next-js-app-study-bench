# StudyBench Progress

## Current milestone

D4 — Flashcards and Review Scheduling

## Status

Completed on 2026-08-11. Awaiting explicit authorization for D5.

## Completed milestones

- D1 — Foundation and Demo Study Catalog (2026-08-10)
- D2 — Local Persistence and Certification Management (2026-08-11)
- D3 — Manual Question Bank (2026-08-11)
- D4 — Flashcards and Review Scheduling (2026-08-11)

## In progress

- None

## Planned milestones

- D5 — Quick Study Sessions and Progress (proposed next, not authorized)
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

## Deviations

- None from `SPEC.md` D2/D3/D4 requirements. D1 structural deviation (omitted
  empty directories) remains permitted by SPEC 19.4. "View attempt history"
  from SPEC 6.3 waits for D5 (attempts do not exist before then). Flashcard
  hard deletion is not in D4 scope (SPEC 22.2 lists none) and was not added.

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

## Validation results (2026-08-11, after D4)

- `npm run format:check` — passed
- `npm run lint` — passed
- `npm run type-check` — passed
- `npm test` — passed (32 files, 556 tests, including repository contract
  suites for certifications, questions, and flashcards against SQLite on
  fresh in-memory migrated databases, and DB-independent scheduling unit
  tests with a fixed clock)
- `npm run build` — passed (20 routes)
- Manual (D4): all five card types created and activated; ratings verified
  against the exact SPEC 6.5 intervals (new card AGAIN 10 min / HARD 1 d /
  GOOD 3 d / EASY 7 d; existing card GOOD 4320→8640 min, HARD 8640→10368,
  AGAIN back to 10 min with lapse increment); editing a reviewed card kept
  review history and revision 1 intact; retiring removed a card from the due
  queue and a forged rating on it was refused; question→card conversion
  carried objective mappings and blocks hard deletion of the source question
  with a clear message; cross-track card addressing 404s.
- Manual (regression): D1–D3 flows unchanged (`/health`, dashboard, objective
  tree, question bank, archive controls); review and flashcard-bank pages
  render meaningful empty states on a database with no cards.

## Next proposed milestone

D5 — Quick Study Sessions and Progress. Not authorized; waiting for explicit
user authorization.
