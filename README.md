# StudyBench

**Build your study bank. Learn anywhere.**

StudyBench is a personal, single-user, AI-assisted study workbench for technical
certifications, language examinations, and other structured learning goals. It is
built incrementally in small, independently verifiable milestones.

## Current state — D2

Milestone D2 replaces the D1 read-only demo catalog with **local SQLite
persistence and full certification management**:

- A dashboard at `/` listing your active study tracks, with a "New study track"
  action and an archived-tracks toggle offering restore.
- Create and edit a study track at `/study-tracks/new` and
  `/study-tracks/[slug]/edit`.
- A detail page at `/study-tracks/[slug]` with track metadata, edit,
  archive/restore, and a nested objective tree.
- Objective management: add a root objective or a child, edit, reorder among
  siblings with explicit up/down controls, reparent through a select, and
  archive/restore.
- A liveness endpoint at `/health` (unchanged from D1).

Everything is stored in a local SQLite database and survives a restart.
Archiving is reversible and **nothing is hard-deleted**. There are no questions,
flashcards, sessions, or AI features yet — those arrive in later milestones.

See `SPEC.md` for the full specification and `PROGRESS.md` for implementation
state.

## Prerequisites

- Node.js 22 (see `.nvmrc`; developed on 22.14.0)
- npm 10 or newer

`better-sqlite3` is a native module and is prebuilt for common platforms. If your
platform has no prebuild, `npm install` compiles it and needs a working C++
toolchain (on Windows, Visual Studio Build Tools with the C++ workload).

## Install

```bash
npm install
```

## Data directory

The database file is `./data/study-bench.db`, created on first use together with
its `data/` directory. Set `STUDYBENCH_DATABASE_FILE` to use another path:

```bash
STUDYBENCH_DATABASE_FILE=./data/scratch.db npm run dev
```

Database files are ignored by git (`/data/*.db`, `-shm`, `-wal`); local study
data is never committed. Migrations run automatically when the application opens
the database, so no separate migrate step is needed. Tests always use in-memory
databases and never touch `./data`.

To start over, stop the server and delete `data/study-bench.db` (plus any
`-shm`/`-wal` files). This destroys local data and cannot be undone.

## Commands

| Command                | Purpose                                    |
| ---------------------- | ------------------------------------------ |
| `npm run dev`          | Start the development server on port 3000  |
| `npm run build`        | Production build                           |
| `npm start`            | Serve the production build (after `build`) |
| `npm run seed`         | Insert the two demo study tracks           |
| `npm test`             | Run unit and component tests once (Vitest) |
| `npm run test:watch`   | Run tests in watch mode                    |
| `npm run type-check`   | TypeScript type checking (`tsc --noEmit`)  |
| `npm run lint`         | ESLint                                     |
| `npm run format`       | Format the repository with Prettier        |
| `npm run format:check` | Verify formatting without writing changes  |

### Seeding demo content

```bash
npm run seed
```

`npm run seed` is explicit and never runs automatically. It inserts two clearly
labelled demo tracks (an AWS certification track and an HSK Chinese track) with
their objectives, each marked `Demo` in the interface. It is safe to re-run: a
track whose slug already exists is skipped and reported, so seeding never
duplicates or overwrites your own content.

## Local verification

```bash
npm run format:check
npm run lint
npm run type-check
npm test
npm run build
```

## Manual check

With `npm run seed` followed by `npm run dev`:

- `http://localhost:3000` — dashboard listing the seeded `Demo` tracks
- Create a track, add objectives, then restart the server — the data is still
  there
- Archive a track, use "Show archived tracks", and restore it
- `http://localhost:3000/study-tracks/unknown` — not-found page
- `http://localhost:3000/health` — `{"status":"ok","application":"study-bench"}`

## Architecture

One full-stack Next.js App Router application, TypeScript strict mode. Reads run
in Server Components; mutations run through thin Server Actions that validate
input with Zod and delegate to the application facade. Pages, route handlers, and
components never touch SQL or the database driver.

```
src/
├── app/                              route handlers, pages, layout, stylesheet
├── platform/
│   ├── clock.ts                      injectable UTC clock port
│   ├── id-generator.ts               injectable ID port (crypto.randomUUID)
│   └── database/                     connection, config, migrations, runner
└── modules/certifications/
    ├── domain/                       framework-free types, slug rules,
    │                                 hierarchy validation, domain errors
    ├── ports/                        repository and unit-of-work interfaces
    │                                 plus the shared repository contract suite
    ├── application/                  Zod schemas and CertificationFacade
    ├── infrastructure/               SQLite repositories, unit of work,
    │                                 demo seed data, test support
    ├── ui/                           Server Actions, forms, cards, tree
    └── composition.ts                server-only composition root
```

Detailed engineering rules live in `CLAUDE.md` and `spec/`.
