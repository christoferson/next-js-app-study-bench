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
- Content is written by a **persona** chosen from the track's study type: a
  technical-certification persona writes applied scenario questions in English, an
  HSK persona writes word- and sentence-level material in simplified Chinese with
  pinyin. The two produce structurally different prompts, not reworded copies.
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

Work on the owner's own imported HSK track, authorized separately from the
milestone plan. It adds no new dependency and no new milestone scope; `PROGRESS.md`
still records D6 as the last completed milestone.

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
enrichment — appends a revision and never rewrites one. There is no AI tutor, no
explanation-on-demand, and no source import, grounded generation, or printable
artifacts yet — those arrive in later milestones.

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

Generation is configured with three environment variables. **None of them is a
secret**, and StudyBench never reads, stores, logs, or renders an AWS credential:
the Bedrock client resolves credentials through the AWS default provider chain
(your shared profile, environment variables, or a task role).

| Variable                  | Default                                        | Purpose                                        |
| ------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| `LANGUAGE_MODEL_PROVIDER` | `fake`                                         | `fake` or `bedrock`                            |
| `BEDROCK_MODEL_ID`        | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | The Bedrock model or inference profile to call |
| `AWS_REGION`              | resolved by the AWS SDK                        | Passed to the Bedrock client when set          |

**Fake by default, on purpose.** A fresh clone runs the entire generation flow —
the form, the run record, the drafts, the review screen, the failure paths — with
no AWS account and no spend, because the default provider is a deterministic fake
model. Its output is obviously placeholder text. Nothing about the fake path is a
stub: the same facade, validation, checks, and persistence run.

To use a real model:

```bash
LANGUAGE_MODEL_PROVIDER=bedrock AWS_PROFILE=your-profile npm run dev
```

Your account needs `bedrock:Converse` access to the configured model in the
configured region. **This spends money** — a batch of a few items is a few
thousand tokens, and the form shows which model it will call before you submit.

`APP_ENV=production` with anything other than `LANGUAGE_MODEL_PROVIDER=bedrock`
**fails loudly** at composition, naming the variable to fix: a production
deployment quietly filling your bank with placeholder items would be worse than
refusing to serve.

Environment files are ignored by git (`.env`, `.env*.local`), so local settings
are never committed.

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
- Open `http://localhost:3000/progress` — counted accuracy, objective coverage,
  confidence calibration, recent mistakes, and recent sessions, with no pass
  probability anywhere
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
