# ARCHITECTURE — StudyBench

Deep reference for structural decisions.

**Read before:** adding a module, creating a directory, defining a repository or
facade, adding a route handler, or changing persistence.

**Authority:** below `SPEC.md` and `PROGRESS.md`. See `CLAUDE.md` section 3.

Moved verbatim from `CLAUDE.md` sections 8, 9, 10, 13, and 27.

---

## 1. One full-stack application

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

---

## 2. Layered modular architecture

Use these conceptual layers when a feature requires them:

- Domain
- Application
- Ports
- Infrastructure
- UI

Responsibilities must remain clear.

### 2.1 Domain

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

### 2.2 Application

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

### 2.3 Ports

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

### 2.4 Infrastructure

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

### 2.5 UI

UI code contains:

- React components
- Route pages
- Forms
- View models
- Presentation formatting
- User interaction state

UI code must not execute raw SQL or initialize AWS clients.

---

## 3. No speculative structure

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

---

## 4. Prefer vertical slices

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

## 5. Repository and facade rules

### 5.1 Domain-specific repositories

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

### 5.2 Focused facades

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

### 5.3 Strategy pattern

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

### 5.4 Composition root

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

## 6. Next.js conventions

### 6.1 Framework

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

### 6.2 Route handlers

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

### 6.3 Server-only code

Database access, AWS SDK use, secrets, and filesystem access must remain in
server-only modules.

Never import server-only modules into Client Components.

Never expose secrets through:

- Public environment variables
- HTML
- Browser bundles
- Client logs
- API responses

### 6.4 Dynamic routes

Unknown dynamic resource identifiers must use the Next.js not-found behavior
where appropriate.

Do not render a normal success page saying "not found."

### 6.5 Error handling

Use explicit domain or application errors for expected failures.

Do not rely on string matching against arbitrary error messages.

Do not expose stack traces or internal implementation details to users.

### 6.6 Loading and empty states

Add loading, empty, and error states when the implemented capability can
meaningfully encounter them.

Do not add speculative loading states for features that do not exist.

---

## 7. Persistence rules

### 7.1 Local database

Beginning in D2, local application persistence uses SQLite.

Default path:

`./data/study-bench.db`

Every application SQLite connection must configure:

    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

Use strict tables where practical.

Do not add SQLite during D1.

### 7.2 Production database

Production persistence uses PostgreSQL beginning in D13.

The final hosting selection between RDS PostgreSQL and Aurora PostgreSQL is
deferred until D13.

Do not add PostgreSQL dependencies or migrations before the authorized milestone
requires them.

### 7.3 Database parity

SQLite and PostgreSQL implementations must provide the same domain-observable
repository behavior, but they do not need identical SQL.

Do not force PostgreSQL behavior into SQLite through fragile emulation.

Do not promise that changing one environment variable makes all database
differences disappear without contract testing.

### 7.4 Repository contract tests

Beginning when repositories are introduced, express their shared behavior through
contract tests.

When PostgreSQL is introduced, run the relevant contracts against both:

- SQLite
- PostgreSQL

### 7.5 Transactions

Operations that modify related records atomically must use a unit-of-work or
transaction boundary.

Examples:

- Saving a question and its first revision
- Recording an attempt and updating review scheduling
- Completing a session item
- Activating a generated batch
- Retiring content and updating pending eligibility

Do not place transaction handling in React components or route handlers.

### 7.6 Migrations

Database schema changes must use migrations.

Do not modify an already-applied migration after it has become part of a completed
milestone unless explicitly correcting an unreleased local milestone.

Prefer adding a new migration.

Migrations must be:

- Ordered
- Repeatable in a clean environment
- Tested
- Documented when they require data transformation

### 7.7 Large content

Do not store large binary files in relational tables.

Store metadata and object keys in the database.

Store file contents in:

- Local filesystem during local development
- Amazon S3 in production

---

## 8. Performance and operational guidelines

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
