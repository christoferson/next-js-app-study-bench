# SPEC.md — StudyBench: Personal AI-Assisted Study Workbench

## 0. Claude Implementation Contract

This specification is intended to be executed incrementally by Claude Code or another coding agent.

Repository:

next-js-app-study-bench

Product name:

StudyBench

Tagline:

Build your study bank. Learn anywhere.

Product type:

Single-user personal study application

Initial pilot:

AWS Certified Generative AI Developer - Professional (AIP-C01)

The initial AWS pilot name and exam code are based on the current official AWS exam guide.

Secondary architecture-validation track:

HSK Chinese language study

### 0.1 Mandatory incremental workflow

Do not attempt to build the entire product in one pass.

The project is divided into milestones. Only implement the currently authorized milestone.

CURRENT AUTHORIZED MILESTONE: D1

For the initial implementation:

    Build Milestone D1 only.
    Do not begin D2 or any later milestone.
    Do not partially implement future features.
    Do not add placeholder implementations for:
        SQLite
        PostgreSQL
        certifications
        objective editing
        question banks
        flashcards
        study sessions
        AI generation
        Amazon Bedrock
        source ingestion
        Amazon Polly
        Amazon Transcribe
        S3
        authentication
        offline synchronization
        ECS deployment
    Do not install SDKs or dependencies that are not used by D1.
    Do not create empty directories for future modules.
    Do not add disabled buttons, dead navigation links, or controls for unimplemented features.
    Clean architectural boundaries are required where they protect current requirements, but speculative abstractions are prohibited.
    Prefer a small, complete, testable vertical slice over a broad, incomplete implementation.
    Keep the application runnable after every milestone.
    Every milestone must have a visible or otherwise directly verifiable outcome.
    Every milestone must preserve all functionality completed in earlier milestones unless a change has been explicitly authorized.
    Do not silently rewrite this specification.
    If an implementation requirement is ambiguous, stop and report the ambiguity instead of making a large speculative decision.

The user authorizes the next milestone with an explicit instruction such as:

Continue with D2.

General feedback, bug reports, design discussion, or questions do not authorize the next milestone.

After completing an authorized milestone, stop and report:

    Summary of what was built.
    Files added, changed, or removed.
    Architectural decisions made.
    Deviations from reference approaches in this specification.
    Commands run.
    Test, lint, type-check, and build results.
    Manual verification steps.
    Known limitations.
    Questions or decisions required before the next milestone.
    The exact next milestone proposed.

### 0.2 Progress tracking

Create and maintain:

PROGRESS.md

Initial structure:

```markdown
# StudyBench Progress

## Current milestone

D1 — Foundation and Demo Study Catalog

## Status

Authorized, not started.

## Completed milestones

- None

## In progress

- D1 — Foundation and Demo Study Catalog

## Planned milestones

- D2 — Local Persistence and Certification Management
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
- Architecture examples in `SPEC.md` are reference approaches unless explicitly marked mandatory.
```

At the end of each completed milestone:

    Update the current milestone.
    Update its status.
    Add it to completed milestones.
    Record material architectural decisions.
    Record approved deviations.
    Record known limitations that have been intentionally deferred.
    Do not mark a milestone complete if its acceptance criteria have not passed.

### 0.3 Specification authority

The terms MUST, MUST NOT, REQUIRED, and PROHIBITED define mandatory behavior.

The terms SHOULD, PREFERRED, and REFERENCE APPROACH describe the expected approach but can be changed when:

    There is a clear technical reason.
    The deviation preserves the product requirements.
    The deviation is reported before or immediately after implementation.
    The user has not explicitly prohibited the deviation.

When this specification conflicts with a later explicit user instruction, the later instruction takes precedence. Record the decision in PROGRESS.md.

### 0.4 Current platform assumptions

The following assumptions establish the intended platform direction. They do not authorize implementation beyond the current milestone.

    Amazon Bedrock will be accessed through an application-defined model gateway. The Bedrock Converse API provides a normalized conversational interface across supported models. Structured output support depends on the selected API and model, so application-level schema validation remains mandatory even when provider-native structured output is used. (docs.aws.amazon.com, docs.aws.amazon.com, docs.aws.amazon.com)
    Amazon Polly will be used for generated speech, including Mandarin Chinese where configured. Voice and engine selection must remain configurable rather than hard-coded into domain logic. (docs.aws.amazon.com, docs.aws.amazon.com)
    Amazon Transcribe will be used for supported batch or streaming transcription workflows. The initial StudyBench implementation will prefer bounded recorded-audio workflows over real-time streaming. (docs.aws.amazon.com)
    SQLite foreign-key behavior must be explicitly configured rather than relying on a library or build default.
    PostgreSQL may use relational columns for core state and jsonb for certification-specific payloads. PostgreSQL provides both json and jsonb data types.
    The intended production deployment is one Next.js container in an Amazon ECS service. An Application Load Balancer is the reference ingress for HTTP and HTTPS traffic.

## 1. Product Definition

StudyBench is a personal study workbench for preparing for multiple certifications, exams, and structured learning goals in parallel.

It allows the owner to:

    Define multiple study tracks.
    Maintain objective or syllabus hierarchies.
    Create and manage a personal question bank.
    Create and review flashcards.
    Generate questions using AI model knowledge.
    Generate questions from imported sources.
    Edit, approve, dispute, retire, or delete generated questions.
    Complete short mobile-friendly study sessions.
    Study technical certifications and language examinations using different strategies.
    Ask an AI tutor for explanations and follow-up questions.
    Generate printable study material for offline use.
    Generate audio study material.
    Record spoken answers and transcribe them.
    Continue selected study activities without a network connection.

The application is not a commercial learning-management system. It has no subscriptions, billing, organization, marketplace, instructor, or social functionality.

### 1.1 Primary product statement

    StudyBench turns personal knowledge sources and AI-generated content into a maintainable study bank that can be practiced in short sessions, heard as audio, or printed for offline use.

### 1.2 Primary product loop

```
Create a study track
        ↓
Define or import its objectives
        ↓
Add, import, or generate study content
        ↓
Review and activate useful content
        ↓
Complete a short study session
        ↓
Review mistakes and ask follow-up questions
        ↓
Improve, dispute, or retire bank content
        ↓
Generate printable or audio study material
        ↓
Repeat across multiple study tracks
```

### 1.3 Core product identity

StudyBench is primarily:

A personal AI-assisted study workbench

It is not primarily:

A chatbot
A public question marketplace
A fixed AWS course
A fixed HSK course
A commercial exam simulator
A learning-management system

## 2. Product Goals

### G1. Multiple simultaneous study tracks

The owner must be able to maintain and study multiple certifications or subjects in parallel.

Examples:

    AWS Certified Generative AI Developer – Professional
    HSK Chinese
    Another AWS certification
    A project-management certification
    A user-defined technical subject

### G2. Maintainable question bank

Generated and manually created questions must be persisted in an editable question bank.

The owner must be able to:

    Add questions.
    Edit questions.
    Create revisions.
    Activate questions.
    Retire questions.
    Mark questions as disputed.
    Approve questions.
    Delete eligible drafts.
    Generate variants.
    Change objective mappings.
    Change provenance metadata.
    Review historical attempts against the exact revision that was answered.

### G3. Short study sessions

The primary study action must support an approximately 10-minute session suitable for a short break.

The session must:

    Start from pre-generated content.
    Avoid requiring an AI call before the first item is shown.
    Save after every answer.
    Allow early completion.
    Allow interruption and resumption.
    Work on a mobile viewport.
    Mix due review with new or weak content.

### G4. AI-assisted content generation

The application must support AI generation from:

    Raw model knowledge.
    Selected imported sources.
    User-authored notes.
    A hybrid of source material and model knowledge.
    Existing questions as variant seeds.

Raw model knowledge is valid. It must not be presented as source-grounded unless source evidence exists.

### G5. Certification-specific strategies

Technical certifications and language examinations must not use one generic prompt and one generic question format.

The application must support different:

    Question-generation strategies.
    Answer-evaluation strategies.
    Question types.
    Study-session composition rules.
    Audio behavior.
    Explanation styles.
    Printable artifact formats.

### G6. Offline study material

The owner must be able to create study material that does not require the running application.

Initial formats include:

    Print-optimized HTML.
    Browser-generated PDF.
    Markdown.
    JSON backup.
    CSV flashcards where applicable.
    Cached audio files.

### G7. Local-first development and AWS production

Development must begin with a low-friction local setup:

Next.js + SQLite + local filesystem

The intended production setup is:

Next.js on ECS + PostgreSQL + S3 + Bedrock + Polly + Transcribe

### G8. Inspectable provenance

Every generated item must retain enough metadata to understand:

    How it was created.
    Which model created it.
    Which persona and prompt version were used.
    Whether sources were provided.
    Which source snapshots support it.
    Whether it was AI-reviewed.
    Whether the owner approved or disputed it.

## 3. Non-Goals

The following are explicitly out of scope unless this specification is later amended.

### 3.1 Commercial features

Do not implement:

    Payments
    Subscriptions
    Pricing tiers
    Trials
    Billing portals
    Organization accounts
    Team administration
    Course sales
    Affiliate links

### 3.2 Multi-user product features

Do not implement:

    Public registration
    Multiple user profiles
    User invitations
    Role-based application permissions
    Teacher and student roles
    Shared study rooms
    Public profiles

A production deployment may have a single-owner access gate. That is a deployment security feature, not a multi-user product model.

### 3.3 Social and marketplace features

Do not implement:

    Social feeds
    Likes
    Comments
    Public leaderboards
    Public question sharing
    Public question marketplaces
    Study groups
    Friend systems

### 3.4 Unsupported exam-content behavior

Do not:

    Claim AI-generated questions are official exam questions.
    Copy or distribute exam dumps.
    Present generated content as endorsed by a certification provider.
    Scrape authenticated or paywalled question banks.
    Circumvent content protection.
    Reproduce proprietary question sets without authorization.

### 3.5 Premature advanced features

Do not initially implement:

    Pass-probability prediction
    Advanced psychometrics
    Item-response theory
    Proctored exams
    Automated tone-level pronunciation scoring
    Native iOS or Android applications
    Real-time collaborative study
    Video lesson generation
    A vector database
    A separate microservice architecture
    A separate worker deployment
    Automatic open-web research without a selected and approved research provider

## 4. Product Principles

### P1. Bank first, AI second

AI must produce content that becomes part of a maintainable bank.

The default study session must select existing bank items rather than generate disposable content on demand.

### P2. Provenance, not prohibition

Source-grounded questions are valuable, but source grounding is not required for all questions.

The application must distinguish between:

MODEL_KNOWLEDGE
SOURCE_GROUNDED
HYBRID
MANUAL
IMPORTED
VARIANT
WEB_RESEARCH

The existence or absence of a source must be visible and inspectable.

### P3. The owner is the final editor

AI may propose:

    Questions
    Answers
    Distractors
    Explanations
    Flashcards
    Objective maps
    Study notes
    Quality findings

AI must not silently replace owner-approved content.

### P4. Historical integrity

An attempt must continue to reference the exact question revision that was answered.

Editing a question must not rewrite history.

### P5. Fast study startup

Starting a normal study session must not depend on a live LLM request.

AI can be used during a session for:

    Follow-up explanations
    Short-answer evaluation
    Challenges
    Related questions
    Tutoring

### P6. Clear uncertainty

The application must distinguish:

    Unseen content
    Incorrect content
    Uncertain answers
    Disputed questions
    Unverified AI content
    Source-checked content
    Owner-approved content

### P7. Bounded architecture

Use facades, repositories, gateways, and strategies where they create a real boundary.

Do not introduce:

    Generic enterprise framework abstractions
    Empty interfaces with only one speculative use
    Universal repositories
    A service locator
    Unused event buses
    Unused plugin systems

### P8. One deployable application

The baseline product must be deployable as one Next.js application container.

Managed AWS services are external dependencies, not additional StudyBench deployables.

## 5. Users and Usage Context

### 5.1 Owner

StudyBench has one implicit owner.

There is no application-level User aggregate and no requirement to put user_id on every table.

### 5.2 Usage contexts

The owner may use StudyBench:

    On a desktop while organizing content.
    On a phone during a 10-minute break.
    With printed material away from a device.
    With audio while walking or commuting.
    With multiple certifications active at once.
    With no imported exam guide.
    With only raw AI-generated content.
    With only manually authored content.
    With a combination of AI, sources, and manual editing.

### 5.3 Starting knowledge

A diagnostic is optional.

If no diagnostic is completed:

    Do not record an exam score of zero.
    Mark objectives as UNSEEN.
    Treat unseen objectives as eligible for early study.
    Do not claim that the owner has failed those objectives.

## 6. Functional Requirements

### 6.1 Study tracks and certifications

A study track represents a certification, examination, language level, or user-defined subject.

A study track must support:

id
slug
name
provider
examCode
version
studyType
description
targetDate
priority
defaultSessionMinutes
personaId
status
createdAt
updatedAt

Supported initial study types:

TECHNICAL_CERTIFICATION
LANGUAGE_PROFICIENCY
GENERAL

The owner must be able to:

    Create multiple tracks.
    Edit a track.
    Archive a track.
    Restore an archived track.
    Set a target date.
    Set a priority.
    Set the default session length.
    Select a persona.
    View all active tracks on the dashboard.

Permanent deletion must be restricted when dependent study history exists.

### 6.2 Objective hierarchy

A track may have a hierarchical objective map.

Examples:

```
Domain
  → Task
      → Skill

HSK level
  → Topic
      → Vocabulary
      → Grammar point
```

An objective must support:

id
certificationId
parentObjectiveId
code
title
description
weight
sourceType
displayOrder
status
createdAt
updatedAt

Objective source types:

OFFICIAL
OFFICIAL_SYLLABUS
USER_DEFINED
AI_PROPOSED
IMPORTED

The owner must be able to:

    Add root objectives.
    Add child objectives.
    Edit objectives.
    Reorder siblings.
    Move an objective under another objective.
    Archive objectives.
    Restore objectives.
    Identify an objective map as official or unofficial.

AI-proposed objectives must not be labeled official.

### 6.3 Question bank

The question bank is a central product feature.

Initial supported question types:

SINGLE_CHOICE
MULTIPLE_RESPONSE
SHORT_ANSWER

Later supported question types include:

CLOZE
ORDERING
READING_COMPREHENSION
LISTENING_COMPREHENSION
DICTATION
SPOKEN_RESPONSE
VOCABULARY_RECOGNITION
VOCABULARY_RECALL
CHARACTER_RECOGNITION

A question root must contain lifecycle and identity information.

Question content must live in immutable revisions.

A question revision may contain:

stem
instructions
questionType
choices
correctAnswer
explanation
choiceExplanations
difficulty
objectiveIds
tags
language
contentPayload
provenance
sourceEvidence
createdBy
createdAt

The owner must be able to:

    Create a manual question.
    Save a draft.
    Edit a question by creating a revision.
    Preview a question.
    Activate a question.
    Retire a question.
    Restore a retired question.
    Mark a question disputed.
    Resolve a dispute.
    Approve a question.
    Duplicate a question.
    Generate a variant later.
    Remove objective mappings.
    Add objective mappings.
    Filter the bank.
    Search the bank.
    View attempt history.
    View revision history.

#### 6.3.1 Question lifecycle

Lifecycle status:

DRAFT
ACTIVE
RETIRED
ARCHIVED

Quality status:

UNREVIEWED
AI_REVIEWED
SOURCE_CHECKED
USER_APPROVED
DISPUTED
OUTDATED

Generation mode:

MANUAL
MODEL_KNOWLEDGE
SOURCE_GROUNDED
HYBRID
IMPORTED
VARIANT
WEB_RESEARCH

These dimensions must remain separate.

For example:

lifecycleStatus: ACTIVE
qualityStatus: UNREVIEWED
generationMode: MODEL_KNOWLEDGE

#### 6.3.2 Question deletion

Hard deletion is allowed only when the question has no dependent:

    Attempts
    Study-session history
    Printed artifacts
    Question variants
    Review records

Otherwise, the question must be retired or archived.

### 6.4 Flashcards

Flashcards are first-class bank items.

Initial flashcard types:

BASIC
REVERSED
CLOZE
VOCABULARY
SCENARIO

A flashcard may be:

    Created manually.
    Created from a question.
    Generated by AI.
    Imported from a structured file.
    Duplicated as a reverse card.

Example vocabulary card:

```
Front: 学习

Back:
- Pinyin: xuéxí
- Meaning: to study; to learn
- Example: 我每天学习汉语。
```

The owner must be able to:

    Add a flashcard.
    Edit it through revisioning.
    Activate it.
    Retire it.
    Review it.
    Rate recall.
    View its review history.
    Link it to objectives.
    Link it to a source.
    Convert eligible questions into cards.

### 6.5 Flashcard review scheduling

Initial ratings:

AGAIN
HARD
GOOD
EASY

The first deterministic scheduling algorithm is:

New card

```
AGAIN → due in 10 minutes
HARD  → due in 1 day
GOOD  → due in 3 days
EASY  → due in 7 days
```

Existing card

```
AGAIN → due in 10 minutes; increment lapse count
HARD  → max(1 day, current interval × 1.2)
GOOD  → max(3 days, current interval × 2)
EASY  → max(7 days, current interval × 3)
```

The scheduling algorithm must be isolated behind a strategy so it can be replaced later without changing route handlers or persistence interfaces.

### 6.6 Quick study sessions

The primary call to action is:

Start 10-minute session

Available modes:

One study track
Mixed study tracks
Flashcards only
Questions only
Mistake review
Optional diagnostic

A session must be composed deterministically from active bank content.

Suggested priority:

    Overdue flashcards.
    Previous confident-but-incorrect answers.
    Previous incorrect answers.
    Weak or low-accuracy objectives.
    Unseen objectives.
    Never-attempted active questions.
    General retention content.

The session composer must:

    Respect selected study tracks.
    Respect the requested session mode.
    Avoid duplicate items within one session.
    Avoid retired and archived items.
    Exclude disputed questions by default.
    Prefer current revisions.
    Freeze selected revisions when the session is created.
    Estimate duration rather than enforce a hard timer.
    Permit early completion.
    Save after every response.
    Support resumption.

### 6.7 Question attempts

An attempt must record:

id
sessionId
questionId
questionRevisionId
submittedAnswer
isCorrect
confidence
durationSeconds
attemptedAt
evaluationMode
feedbackSnapshot

Confidence values:

GUESS
UNCERTAIN
FAIRLY_SURE
CONFIDENT

The application should distinguish:

Correct + confident
Correct + uncertain
Incorrect + uncertain
Incorrect + confident

An incorrect confident answer should receive higher review priority than an incorrect uncertain answer.

### 6.8 Progress

Initial progress reporting must remain evidence-based.

Supported measures:

    Objective coverage.
    Accuracy by track.
    Accuracy by objective.
    Accuracy by question type.
    Recently missed concepts.
    Due flashcards.
    Unseen objectives.
    Study-session history.
    Confidence calibration.
    Number of active bank items.
    Number of disputed bank items.

Do not initially display a pass probability.

### 6.9 Diagnostics

Diagnostics are optional.

A diagnostic can be offered only when enough active questions exist across relevant objectives.

If skipped:

objective state = UNSEEN

If completed:

    Record normal attempts.
    Mark the session as diagnostic.
    Use results to prioritize study.
    Do not treat one diagnostic as a definitive pass prediction.

### 6.10 AI generation

The owner must be able to request AI-generated:

    Questions.
    Flashcards.
    Explanations.
    Choice explanations.
    Distractors.
    Question variants.
    Objective maps.
    Topic summaries.
    Study notes.
    Follow-up questions.
    Printable content.

Generation input may include:

study track
selected objectives
persona
question types
difficulty
requested count
generation mode
selected source snapshots
existing question
language settings
additional instructions

Generated content must enter the bank as DRAFT by default.

The owner may change this setting later, but automatic activation must not be the initial default.

### 6.11 Raw-model-knowledge generation

Raw model knowledge is a supported first-class mode.

Example:

```
Certification: AWS AIP-C01
Topic: Foundation model evaluation
Mode: MODEL_KNOWLEDGE
Count: 5
Difficulty: Mixed
```

Requirements:

    Sources are not required.
    The UI must identify the item as model-knowledge generated.
    The application must record the model and persona versions.
    The application must not fabricate a source citation.
    The owner may edit and activate the question.
    The owner may later request source-based verification.

### 6.12 Source-grounded generation

The owner may select imported sources and request grounded generation.

The model must receive:

    Selected source excerpts.
    The selected objective.
    The persona.
    The requested question type.
    The requested difficulty.
    Explicit instructions to separate supported claims from general reasoning.

Every source-grounded question must retain links to the exact source snapshot and chunks used during generation.

### 6.13 Hybrid generation

Hybrid generation permits the model to:

    Use source material for the factual basis.
    Use model knowledge for scenarios, teaching structure, or distractor construction.
    Identify the source-supported portion.
    Identify meaningful unsupported assumptions where applicable.

Hybrid output must not be labeled purely source-grounded.

### 6.14 Source library

Supported source inputs will be introduced incrementally.

Planned inputs:

Pasted plain text
Markdown
Text-based PDF
Web page URL
CSV
JSON
Personal notes
Official exam guide
Official documentation page
Vocabulary list
Grammar list

Initial source ingestion does not require OCR.

Scanned PDFs may be rejected with a clear explanation.

A source must have:

id
title
sourceType
authority
originalLocation
certificationIds
retrievedAt
contentHash
status
createdAt
updatedAt

Source authority:

OFFICIAL
TRUSTED_THIRD_PARTY
USER_AUTHORED
GENERAL_WEB
UNKNOWN

A source refresh must create a new immutable snapshot instead of silently replacing the old content.

### 6.15 Internet facts

The initial supported internet-fact workflow is:

```
Owner enters URL
        ↓
Application validates URL
        ↓
Application retrieves content
        ↓
Application saves a source snapshot
        ↓
Owner maps source to objectives
        ↓
AI generates questions from selected source
```

Automatic general web search is deferred until a search or research provider is deliberately selected.

The model must not autonomously retrieve arbitrary URLs.

### 6.16 AI tutor

The tutor must support:

    Explain the correct answer.
    Explain why another option is wrong.
    Explain at a beginner level.
    Explain technically.
    Give an example.
    Ask a follow-up question.
    Grade a short answer.
    Identify missing concepts.
    Challenge the stored answer.
    Suggest that a question is ambiguous.
    Recommend marking a question disputed.
    Convert an explanation into flashcards.

The tutor must not silently modify the question bank.

If it believes the stored answer may be wrong, it must return a structured quality finding.

Example:

```json
{
  "answerStatus": "POSSIBLY_DISPUTED",
  "reason": "Two choices may satisfy the stated requirement.",
  "recommendedAction": "Mark the question disputed and review it.",
  "proposedRevision": null
}
```

### 6.17 Printable study packs

The owner must be able to create print-oriented artifacts.

Pack types:

STUDY_GUIDE
PRACTICE_QUIZ
MISTAKE_REVIEW
FLASHCARD_SHEETS
OBJECTIVE_CHECKLIST
HSK_WRITING_WORKSHEET
LISTENING_EXERCISE

Configurable options:

    Study tracks.
    Objectives.
    Difficulty.
    Number of questions.
    Number of flashcards.
    Include notes.
    Include explanations.
    Include answer key.
    Put answer key on separate pages.
    Include source references.
    Include previous mistakes.
    Include blank note space.

Initial output must use print-optimized HTML.

The browser’s print functionality may be used to create a PDF.

Server-side PDF generation is not required for the initial artifact milestone.

### 6.18 Audio generation

Audio workflows must include:

    Read a flashcard prompt.
    Pause.
    Read the flashcard answer.
    Read technical questions and choices.
    Generate HSK listening-comprehension audio.
    Generate HSK vocabulary audio.
    Generate audio study packs.
    Cache repeated synthesis.

Audio cache identity must include at least:

text
language
voice
engine
speech configuration

Audio settings must not be hard-coded in domain entities.

### 6.19 Speech transcription

The owner may:

    Record a short spoken answer.
    Upload supported audio.
    Submit the audio for transcription.
    View and edit the transcript.
    Ask the tutor to evaluate the transcript.
    Compare an HSK spoken response with an expected meaning.
    Complete dictation exercises.

StudyBench must not claim precise phoneme or tone accuracy based only on transcription.

A transcript mismatch may be presented as a possible pronunciation or recognition issue, not as definitive phonetic scoring.

### 6.20 Offline behavior

Offline functionality applies to previously downloaded or generated content.

The offline application may support:

    Opening the installed app shell.
    Reviewing cached flashcards.
    Completing a downloaded session.
    Playing cached audio.
    Saving attempts in a local outbox.
    Synchronizing attempts when connectivity returns.

Offline mode does not support:

    New Bedrock generation.
    New Polly synthesis.
    New Transcribe jobs.
    New source retrieval.
    Server-only tutor calls.

## 7. Certification and Persona Strategies

### 7.1 Technical certification strategy

The built-in technical certification persona must support:

    Applied scenarios.
    Architecture decisions.
    Troubleshooting.
    Security decisions.
    Operational decisions.
    Cost and efficiency decisions.
    Best-next-action questions.
    Single-choice questions.
    Multiple-response questions.
    Short-answer recall.

Rules:

    Prefer understanding over trivia.
    Use plausible distractors.
    State whether one or multiple answers are expected.
    Explain why each choice is correct or incorrect.
    Avoid claiming that content is official.
    Avoid obscure quotas unless explicitly requested.
    Identify assumptions.
    Map questions to objectives.

The AWS pilot uses this strategy with AWS-specific configuration.

### 7.2 HSK Chinese strategy

The HSK persona must support:

    Hanzi recognition.
    Pinyin recognition.
    Meaning recall.
    Vocabulary recall.
    Grammar selection.
    Cloze questions.
    Sentence ordering.
    Reading comprehension.
    Listening comprehension.
    Dictation.
    Spoken response.
    Character-writing prompts.

Rules:

    Respect the configured level or vocabulary scope where possible.
    Hide pinyin when testing character recognition.
    Hide translation when testing meaning recall.
    Use natural Chinese.
    Show pinyin and translation after the answer when configured.
    Identify tested vocabulary and grammar.
    Avoid treating literal translation as the only valid answer when meaning is preserved.

### 7.3 Strategy interfaces

Reference interfaces:

```typescript
interface QuestionGenerationStrategy {
  generate(
    request: GenerateQuestionsRequest,
  ): Promise<QuestionDraft[]>;
}

interface AnswerEvaluationStrategy {
  evaluate(
    request: EvaluateAnswerRequest,
  ): Promise<AnswerEvaluation>;
}

interface SessionCompositionStrategy {
  compose(
    request: ComposeSessionRequest,
  ): Promise<StudySessionDraft>;
}

interface FlashcardSchedulingStrategy {
  schedule(
    request: ScheduleFlashcardRequest,
  ): ReviewSchedule;
}

interface StudyMaterialStrategy {
  generate(
    request: GenerateStudyMaterialRequest,
  ): Promise<StudyArtifactDraft>;
}

interface AudioLessonStrategy {
  create(
    request: CreateAudioLessonRequest,
  ): Promise<AudioLessonDraft>;
}
```

These are reference shapes. Create each interface only when its authorized milestone requires it.

### 7.4 Persona registry

Certification-specific behavior should be selected through a persona registry.

Reference concept:

```typescript
interface PersonaRegistry {
  get(personaId: PersonaId): StudyPersona;
}
```

Avoid scattered conditions such as:

```typescript
if (certification.provider === "AWS") {
  // ...
}

if (certification.name.includes("HSK")) {
  // ...
}
```

## 8. Architecture

### 8.1 Application form

StudyBench must be a full-stack TypeScript Next.js application.

Mandatory baseline:

Next.js
TypeScript strict mode
App Router
Node.js runtime
Responsive web UI
Route handlers for HTTP endpoints when needed
Server-side application composition

Do not create a separate FastAPI, Express, NestJS, or other backend application.

### 8.2 Layering

Modules may contain:

domain
application
ports
infrastructure
ui

Responsibilities:

Domain

Contains:

    Entities
    Value objects
    Domain rules
    Lifecycle transitions
    Pure algorithms
    Domain errors

Domain code must not import:

    Next.js
    React
    AWS SDKs
    Database drivers
    HTTP libraries

Application

Contains:

    Use cases
    Facades
    Commands
    Queries
    Workflow orchestration
    Transaction boundaries

Ports

Contains:

    Repository interfaces
    External-service gateway interfaces
    Object-storage interfaces
    Clock and ID interfaces where needed

Infrastructure

Contains:

    SQLite repositories
    PostgreSQL repositories
    Bedrock adapters
    Polly adapters
    Transcribe adapters
    Local filesystem storage
    S3 storage
    URL retrieval
    Database migrations

UI

Contains:

    React components
    View models
    Forms
    Presentation formatting

### 8.3 Module creation rule

Do not create a module until its milestone begins.

Do not create the entire final directory structure in D1.

A future reference structure is:

```
src/
├── app/
├── modules/
│   ├── study-tracks/
│   ├── objectives/
│   ├── questions/
│   ├── flashcards/
│   ├── study-sessions/
│   ├── generation/
│   ├── tutoring/
│   ├── sources/
│   ├── artifacts/
│   └── audio/
├── platform/
│   ├── database/
│   ├── aws/
│   └── storage/
└── shared/
```

Only create directories currently containing implemented code.

### 8.4 Facades

Planned focused facades:

CertificationFacade
QuestionBankFacade
FlashcardFacade
StudyFacade
GenerationFacade
TutorFacade
SourceFacade
ArtifactFacade
AudioFacade

A facade may coordinate repositories and gateways.

A facade must not:

    Render React.
    Execute raw SQL.
    Contain AWS SDK initialization.
    Depend on route-handler request objects.
    Become one global application service.

### 8.5 Repositories

Repositories must be domain-specific.

Good:

```typescript
interface QuestionRepository {
  findById(id: QuestionId): Promise<Question | null>;
  save(question: Question): Promise<void>;
  saveRevision(revision: QuestionRevision): Promise<void>;
  search(criteria: QuestionSearchCriteria): Promise<QuestionSearchPage>;
  findStudyCandidates(
    criteria: StudyCandidateCriteria,
  ): Promise<QuestionCandidate[]>;
  retire(id: QuestionId, reason?: string): Promise<void>;
}
```

Prohibited:

```typescript
interface Repository<T> {
  create(value: T): Promise<T>;
  update(value: T): Promise<T>;
  delete(id: string): Promise<void>;
}
```

Also prohibited:

```typescript
findByAnyCombinationOfFields(
  filters: Record<string, unknown>,
): Promise<unknown[]>;
```

Repositories describe application access patterns, not database capabilities.

### 8.6 Gateways

External services must remain behind ports.

Planned gateways:

```typescript
interface LanguageModelGateway {
  generateStructured<T>(
    request: StructuredGenerationRequest<T>,
  ): Promise<StructuredGenerationResult<T>>;

  converse(
    request: ConversationRequest,
  ): Promise<ConversationResult>;
}

interface SpeechSynthesisGateway {
  synthesize(
    request: SpeechSynthesisRequest,
  ): Promise<SynthesizedSpeech>;
}

interface SpeechTranscriptionGateway {
  start(
    request: TranscriptionRequest,
  ): Promise<TranscriptionJob>;

  get(
    id: TranscriptionJobId,
  ): Promise<TranscriptionJob>;
}

interface ObjectStorage {
  put(request: PutObjectRequest): Promise<StoredObject>;
  get(key: string): Promise<ReadableStream>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

interface SourceRetriever {
  retrieve(request: RetrieveSourceRequest): Promise<RetrievedSource>;
}
```

### 8.7 Composition root

Concrete infrastructure implementations must be selected in a server-only composition root.

Route handlers and server components must not instantiate database drivers or AWS SDK clients directly.

### 8.8 Route handlers

Route handlers must:

    Parse the request.
    Validate input.
    Call an application facade.
    Translate known errors.
    Return a response.

Route handlers must not contain:

    Prompt templates.
    Raw SQL.
    Question-selection algorithms.
    Bedrock orchestration.
    Polly orchestration.
    Transcribe orchestration.
    Business lifecycle transitions.

## 9. Persistence and Storage

### 9.1 Local persistence

Beginning in D2:

Database: SQLite
Storage: Local filesystem

Recommended database file:

./data/study-bench.db

Recommended storage root:

./data/objects/

Local data must be excluded from version control.

Suggested .gitignore entries:

```
/data/*.db
/data/*.db-shm
/data/*.db-wal
/data/objects/
/data/uploads/
/data/audio/
/data/artifacts/
```

### 9.2 SQLite configuration

Every application SQLite connection must configure:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

Use strict tables where supported and practical.

SQLite is a local-development and personal-POC database. It is not the production ECS database.

### 9.3 Production persistence

Beginning in D13:

Database: PostgreSQL
Object storage: Amazon S3

The final choice between RDS PostgreSQL and Aurora PostgreSQL is deferred until D13.

Core relational state should use normalized tables.

Certification-specific payloads may use PostgreSQL jsonb.

### 9.4 Provider-specific adapters

Required adapter direction:

SqliteQuestionRepository
PostgresQuestionRepository

SqliteStudySessionRepository
PostgresStudySessionRepository

LocalFileObjectStorage
S3ObjectStorage

Repository behavior must be validated with shared contract tests.

The application must not promise transparent database switching without testing.

### 9.5 IDs and timestamps

Generate IDs in application code.

Reference approach:

crypto.randomUUID()

All domain timestamps must represent UTC.

Repositories may store timestamps using:

    ISO text in SQLite.
    Time-zone-aware timestamp types in PostgreSQL.

The repository must map both to one domain representation.

### 9.6 Transactions

Multi-record operations must use a unit-of-work boundary.

Reference interface:

```typescript
interface UnitOfWork {
  transaction<T>(
    operation: (
      repositories: TransactionRepositories,
    ) => Promise<T>,
  ): Promise<T>;
}
```

Examples requiring transactions:

    Save a question and its first revision.
    Save an attempt and reschedule review.
    Complete a session and update its items.
    Activate a generated question batch.
    Retire a question and update eligible pending selections.

## 10. Logical Data Model

The exact physical schema is milestone-specific. The target logical model includes:

certifications
certification_objectives
personas
questions
question_revisions
question_objective_links
question_source_links
question_attempts
question_disputes
flashcards
flashcard_revisions
flashcard_objective_links
flashcard_reviews
review_schedules
study_sessions
study_session_items
sources
source_snapshots
source_chunks
generation_runs
study_artifacts
artifact_items
media_assets
transcription_jobs
app_settings

### 10.1 Question revision integrity

An attempt must reference:

question_id
question_revision_id

A printed artifact must reference the revisions included when it was created.

### 10.2 Source snapshot integrity

Source content must be immutable at the snapshot level.

Refreshing a URL creates:

```
Source
  ├── Snapshot 1
  ├── Snapshot 2
  └── Snapshot 3
```

A question references one or more specific snapshots and chunks.

### 10.3 Generated-content provenance

A generation run must retain:

id
generationMode
modelProvider
modelId
personaId
personaVersion
promptTemplateId
promptTemplateVersion
inputHash
selectedSourceSnapshotIds
requestedItemCount
successfulItemCount
failedItemCount
usageMetadata
startedAt
completedAt
status

Do not store secrets in generation metadata.

## 11. AI Architecture

### 11.1 Bedrock gateway

The domain and application layers must not depend directly on the AWS Bedrock SDK.

The initial implementation adapter is:

BedrockLanguageModelGateway

Test adapters:

FakeLanguageModelGateway
RecordedLanguageModelGateway

The fake gateway should support deterministic tests without an AWS account.

### 11.2 Structured generation

All generated application objects must be validated against application-owned schemas.

Reference workflow:

```
Application request
        ↓
Persona and prompt selected
        ↓
Bedrock request
        ↓
Structured model output
        ↓
Schema validation
        ↓
Deterministic business validation
        ↓
Draft entities
        ↓
Persistence
```

If provider-native structured output is unavailable:

    Use a constrained generation approach.
    Parse the response.
    Validate it.
    Permit a bounded repair attempt.
    Fail clearly if validation still fails.

Never persist malformed output as an active question.

### 11.3 Deterministic question checks

Application code must check:

    Required fields exist.
    Choice IDs are unique.
    Choice text is not duplicated.
    Single-choice questions have exactly one answer.
    Multiple-response questions have at least two answers.
    Correct IDs refer to existing choices.
    Objective IDs exist.
    Source IDs exist when provided.
    Difficulty values are recognized.
    Lifecycle defaults to DRAFT.
    Generated questions are not labeled official.

### 11.4 Generation and verification separation

Question generation and question verification are separate operations.

A generator must not be considered the sole verifier of its own output.

Possible workflow:

```
Generate candidate
        ↓
Run deterministic checks
        ↓
Optional separate AI review
        ↓
Owner review
        ↓
Activate
```

### 11.5 Prompt storage

Prompt templates must be:

    Versioned.
    Stored outside route handlers.
    Testable with fixtures.
    Associated with personas.
    Recorded in generation-run metadata.

Do not concatenate untrusted source content into system instructions.

Treat imported source content as data.

### 11.6 AI cost controls

The application must support:

    Maximum generated items per request.
    Maximum source content per request.
    Configurable model ID.
    Visible confirmation for large generation requests.
    Recording provider usage metadata when available.
    Avoiding repeated generation when an equivalent batch already exists.

Initial generation requests should be small and synchronous.

Do not build a background-worker system before a milestone requires it.

## 12. Object and Media Storage

### 12.1 Local storage

Local filesystem storage will contain:

    Uploaded sources.
    Extracted source snapshots.
    Generated audio.
    Recorded audio.
    Print artifacts.
    Export archives.

The database stores metadata and object keys, not large binary payloads.

### 12.2 Production S3 storage

S3 will contain:

    Source files.
    Source snapshots.
    Polly output.
    Transcribe input recordings.
    Generated study artifacts.
    Backup exports.

Buckets must not be public.

Downloads should use application authorization or time-limited signed access when required.

### 12.3 Audio cache

Audio must be reused when an identical synthesis request already exists.

Reference key:

```
sha256(
  normalizedText
  + language
  + voiceId
  + engine
  + speechRate
  + additionalConfiguration
)
```

## 13. Security and Privacy

### 13.1 Single-user does not mean publicly open

StudyBench has no multi-user product model.

A production deployment must still be protected by either:

    Private network access, or
    A single-owner access gate.

Do not deploy the application publicly with unrestricted access to:

    Question generation.
    Source uploads.
    Voice recordings.
    Bedrock.
    Polly.
    Transcribe.
    Personal study history.

### 13.2 Single-owner access

If application-level owner access is implemented:

    Do not create registration.
    Do not create a users table.
    Do not create profile management.
    Store credentials or credential hashes through a secret-management mechanism.
    Use secure, HTTP-only cookies.
    Protect state-changing operations.
    Protect all application routes except health and owner-login routes.

### 13.3 AWS credentials

    Do not place AWS credentials in client-side code.
    Use the ECS task role in production.
    Use local AWS credential mechanisms during development.
    Grant only required actions.
    Do not log secrets.
    Do not commit .env files containing credentials.

### 13.4 Source retrieval safety

URL retrieval must:

    Accept only supported HTTP and HTTPS URLs.
    Reject local-file URLs.
    Reject loopback targets.
    Reject private-network targets unless explicitly approved.
    Revalidate redirects.
    Set timeouts.
    Enforce response-size limits.
    Enforce supported content types.
    Sanitize rendered content.

This protects the application from server-side request forgery and accidental retrieval of local services.

### 13.5 Prompt-injection safety

Imported documents and web pages are untrusted content.

They must not be able to:

    Change system instructions.
    Request AWS credentials.
    Request arbitrary tools.
    Cause the model to retrieve additional URLs.
    Activate generated questions automatically.
    Modify stored questions without owner confirmation.

### 13.6 Voice recordings

Voice recordings must:

    Be private.
    Have a visible delete action.
    Have documented retention behavior.
    Not be retained indefinitely by default unless the owner chooses to keep them.

## 14. User Experience Requirements

### 14.1 Mobile-first study

Study screens must work at approximately 360-pixel viewport width.

Requirements:

    No horizontal scrolling for normal question content.
    Large answer targets.
    Clear progress indication.
    Autosave after every answer.
    Resume interrupted sessions.
    Explanation text readable without zooming.
    Audio controls accessible by touch.

### 14.2 Desktop content management

Question, source, and artifact management may use wider desktop layouts.

Question-bank filters may include:

    Study track.
    Objective.
    Question type.
    Difficulty.
    Lifecycle.
    Quality status.
    Generation mode.
    Attempt state.
    Recently generated.
    Frequently missed.
    Missing sources.
    Disputed.
    Outdated.

### 14.3 No misleading claims

Every generated question must be presented as:

Unofficial study content

when provider affiliation might otherwise be inferred.

Source-grounded content may say:

Generated from selected source material

It must not say:

Official exam question

### 14.4 Accessibility

All milestones must preserve basic accessibility:

    Semantic headings.
    Keyboard navigation.
    Visible focus states.
    Form labels.
    Accessible names for icon buttons.
    Sufficient color contrast.
    Error messages associated with inputs.
    Status not communicated by color alone.

## 15. Testing and Quality Requirements

### 15.1 Required commands

The project must provide commands for:

development
lint
type-check
unit tests
integration tests
build

Exact script names should be documented in README.md.

### 15.2 Unit tests

Use unit tests for:

    Domain lifecycle transitions.
    Question validation.
    Flashcard scheduling.
    Session composition.
    Provenance rules.
    Persona selection.
    Progress calculations.
    URL validation helpers.

### 15.3 Repository contract tests

Beginning with D2, repository behavior must be expressed in shared tests.

Beginning with D13, the same contract suite must run against SQLite and PostgreSQL where applicable.

### 15.4 Component tests

Use component tests for:

    Forms.
    Question rendering.
    Flashcard interactions.
    Status labels.
    Study controls.
    Error states.

### 15.5 End-to-end tests

Add end-to-end coverage incrementally for completed vertical slices.

Examples:

    Open demo study track.
    Create certification.
    Create and activate a manual question.
    Complete a quick session.
    Generate an AI draft using a fake gateway.
    Import a source.
    Print a study pack.
    Complete an offline session and synchronize it.

### 15.6 External-service tests

Normal automated tests must not require live Bedrock, Polly, Transcribe, or S3.

Live AWS integration tests must be:

    Explicitly enabled.
    Clearly labeled.
    Excluded from the default test command.
    Cost-bounded.
    Safe to rerun.

### 15.7 Milestone quality gate

A milestone is not complete until:

    Lint passes.
    Type-check passes.
    Applicable tests pass.
    Production build passes.
    Manual verification steps are documented.
    No unauthorized future feature was implemented.

## 16. Deployment Architecture

### 16.1 Production target

```
Browser / installed PWA
        ↓
Application Load Balancer
        ↓
Amazon ECS service
        ↓
Next.js container
        ├── UI
        ├── Route handlers
        ├── Application facades
        ├── Domain services
        ├── PostgreSQL repositories
        ├── Bedrock gateway
        ├── Polly gateway
        ├── Transcribe gateway
        └── S3 storage adapter
```

External dependencies:

PostgreSQL
Amazon S3
Amazon Bedrock
Amazon Polly
Amazon Transcribe
AWS Secrets Manager or Parameter Store
Amazon CloudWatch

### 16.2 Single deployment rule

The baseline production application must use:

    One application repository.
    One application image.
    One ECS service.
    One Next.js application.
    One production database.
    One object-storage provider.

Do not introduce a separate API service or AI service.

Asynchronous AWS jobs may be started and polled by the same application.

A separate worker deployment is deferred.

### 16.3 Container

The production container must:

    Use a production Next.js build.
    Use the Node.js runtime.
    Run as a non-root user where practical.
    Expose a health endpoint.
    Receive configuration through environment variables and secrets.
    Avoid embedding credentials.
    Avoid storing durable production data on the container filesystem.

### 16.4 Infrastructure as code

Production infrastructure must be defined as code.

Preferred reference approach:

AWS CDK with TypeScript

A deviation may be proposed during D13.

Do not add infrastructure code before D13.

## 17. Configuration

Planned environment variables include:

```
APP_ENV
APP_BASE_URL

DATABASE_PROVIDER
SQLITE_PATH
DATABASE_URL

OBJECT_STORAGE_PROVIDER
LOCAL_OBJECT_STORAGE_PATH
S3_BUCKET
AWS_REGION

LANGUAGE_MODEL_PROVIDER
BEDROCK_MODEL_ID

POLLY_VOICE_ID
POLLY_ENGINE

TRANSCRIBE_LANGUAGE_CODE

ACCESS_MODE
OWNER_PASSWORD_HASH
SESSION_SECRET
```

Rules:

    Validate configuration during server startup.
    Fail clearly for missing production configuration.
    Do not silently fall back to a fake provider in production.
    Tests may inject fake providers explicitly.
    Client-side code must receive only public configuration.

## 18. Milestone Plan

### Milestone summary

| Milestone | Name | Primary validation |
|-----------|------|--------------------|
| D1 | Foundation and Demo Study Catalog | App structure, responsive UI, routing, deterministic demo provider |
| D2 | Local Persistence and Certification Management | SQLite, repositories, certification and objective CRUD |
| D3 | Manual Question Bank | Question lifecycle, revisions, filtering, manual content |
| D4 | Flashcards and Review Scheduling | Flashcard bank and deterministic spaced review |
| D5 | Quick Study Sessions and Progress | Ten-minute sessions, attempts, mistakes, mixed tracks |
| D6 | Bedrock AI Foundation and Raw-Knowledge Generation | AI gateway, personas, structured draft generation |
| D7 | AI Tutor and Question Quality Workflow | Explanations, challenges, verification, disputes |
| D8 | Source Library and Grounded Generation | Imports, snapshots, chunks, grounded and hybrid content |
| D9 | Printable Study Packs and Data Exports | Offline print material, JSON and CSV exports |
| D10 | Polly Audio Generation | Listening content and cached audio study material |
| D11 | Transcribe Speech Input and Evaluation | Recorded responses, transcription, rubric evaluation |
| D12 | Offline and Installable PWA | Cached sessions, local outbox, synchronization |
| D13 | PostgreSQL, S3, ECS, and Production Hardening | Production adapters, AWS infrastructure, protected deployment |

## 19. D1 — Foundation and Demo Study Catalog

### 19.1 Goal

Create a small, polished, responsive StudyBench application shell with a deterministic read-only demo catalog.

D1 validates:

    Repository setup.
    Next.js setup.
    TypeScript setup.
    Basic layering.
    Server-rendered routing.
    Responsive visual direction.
    Test and build tooling.
    Incremental implementation discipline.

D1 must not contain persistence or AWS integrations.

### 19.2 Required routes

Home

/

Displays:

    StudyBench product name.
    Tagline.
    Brief personal-workbench description.
    Two clearly labeled demo study tracks.
    A working link to view each demo track.

Suggested demo tracks:

AWS Certified Generative AI Developer - Professional (AIP-C01)
HSK Chinese — Demo Track

The AWS title may be displayed as the pilot identity. All progress and objectives shown in D1 must be clearly demo data.

Study-track detail

/study-tracks/[slug]

Displays:

    Track name.
    Provider or category.
    Study type.
    Demo badge.
    Short description.
    A small read-only list of demo objective summaries.
    A working return link.

Unknown slugs must render the Next.js not-found experience.

Health

/health

Returns a small JSON response such as:

```json
{
  "status": "ok",
  "application": "study-bench"
}
```

Do not expose secrets, environment values, dependency versions, or host details.

### 19.3 D1 demo-provider boundary

D1 must use a deterministic in-memory catalog behind a small, currently useful interface.

Reference shape:

```typescript
interface StudyCatalog {
  listTracks(): Promise<StudyTrackSummary[]>;
  findTrackBySlug(
    slug: string,
  ): Promise<StudyTrackDetail | null>;
}
```

Implementation:

DemoStudyCatalog

The interface exists because D1 requires both list and detail retrieval. Do not add create, update, delete, search, transaction, or persistence methods in D1.

### 19.4 D1 reference structure

A suitable D1 structure is:

```
src/
├── app/
│   ├── health/
│   │   └── route.ts
│   ├── study-tracks/
│   │   └── [slug]/
│   │       └── page.tsx
│   ├── globals.css
│   ├── layout.tsx
│   ├── not-found.tsx
│   └── page.tsx
├── modules/
│   └── study-catalog/
│       ├── domain/
│       ├── application/
│       ├── ports/
│       ├── infrastructure/
│       └── ui/
└── shared/
    └── ui/
```

Only create a directory when it contains required D1 code.

Minor structural deviations are allowed if layering remains clear.

### 19.5 D1 visual requirements

The UI must:

    Be responsive.
    Work on a narrow mobile viewport.
    Use a restrained study-oriented visual design.
    Include visible keyboard focus.
    Use semantic headings.
    Avoid framework-default placeholder content.
    Avoid lorem ipsum.
    Avoid fabricated claims about progress.
    Label all seed content as demo.
    Avoid displaying controls that do nothing.

The home page must feel like an application dashboard, not a marketing landing page.

### 19.6 D1 technical requirements

    Initialize a Next.js application in the existing repository.
    Use the App Router.
    Use TypeScript strict mode.
    Use a currently supported stable Node.js release.
    Record the selected Node.js version.
    Use npm and commit the lockfile.
    Configure linting.
    Configure formatting.
    Configure unit/component testing.
    Add a production build command.
    Add a concise README.md.
    Add PROGRESS.md.
    Preserve this SPEC.md.
    Add no database dependency.
    Add no AWS SDK dependency.
    Add no authentication dependency.
    Add no state-management library unless D1 demonstrably requires it.
    Avoid experimental Next.js features.

### 19.7 D1 tests

At minimum, test:

    The demo catalog returns the expected tracks.
    A known slug returns a track.
    An unknown slug returns null.
    The home view renders StudyBench identity.
    Demo tracks are visibly identified as demo content.
    The health route returns the expected safe payload.

Use testing levels appropriate to the implementation. Do not overbuild a large end-to-end suite for D1.

### 19.8 D1 acceptance criteria

D1 is complete only when:

    The application starts locally.
    / displays the StudyBench dashboard.
    The dashboard displays two demo tracks.
    Each demo track links to a working detail page.
    An unknown study-track slug renders not found.
    /health returns a successful safe JSON response.
    The interface works at mobile and desktop widths.
    There are no dead links or disabled future-feature controls.
    No database package is installed.
    No AWS SDK package is installed.
    No future module is stubbed.
    Tests pass.
    Lint passes.
    Type-check passes.
    Production build passes.
    README.md documents local commands.
    PROGRESS.md accurately records D1.
    The implementation report is provided.
    Claude stops and waits for explicit authorization for D2.

## 20. D2 — Local Persistence and Certification Management

### 20.1 Goal

Replace the read-only demo provider with local SQLite persistence and add certification and objective management.

### 20.2 Scope

Implement:

    SQLite database initialization.
    SQLite migrations.
    Certification repository.
    Objective repository.
    Unit of work where required.
    Repository contract tests.
    Certification list.
    Certification create form.
    Certification edit form.
    Certification archive and restore.
    Objective tree view.
    Objective create and edit.
    Objective reorder and reparent.
    Optional explicit demo seed command.

Do not implement questions, flashcards, AI, or AWS services.

### 20.3 Acceptance criteria

    Multiple study tracks persist across restart.
    Objective hierarchies persist.
    Invalid parent references are rejected.
    Cyclic objective relationships are rejected.
    Archived tracks are hidden by default.
    SQLite foreign keys are enabled.
    SQLite uses WAL and a busy timeout.
    Repository contracts pass.
    No UI component executes SQL.
    No route handler executes SQL.
    D1 behavior is preserved or cleanly migrated.
    The application remains runnable with one setup command.

## 21. D3 — Manual Question Bank

### 21.1 Goal

Provide a complete manual question-authoring and maintenance workflow without AI.

### 21.2 Scope

Implement:

    Question aggregate.
    Immutable question revisions.
    Single-choice questions.
    Multiple-response questions.
    Short-answer questions.
    Objective mappings.
    Manual provenance.
    Lifecycle status.
    Quality status.
    Question-bank list.
    Filtering.
    Search.
    Create.
    Edit.
    Preview.
    Activate.
    Retire.
    Restore.
    Dispute.
    Resolve dispute.
    Eligible hard deletion.
    Revision history.

Do not implement attempts or study sessions yet.

### 21.3 Acceptance criteria

    A manual question can be created and activated.
    Editing creates a new revision.
    Previous revisions remain inspectable.
    Invalid choice configuration is rejected.
    Retired and disputed filters work.
    Hard-delete rules are enforced.
    The bank works for more than one study track.
    No AI dependency exists yet.

## 22. D4 — Flashcards and Review Scheduling

### 22.1 Goal

Add manual flashcards and deterministic spaced review.

### 22.2 Scope

Implement:

    Flashcard aggregate and revisions.
    Basic cards.
    Reverse cards.
    Cloze cards.
    Vocabulary cards.
    Scenario cards.
    Objective mappings.
    Flashcard lifecycle.
    Review scheduling strategy.
    Review screen.
    Recall ratings.
    Due-card query.
    Review history.
    Convert eligible question into flashcard.

### 22.3 Acceptance criteria

    Cards can be created manually.
    Cards can be edited without deleting history.
    Due dates follow the specified initial scheduling rules.
    Review actions are transactional.
    Due cards are ordered predictably.
    Retired cards are excluded.
    Scheduling logic has unit tests independent of the database.

## 23. D5 — Quick Study Sessions and Progress

### 23.1 Goal

Deliver the core 10-minute study experience using existing bank content.

### 23.2 Scope

Implement:

    Study-session aggregate.
    Session composer.
    Question attempts.
    Confidence recording.
    Flashcard review inclusion.
    Single-track session.
    Mixed-track session.
    Questions-only session.
    Flashcards-only session.
    Mistake review.
    Optional diagnostic.
    Session pause and resume.
    Save after every answer.
    Basic progress dashboard.
    Recent mistakes.
    Objective coverage.

### 23.3 Acceptance criteria

    A session starts without an AI call.
    A session can combine questions and flashcards.
    Mixed sessions respect configured track selection.
    Retired and disputed content is excluded.
    Attempts reference exact revisions.
    Interrupted sessions resume.
    Completing an item persists immediately.
    Diagnostic can be skipped.
    Skipped objectives remain UNSEEN.
    Mobile interaction is usable at a narrow viewport.

## 24. D6 — Bedrock AI Foundation and Raw-Knowledge Generation

### 24.1 Goal

Generate draft questions and flashcards using Amazon Bedrock and raw model knowledge.

### 24.2 Scope

Implement:

    Language model gateway.
    Bedrock adapter.
    Fake deterministic adapter.
    Structured-output validation.
    Prompt template versioning.
    Generation-run persistence.
    Technical certification persona.
    HSK persona.
    Raw-knowledge question generation.
    Raw-knowledge flashcard generation.
    Generation preview.
    Accept or reject drafts.
    Edit generated drafts.
    Batch size limits.
    Provider-usage metadata where available.

Do not implement sources yet.

### 24.3 Acceptance criteria

    Automated tests run with the fake gateway.
    Live Bedrock use is explicitly configured.
    Malformed output is rejected.
    Generated items are drafts by default.
    Provenance identifies MODEL_KNOWLEDGE.
    Model ID and persona version are retained.
    AWS and HSK generation produce different structures and instructions.
    A normal study session still does not require a Bedrock call.

## 25. D7 — AI Tutor and Question Quality Workflow

### 25.1 Goal

Allow the owner to ask questions about bank content and challenge its quality.

### 25.2 Scope

Implement:

    Tutor facade.
    Follow-up explanation.
    Beginner explanation.
    Technical explanation.
    Choice-by-choice explanation.
    Short-answer evaluation.
    Follow-up question generation.
    AI question review.
    Ambiguity detection.
    Suggested dispute.
    Question challenge workflow.
    Owner-controlled revision proposal.
    AI-reviewed quality state.

### 25.3 Acceptance criteria

    The tutor receives the exact revision being discussed.
    The tutor cannot silently rewrite a question.
    A challenge can produce a structured quality finding.
    The owner can mark the question disputed.
    Disputed questions leave future normal sessions.
    Tutor responses identify whether sources were available.
    Raw-knowledge explanations do not fabricate citations.

## 26. D8 — Source Library and Grounded Generation

### 26.1 Goal

Import trusted or personal sources and use them for grounded or hybrid generation.

### 26.2 Scope

Implement:

    Object-storage port.
    Local filesystem adapter.
    Pasted text import.
    Markdown import.
    Text-based PDF import.
    Web URL import.
    Source metadata.
    Immutable source snapshots.
    Content hashes.
    Source chunks.
    Objective links.
    Grounded generation.
    Hybrid generation.
    Source evidence display.
    Source-based verification.
    Source refresh.
    Outdated-question detection when a source changes.

Do not add a vector database.

### 26.3 Acceptance criteria

    An imported source is stored outside the database.
    Source metadata persists in SQLite.
    A refresh creates a new snapshot.
    A question references exact chunks.
    Source-grounded questions display their evidence.
    Hybrid questions are labeled hybrid.
    URL retrieval includes required safety controls.
    Source content cannot change system instructions.
    Scanned PDFs fail clearly when text cannot be extracted.
    The application works without any source library.

## 27. D9 — Printable Study Packs and Data Exports

### 27.1 Goal

Create useful offline study material and owner-controlled exports.

### 27.2 Scope

Implement:

    Study artifact model.
    Study-guide builder.
    Practice quiz.
    Separate answer key.
    Mistake-review pack.
    Flashcard sheets.
    HSK writing worksheet.
    Print CSS.
    Artifact revision metadata.
    Markdown export.
    JSON logical backup export.
    CSV flashcard export.
    Import validation for supported StudyBench JSON.

### 27.3 Acceptance criteria

    A study pack can be printed cleanly.
    The answer key can begin on separate pages.
    Included question revisions are frozen.
    Source notes are included when requested.
    A JSON export can reconstruct supported owner data.
    Import validates before writing.
    Failed import does not partially corrupt data.

## 28. D10 — Polly Audio Generation

### 28.1 Goal

Generate and cache audio study material using Amazon Polly.

### 28.2 Scope

Implement:

    Speech-synthesis gateway.
    Polly adapter.
    Fake speech adapter.
    Audio asset model.
    Audio cache.
    HSK vocabulary audio.
    HSK listening question audio.
    Technical question reading.
    Audio flashcards.
    Audio playback controls.
    Configurable voice and engine.
    Audio study-pack selection.

### 28.3 Acceptance criteria

    Default tests do not call Polly.
    Identical synthesis requests reuse cached audio.
    HSK and technical audio use configurable settings.
    Listening transcripts remain hidden until appropriate.
    Audio assets can be deleted.
    Audio playback works on mobile.
    Domain code does not import the Polly SDK.

## 29. D11 — Transcribe Speech Input and Evaluation

### 29.1 Goal

Support recorded oral answers, dictation, and transcript-based evaluation.

### 29.2 Scope

Implement:

    Browser recording flow.
    Audio upload validation.
    Speech-transcription gateway.
    Amazon Transcribe adapter.
    Fake transcription adapter.
    Transcription job state.
    Job polling.
    Transcript review.
    Oral recall evaluation.
    HSK dictation.
    HSK spoken-response evaluation.
    Recording deletion.
    Retention settings.

### 29.3 Acceptance criteria

    A short recording can be submitted.
    Transcription state survives page refresh.
    The transcript can be corrected before evaluation.
    Bedrock evaluates the transcript against a rubric.
    StudyBench does not claim precise tone scoring.
    Recordings can be deleted.
    Default tests do not call Transcribe.

## 30. D12 — Offline and Installable PWA

### 30.1 Goal

Allow selected study activities to continue with intermittent or absent connectivity.

### 30.2 Scope

Implement:

    Installable PWA metadata.
    Application-shell caching.
    Downloaded session caching.
    Flashcard caching.
    Cached audio playback.
    IndexedDB attempt outbox.
    Connectivity status.
    Retry and synchronization.
    Conflict-safe server submission.
    Clear offline limitations.

### 30.3 Acceptance criteria

    The app shell opens after installation without connectivity.
    A downloaded session can be completed offline.
    Offline attempts survive browser restart.
    Attempts synchronize when connectivity returns.
    Duplicate synchronization is idempotent.
    AI actions are visibly unavailable offline.
    Cached audio remains playable.

## 31. D13 — PostgreSQL, S3, ECS, and Production Hardening

### 31.1 Goal

Deploy StudyBench as a protected single-owner AWS application.

### 31.2 Scope

Implement:

    PostgreSQL migrations.
    PostgreSQL repositories.
    SQLite/PostgreSQL repository contract tests.
    S3 object-storage adapter.
    Production configuration validation.
    Production Docker image.
    Health checks.
    AWS infrastructure as code.
    ECS service.
    Application Load Balancer.
    RDS PostgreSQL or Aurora PostgreSQL.
    S3 bucket.
    ECS task role.
    Bedrock permissions.
    Polly permissions.
    Transcribe permissions.
    Secret storage.
    CloudWatch logging.
    Database migration execution.
    Single-owner access protection or documented private access.
    Logical backup and restore procedure.
    Deployment documentation.

### 31.3 Acceptance criteria

    The same domain behavior passes against SQLite and PostgreSQL.
    Durable production files use S3.
    The application image contains no credentials.
    Production database migrations are repeatable.
    Health checks succeed.
    The deployment is not publicly unrestricted.
    Bedrock, Polly, and Transcribe use the ECS task role.
    The application survives task replacement.
    No durable data depends on the container filesystem.
    Backup and restore are documented and tested.
    The app remains one deployable Next.js application.

## 32. Post-MVP Possibilities

These are ideas only. They are not authorized milestones.

Possible later work:

    Automated web research through an approved provider.
    Semantic source retrieval.
    Vector search.
    More sophisticated spaced repetition.
    Additional certification personas.
    HSK-specific vocabulary-level validation.
    Improved pronunciation analysis through a dedicated service.
    Server-rendered PDF generation.
    Audio playlists.
    More advanced study analytics.
    Study-plan calendar generation.
    Local database backup scheduling.
    Question deduplication using embeddings.
    Automatic question-bank coverage replenishment.

Do not build these without an explicit specification update.

## 33. Definition of Product Success

StudyBench has achieved its intended initial product outcome when the owner can:

    Maintain multiple certifications or study tracks.
    Import or manually define their objectives.
    Build and maintain a personal question bank.
    Create and review flashcards.
    Generate draft content using raw model knowledge.
    Generate source-grounded content when sources are available.
    Edit, activate, dispute, retire, and delete eligible content.
    Start a useful 10-minute session from a phone.
    Review mistakes and ask the tutor follow-up questions.
    Print study guides and practice quizzes.
    Listen to generated study audio.
    Record selected spoken answers.
    Continue downloaded study sessions offline.
    Run the application locally with SQLite.
    Deploy the same product as one protected Next.js application on AWS with PostgreSQL and S3.

The immediate implementation target remains:

D1 — Foundation and Demo Study Catalog

Do not begin D2 without explicit user authorization.