# StudyBench

**Build your study bank. Learn anywhere.**

StudyBench is a personal, single-user, AI-assisted study workbench for technical
certifications, language examinations, and other structured learning goals. It is
built incrementally in small, independently verifiable milestones.

## Current state — D6

Milestone D6 adds the **Bedrock AI foundation and raw-knowledge generation** on
top of the D5 study sessions. You can now ask a model for a small batch of
questions or flashcards for one track, review the batch, and keep or reject each
item. **Out of the box it uses a fake model and costs nothing** — see
[AI generation](#ai-generation) below.

- "Generate with AI" on a track page opens `/study-tracks/[slug]/generate`:
  questions or flashcards, 1–10 items, an optional difficulty, optional
  objectives to target, optional extra instructions, and the item types the
  track's persona supports. Generation is synchronous — you wait on the page, and
  there is no queue or background worker.
- Every batch is recorded as a **generation run** and every generated item is
  linked to it. Run history is at `/study-tracks/[slug]/generation-runs`, and one
  run's review screen at `.../generation-runs/[runId]` names the model, the
  persona and its version, the prompt template and its version, the token usage
  the provider reported, and what the batch produced.
- Generated items land as **drafts, unreviewed**, marked
  `AI generated — model knowledge`, and are never labelled official or real exam
  material. Nothing generated can appear in a study session until you activate
  it. Rejecting an item deletes it while it is still a draft; activating it makes
  it yours, and generation will not touch it again.
- Content is written by a **persona**: the one assigned to the track, or — by default —
  the built-in one for its study type. A technical-certification persona writes applied
  scenario questions in English, an HSK persona writes word- and sentence-level material
  in simplified Chinese with pinyin. The two produce structurally different prompts, not
  reworded copies. See [Personas](#personas) for writing and assigning your own.
- Model output is validated against an application-owned schema and then checked
  by deterministic rules (answerable choices, a marked correct answer, objectives
  that exist on this track, no duplicate items in a batch) **before** anything is
  stored. An item that fails is counted as failed, not saved, and a batch may be
  reported as partly completed.
- Asking twice for the same batch shows a notice linking the earlier run, with an
  explicit "generate anyway" if that is what you meant.
- A provider failure produces a `Failed` run you can read, with a category and
  safe advice. No stack trace, credential, or provider message reaches the
  interface.
- Studying (D5) is still the primary action: the dashboard leads with
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
- Progress on two screens. `/progress` is a short dashboard: one summary line for
  everything (time answering, days active this month, items studied in the last
  seven days, overall accuracy) and then one compact card per track — last
  studied, study streak, days active, objective coverage, accuracy, and cards due
  — each linking to that track's own page. A track never studied says "not
  studied yet" rather than showing zeroes.
- `/progress/[slug]` is one track in detail: the same headline figures plus a
  recent-answers trend, then progress **by domain** — each root objective as a
  row with its rolled-up questions attempted and accuracy, expandable to the
  objectives beneath it — and, folded away until wanted, accuracy by question
  type, confidence calibration, recent mistakes, and this track's session history
  with a resume link. An unknown slug is a 404; an archived track is still
  readable.
- Every figure is counted from recorded answers and card reviews — there is
  deliberately **no pass probability, readiness score, or predicted grade**.
  "Time answering" is the sum of the per-question timers only, and it says how
  many answers were never timed rather than filling them in with an average.
  A streak is consecutive days with any recorded activity, counted as live if the
  last of them was today or yesterday.
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

### D10 — spoken audio

Brought forward ahead of D7–D9 because pronunciation is what the owner's own HSK
track needs most. Only the parts that stand on what already exists are here: audio
study packs need D9's printable artifacts, and a listening-comprehension question
needs a question type the bank does not have. **Audio is off until you configure a
real voice** — see [Spoken audio](#spoken-audio) below.

- **Pronunciation on vocabulary cards.** A small speaker button sits beside the term.
  Press it and you hear the word — one press, whether or not the clip already exists.
  The button appears on the card page at
  `/study-tracks/[slug]/flashcards/[flashcardId]`, on the review screen, and on a
  card inside a session — on the two study screens only **after** the answer is
  revealed, since hearing the term is a strong hint on a card that prompts with the
  meaning.
- **The term only.** Not the example sentence, not the reading, not the meaning. A
  vocabulary card is for learning one word; a column of buttons down the answer face
  invited pressing all of them, and an example is where the billed characters pile up
  for the part of the card that is read rather than learned. `xuéxí` read by a Mandarin
  voice is a mispronunciation, and the meaning is the answer.
- **Nothing appears until a voice is configured.** Study screens render no audio
  control at all unless `SPEECH_PROVIDER=polly` is set. The placeholder provider
  speaks silence, and a button that plays nothing is worse than no button.
- **"Read aloud" on a question.** A question page offers the stem, spoken by an
  English voice. The choices are not synthesized: they are read on screen, and
  speaking them would bill for four more clips and read the distractors aloud in a
  fixed order.
- **A clip is made once and kept.** Clips are cached by a SHA-256 of the exact
  text, voice, engine, language, and rate, so the same phrase is never paid for
  twice — opening a page only reads the cache and can never bill. Files live in
  `./data/audio/`; only their metadata is in the database.
- **Nothing is spoken until you ask.** There is no automatic synthesis anywhere: a
  clip exists because a button was pressed.
- `/settings/audio` lists every clip with its voice, language, and size, reports
  the total on disk, and is **the only place a clip can be removed** — a mis-tap on
  a card should not destroy something you paid for.

Basic, reversed, cloze, and scenario cards offer no audio, audio study packs and
listening-comprehension questions are not part of this milestone, and printable
artifacts still arrive later.

### Added after D6, outside a milestone

Work authorized separately from the milestone plan. It adds no new milestone scope;
`PROGRESS.md` still records D6 as the last completed milestone. One dependency was
added, `unpdf`, for reading an uploaded syllabus PDF.

- **The HSK 5 syllabus as an objective tree.** `npm run import:hsk-syllabus` adds
  the examination's skills and parts, the syllabus's grammar points, and the
  owner's own notes on topic areas and language tasks to the imported HSK track —
  see [Importing your own study material](#importing-your-own-study-material).
- **"Enrich vocabulary with AI"** at `/study-tracks/[slug]/enrich`: a model fills
  in what a one-line gloss leaves out — further senses, synonyms and antonyms,
  example sentences with readings and translations, and a register note. Up to 20
  cards per run, chosen by the bank rather than by you: the next cards that still
  have only a gloss, in a deterministic order, so repeated runs walk the list. The
  detail arrives as **a new revision**; the card's own lifecycle, schedule, review
  history, and the wording you wrote are untouched, and a card stays manual
  content. An example that does not actually use the word it illustrates is
  rejected, and that card is left exactly as it was.
- **Drills that fit the objective.** Generation now reads what kind of thing the
  chosen objective is from the tree it sits under. A grammar point asks for items
  that _exercise_ that pattern — gap-fills and a "which sentence uses it
  correctly" discrimination item — with the syllabus's own description passed in as
  owner data. A topic or language task asks for items _set in_ that theme. An
  ordinary exam domain, which is every objective on a technical certification, is
  prompted exactly as before. Word-ordering items are not generated: they need an
  ordering question type the bank does not have yet.
- **A language track leads with building material.** A `LANGUAGE_PROFICIENCY`
  track page opens with a "Build study material" section offering "Enrich
  vocabulary with AI" and "Generate drills"; a technical certification keeps its
  single "Generate with AI" entry point. The choice comes from the track's study
  type, never from its provider or name.
- **"Import objectives"** on a track page: upload a syllabus as a PDF or text file,
  or paste it, and a model proposes an objective tree you read and confirm before
  anything is written — see
  [Importing objectives from a syllabus](#importing-objectives-from-a-syllabus).
  The uploaded file is not stored, applying is one transaction, and applying the
  same proposal twice is refused rather than duplicating it.
- **Vocabulary and cloze cards hold more.** A vocabulary card can now carry
  further senses, synonyms, antonyms, several worked examples each with its own
  reading and translation, and a usage note — all of them **optional and
  additive**, so every card written before they existed is still valid, unchanged,
  and needed no migration. A cloze deletion can carry a hint after a `|`, as in
  `{{答案|the first character}}`. All of it is writable by hand on the card form;
  enrichment is one way to fill it in, not the only way.

Everything is stored in a local SQLite database and survives a restart. Tracks,
objectives, and flashcards are never hard-deleted — a card carries review
history, so retirement is how it leaves the queue. A question can be deleted, but
not while a flashcard made from it exists, and not once it has been answered or
offered in a session. Sessions are composed by a deterministic strategy that
reads only the bank: **no AI is involved in starting a session**. AI generation
creates only drafts, and the one flow that touches content you already have —
enrichment — appends a revision and never rewrites one. The AI tutor explains a
question you already have and writes nothing into the bank at all. There is no
source library, grounded generation, or printable artifacts yet — those arrive in
later milestones. An imported syllabus is read once for its outline and the document
itself is not kept, which is why it is not a source library.

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

Generated audio is written to `./data/audio/`, one MP3 per clip, created on first
use. It is ignored by git (`/data/audio/`) for the same reason as the database: a
clip is your study content read aloud. Set `STUDYBENCH_AUDIO_ROOT` to use another
root directory. Tests write to temporary directories and never touch `./data`.

To start over, stop the server and delete `data/study-bench.db` (plus any
`-shm`/`-wal` files). Delete `data/audio/` too — an orphaned file is harmless but
a database without its files would show players that fail to load. This destroys
local data and cannot be undone.

## Commands

| Command                       | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| `npm run dev`                 | Start the development server on port 3000          |
| `npm run build`               | Production build                                   |
| `npm start`                   | Serve the production build (after `build`)         |
| `npm run seed`                | Insert the demo study tracks and demo content      |
| `npm run import:real`         | Import your own study material (see below)         |
| `npm run import:hsk-syllabus` | Add the HSK 5 syllabus structure to that HSK track |
| `npm test`                    | Run unit and component tests once (Vitest)         |
| `npm run test:watch`          | Run tests in watch mode                            |
| `npm run test:live`           | Opt-in live provider tests (see below)             |
| `npm run type-check`          | TypeScript type checking (`tsc --noEmit`)          |
| `npm run lint`                | ESLint                                             |
| `npm run format`              | Format the repository with Prettier                |
| `npm run format:check`        | Verify formatting without writing changes          |

### Seeding demo content

```bash
npm run seed
```

`npm run seed` is explicit and never runs automatically. It inserts two clearly
labelled demo tracks (an AWS certification track and an HSK Chinese track) with
their objectives, each marked `Demo` in the interface, and then fills both banks
on both tracks with demo questions and demo flashcards so a fresh database has
something studiable in it. The demo items are invented for this repository —
fictional services, fictional numbers — and nothing in them is presented as
official or real exam material.

It is safe to re-run, and idempotent in two layers:

- **Tracks, by slug.** A demo track whose slug already exists is skipped and
  reported, untouched.
- **Bank content, per bank.** A question bank or flashcard bank that already holds
  **any** item is left completely alone; an empty one receives the whole demo set.
  Nothing is edited, deleted, or de-duplicated item by item, so re-seeding can
  never overwrite your wording or add a second copy beside an item you rewrote.
  Emptying a bank and re-seeding does write the demo items again — that is what
  "empty bank" means here.

Demo items are written through the same facades your own authoring uses, so they
pass the same validation and are recorded as manual content, not as AI-generated
content. They are activated on the way in, so a session can offer them
immediately.

### Importing your own study material

```bash
npm run import:real
```

One-off tooling for turning two documents you already own into real tracks, so the
bank holds material worth studying rather than only demo content. It reads text you
have extracted from your own PDFs and expects both files in `external/sources/`:
`ai-professional-01.txt` (an official AWS exam guide) and
`hsk5-vocabulary-list-2026.txt` (a New HSK 5 word list). `external/` is gitignored
— the documents are personal material and are never committed, so the import fails
with a message telling you where to put them if they are absent, and neither
parser contains any of their content. It creates one track per document: the exam
guide's content domains as top-level objectives carrying their stated weightings
with each task beneath them, and the word list as one active vocabulary flashcard
per word (term, pinyin, English meaning, register). No questions are imported, and
no example sentences are invented. Idempotent by track slug: a track that already
exists is reported and left completely untouched, so re-running is safe.

#### The HSK 5 syllabus structure

```bash
npm run import:hsk-syllabus
```

A second one-off tool that adds the study structure of the examination to the HSK
track `import:real` created, so a generated drill can target a grammar point or a
theme rather than only "HSK 5 vocabulary". It reads three more files from
`external/sources/` — `hsk3-level5-syllabus.txt` (the syllabus as text extracted
from your own PDF), `HSK_3_LEVEL_5_GRAMMAR.json` (its grammar appendix), and
`HSK_3_LEVEL_5_TOPICS.txt` (your own notes on the band's topic areas and language
tasks). As with `import:real`, `external/` is gitignored, the files are read at run
time, absence is reported with the paths to fill in, and no parser contains any of
their content. The script prints counts, never content.

It creates six root objectives on the track: the examination's three skills with
their parts beneath them, the grammar appendix's categories with each point
beneath its category, and the two roots from your notes. **Provenance is recorded
per root.** The syllabus and grammar roots are marked as coming from the official
syllabus; the topics and language-task roots are marked **AI-proposed** and carry
"(unofficial)" in their own titles, because those notes came from a chatbot's
description of the examination and not from the examining body. Nothing imported
by either script is labelled real exam material.

Idempotent per root: a root already on the track is reported as already present
and neither it nor its children are written, so re-running is safe. The vocabulary
root and the imported cards are never touched. It is a separate script from
`import:real` for exactly that reason — `import:real` protects the bank by leaving
an existing track completely alone, and this one only ever adds objectives to a
track that is already there.

## AI generation

Generation is configured with environment variables. **None of them is a
secret**, and StudyBench never reads, stores, logs, or renders an AWS credential:
the Bedrock client resolves credentials through the AWS default provider chain
(your shared profile, environment variables, or a task role).

| Variable                      | Default                                        | Purpose                                         |
| ----------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| `LANGUAGE_MODEL_PROVIDER`     | `fake`                                         | `fake` or `bedrock`                             |
| `BEDROCK_MODEL_ID`            | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | The model every purpose calls unless overridden |
| `BEDROCK_GENERATION_MODEL_ID` | `BEDROCK_MODEL_ID`                             | The model that **writes** content               |
| `BEDROCK_REVIEW_MODEL_ID`     | `BEDROCK_MODEL_ID`                             | The model that **judges** content               |
| `AWS_REGION`                  | resolved by the AWS SDK                        | Passed to the Bedrock client when set           |

**Fake by default, on purpose.** A fresh clone runs the entire generation flow —
the form, the run record, the drafts, the review screen, the failure paths — with
no AWS account and no spend, because the default provider is a deterministic fake
model. Its output is obviously placeholder text. Nothing about the fake path is a
stub: the same facade, validation, checks, and persistence run.

To use a real model:

```bash
LANGUAGE_MODEL_PROVIDER=bedrock AWS_PROFILE=your-profile npm run dev
```

Your account needs `bedrock:Converse` access to every configured model in the
configured region. **This spends money** — a batch of a few items is a few
thousand tokens, and the form shows which model it will call before you submit.

`APP_ENV=production` with anything other than `LANGUAGE_MODEL_PROVIDER=bedrock`
**fails loudly** at composition, naming the variable to fix: a production
deployment quietly filling your bank with placeholder items would be worse than
refusing to serve. The guard is on the **provider**, not on any model id: an
unconfigured model id falls back, and no combination of these variables can leave a
purpose with no model.

Environment files are ignored by git (`.env`, `.env*.local`), so local settings
are never committed.

### One model, or one per purpose

The two purpose-specific variables are optional, and the precedence is the same for
each: **the purpose-specific variable, then `BEDROCK_MODEL_ID`, then the built-in
default.** So setting nothing gives you one sensible model everywhere, setting
`BEDROCK_MODEL_ID` moves everything at once, and setting a purpose-specific variable
moves only that purpose.

- `BEDROCK_GENERATION_MODEL_ID` — writing questions and flashcards, enriching
  vocabulary, importing an objective outline from a syllabus.
- `BEDROCK_REVIEW_MODEL_ID` — reviewing one question
  (`/study-tracks/[slug]/questions/[id]`).

Splitting them is worth it when writing and judging want different trade-offs. A
review is one short call whose entire value is scrutiny, so it can be worth a
stronger — more expensive — model than the one that writes batches of ten. The
opposite is just as reasonable: if you want to sweep a large bank for obviously
broken items, point the review at a cheaper, faster model and keep the good one for
the content you will actually study.

Each generation run records the model it actually called, so a run history with both
variables set shows which model produced or judged each item. Splitting the models
is a configuration change only — nothing in the bank, the prompts, or the run schema
changes with it.

```bash
LANGUAGE_MODEL_PROVIDER=bedrock \
BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-5-20250929-v1:0 \
BEDROCK_REVIEW_MODEL_ID=us.anthropic.claude-opus-4-1-20250805-v1:0 \
AWS_PROFILE=your-profile npm run dev
```

An unavailable review model fails the review call, not the whole application.

### Enriching vocabulary

The enrichment flow at `/study-tracks/[slug]/enrich` uses the same provider setting,
the same run record, and the same review screen as generation, so it is free on the
fake provider too. Two things differ and are worth knowing before pointing it at
Bedrock:

- **It writes to existing cards, not drafts.** There is nothing to accept
  afterwards: a successful card gets a new revision and its earlier revisions stay
  readable. A card is never replaced, and a rejected card is not written at all.
- **A run is larger than a generation batch.** Up to 20 cards at once, which is
  roughly 10k tokens per run on Sonnet, against a few thousand for a batch of
  questions. The form states the model and the number of cards before you submit,
  and the run's review screen reports the tokens the provider actually charged.

The cards are chosen for you: the next active vocabulary cards that still have only
a gloss, in a deterministic order. Run it repeatedly to walk the list. When every
card already has its detail, the page says so and makes no model call.

### Importing objectives from a syllabus

"Import objectives" on a track page, at
`/study-tracks/[slug]/objectives/import`, turns a syllabus into an objective tree
without typing it out. Upload the exam guide as a **PDF**, upload a **plain-text
file**, or **paste** the outline; a model reads it and proposes a tree of up to
three levels, with the codes and percentage weightings the document states. Text is
extracted locally with [`unpdf`](https://github.com/unjs/unpdf) — pure JavaScript,
no system PDF tooling to install.

**Nothing is written until you confirm.** Extraction produces a proposal, not
objectives. The confirm page at `/study-tracks/[slug]/objectives/import/[runId]`
shows the whole proposed tree — codes, titles, weights, descriptions, and the node
count — and you choose:

- **Where it came from.** "Official syllabus" or "Unofficial or AI-assisted",
  recorded on every objective the import adds. There is no default, because a model
  reading a PDF is not what makes an outline official.
- **Apply**, which inserts the whole tree in one transaction, appended after your
  existing objectives and in document order, then opens the track. Or **Discard**,
  which writes nothing.

The confirm page has its own URL and survives a refresh: the proposal is stored on
the extraction's run row, so re-reading it costs nothing and you can extract on a
laptop and confirm on a phone. **Applying the same proposal twice is refused** with
a message rather than duplicating the tree, which is what a stale tab would
otherwise do.

**The uploaded file itself is not stored.** It is read once, in the request, and
discarded; only the outline you apply is kept. A source library that keeps
documents arrives in a later milestone. Two limits apply: 10 MB per file, and
120,000 characters of extracted text — a longer document is truncated, and the
confirm page says so and tells you to check for a missing final section.

A PDF that is a scan has no text layer to read, and a table-heavy layout sometimes
extracts badly. Both cases end in a run that proposed nothing, and the answer to
both is to paste the outline as text instead. Like every other AI flow, this one
runs end to end on the default fake provider at no cost; a real extraction of a
full exam guide is roughly 15–20k tokens.

### Reviewing a question with AI

"Review with AI" on any **draft or active** question page asks the configured model
to judge the question the owner already has. It costs roughly 1–2k tokens per
review, runs on the fake provider for free like every other AI flow, and each
request is its own run in the history at `/study-tracks/[slug]/generation-runs`.

What it checks:

- **Whether the marked answer is actually correct**, judged against the model's own
  knowledge of the subject.
- **Whether more than one answer is defensible** — the ambiguity case, which is
  still a problem when the marked answer is right.
- **Whether the distractors are plausible**, whether the stem is clear, and whether
  the explanation supports the answer it gives.

What it never does:

- **It never rewrites the question.** There is nowhere in the review's shape to put
  replacement text, so a correction can only ever arrive as a finding to read. The
  stem, the choices, the answer key, and the explanation are untouched by a review.
- **It never changes the lifecycle.** A review cannot retire, activate, dispute, or
  delete anything. Where it recommends a dispute, the findings panel offers a button
  that prefills the review's own summary as the reason — and disputing is still your
  click, recorded through the same action as a dispute you typed yourself.
- **It never cites a source**, because it consulted none. The panel says so on every
  review: `AI review used model knowledge only — no sources were consulted.`

The one thing it changes is the **quality state**, and only in one direction: a
question that was `UNREVIEWED` and comes back **Sound** with its answer confirmed
becomes `AI_REVIEWED`. Any other verdict leaves the state exactly as it was, and a
state you reached yourself — approved, disputed, or verified against a source — is
never overwritten by a model. Nothing is ever demoted.

The panel keeps the latest review of a question and marks it as judging an earlier
revision if the question has since been edited. Reviewing is one question at a
time; batch review of a whole bank is future work.

### Asking the tutor about a question

"Ask the tutor" on any question page asks the configured model **one thing** about
the question you already have, and shows the answer under the panel. It costs
roughly 0.5–1.5k tokens per ask, runs on the fake provider for free like every other
AI flow, and each ask is its own run in the history at
`/study-tracks/[slug]/generation-runs` with its own token count.

**It is a menu of asks, not a chat.** There are six buttons and no message box:

- **Explain the answer** — why the marked answer is the answer, and briefly why the
  others are not.
- **Explain it simply** — the same thing for somebody meeting the topic for the first
  time, unfolded rather than compressed.
- **Explain it technically** — the mechanism, the constraints, and where the boundary
  with the neighbouring answer falls.
- **Give an example** — a concrete worked situation, not a restatement of the
  question.
- **Why is this choice wrong?** — pick any choice the question does not mark correct
  and ask about that one specifically.
- **Ask me a follow-up question** — one further question testing the same
  understanding from a different angle, with its answer behind a disclosure.

That shape is deliberate. Each ask is a single structured call, validated and
recorded on its own, so an answer has a recorded model, persona, prompt template
version, token count, and the **exact revision** it was about. A chat transcript
would have one provenance record for many claims, and a thread you are billed for by
accident. The cost of one ask is knowable before you press the button, and asking
twice is two runs rather than a growing context.

What it never does:

- **It never rewrites the question.** There is nowhere in a tutor answer's shape to
  put replacement text — no corrected stem, no replacement choice, no revised answer
  key — so the strongest form of "the tutor cannot silently rewrite a question" is
  that there is no field to hide one in. The stem, choices, answer key, explanation,
  lifecycle, and quality state are all untouched by an ask.
- **It never adds anything to your bank.** A follow-up question it writes is shown
  for you to think about and is **not** inserted as a question: it will never appear
  in a study session. If you want to keep it, write it as your own question.
- **It never cites a source**, because it consulted none. D8's source library does
  not exist yet, so every answer is model knowledge only and the panel says so on
  every exchange. Treat an explanation as a study aid to check, not as a reference.

Unlike a review, an ask is allowed at **any lifecycle** — draft, active, retired, or
archived. Wanting to understand a retired question while reading through the bank is
a legitimate thing to want, and you are the one pressing the button.

The panel shows the five most recent asks about a question, newest first, and marks
an answer as being about an earlier revision if you have edited the question since.
The tutor uses the **review** model (`BEDROCK_REVIEW_MODEL_ID`), because explaining
and judging are the same kind of job — see
[One model, or one per purpose](#one-model-or-one-per-purpose).

**During a session**, the feedback panel after an answer offers "Ask the tutor about
this", which opens that question's page at the tutor panel in a new tab so the
session stays where it is. Tutoring _inline_, without leaving the session, is future
work: a model call between one answer and the next is a second wait competing with
"Next item".

### Grading a written answer with AI

A short-answer question is graded by you: the answer is revealed, you compare it to
what you wrote, and you press "I got it right" or "I got it wrong". After that,
_if_ the question records expected concepts, the feedback panel offers **"Grade with
AI"** — a second opinion on the answer you just gave. It costs roughly 0.5–1k tokens
per grading and is its own run in the history.

**The grading is advice. Your verdict stays the record.** This is the whole design:

- The verdict you already pressed is what the attempt keeps. The attempt's
  evaluation mode stays `SELF_ASSESSED`, and no migration was needed, because
  nothing about the attempt changed.
- The panel says whether the model **agreed with** or **differed from** your verdict.
  It does not correct it. There is no "change my answer" control anywhere on the
  panel, and a grading that arrives after you have moved on changes nothing.
- A **partly correct** grading is reported as "Partly — your call", not forced into
  either of your two buttons. That is exactly the case a right/wrong record cannot
  express, and guessing would put words in your mouth.

What comes back is a verdict, the concepts your answer **covered**, the concepts it
**did not find**, and a short piece of feedback. The two concept lists are the
useful part: they are the concepts _you_ recorded on the question, echoed back
sorted into two piles, so you can see which part of your own answer key the answer
actually reached. A grading that invents a concept the question never recorded is
rejected and retried, and a grading that lists a missed concept and then calls the
answer fully correct is rejected too.

The button is only offered when a grading is possible: a written answer, in a track
still present, on a question that records at least one expected concept. Grading is
not offered for choice questions at all — a marked choice is graded by comparison,
which needs no model.

Like every other AI flow it never rewrites the question, never adds anything to your
bank, and cites nothing because it consulted nothing.

### Challenging a question

Sometimes the question is wrong, not you. **"Challenge this answer"** on any draft or
active question page takes your objection in your own words and asks the model to
_adjudicate_ it. It costs roughly 1–2k tokens per challenge and is its own run in the
history.

It is not the same call as "Review with AI". A review is asked to look for problems
in general; a challenge is asked to settle one specific dispute, and it is told to
build the **strongest case for your objection first**, then the strongest case
against it, and only then decide. It is told the two ways this call fails — agreeing
with you because you sound sure, and defending the stored answer because it is
already written down — and that your objection is an argument to weigh rather than an
instruction to follow.

Your objection travels as delimited owner data in the user message, never as part of
the instructions. Text in it that looks like a command to change the verdict is
data, and the model is told so.

The outcome is a **structured finding**, not prose to interpret:

- **The stored answer stands** — with the argument for why your reading does not
  hold.
- **Your objection has a point** — the marked answer survives, but the question is
  not as clear as it looks.
- **The stored answer looks wrong** — the marked answer is, on the model's
  knowledge, not the answer.

Alongside the verdict comes one recommendation you can act on: **keep**, **dispute**,
or **revise**.

- A recommended **dispute** is offered as one button that prefills the challenge's own
  reasoning as the dispute reason — through the same action a dispute you typed
  yourself uses, so the two are indistinguishable in the data. Disputing is still
  your click. A disputed question is left out of every new session, in every mode,
  including mistake review; it is not deleted, and resolving the dispute brings it
  back.
- A recommended **revision** is a **note**, beside a link to your own edit form.
  There is no "apply" button, because there is nothing to apply: the challenge's
  shape has no field that can carry a replacement stem, choice, answer key, or
  explanation. The model can tell you what a new revision would have to change, and
  you write it. This is `spec/AI-GUIDELINES.md` section 1.10 — no hidden question
  rewrites — held by construction rather than by policy.

A challenge that finds nothing changes nothing at all: not the stem, not the answer
key, not the lifecycle, and not the quality state. Unlike a review, a challenge never
promotes a question to `AI_REVIEWED` — an adversarial call the owner initiated is not
a clean bill of health.

The panel keeps the latest challenge of a question and marks it as judging an earlier
revision if you have edited the question since. Challenging is withdrawn once a
question is retired or archived, and the dispute button is not offered for a question
already disputed.

## Spoken audio

Speech is configured the same way generation is, with its own variables. **None of
them is a secret**; the Polly client resolves credentials through the AWS default
provider chain, and StudyBench never reads, stores, logs, or renders one.

| Variable                | Default                 | Purpose                              |
| ----------------------- | ----------------------- | ------------------------------------ |
| `SPEECH_PROVIDER`       | `fake`                  | `polly` enables audio; `fake` is off |
| `POLLY_VOICE_ID_ZH`     | `Zhiyu`                 | The voice for Mandarin clips         |
| `POLLY_VOICE_ID_EN`     | `Joanna`                | The voice for English clips          |
| `POLLY_ENGINE`          | `neural`                | `neural` or `standard`               |
| `AWS_REGION`            | resolved by the AWS SDK | Passed to the Polly client when set  |
| `STUDYBENCH_AUDIO_ROOT` | `./data`                | Root under which `audio/` is written |

**Off by default, on purpose.** Until `SPEECH_PROVIDER=polly` is set, no study
screen shows an audio control at all, and `/settings/audio` explains what to add
instead of listing voices. The default provider produces a valid MP3 of _silence_,
which is what tests need and exactly what a person does not: a button that accepts
the press, stores a clip, and plays nothing is indistinguishable from a broken
feature. So the feature stays invisible rather than mute.

To use real voices:

```bash
SPEECH_PROVIDER=polly AWS_PROFILE=your-profile npm run dev
```

Your account needs `polly:SynthesizeSpeech` in the configured region.

**One press.** The first press on a clip asks the server for it, waits — the button
shows a spinner — and plays it as soon as it exists; every press after that plays
immediately. There is no separate step to create a clip, and no native transport bar
on a study screen: just a speaker button beside the phrase. If anything fails, the
button says "Audio unavailable" and nothing else; the reason is a server concern.

**What it costs.** Polly bills per character, and neural voices are roughly
$16 per million characters. A vocabulary term is two or three characters, and it is
the only thing a card offers, so a thousand cards is measured in cents; a question
stem is a sentence and costs proportionally more. Every clip is cached by its exact
text, voice, engine, language, and rate, so re-opening a card, revisiting it in
review, or asking again months later costs nothing — the same phrase is synthesized
once and never again. Nothing is ever synthesized in bulk or in the background: one
press of one button is one clip.

Which voice speaks is decided by the content, never by the provider setting: a
card's own content language when it has one, otherwise the track's study type — a
`LANGUAGE_PROFICIENCY` track speaks Mandarin, everything else English. A question
stem is always English.

`APP_ENV=production` with anything other than `SPEECH_PROVIDER=polly` **fails
loudly** at composition, naming the variable to fix, for the same reason the
generation guard does.

### Removing clips

`/settings/audio` is the only place a clip can be removed. It lists every clip with
its voice, language, and size, plays it in a normal player, and "Remove audio"
deletes both the file and its row. Study screens deliberately offer no removal: the
card you are learning from is the worst place to lose a clip to a mis-tap, and
deletion is a management action, not a study one.

Removal is not permanent in the sense you might expect: a clip is keyed by the text
it speaks, not by the card it came from, so pressing play on that card again makes it
again — and pays for it again. That keying is also why editing a card's term does not
invalidate anything: the new term is simply a different key, with no clip yet. The
old clip stays on disk until it is removed here.

## Personas

A persona is the instructions generation writes under: who the model is, what a good
question looks like for the subject, what a good flashcard looks like, what it must
refuse, and which content types and language it defaults to. Two personas are built
into the source — one for technical certifications, one for HSK Chinese — and they are
what a track uses until you choose otherwise.

`/settings/personas` is where you write your own. Start from one of six prepared
starting points — AWS associate level, AWS professional and specialty level, a generic
technical certification, HSK Chinese, JLPT Japanese, and a generic language
examination — and edit the prefilled form. The three list fields (question guidance,
flashcard guidance, prohibitions) are one entry per line. Saving creates version 1;
every later edit saves the next version, so a run recorded against version 2 stays
explicable after version 3 exists.

A persona is **copied** from its starting point, not linked to it: improving a template
in a later release cannot change what your persona generates, and editing your persona
cannot affect anyone's starting point. Each persona also carries a stable key derived
from its name at creation — `jlpt-japanese-proficiency` — which does not move when you
rename it, so future run provenance stays readable.

Each persona has a fixed **archetype**, technical or language, taken from the starting
point and not editable. It decides which tracks may use it — a language persona for a
language-proficiency track, a technical one for a technical certification or a general
track — and which behaviour applies: vocabulary enrichment is meaningful for a language
persona and meaningless for a technical one, and that decision must come from a field
rather than from searching a name for "HSK".

### Choosing a persona

A study track's edit form has a **Persona** select. It offers `Automatic (by study
type)`, which is the default and every existing track's setting, plus your own personas
whose archetype suits that track. Automatic means the built-in persona for the study
type, exactly as before. The select does not appear at all until you have a persona that
suits the track, so nothing on the form changes on a fresh installation.

The generate form and the objective-import form offer the same select, defaulting to the
track's assignment. A choice there applies to **that batch only** and does not change
the track.

Every generation run records the persona that produced it as a key and a version —
`aws-associate-level v3` for one of yours, `technical-certification v1` for a built-in
one — never a database identifier. The run review screen shows the persona's name and
resolves it from either registry; a run whose persona has since been deleted shows the
recorded key instead of inventing a name.

Vocabulary enrichment still uses the built-in HSK persona regardless of the track's
assignment. Its prompt and its matching logic read the HSK persona's vocabulary fields
specifically, so routing it through an owner-written persona is a separate change.

### Exporting and importing a persona

A persona is prose you wrote, and it is useful without any of this application's data —
so it has a file format. **Download JSON** on a persona's row, or on its page, saves it
as `aws-associate-level.persona.json`: one JSON object holding the archetype, the name,
the role, the three guidance lists, the default types, and the language fields.

The file deliberately carries **no identity**: no database id, no persona key, no version,
no timestamps. What is left is exactly the shape a prepared starting point has, which is
why the same file doubles as a **shareable template** — hand it to somebody else, edit it
in a text editor, or keep it as a backup of wording you are about to change.

The **Import a persona** section of `/settings/personas` reads one back. Choose the file
(or drag it onto the box, or paste the JSON when it arrived in a message) and the persona
opens in the ordinary create form, prefilled. **Nothing is written until you save it**, and
that is the point: a file may be a stranger's text, so it is reviewed and editable first.
Saving creates a new persona at version 1 with its own freshly derived key — importing the
same file twice gives you two personas, `aws-associate-level` and `aws-associate-level-2`,
never an overwrite of one a run was recorded against.

Every field is re-validated on the way in, against the same bounds the form applies, and a
failure names the key that caused it — `defaultQuestionTypes: "ESSAY" is not a question
type this version of StudyBench knows` — because a persona file is exactly the kind of
thing you end up editing by hand. A question or card type this release does not recognise
is **refused rather than dropped**, so an import can never quietly produce a persona that
generates the wrong content types. The file's first key is a format version, and a file
from a newer release says so instead of being half-read.

### Deleting a persona

A persona a study track is assigned **cannot be deleted**. The refusal names the tracks
so you know which to change, archived tracks included — restoring one would otherwise
leave it pointing at nothing. Change those tracks back to automatic, or to another
persona, and the deletion succeeds. The database enforces the same rule as a foreign key
with `ON DELETE RESTRICT`, so no code path can bypass it.

Recorded runs are deliberately **not** a reason to refuse. A run stores the persona's key
and version as text rather than a foreign key, so deleting a persona leaves its history
readable.

The list starts empty on a fresh installation: no persona is copied into the database,
and every track begins on automatic.

## Getting around

Every page carries the same header, rendered from the root layout:

| Entry    | Goes to      | Lit up on                                    |
| -------- | ------------ | -------------------------------------------- |
| Tracks   | `/`          | the dashboard and any `/study-tracks/*` page |
| Study    | `/study/new` | any `/study/*` page                          |
| Progress | `/progress`  | `/progress` and any `/progress/*` page       |
| Settings | `/settings`  | any `/settings/*` page                       |

The current section is marked with `aria-current="page"` as well as a gold underline, so it
is announced and not signalled by colour alone. Below 40rem the nav wraps onto a second row
rather than folding into a menu — four short labels fit two-per-row at 360px, and a menu
would trade a visible destination for a press and some JavaScript.

Nested pages carry a **breadcrumb trail** under the header (`Tracks / HSK 4 / Question
bank`). This replaced about thirty hand-written "Back to X" links, which between them had
three different labels for the dashboard and no way to reach a grandparent in one press. The
current page is named in the trail but is not a link to itself.

`/settings` is an index over the three settings screens — Appearance, Audio, Personas. It
exists because the header needs one Settings destination and because those screens used to
be reachable only from a row of quiet links on the dashboard.

**Collapsible sections.** Long sections are `<details>`, with the `<h2>` inside the
`<summary>` so the heading stays in the document outline while the whole line becomes the
control. No JavaScript is involved and no state is stored, so every visit starts from the
section's default:

| Section                                | Starts                                          |
| -------------------------------------- | ----------------------------------------------- |
| Each root objective (domain) in a tree | open                                            |
| Bank filters                           | open                                            |
| Attempt / review / revision history    | open at 3 entries or fewer, otherwise collapsed |

A collapsed history shows its size in the summary ("12 attempts"), which answers what most
opens were asking.

## Colours

Four colours, defined as tokens at the top of `src/app/globals.css`:

| Token            | Hex       | Used for                                             |
| ---------------- | --------- | ---------------------------------------------------- |
| `--color-yale`   | `#003566` | links, primary buttons, focus rings, header gradient |
| `--color-oxford` | `#001d3d` | body text, header gradient end, text on gold         |
| `--color-gold`   | `#f0cb46` | active nav, highlight badges — **fills only**        |
| `--color-satin`  | `#cca000` | borders and hover states on gold elements            |

The rule that shapes all of it: **gold is never text on a light background.** `#f0cb46` on
white is about 1.8:1, which fails WCAG AA for any text at any size. Gold is a fill with dark
text on it, and `#001d3d` on `#f0cb46` is about 11.4:1. Satin sheen gold is about 2.6:1 on
white, which clears the 3:1 line for non-text elements like borders but not for text either.

Contrast for the pairs that matter:

| Pair                               | Ratio   | AA                            |
| ---------------------------------- | ------- | ----------------------------- |
| `--color-oxford` on white          | ~16.6:1 | passes (AAA)                  |
| `--color-yale` on white            | ~12.0:1 | passes (AAA)                  |
| `--color-text-muted` on white      | ~7.0:1  | passes (AAA)                  |
| white on `--color-yale`            | ~12.0:1 | passes                        |
| `--color-oxford` on `--color-gold` | ~11.4:1 | passes                        |
| `--color-gold` on white (text)     | ~1.8:1  | **fails — not used for text** |

`--color-correct` and `--color-incorrect` stay green and red, and `--color-error` stays red.
Those carry meaning rather than brand, and repainting them in the palette would say a wrong
answer was a decorative event. Every state that uses them also states itself in words.

Focus rings are Yale blue everywhere except inside the header, where navy on navy would be
invisible; there they are gold.

## Text size

StudyBench renders at a root font size you choose, anywhere from **12px to 24px**, default
**16px**. There are two ways to set it:

- The **Aa stepper in the header**, on every page. Minus and plus move one pixel at a time
  and show the current value. Use this one — you can watch the text you are actually
  reading resize under the control.
- **`/settings/appearance`**, which offers the same range as a number field with the same
  steppers, for typing a value directly.

One pixel per press rather than three named presets, because the right size depends on your
screen, your distance from it, and your eyes, and none of those come in three varieties. The
stepper applies the change optimistically — the page resizes on the press, and the cookie is
written behind it — so holding down plus is a smooth ramp rather than a series of round
trips.

Only the root font size changes, because nothing else needs to: every size, space, and
measure in the stylesheet is expressed in `rem`, `em`, or `ch`, so they all scale from
there together. The line-length limit stays `62ch` at every size — `ch` is the width of a
character in the current font, so a line stays the same number of characters rather than
growing into an unreadably wide one.

The size is applied as an inline `style` on `<html>`, which is the one place a value from a
cookie is written straight into markup. That is safe because of where it comes from:
`toTextSize` is a total function that returns an integer in 12–24 and nothing else, so there
is no input — absent, empty, `"999"`, or `"16px; background: url(...)"` — that reaches the
attribute as anything but a number. The alternative, a `data-` attribute with thirteen CSS
rules behind it, buys nothing over one validated integer.

**Why this is not browser zoom.** Zoom scales the viewport, so as text grows the layout
crosses the mobile breakpoints in the wrong direction — the phone layout appears on a
desktop. Scaling the root font size leaves the viewport alone, so the layout you get is
the layout that was designed for the device you are on.

### Upgrading from the three presets

An earlier version stored one of three words. Those are migrated on read, so an existing
cookie keeps rendering at the size it always did:

| Old value     | Now  |
| ------------- | ---- |
| `compact`     | 16px |
| `comfortable` | 18px |
| `large`       | 20px |

Anything else — absent, empty, out of range, or hand-edited — renders at the 16px default.

### Where it is stored

In a cookie, `studybench_text_size` — not in the database, and no migration ships with
it:

- The root layout needs the value on **every** request, before any markup is produced. A
  database read on the critical path of every page to fetch one word would cost
  something and show nothing; the request already carries the value.
- Applying it on the server is what avoids a **flash of the wrong size**. A preference
  read in the browser is applied after the document has painted, so every navigation
  would visibly jump from one size to another.
- `SPEC.md`'s logical model has an `app_settings` table. It does not exist yet, and this
  feature deliberately does not create it: a browser-sized display preference is not the
  preference that justifies a schema change. It stays uncreated until something arrives
  that genuinely belongs to your study data.

The cookie is `SameSite=Lax`, path `/`, and lasts a year. It is **not** `httpOnly`,
which is a deliberate non-decision rather than an oversight: the value is a number
between 12 and 24 and is visible in the rendered `style` attribute anyway, so there is no
secret for `httpOnly` to protect. `Secure` is set only in production, because a `Secure`
cookie is dropped over plain HTTP and the setting would appear not to save on
`http://localhost`.

Whatever the cookie holds is validated on every read. Out-of-range values are **refused**
rather than clamped — `"999"` becomes the 16px default, not 24px — because the application
never wrote it, so it is corruption rather than an intention to be honoured. Clamping is
only for the steppers, where 24 and plus means "stay at 24".

Because the preference lives in the browser, another browser or another device keeps its
own choice. That is the trade for having it available before the first byte of HTML.

## Live provider tests

`npm test` never calls AWS. The tests that do are excluded twice over: they live
outside `src/`, which the default Vitest configuration does not scan, and every
case skips unless `STUDYBENCH_LIVE_AI_TESTS=1` is set.

```bash
STUDYBENCH_LIVE_AI_TESTS=1 LANGUAGE_MODEL_PROVIDER=bedrock npm run test:live
STUDYBENCH_LIVE_AI_TESTS=1 SPEECH_PROVIDER=polly npm run test:live
```

They generate one question and synthesize one short phrase. They are smoke tests,
not milestone gates, and they cost whatever one small request costs.

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

- `http://localhost:3000` — dashboard listing the seeded `Demo` tracks; both
  tracks already have questions and cards, and "Start 10-minute session" has
  content to offer
- The header is on every page: press each of Tracks, Study, Progress and Settings, and
  each time exactly one entry is underlined in gold — opening a track underlines Tracks,
  not Study
- Tab into the header — the focus ring is gold and visible against the navy, and the nav
  links are reachable in order
- Press the header's `Aa` plus button a few times — the page grows a pixel per press and
  the value beside it keeps up; reload and the size is still there; go to another page and
  it is still there
- Press minus down to 12 and plus up to 24 — the buttons disable at each end rather than
  accepting a press that does nothing
- `/settings/appearance` shows the same size the header does; type `19`, save, and the
  header agrees
- Open a question you have answered several times — Attempt history is collapsed with a
  count in its summary; a question answered once has it open
- Press Tab to the "Revision history" summary and press Enter — it opens; the heading is
  still a heading either way
- Collapse a root objective on a track's tree — its children fold away and the summary
  reports how many were nested
- Narrow the window to 360px — the nav wraps to two rows, every header control is still
  reachable, and question text does not touch the screen edges
- Run `npm run seed` a second time — every bank reports "already present, left
  unchanged" and nothing is duplicated
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
- Open `http://localhost:3000/progress` — one summary line and one compact card
  per track, with no pass probability anywhere
- Click a track's name on that page: its own progress page opens with the domains
  listed as rows; press a domain to reveal the objectives under it. Recent
  mistakes, calibration, and session history start folded
- After a wrong answer, "Mistake review" becomes available on `/study/new`
- On the AWS demo track, choose "Generate with AI", ask for 3 questions, and wait:
  the run review screen opens naming the model, the persona and version, the
  prompt template and version, and the token usage
- Ask for exactly the same batch again — a notice links the earlier run and offers
  "generate anyway"
- Reject one draft (it disappears), open another and activate it (the review
  screen now says it is no longer a draft and offers no reject), and edit a third
  (the review screen says it changed since generation and shows your version)
- On the HSK demo track, generate flashcards — the cards are in simplified
  Chinese with pinyin, marked `AI generated — model knowledge`, and are drafts
- The HSK demo track (a language track) leads with "Build study material" offering
  both "Enrich vocabulary with AI" and "Generate drills"; the AWS demo track keeps
  a single "Generate with AI"
- Archive the HSK demo track — neither action is offered while it is archived

The AI tutor, on the fake provider (so no AWS account and no spend):

- Open an AWS demo question and scroll to "Ask the tutor" — six asks as buttons, and
  no message box anywhere
- Press "Explain the answer" — the button says "Asking…" while the others stay
  pressable, then an answer appears under "What the tutor said", labelled with the ask
  and badged `Model knowledge only`
- Press "Ask me a follow-up question" — a further question appears with its answer
  behind "Show the answer", and the line under it says it was not added to your
  question bank; confirm the bank list has not grown
- Pick a wrong choice from "Why is one of the other choices wrong?" and ask — only
  the choices the question does not mark correct are offered
- Confirm the question itself is untouched: same stem, same choices, same answer,
  same lifecycle, same review state, still revision 1
- Open `/study-tracks/[slug]/generation-runs` — each ask is its own row labelled
  `AI tutor answer` / `Explained from model knowledge`, with its token count, and its
  link lands back on the tutor panel
- Edit the question, then reload it — every earlier answer now says it is about an
  earlier revision
- Answer a question in a session — the feedback panel offers "Ask the tutor about
  this", which opens the question at the tutor panel in a new tab and leaves the
  session where it was
- Retire the question and ask again — the tutor still answers, unlike "Review with
  AI", which is withdrawn

Audio, with no provider configured (the default, so no AWS account and no spend):

- Open the vocabulary card you wrote on the HSK track — there is no "Listen" section
  and no play button anywhere
- Open `/settings/audio` — it says audio is not configured and names
  `SPEECH_PROVIDER=polly` as what to add

Audio, with `SPEECH_PROVIDER=polly AWS_PROFILE=your-profile npm run dev` (this
spends money, a fraction of a cent per clip):

- Open the same card — a "Listen" section shows the term with a small speaker button
  beside it, and exactly one button: nothing offers to speak the example sentence, the
  pinyin, or the meaning
- Press it: a spinner briefly, then you hear the word in Mandarin; the button becomes
  a pause control while it plays
- Press it again — it plays immediately, and `/settings/audio` still shows one clip
- Reload the page and press it — still one clip, so the second press cost nothing
- Open the card in "Review 1 due" — no audio is offered until "Show answer", then
  the same button appears
- Open a basic or cloze card — there is no "Listen" section at all
- Open an active question — "Read aloud" offers the stem and nothing else; press it
  and you hear it in English
- Confirm no card, review, or session screen offers to remove a clip
- Open `/settings/audio` — every clip with its voice, language, size, and the total;
  "Remove audio" removes one and the count drops
- Go back to the card and press play again — it is made again, which is what
  content-keyed caching means
- At a 360px viewport width, every control is reachable and nothing overflows

With your own material imported (`npm run import:real`, then
`npm run import:hsk-syllabus`, then `npm run dev`):

- Run `npm run import:hsk-syllabus` a second time — every root reports "already on
  the track, left unchanged" and no objective is duplicated
- Open the imported HSK track — the objective tree holds the exam skills, the
  grammar categories with their points, and the two roots titled "(unofficial)"
- Choose "Enrich vocabulary with AI" — the page states how many cards still have
  only a gloss; ask for a few and wait, then open an enriched card: it is at
  revision 2, still active and still manual, the meaning you imported is unchanged,
  and the added senses, synonyms, examples with readings, and usage note are there
- Open revision 1 of that card — it still reads as imported, with no added detail
- Enrich again immediately — different cards are chosen, not the same ones
- Choose "Generate drills", target one grammar point, and ask for a few questions:
  the drafts test the pattern with gap-fills and a "which sentence uses it
  correctly" item, rather than asking what the pattern means
- Target one "(unofficial)" topic instead — the drafts are set in that theme and
  still test language, and every draft is marked `AI generated — model knowledge`
  Personas (no AWS account, no spend — managing a persona calls no model):

- Open `/settings/personas` from Settings in the header — the list is empty, it says where a
  persona is assigned and what automatic means, and six starting points are offered
- Choose "JLPT Japanese proficiency" — the form is prefilled with kana, kanji, and
  JLPT-level guidance, one guideline per line, and mentions no pinyin anywhere
- Save it — it appears in the list as version 1, archetype Language, with the key
  `jlpt-japanese-proficiency`
- Open it, change its name and a guidance line, and save — it is version 2, the key is
  unchanged, and the edited line is there when you reopen it
- Clear the guidance box entirely and save — the form refuses with a message beside
  the field, and nothing is written
- Choose "Download JSON" on its row — the browser saves
  `jlpt-japanese-proficiency.persona.json`; open it and there is no id, key, version, or
  date in it, only the wording
- Delete it — the list is empty again
- Import the file you just downloaded — the create form opens prefilled with the same
  wording, says nothing has been saved yet, and saving puts it back in the list at
  version 1
- Import the same file again — a second persona appears, keyed
  `jlpt-japanese-proficiency-2`, and the first is untouched
- Edit the file's `defaultCardTypes` to `["FLIPBOOK"]` and import it — the refusal names
  `defaultCardTypes` and `FLIPBOOK`, and no form opens
- Change its `studybench_persona` to `2` and import it — the refusal says the file is from
  a newer release
- Import any other file renamed to `.json` — the message beside the file input says it is
  not readable JSON
- `http://localhost:3000/settings/personas/new?template=nope` — not-found page
- `http://localhost:3000/settings/personas/nope/export` — 404 with an empty body

Assigning a persona to a track (still no spend — the default provider is the fake one):

- Create a persona from "AWS associate level", then open a technical track's edit form —
  a **Persona** select is there, set to `Automatic (by study type)`, and your persona is
  the only other option
- Open a language track's edit form — the select is not there at all, because no persona
  you have suits it
- Assign the persona to the technical track and save — reopen the form and it is still
  selected
- Generate a small batch on that track — the form's own Persona select defaults to the
  assignment, and the run review names your persona and its version rather than
  "Technical certification"
- Leave the track assigned but choose `Automatic` on the generate form — that run records
  `technical-certification v1`, and the track's own assignment is unchanged
- Go back to `/settings/personas` and delete the assigned persona — it refuses, naming
  the track
- Set that track back to `Automatic`, then delete the persona — it succeeds, and the
  earlier run still opens and shows the recorded key `aws-associate-level`
- Archive a track that has a persona assigned and try to delete that persona — still
  refused, and the message names the archived track
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
│   ├── hash.ts                       SHA-256, for request fingerprints
│   ├── storage/                      object-storage port and its local
│   │                                 filesystem adapter
│   └── database/                     connection, config, migrations, runner,
│                                     shared connection composition
├── seed/                             demo bank content and its wiring
├── import/                           parsers for your own study documents,
│                                     and the importer's wiring
└── modules/
    ├── certifications/               study tracks and objectives
    ├── question-bank/                questions and their revisions
    ├── flashcards/                   cards, revisions, review scheduling
    ├── study-sessions/               sessions, attempts, progress measures
    ├── ai-generation/                personas, prompt templates, model gateway,
    │                                 generation runs
    └── audio/                        speech requests, voice selection, media
                                      assets, the speech gateway
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

All six modules share one database connection and one transaction runner from
`platform/database/composition.ts`, so migrations run once and writes serialise
across modules.

The module dependency direction is
`certifications ← question-bank ← flashcards ← {ai-generation, audio}`. Generation
reads and writes both banks; audio reads card and question content, passed in by the
page, and writes only its own table. No bank, and neither the study-sessions module
nor generation, knows that either exists. Those directions are asserted by source
scans in `modules/ai-generation/module-boundaries.test.ts` and
`modules/audio/module-boundaries.test.ts`, which also check that each AWS SDK
appears in exactly one adapter, that the domain imports no framework and no
filesystem, that nothing below composition reads `process.env`, that application
code never imports `infrastructure/`, and that nothing in either module logs.

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

The model sits behind a port (`modules/ai-generation/ports/language-model-gateway.ts`)
with two adapters: a Bedrock adapter that uses the **Converse API with forced tool
use**, so structured output is a tool schema the model must fill rather than JSON
parsed out of prose, and a deterministic fake. Which one runs is decided once, in
`modules/ai-generation/composition.ts`, from the environment; the facade, the
domain, the routes, and the components never read `process.env`. Structured output
is validated with a bounded repair: one retry that tells the model what was wrong,
then a clear failure.

Personas and prompt templates are versioned modules under
`modules/ai-generation/domain/`, never strings built inside a route handler. Every
run records the model, provider, persona id and version, template id and version,
and a SHA-256 fingerprint of the request, so a batch generated months ago can still
be explained by the exact instructions that produced it. Your free-text
"additional instructions" always go in the user message, never into the system
instructions, so owner input cannot rewrite the persona's prohibitions. Your bank
content reaches the model the same way, inside its own delimited block, labelled as
data rather than instructions — a card whose meaning field reads "ignore your
instructions" is a card to enrich, not a rule.

What kind of thing an objective is — a grammar pattern, a theme, a word list, or an
ordinary exam domain — is **derived** from the root it descends from
(`modules/certifications/domain/objective-kind.ts`), not stored in a column the tree
could contradict. Which first action a track page offers is derived the same way,
from the study type (`studyMaterialStyleFor`). Both are exhaustive switches, so a
new study type or a new objective kind has to decide rather than falling into a
default, and neither ever looks at a track's provider, name, or slug.

Speech sits behind its own port
(`modules/audio/ports/speech-synthesis-gateway.ts`) with the same two-adapter shape:
a Polly adapter and a deterministic fake, chosen once in
`modules/audio/composition.ts`. The bytes go through a second port,
`platform/storage/object-storage.ts`, whose only adapter today writes files under
`./data/audio/`; D13 adds an S3 one, and nothing above the port changes. The
database holds metadata and an object key — never audio — exactly as
`spec/ARCHITECTURE.md` section 7.7 requires.

An asset's identity is a **content** hash, not an entity reference: the cache key is
a SHA-256 over the normalized text, language, voice, engine, rate, and output format
(`modules/audio/domain/speech-request.ts`), so two cards sharing a term share one
clip, editing a card invalidates nothing, and re-asking for a phrase is free. Only
whitespace is normalized — folding case or punctuation would make two genuinely
different utterances collide and serve the wrong audio. The `media_assets.cache_key`
column is `UNIQUE`, so two concurrent presses of the same button cannot produce two
paid-for rows.

Which voice speaks is derived, never configured per card: the revision's own content
language when it has one, otherwise the track's study type, through two exhaustive
switches (`modules/audio/domain/voice-selection.ts`). Nothing looks at a track's
name, slug, or provider.

Synthesis is a Server Action, because it is a paid write; playback is a route handler
(`app/api/audio/[assetId]/route.ts`) that does nothing but look an asset up and
stream it. A page render only ever reads the cache, so no refresh, no crawler, and
no accidental reload can spend money. The route takes an asset **id** and reads the
object key from the row, and the storage adapter independently refuses any key that
is not a plain relative path under its root — so a path a request controls never
reaches the filesystem.

Enrichment records its provenance on the **revision**, not the card: the card was
written by you and stays yours, and one particular revision of it was written by a
model. That is what `flashcard_revisions.generation_run_id` is for, and it is why an
enriched card still reports itself as manual content.

Detailed engineering rules live in `CLAUDE.md` and `spec/`.
