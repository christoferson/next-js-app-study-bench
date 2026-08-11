# StudyBench

**Build your study bank. Learn anywhere.**

StudyBench is a personal, single-user, AI-assisted study workbench for technical
certifications, language examinations, and other structured learning goals. It is
built incrementally in small, independently verifiable milestones.

## Current state — D5

Milestone D5 adds **quick study sessions and progress** on top of the D4
flashcard bank. Studying is now the primary action: the dashboard leads with
"Start 10-minute session", or "Resume your session" when one is still running.

- A start screen at `/study/new` choosing what kind of session (one track, mixed
  tracks, questions only, flashcards only, mistake review, diagnostic), which
  tracks, and roughly how long (5–45 minutes; a guide, not a timer). A mode with
  nothing to offer is disabled with the reason stated next to it. Arriving from a
  track page (`/study/new?track=[slug]`) preselects that track.
- A study screen at `/study/sessions/[sessionId]` presenting one item at a time,
  with position, a skip, and a "finish early". Answers are saved the moment they
  are submitted, so closing the tab loses nothing and reopening the session
  resumes at the same item with the same items in the same order.
- Questions are answered with a required confidence (guessed, unsure, fairly
  sure, confident). Single choice and multiple response are checked against the
  recorded answer; a short answer is revealed and graded by you, and the feedback
  says so. Feedback names the correct answer and the explanation from the
  revision you answered, not the question's current wording.
- Flashcards met inside a session are prompted and rated exactly as the D4 review
  screen does, and one rating updates the review record, the card's schedule, and
  the session item together.
- A summary at `/study/sessions/[sessionId]/summary` reporting items reached,
  questions answered and how many were right, cards rated, anything left
  unreached, and what was missed with how sure you had been. A flashcards-only
  session reports no accuracy rather than 0%.
- A progress dashboard at `/progress`: overall and per-track accuracy, objective
  coverage with unseen objectives named as "not studied yet", accuracy by
  question type and by objective, confidence calibration, recent mistakes,
  flashcards due, what each bank holds, and recent sessions with a resume link.
  Every figure is counted from recorded answers — there is deliberately **no pass
  probability, readiness score, or predicted grade**.
- A question page now shows its attempt history, each row naming the revision it
  was answered against. A question that has been answered or offered in a session
  can no longer be hard-deleted; retiring it is how it leaves study, and the
  history survives.
- Study tracks (D2): a dashboard at `/` listing your active tracks with a "New
  study track" action and an archived-tracks toggle offering restore; create and
  edit at `/study-tracks/new` and `/study-tracks/[slug]/edit`; a detail page at
  `/study-tracks/[slug]` with metadata, edit, archive/restore, a "Start session"
  action, and a nested objective tree; objective management with add-child, edit,
  sibling reordering, reparenting, and archive/restore.
- A per-track question bank (D3) at `/study-tracks/[slug]/questions`, listing
  questions with their type, lifecycle status, review state, and revision, and
  filtering by lifecycle, review state, type, objective, and question text.
  Writing questions at `.../questions/new` in three types: single choice,
  multiple response, and short answer. Editing at `.../[questionId]/edit`
  **appends a revision** rather than overwriting one, and every earlier revision
  stays readable at `.../[questionId]/revisions/[revisionNumber]`. Question
  lifecycle and review state are two independent dimensions, and a question can
  be deleted only when nothing depends on it.
- A per-track flashcard bank at `/study-tracks/[slug]/flashcards`, listing cards
  by prompt side only, and filtering by lifecycle, card type, objective, and card
  text.
- Writing cards at `/study-tracks/[slug]/flashcards/new` in five types: basic,
  reversed, cloze, vocabulary, and scenario. A new card starts as a draft, and a
  card that cannot be studied — a cloze sentence with no `{{deletion}}`, a blank
  face — is rejected with a message next to the field.
- A card page at `/study-tracks/[slug]/flashcards/[flashcardId]` showing how the
  card is prompted, the answer behind a disclosure, its objective mappings, its
  lifecycle controls, its review history, and its revision history.
- Editing at `.../[flashcardId]/edit` **appends a revision**, keeps the card's
  due date and review history, and can change the card's type. Earlier revisions
  stay readable at `.../[flashcardId]/revisions/[revisionNumber]`.
- Review at `/study-tracks/[slug]/review`: the next due card, answer hidden until
  you ask for it, then four recall ratings. Due dates follow the schedule in
  `SPEC.md` section 6.5 — again in 10 minutes, hard in a day, good in three days,
  easy in a week, growing on each success. The queue is deterministically
  ordered, so reloading offers the same card until you rate it, and only active
  cards appear.
- Turning an active question into a draft flashcard from the question page: the
  card carries the wording, the answer, and the objective mappings, and is
  independent of the question from then on.
- A liveness endpoint at `/health` (unchanged from D1).

Everything is stored in a local SQLite database and survives a restart. Tracks,
objectives, and flashcards are never hard-deleted — a card carries review
history, so retirement is how it leaves the queue. A question can be deleted, but
not while a flashcard made from it exists, and not once it has been answered or
offered in a session. Sessions are composed by a deterministic strategy that
reads only the bank: **no AI is involved in starting a session**. There are no
imports, printable artifacts, audio, or AI features yet — those arrive in later
milestones.

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
- Open a track, choose "Open question bank", and write a single-choice question;
  saving without marking a correct answer is rejected with a message
- Activate the draft, then edit it: the revision history shows two revisions and
  revision 1 still reads as originally written
- Filter the bank by status, dispute a question with a reason, and resolve it
- Open the HSK track, choose "Open flashcards", and write a vocabulary card
  (term `学习`, reading `xuéxí`, meaning `to study; to learn`); activate it
- Choose "Review 1 due", press "Show answer", then "Good" — the card leaves the
  queue and its next due date is three days out
- Edit that card: the review history still names revision 1, and the due date is
  unchanged
- Retire the card and reload the review screen — it is no longer offered
- On an active question, choose "Make a flashcard from this question", then try to
  delete that question: the deletion is refused while the card exists
- From the dashboard, choose "Start 10-minute session", pick one track, and work
  through it: answer with a confidence, read the feedback, rate a card, skip an
  item, then "Finish early" — the summary reports what was reached
- Close the tab mid-session and reopen `http://localhost:3000` — "Resume your
  session" returns to the same item with the same items in the same order
- Edit a question you answered earlier, then open its page: the attempt history
  still names the revision you answered
- Try to delete that answered question: the deletion is refused and "Retire"
  is offered instead
- Open `http://localhost:3000/progress` — counted accuracy, objective coverage,
  confidence calibration, recent mistakes, and recent sessions, with no pass
  probability anywhere
- After a wrong answer, "Mistake review" becomes available on `/study/new`
- `http://localhost:3000/study/sessions/nope` — not-found page
- `http://localhost:3000/study-tracks/unknown` — not-found page
- `http://localhost:3000/study-tracks/demo-cloud-practitioner/questions/nope` —
  not-found page
- `http://localhost:3000/study-tracks/demo-cloud-practitioner/flashcards/nope` —
  not-found page
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
│   └── database/                     connection, config, migrations, runner,
│                                     shared connection composition
└── modules/
    ├── certifications/               study tracks and objectives
    ├── question-bank/                questions and their revisions
    ├── flashcards/                   cards, revisions, review scheduling
    └── study-sessions/               sessions, attempts, progress measures
```

Each module has the same five layers plus a composition root:

```
    <module>/
    ├── domain/                       framework-free types, invariants,
    │                                 lifecycle rules, domain errors
    ├── ports/                        repository and unit-of-work interfaces
    │                                 plus the shared repository contract suite
    ├── application/                  Zod schemas and the module facade
    ├── infrastructure/               SQLite repositories, unit of work,
    │                                 test support
    ├── ui/                           Server Actions and components
    └── composition.ts                server-only composition root
```

All four modules share one database connection and one transaction runner from
`platform/database/composition.ts`, so migrations run once and writes serialise
across modules.

Question and card content are discriminated unions per type, stored as validated
JSON with the type in its own column. Revisions are append-only: the repository
port has no update-revision method, so an edit can only add revision `n + 1`. So
are recorded reviews — each one names the card revision it was given against, so
a later edit cannot rewrite what was studied.

The review scheduling algorithm sits behind a strategy
(`modules/flashcards/domain/review-scheduling.ts`) that takes a rating plus the
card's current schedule and returns the next one. It reads no database and gets
its time from the injected clock, so every rule in `SPEC.md` section 6.5 is unit
tested without persistence, and replacing it is one line in the flashcard
composition root.

Session composition is the second strategy
(`modules/study-sessions/domain/session-composer.ts`): it takes the candidate
questions and due cards the facade already fetched and returns an ordered item
list. It reads no database and calls no model, so a session starts from bounded
queries alone and the composition rules are unit tested without persistence.

A session item freezes the question or card revision it offers. Attempts are
append-only and each names the revision it answered, so editing a question mid
session neither changes what is on screen nor rewrites what was answered. An
answer writes the attempt and completes the item in one transaction through the
study module's unit of work, and rating a card in a session writes the review, the
card's new schedule, and the item together — so a refused grade or a retired card
leaves nothing behind.

Whether a question can be hard-deleted is decided by a composite of dependency
checkers wired in `modules/question-bank/composition.ts`: one reports flashcards
derived from it, one reports attempts and session history. The database enforces
the same rule independently with `ON DELETE RESTRICT`.

Detailed engineering rules live in `CLAUDE.md` and `spec/`.
