# StudyBench Progress

## Current milestone

D1 — Foundation and Demo Study Catalog

## Status

Completed on 2026-08-10. Awaiting explicit authorization for D2.

## Completed milestones

- D1 — Foundation and Demo Study Catalog (2026-08-10)

## In progress

- None

## Planned milestones

- D2 — Local Persistence and Certification Management (proposed next, not
  authorized)
- D3 — Manual Question Bank
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

## Deviations

- None from `SPEC.md` D1 requirements. Structural deviation from the 19.4
  reference tree (omitted empty directories) is permitted by 19.4 itself.

## Known limitations

- Responsiveness at a 360-pixel viewport is implemented via a single-column
  layout and one `min-width: 40rem` breakpoint but was verified by stylesheet
  review, not real-browser device emulation.
- Color contrast was chosen conservatively (dark text on light background) but
  not measured with a contrast tool.
- `npm audit` reports 3 high-severity advisories in transitive dependencies of
  Next.js 15 (`postcss`, `sharp`); the only offered fix is Next 16, a breaking
  upgrade out of D1 scope. Revisit no later than D13 production hardening.

## Validation results (2026-08-10)

- `npm run format:check` — passed
- `npm run lint` — passed
- `npm run type-check` — passed
- `npm test` — passed (4 files, 18 tests)
- `npm run build` — passed (routes: `/`, `/_not-found` static; `/health`,
  `/study-tracks/[slug]` dynamic)
- Manual: `/` shows dashboard with two Demo tracks; detail pages render with
  demo badge, metadata, objectives, and return link; unknown slug returns HTTP
  404 via the Next.js not-found page; `/health` returns
  `{"status":"ok","application":"study-bench"}` with `Cache-Control: no-store`.

## Next proposed milestone

D2 — Local Persistence and Certification Management. Not authorized; waiting
for explicit user authorization.
