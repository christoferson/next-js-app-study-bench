# StudyBench Progress

## Current milestone

D2 — Local Persistence and Certification Management

## Status

Completed on 2026-08-11. Awaiting explicit authorization for D3.

## Completed milestones

- D1 — Foundation and Demo Study Catalog (2026-08-10)
- D2 — Local Persistence and Certification Management (2026-08-11)

## In progress

- None

## Planned milestones

- D3 — Manual Question Bank (proposed next, not authorized)
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

## Deviations

- None from `SPEC.md` D2 requirements. D1 structural deviation (omitted empty
  directories) remains permitted by SPEC 19.4.

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

## Validation results (2026-08-11)

- `npm run format:check` — passed
- `npm run lint` — passed
- `npm run type-check` — passed
- `npm test` — passed (13 files, 178 tests, including the repository contract
  suite against SQLite on fresh in-memory migrated databases)
- `npm run build` — passed (8 routes)
- Manual: tracks and objective hierarchies persist across a server restart;
  invalid parent references and cyclic reparenting are rejected with
  field-associated errors; archive hides a track from the default list and
  restore returns it; unknown slug returns HTTP 404; `/health` returns
  `{"status":"ok","application":"study-bench"}` unchanged; `npm run seed` is
  idempotent (second run reports both demo tracks already present).

## Next proposed milestone

D3 — Manual Question Bank. Not authorized; waiting for explicit user
authorization.
