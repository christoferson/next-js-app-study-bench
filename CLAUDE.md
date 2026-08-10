# CLAUDE.md — StudyBench Engineering Guide

## 1. Purpose

This file provides repository-level instructions for Claude Code and other coding
agents working on StudyBench.

Repository:

`next-js-app-study-bench`

Product:

`StudyBench`

Tagline:

`Build your study bank. Learn anywhere.`

StudyBench is a single-user, personal, AI-assisted study workbench for technical
certifications, language examinations, and other structured learning goals.

The product is intentionally implemented in small, independently verifiable
milestones.

Do not attempt to build the complete product in one pass.

---

## 2. Required Reading

Before planning or changing code, read these files in this order:

1. `SPEC.md`
2. `PROGRESS.md`
3. `CLAUDE.md`
4. `README.md`
5. Relevant source files and tests for the authorized milestone

If `PROGRESS.md` does not exist and the authorized milestone requires it, create it
using the initial structure defined in `SPEC.md`.

Do not begin implementation until the current authorized milestone is known.

---

## 3. Authority and Conflict Resolution

Use the following precedence:

1. The user's latest explicit instruction
2. `SPEC.md` for product requirements, milestone scope, and acceptance criteria
3. `PROGRESS.md` for recorded implementation state
4. `CLAUDE.md` for engineering workflow and coding conventions
5. Existing implementation patterns

If these sources conflict in a way that changes product behavior or milestone
scope:

- Do not guess.
- Do not silently choose one interpretation.
- Explain the conflict.
- Ask for clarification before making broad changes.

A request such as the following authorizes the named milestone:

`Continue with D2.`

General feedback, a bug report, an architectural discussion, or a request to
inspect code does not authorize the next milestone.

---

## 4. Current Authorized Milestone

The initial authorized milestone is:

`D1 — Foundation and Demo Study Catalog`

Unless the user has explicitly authorized a later milestone:

- Implement D1 only.
- Do not begin D2.
- Do not partially implement D2.
- Do not create placeholder code for future milestones.
- Stop after D1 passes its acceptance criteria.
- Report completion and wait for authorization.

Before each implementation session, confirm the authorized milestone from the
latest user instruction and `PROGRESS.md`.

Never advance to another milestone merely because the current one is complete.

---

## 5. Mandatory Incremental Workflow

For every authorized milestone, follow this workflow.

### 5.1 Inspect

Before editing:

- Read the milestone goal, scope, exclusions, tests, and acceptance criteria.
- Inspect the current repository state.
- Inspect `package.json`, configuration files, and existing scripts.
- Inspect existing tests and architectural patterns.
- Check `git status`.
- Identify uncommitted user changes.
- Do not overwrite unrelated user work.

### 5.2 Plan

Before making changes, provide a concise implementation plan containing:

- The authorized milestone
- The vertical slice being implemented
- Expected files or areas to change
- Tests to add or update
- Verification commands
- Any ambiguity or decision that requires user input

Keep the plan specific to the authorized milestone.

Do not include speculative future architecture in the implementation plan.

### 5.3 Implement

During implementation:

- Keep the application runnable.
- Prefer a small complete vertical slice.
- Add tests with behavior.
- Avoid dead controls and placeholder pages.
- Avoid unused abstractions and dependencies.
- Preserve completed milestone behavior.
- Run targeted checks throughout development.
- Do not wait until the end to run all validation.

### 5.4 Verify

Before declaring the milestone complete, run all applicable commands for:

- Formatting verification
- Linting
- Type checking
- Unit and component tests
- Integration tests, when the milestone includes persistence
- Production build
- Any applicable end-to-end tests

Also perform and document manual verification.

### 5.5 Record

Update `PROGRESS.md` with:

- Milestone status
- Completed work
- Architectural decisions
- Approved deviations
- Known limitations
- Test and build results
- The next proposed milestone

Do not mark the next milestone as authorized or in progress unless the user has
explicitly authorized it.

After completing D1, an appropriate state is:

- D1 completed
- Awaiting authorization for D2
- D2 proposed but not authorized

### 5.6 Stop

After completing the authorized milestone:

- Do not begin the next milestone.
- Do not add “helpful” future scaffolding.
- Provide the required implementation report.
- Wait for explicit user approval.

---

## 6. Required Completion Report

At the end of an implementation milestone, report:

1. Summary of what was built
2. Files added, changed, or removed
3. Architectural decisions made
4. Deviations from `SPEC.md`
5. Commands run
6. Formatting, lint, type-check, test, and build results
7. Manual verification steps
8. Known limitations
9. Questions or decisions required before the next milestone
10. The exact next milestone proposed

Use this structure:

    ## Milestone completed

    D1 — Foundation and Demo Study Catalog

    ## Summary

    - ...

    ## Files changed

    Added:
    - ...

    Changed:
    - ...

    Removed:
    - None

    ## Architectural decisions

    - ...

    ## Deviations from SPEC.md

    - None

    ## Commands run

    - `npm run lint`
    - `npm run type-check`
    - `npm test`
    - `npm run build`

    ## Results

    - Format: passed
    - Lint: passed
    - Type-check: passed
    - Tests: passed
    - Build: passed

    ## Manual verification

    1. ...
    2. ...

    ## Known limitations

    - ...

    ## Decisions required

    - None

    ## Proposed next milestone

    D2 — Local Persistence and Certification Management

    Waiting for explicit authorization.

Do not claim that a command passed if it was not run successfully.

If a command cannot be run, report:

- The exact command
- Why it could not run
- The error or environmental limitation
- What remains unverified

---

## 7. Product Constraints

StudyBench is:

- Personal
- Single-user
- Multi-certification
- Mobile-friendly
- AI-assisted
- Question-bank centered
- Designed for short study sessions
- Capable of printable and audio study material
- Developed locally before AWS deployment

StudyBench is not:

- A commercial SaaS
- A learning-management system
- A social network
- A public question marketplace
- A multi-tenant application
- An official exam-question provider
- An exam-dump application
- A chatbot with disposable output as its primary experience

Do not add:

- Registration
- Multiple user accounts
- Organizations
- Roles
- Teams
- Payments
- Subscriptions
- Social features
- Public question sharing
- Public leaderboards
- Instructor dashboards
- Course sales
- Marketplace functionality

A future single-owner access gate is allowed only in the production-hardening
milestone. It must not become a multi-user product model.

---

## 8. Architecture Principles

### 8.1 One full-stack application

StudyBench must remain one full-stack TypeScript Next.js application.

Do not add a separate:

- Express server
- NestJS application
- FastAPI application
- Python backend
- AI microservice
- Media microservice
- Worker deployment
- Authentication service

The production target is one Next.js application image deployed as one ECS
service, with managed AWS services as dependencies.

### 8.2 Layered modular architecture

Use these conceptual layers when a feature requires them:

- Domain
- Application
- Ports
- Infrastructure
- UI

Responsibilities must remain clear.

#### Domain

Domain code contains:

- Entities
- Value objects
- Lifecycle rules
- Validation rules
- Domain errors
- Pure scheduling and selection algorithms

Domain code must not import:

- React
- Next.js
- AWS SDKs
- Database drivers
- HTTP request or response types
- Filesystem libraries
- Environment-variable access

#### Application

Application code contains:

- Use cases
- Commands
- Queries
- Facades
- Workflow orchestration
- Transaction coordination

Application code depends on domain concepts and ports.

It must not contain:

- Raw SQL
- React rendering
- AWS SDK client initialization
- Next.js request parsing
- Database-driver-specific rows

#### Ports

Ports define narrow interfaces for behavior the application needs, including:

- Repositories
- Unit of work
- Object storage
- Language models
- Speech synthesis
- Speech transcription
- Source retrieval
- Clock and identifier generation when deterministic testing requires them

Create ports only when the current milestone uses them.

#### Infrastructure

Infrastructure contains concrete implementations such as:

- Demo in-memory catalogs
- SQLite repositories
- PostgreSQL repositories
- Local filesystem storage
- S3 storage
- Bedrock gateway
- Polly gateway
- Transcribe gateway
- URL retrieval
- Database migrations

#### UI

UI code contains:

- React components
- Route pages
- Forms
- View models
- Presentation formatting
- User interaction state

UI code must not execute raw SQL or initialize AWS clients.

### 8.3 No speculative structure

Do not create all anticipated modules at the beginning.

Create a directory only when:

- The authorized milestone requires it, and
- It contains implemented code or directly relevant tests

Do not create empty directories for:

- Questions
- Flashcards
- Study sessions
- AI
- Sources
- Audio
- Artifacts
- AWS infrastructure
- PostgreSQL

until their milestones are authorized.

### 8.4 Prefer vertical slices

A vertical slice should include only what is needed to make one capability usable
and verifiable.

For example, D1 includes:

- Demo study-track data
- A narrow catalog port
- A deterministic implementation
- A dashboard
- A detail page
- A health endpoint
- Relevant tests

D1 does not include:

- A generic persistence framework
- A question repository
- An AI gateway
- A job queue
- An object-storage abstraction
- An authentication abstraction

---

## 9. Repository and Facade Rules

### 9.1 Domain-specific repositories

Repositories must describe application access patterns.

Preferred:

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

Prohibited:

    interface Repository<T> {
      create(value: T): Promise<T>;
      update(value: T): Promise<T>;
      delete(id: string): Promise<void>;
    }

Also prohibited:

    findByAnyCombinationOfFields(
      filters: Record<string, unknown>,
    ): Promise<unknown[]>;

Do not leak raw SQL, query builders, ORM expressions, or database rows through
repository ports.

### 9.2 Focused facades

A facade coordinates one product capability.

Possible future facades include:

- `CertificationFacade`
- `QuestionBankFacade`
- `FlashcardFacade`
- `StudyFacade`
- `GenerationFacade`
- `TutorFacade`
- `SourceFacade`
- `ArtifactFacade`
- `AudioFacade`

Create each only when its milestone requires it.

Do not create a single global `AppService` or `StudyBenchService`.

### 9.3 Strategy pattern

Use strategies where behavior genuinely varies by:

- Certification family
- Question format
- Flashcard scheduling algorithm
- Session-composition policy
- Answer evaluation
- Study-material format
- Audio lesson format

Do not create a strategy interface for behavior that has only one simple
implementation and no current variation requirement.

### 9.4 Composition root

Concrete adapters must be selected in a server-only composition root.

Route handlers and pages must not instantiate:

- Database clients
- AWS SDK clients
- Repositories
- Filesystem adapters
- AI gateways

through scattered local construction.

D1 may use a small composition function for `DemoStudyCatalog`.

Do not build a dependency-injection framework.

Use explicit TypeScript construction.

---

## 10. Next.js Conventions

### 10.1 Framework

Use:

- Next.js App Router
- TypeScript strict mode
- React
- Node.js runtime
- Server Components by default

Use Client Components only when browser state, browser APIs, event handlers, or
interactive controls require them.

Do not mark an entire page or layout as a Client Component when a small child
component is sufficient.

### 10.2 Route handlers

Route handlers must:

- Parse input
- Validate input
- Invoke an application capability
- Translate known errors
- Return a response

Route handlers must not contain:

- Business rules
- Prompt templates
- Raw SQL
- Study-session selection logic
- Bedrock orchestration
- Polly orchestration
- Transcribe orchestration

### 10.3 Server-only code

Database access, AWS SDK use, secrets, and filesystem access must remain in
server-only modules.

Never import server-only modules into Client Components.

Never expose secrets through:

- Public environment variables
- HTML
- Browser bundles
- Client logs
- API responses

### 10.4 Dynamic routes

Unknown dynamic resource identifiers must use the Next.js not-found behavior
where appropriate.

Do not render a normal success page saying “not found.”

### 10.5 Error handling

Use explicit domain or application errors for expected failures.

Do not rely on string matching against arbitrary error messages.

Do not expose stack traces or internal implementation details to users.

### 10.6 Loading and empty states

Add loading, empty, and error states when the implemented capability can
meaningfully encounter them.

Do not add speculative loading states for features that do not exist.

---

## 11. TypeScript Standards

### 11.1 Strictness

TypeScript strict mode is mandatory.

Do not weaken compiler settings to avoid fixing a type error.

Avoid:

- `any`
- Unsafe type assertions
- Non-null assertions without a documented invariant
- Broad `Record<string, unknown>` domain objects
- Untyped JSON parsing

Use `unknown` at external boundaries and validate before use.

### 11.2 Domain types

Prefer explicit domain names:

- `StudyTrackId`
- `QuestionId`
- `QuestionRevisionId`
- `ObjectiveId`
- `GenerationMode`
- `QuestionLifecycleStatus`

Do not overuse primitive wrappers when they add no safety or clarity.

### 11.3 Discriminated unions

Use discriminated unions for variant content.

Example:

    type QuestionContent =
      | {
          type: "SINGLE_CHOICE";
          choices: Choice[];
          correctChoiceId: string;
        }
      | {
          type: "MULTIPLE_RESPONSE";
          choices: Choice[];
          correctChoiceIds: string[];
        }
      | {
          type: "SHORT_ANSWER";
          expectedConcepts: string[];
        };

The discriminator must be stable and persisted where applicable.

### 11.4 Exhaustive handling

Use exhaustive switching for closed unions.

A new question type must cause relevant compile-time failures until renderers,
validators, and evaluators handle it deliberately.

### 11.5 IDs

Generate IDs in application code using an injected generator where deterministic
testing requires one.

The default production-capable implementation may use:

`crypto.randomUUID()`

Do not rely on database-specific auto-increment IDs for domain identity.

### 11.6 Time

Represent application time consistently in UTC.

Inject a clock into time-sensitive domain services when deterministic tests
require it.

Do not scatter direct `new Date()` calls through scheduling and session-selection
logic.

---

## 12. Validation

Validate data at every external boundary, including:

- Forms
- Route requests
- Imported files
- AI output
- Database JSON payloads
- Environment configuration
- AWS service responses where assumptions matter

Use one consistent schema-validation library once a milestone requires runtime
schemas.

Do not add multiple competing validation libraries.

Validation failures must be:

- Specific
- Actionable
- Safe to display
- Mapped to the relevant field when possible

Application-owned schemas remain authoritative even when an AI provider supports
structured output.

Never trust model-generated JSON without validation.

---

## 13. Persistence Rules

### 13.1 Local database

Beginning in D2, local application persistence uses SQLite.

Default path:

`./data/study-bench.db`

Every application SQLite connection must configure:

    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

Use strict tables where practical.

Do not add SQLite during D1.

### 13.2 Production database

Production persistence uses PostgreSQL beginning in D13.

The final hosting selection between RDS PostgreSQL and Aurora PostgreSQL is
deferred until D13.

Do not add PostgreSQL dependencies or migrations before the authorized milestone
requires them.

### 13.3 Database parity

SQLite and PostgreSQL implementations must provide the same domain-observable
repository behavior, but they do not need identical SQL.

Do not force PostgreSQL behavior into SQLite through fragile emulation.

Do not promise that changing one environment variable makes all database
differences disappear without contract testing.

### 13.4 Repository contract tests

Beginning when repositories are introduced, express their shared behavior through
contract tests.

When PostgreSQL is introduced, run the relevant contracts against both:

- SQLite
- PostgreSQL

### 13.5 Transactions

Operations that modify related records atomically must use a unit-of-work or
transaction boundary.

Examples:

- Saving a question and its first revision
- Recording an attempt and updating review scheduling
- Completing a session item
- Activating a generated batch
- Retiring content and updating pending eligibility

Do not place transaction handling in React components or route handlers.

### 13.6 Migrations

Database schema changes must use migrations.

Do not modify an already-applied migration after it has become part of a completed
milestone unless explicitly correcting an unreleased local milestone.

Prefer adding a new migration.

Migrations must be:

- Ordered
- Repeatable in a clean environment
- Tested
- Documented when they require data transformation

### 13.7 Large content

Do not store large binary files in relational tables.

Store metadata and object keys in the database.

Store file contents in:

- Local filesystem during local development
- Amazon S3 in production

---

## 14. AI Engineering Rules

These rules apply beginning with the authorized AI milestone.

### 14.1 AI behind a gateway

Application and domain code must not directly import the Amazon Bedrock SDK.

Use an application-defined gateway such as:

    interface LanguageModelGateway {
      generateStructured<T>(
        request: StructuredGenerationRequest<T>,
      ): Promise<StructuredGenerationResult<T>>;

      converse(
        request: ConversationRequest,
      ): Promise<ConversationResult>;
    }

Expected implementations include:

- `BedrockLanguageModelGateway`
- `FakeLanguageModelGateway`
- `RecordedLanguageModelGateway`, if later justified

### 14.2 Provenance

Every generated item must retain:

- Generation mode
- Model provider
- Model ID
- Persona ID
- Persona version
- Prompt-template ID
- Prompt-template version
- Generation timestamp
- Selected sources, if any
- Verification state
- Generation-run ID

Supported generation modes include:

- `MANUAL`
- `MODEL_KNOWLEDGE`
- `SOURCE_GROUNDED`
- `HYBRID`
- `IMPORTED`
- `VARIANT`
- `WEB_RESEARCH`

Do not fabricate source references for model-knowledge output.

### 14.3 Model knowledge is allowed

Claude or another Bedrock model may generate questions from raw model knowledge.

Such content must be identified as model-generated and ungrounded unless source
evidence exists.

Raw model knowledge is not prohibited.

It is one supported provenance mode.

### 14.4 Generated content defaults to draft

AI-generated questions and flashcards must default to:

- Lifecycle: `DRAFT`
- Quality status: `UNREVIEWED`, unless a separate review occurred

Do not auto-activate generated content in the initial implementation.

### 14.5 Generation and verification are separate

Do not treat the generator as the sole authority on its output.

The workflow may include:

1. Generate candidate
2. Validate schema
3. Apply deterministic checks
4. Optionally run a separate AI review
5. Let the owner inspect or edit
6. Activate only through an explicit workflow

### 14.6 Prompt location

Prompt templates must:

- Live outside route handlers
- Be versioned
- Be associated with a persona
- Be testable with fixtures
- Be recorded in generation metadata

Do not embed long prompts directly in React components.

### 14.7 Prompt-injection protection

Imported source material is untrusted data.

Source content must not be inserted into system instructions as trusted
instructions.

Source content cannot authorize:

- Tool calls
- Additional URL retrieval
- Credential access
- Question activation
- Content deletion
- System-prompt changes

### 14.8 Deterministic output checks

Before persisting generated questions, application code must check:

- Required fields
- Recognized question type
- Unique choice IDs
- Non-duplicate choice text
- Correct answer references
- Correct answer count
- Existing objective IDs
- Existing source IDs when provided
- Recognized difficulty
- Valid provenance
- Draft lifecycle defaults

Malformed output must not be persisted as active content.

### 14.9 Fake AI for tests

Default automated tests must not call Bedrock.

Use deterministic fakes and fixtures.

Live AWS tests must be:

- Explicitly enabled
- Cost-bounded
- Excluded from default test commands
- Safe to rerun
- Clearly reported

### 14.10 No hidden question rewrites

The tutor or verifier must not silently modify an existing question revision.

A proposed correction must become:

- A quality finding
- A dispute recommendation
- A proposed new revision
- An owner-controlled action

Historical attempts must continue to reference the old revision.

---

## 15. Certification Persona Rules

### 15.1 Persona selection

Certification-specific behavior must be selected through explicit configuration
or a persona registry.

Avoid scattered checks such as:

    if (certification.provider === "AWS") {
      // ...
    }

    if (certification.name.includes("HSK")) {
      // ...
    }

Use explicit persona or study-type configuration.

### 15.2 Technical certification behavior

The technical-certification persona should favor:

- Applied scenarios
- Architecture decisions
- Troubleshooting
- Security
- Operational efficiency
- Cost considerations
- Best-next-action questions
- Plausible distractors
- Choice-by-choice explanations

It must not:

- Claim generated content is official
- Reproduce exam dumps
- Depend on obscure quotas unless requested
- Present ambiguous multiple-choice questions as having one certain answer

### 15.3 HSK behavior

The HSK persona should support:

- Vocabulary recognition
- Vocabulary recall
- Hanzi recognition
- Pinyin recognition
- Grammar
- Cloze questions
- Sentence ordering
- Reading
- Listening
- Dictation
- Spoken response

It must:

- Respect configured vocabulary scope where possible
- Hide pinyin when testing character recognition
- Hide translation when testing meaning recall
- Use natural Chinese
- Reveal pinyin and translation according to study settings
- Avoid presenting literal translation as the only acceptable meaning when
  equivalent meaning is valid

---

## 16. Question and Revision Rules

These rules apply when the question-bank milestone is authorized.

### 16.1 Question root and immutable revisions

A question root owns:

- Identity
- Lifecycle
- Current revision reference
- Quality state
- Creation and update metadata

Question content belongs to immutable revisions.

Editing a question creates a new revision.

Do not overwrite a revision that has been used in:

- An attempt
- A study session
- A print artifact
- A generated variant

### 16.2 Lifecycle and quality are separate

Lifecycle:

- `DRAFT`
- `ACTIVE`
- `RETIRED`
- `ARCHIVED`

Quality:

- `UNREVIEWED`
- `AI_REVIEWED`
- `SOURCE_CHECKED`
- `USER_APPROVED`
- `DISPUTED`
- `OUTDATED`

Generation mode is a third independent dimension.

Do not collapse these concepts into one status field.

### 16.3 Deletion

Hard deletion is allowed only when the question has no protected dependent
history.

Otherwise, use retirement or archival.

Do not cascade-delete study history to make a question deletable.

### 16.4 Historical integrity

Attempts and artifacts must reference exact revisions.

Do not display current question text as if it were the text used for a historical
attempt.

---

## 17. Study Session Rules

These rules apply beginning with the study-session milestone.

### 17.1 No required AI call at session start

A normal study session must start from existing active bank content.

Starting a session must not wait for Bedrock.

AI may later support:

- Explanations
- Free-text grading
- Challenges
- Follow-up questions
- Bank replenishment

### 17.2 Session selection

The deterministic composer should prioritize:

1. Overdue flashcards
2. Confident-but-incorrect answers
3. Other incorrect answers
4. Weak objectives
5. Unseen objectives
6. Never-attempted active content
7. General retention

It must exclude by default:

- Draft content
- Retired content
- Archived content
- Disputed questions

### 17.3 Frozen revisions

When a session is created, store the selected question and flashcard revision IDs.

A later content edit must not change an in-progress session.

### 17.4 Save incrementally

Persist after every completed item.

Do not wait until the session ends to save all attempts.

Sessions must support interruption and resumption.

### 17.5 Diagnostics

Diagnostics are optional.

If skipped:

- Do not assign a score of zero.
- Mark relevant content as `UNSEEN`.
- Prioritize it as new content.

---

## 18. Audio and Speech Rules

These rules apply beginning with the relevant audio milestones.

### 18.1 Gateways

Do not directly import Polly or Transcribe SDKs into domain or application
modules.

Use:

- `SpeechSynthesisGateway`
- `SpeechTranscriptionGateway`

### 18.2 Audio caching

Identical speech-synthesis requests must reuse cached output.

The cache identity must account for:

- Normalized text
- Language
- Voice
- Engine
- Speech rate
- Relevant speech configuration

### 18.3 Speech-evaluation limits

Amazon Transcribe output is a transcript, not a precise pronunciation score.

Do not claim:

- Exact tone accuracy
- Exact phoneme accuracy
- Clinical or expert pronunciation assessment

A transcript mismatch may be presented as:

- A possible pronunciation issue
- A possible recognition issue
- A reason to retry

### 18.4 Recording privacy

Voice recordings must:

- Remain private
- Have a delete action
- Have defined retention behavior
- Not be retained indefinitely without owner intent

---

## 19. Security Rules

### 19.1 Secrets

Never commit:

- AWS credentials
- Database passwords
- Session secrets
- Owner-password hashes
- API keys
- Signed URLs
- Real voice recordings
- Personal source documents

Do not print secrets in logs or completion reports.

### 19.2 AWS credentials

Production AWS access must use the ECS task role.

Do not embed credentials in:

- Source code
- Docker images
- Client-side JavaScript
- Configuration committed to Git

### 19.3 Single-owner access

Single-user does not mean publicly unrestricted.

When production access protection is authorized:

- Do not create registration.
- Do not create a users table.
- Do not add organization or role concepts.
- Protect state-changing operations.
- Use secure HTTP-only cookies if application-level sessions are used.
- Keep credentials in a secret-management mechanism.

### 19.4 URL retrieval

When source URL import is authorized, retrieval must defend against server-side
request forgery.

At minimum:

- Allow only HTTP and HTTPS
- Reject loopback addresses
- Reject private-network destinations unless deliberately approved
- Revalidate redirects
- Apply timeouts
- Limit response size
- Restrict content types
- Sanitize rendered content

### 19.5 Logs

Logs may include:

- Request correlation ID
- Operation name
- Duration
- Safe entity IDs
- Safe error category

Logs must not include:

- Full prompts by default
- Full source documents
- Correct answers unnecessarily
- Voice recording contents
- Database credentials
- AWS credentials
- Cookies
- Session secrets

---

## 20. UI and Accessibility Standards

### 20.1 Product feel

The home experience should feel like a personal application dashboard, not a
marketing landing page.

Use:

- Clear hierarchy
- Restrained visual design
- Study-oriented language
- Useful empty states
- Direct calls to action
- Consistent status labels

Avoid:

- Excessive gradients
- Promotional claims
- Fake testimonials
- Fabricated progress
- Disabled future-feature controls
- Non-functional navigation

### 20.2 Mobile study

Study experiences must work at approximately a 360-pixel viewport width.

Requirements include:

- No normal-content horizontal scrolling
- Large touch targets
- Readable answer choices
- Clear current-item progress
- Accessible audio controls
- Autosave feedback where relevant
- Explanation text readable without zooming

### 20.3 Accessibility

All implemented UI must provide:

- Semantic headings
- Form labels
- Keyboard navigation
- Visible focus states
- Accessible names for icon-only controls
- Sufficient color contrast
- Errors associated with relevant fields
- Status information not communicated by color alone

Use semantic HTML before adding ARIA.

### 20.4 No dead controls

Do not display:

- Buttons with no action
- Navigation to unimplemented routes
- Disabled controls advertising future features
- Empty placeholder panels for later milestones

If a feature is not implemented, omit it.

---

## 21. Styling Rules

Use the styling approach already established in the repository.

For D1:

- Prefer a small maintainable stylesheet.
- Do not add a large component library solely for the demo catalog.
- Do not add a design-system dependency without current need.
- Use reusable design tokens through CSS custom properties where useful.
- Support light mode at minimum.
- Do not spend milestone scope on elaborate theming.

If a styling framework is already present, use it consistently rather than adding
a competing approach.

---

## 22. Testing Standards

### 22.1 Test behavior, not implementation trivia

Tests should verify observable behavior.

Prefer:

- Catalog returns known tracks
- Unknown slug returns no result
- Retired questions are not study candidates
- Editing creates a revision
- Scheduling returns the expected next due date

Avoid tests that only assert:

- A private method was called
- A component has a particular internal state variable
- A repository executed a specific SQL string
- A mock received incidental implementation details

### 22.2 Test levels

Use the smallest useful level:

- Unit tests for pure domain logic
- Repository contract tests for persistence behavior
- Component tests for user interactions
- Route tests for request/response behavior
- End-to-end tests for important completed vertical slices

### 22.3 Determinism

Tests must not depend on:

- The real current time
- Random UUIDs
- Live AWS responses
- Network access
- Test execution order
- Existing local database contents

Inject or control:

- Clock
- ID generation
- AI responses
- Audio responses
- Repository setup

when required.

### 22.4 Test data

Use clearly fictional or explicitly demo-labeled data.

Do not present generated sample questions as official exam questions.

### 22.5 External services

Default tests must never incur AWS cost.

Live AWS tests must require an explicit opt-in environment setting and must not
run as part of the normal `npm test` command.

---

## 23. Required Project Commands

The repository must provide documented commands for:

- Development
- Formatting
- Formatting verification
- Linting
- Type checking
- Unit and component tests
- Integration tests when introduced
- Production build

Preferred script names:

- `npm run dev`
- `npm run format`
- `npm run format:check`
- `npm run lint`
- `npm run type-check`
- `npm test`
- `npm run test:watch`
- `npm run test:integration`
- `npm run build`

Do not add a script that claims to perform a check but skips it.

If the repository already uses equivalent names, preserve consistency and
document them in `README.md`.

---

## 24. Dependency Rules

Before adding a dependency:

1. Confirm that the authorized milestone needs it.
2. Confirm that the platform does not already provide the capability.
3. Prefer a maintained, focused package.
4. Avoid overlapping libraries.
5. Explain significant dependency choices in the completion report.

Do not add dependencies for future milestones.

D1 must not include:

- SQLite drivers
- ORMs
- PostgreSQL clients
- AWS SDK clients
- Authentication libraries
- PDF libraries
- Audio libraries
- PWA libraries
- State-management libraries without demonstrated need
- AI SDKs
- Vector databases

Use `npm` and commit the lockfile.

Do not manually edit dependency versions in the lockfile.

---

## 25. Git and File Safety

Before changing files:

- Run `git status`.
- Inspect uncommitted changes.
- Preserve user-authored modifications.
- Do not revert unrelated work.

Do not run destructive commands without explicit authorization, including:

- `git reset --hard`
- `git clean -fd`
- Force checkout of user changes
- Rewriting published history
- Deleting the local database
- Deleting uploaded objects
- Dropping production tables

Do not commit unless explicitly requested.

Do not amend a commit unless explicitly requested.

Do not modify `SPEC.md` unless the user explicitly asks to change the
specification.

Updating `PROGRESS.md` as required by the authorized milestone is expected.

---

## 26. Documentation Standards

### 26.1 README

Keep `README.md` concise and operational.

It should document:

- Product summary
- Prerequisites
- Install command
- Development command
- Test commands
- Build command
- Relevant local configuration
- Current milestone status where useful

Do not duplicate the entire specification in the README.

### 26.2 PROGRESS

`PROGRESS.md` records implementation state and material decisions.

Do not use it as a general diary.

Record:

- Current authorized milestone
- Status
- Completed milestones
- Decisions
- Deviations
- Known limitations
- Validation results

### 26.3 Comments

Prefer clear code over explanatory comments.

Use comments for:

- Non-obvious invariants
- Security-sensitive decisions
- Database compatibility constraints
- Intentional workarounds
- Reasons for unusual code

Do not add comments that merely restate the code.

### 26.4 Decision records

Do not create a large architecture-decision-record system unless explicitly
requested.

Record milestone-level decisions in `PROGRESS.md`.

Create a separate decision document only when a decision is substantial enough
to require detailed alternatives and consequences.

---

## 27. Performance and Operational Guidelines

Do not optimize prematurely, but preserve these principles:

- Normal session startup must not call the LLM.
- Avoid unbounded question-bank queries.
- Paginate management views when data volume requires it.
- Do not load full source documents into list views.
- Cache synthesized audio.
- Bound AI generation counts.
- Bound imported file sizes.
- Bound URL retrieval sizes.
- Avoid loading binary media into relational rows.
- Avoid client-side exposure of entire private datasets.

Use measurement before introducing caching beyond explicitly required caches.

---

## 28. D1-Specific Instructions

The currently authorized D1 milestone builds only the foundation and deterministic
demo catalog.

### 28.1 Required D1 routes

Implement:

- `/`
- `/study-tracks/[slug]`
- `/health`

### 28.2 Required D1 dashboard behavior

The home page must display:

- `StudyBench`
- `Build your study bank. Learn anywhere.`
- A concise personal-study-workbench description
- Two clearly labeled demo study tracks
- Working links to each demo detail page

Suggested demo tracks:

- AWS Certified Generative AI Developer – Professional (AIP-C01)
- HSK Chinese — Demo Track

All objectives, descriptions, progress-like values, or labels must be clearly
identified as demo content.

Do not claim demo objectives are complete or official exam outlines.

### 28.3 Required D1 detail behavior

Each detail page must display:

- Track name
- Provider or category
- Study type
- Demo badge
- Short description
- A small read-only objective summary
- Working navigation back to the dashboard

Unknown slugs must render the Next.js not-found experience.

### 28.4 Required D1 health behavior

`/health` must return safe JSON similar to:

    {
      "status": "ok",
      "application": "study-bench"
    }

Do not return:

- Environment variables
- Dependency versions
- Host information
- Filesystem paths
- Database details
- AWS account details

### 28.5 Required D1 catalog boundary

Use a narrow interface equivalent to:

    interface StudyCatalog {
      listTracks(): Promise<StudyTrackSummary[]>;

      findTrackBySlug(
        slug: string,
      ): Promise<StudyTrackDetail | null>;
    }

Implement it with deterministic local demo data.

Do not add methods for:

- Create
- Update
- Delete
- Search
- Transactions
- Persistence
- Pagination

Those are not needed in D1.

### 28.6 D1 prohibited work

Do not add:

- SQLite
- PostgreSQL
- An ORM
- AWS SDKs
- Bedrock
- Polly
- Transcribe
- S3
- Authentication
- Question-bank entities
- Flashcard entities
- Study-session entities
- Source ingestion
- AI prompt templates
- PWA functionality
- ECS infrastructure
- Empty modules for future features
- Disabled future controls

### 28.7 D1 tests

At minimum, verify:

- The catalog returns the expected demo tracks.
- A known slug returns a detail result.
- An unknown slug returns `null`.
- The home view displays StudyBench identity.
- Demo content is visibly labeled.
- The health route returns the safe expected payload.

### 28.8 D1 acceptance gate

D1 is complete only when:

- The application starts locally.
- The dashboard works.
- Both demo detail links work.
- Unknown slugs render not found.
- The health route works.
- The UI works on mobile and desktop widths.
- No dead controls exist.
- No database dependency exists.
- No AWS dependency exists.
- No future module is stubbed.
- Format verification passes.
- Lint passes.
- Type checking passes.
- Tests pass.
- Production build passes.
- `README.md` is current.
- `PROGRESS.md` is current.
- The completion report is provided.
- Work stops before D2.

---

## 29. Definition of Done

A task is not complete merely because code was written.

A milestone is done only when:

- Its acceptance criteria are satisfied.
- Scope exclusions were respected.
- The application remains runnable.
- Relevant tests were added.
- Tests pass.
- Lint passes.
- Type checking passes.
- Production build passes.
- Manual verification is documented.
- Documentation is updated.
- `PROGRESS.md` reflects reality.
- Deviations are reported.
- No unauthorized future work was added.
- Claude stops and waits for authorization.

If one of these conditions is not met, report the milestone as incomplete.

---

## 30. Final Instruction

Optimize for:

- Correctness
- Incremental delivery
- Inspectable behavior
- Clear boundaries
- Maintainable code
- Fast feedback
- Honest reporting

Do not optimize for:

- Maximum code volume
- Maximum abstraction
- Completing future milestones early
- Demonstrating every possible pattern
- Hiding uncertainty
- Producing a broad but incomplete implementation

The preferred outcome of every authorized milestone is:

`A small, complete, tested, runnable vertical slice that the owner can inspect before continuing.`