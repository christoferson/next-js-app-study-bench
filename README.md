# StudyBench

**Build your study bank. Learn anywhere.**

StudyBench is a personal, single-user, AI-assisted study workbench for technical
certifications, language examinations, and other structured learning goals. It is
built incrementally in small, independently verifiable milestones.

## Current state — D1

Milestone D1 delivers the application shell and a **read-only demo study
catalog**:

- A dashboard at `/` listing two demo study tracks.
- A detail page at `/study-tracks/[slug]` with read-only demo objectives.
- A liveness endpoint at `/health`.

D1 has **no persistence**. The catalog is a deterministic in-memory demo
implementation, all of its content is labelled `Demo`, and nothing is saved
between requests or restarts. Local SQLite persistence arrives in D2.

See `SPEC.md` for the full specification and `PROGRESS.md` for implementation
state.

## Prerequisites

- Node.js 22 (see `.nvmrc`; developed on 22.14.0)
- npm 10 or newer

## Install

```bash
npm install
```

## Commands

| Command                | Purpose                                    |
| ---------------------- | ------------------------------------------ |
| `npm run dev`          | Start the development server on port 3000  |
| `npm run build`        | Production build                           |
| `npm start`            | Serve the production build (after `build`) |
| `npm test`             | Run unit and component tests once (Vitest) |
| `npm run test:watch`   | Run tests in watch mode                    |
| `npm run type-check`   | TypeScript type checking (`tsc --noEmit`)  |
| `npm run lint`         | ESLint                                     |
| `npm run format`       | Format the repository with Prettier        |
| `npm run format:check` | Verify formatting without writing changes  |

## Local verification

```bash
npm run format:check
npm run lint
npm run type-check
npm test
npm run build
```

## Manual check

With `npm run dev` running:

- `http://localhost:3000` — dashboard with two `Demo` study tracks
- `http://localhost:3000/study-tracks/hsk-chinese-demo-track` — detail page
- `http://localhost:3000/study-tracks/unknown` — not-found page
- `http://localhost:3000/health` — `{"status":"ok","application":"study-bench"}`

## Architecture

One full-stack Next.js App Router application, TypeScript strict mode, Server
Components only in D1.

```
src/
├── app/                          route handlers, pages, layout, stylesheet
└── modules/study-catalog/
    ├── domain/                   framework-free study-track types
    ├── ports/                    StudyCatalog interface
    ├── infrastructure/           DemoStudyCatalog and demo data
    ├── ui/                       track card, objective list, demo badge
    └── composition.ts            server-only composition root
```

Detailed engineering rules live in `CLAUDE.md` and `spec/`.
