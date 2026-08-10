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

This file is loaded into every session. It holds the rules that apply to all work.
Deep rules live in `spec/` and are read when the current task touches them.

---

## 2. Required Reading

Before planning or changing code, read in this order:

1. `SPEC.md` section 0 (implementation contract) and section 18 (milestone plan)
2. `SPEC.md` — the section for the authorized milestone
3. `PROGRESS.md`
4. This file
5. The `spec/` files that the current task touches, per section 6
6. `README.md`, once it exists
7. Relevant source files and tests for the authorized milestone

Do not read all of `SPEC.md` every session. It is long, and only the contract, the
milestone plan, and the current milestone section are needed to start.

If `PROGRESS.md` is missing or empty and the authorized milestone requires it,
create it using the initial structure defined in `SPEC.md` section 0.2.

Do not begin implementation until the current authorized milestone is known.

---

## 3. Authority and Conflict Resolution

Use the following precedence:

1. The user's latest explicit instruction
2. `SPEC.md` for product requirements, milestone scope, and acceptance criteria
3. `PROGRESS.md` for recorded implementation state
4. `CLAUDE.md` for engineering workflow and coding conventions
5. `spec/` reference files for detailed rules within their subject area
6. Existing implementation patterns

If these sources conflict in a way that changes product behavior or milestone
scope:

- Do not guess.
- Do not silently choose one interpretation.
- Explain the conflict.
- Ask for clarification before making broad changes.

---

## 4. Authorized Milestone

Only one milestone is ever authorized at a time.

Determine it from, in order:

1. The user's latest explicit instruction
2. `PROGRESS.md`

A request such as the following authorizes the named milestone:

`Continue with D2.`

General feedback, a bug report, an architectural discussion, or a request to
inspect code does not authorize the next milestone.

Once the authorized milestone is known, its goal, scope, exclusions, required
routes, tests, and acceptance criteria come from the matching `SPEC.md` section.
`SPEC.md` is the single source of truth for milestone content. Do not restate
milestone requirements here.

For the authorized milestone:

- Implement that milestone only.
- Do not begin the next one.
- Do not partially implement a future milestone.
- Do not create placeholder code, empty modules, or disabled controls for future
  milestones.
- Do not install a dependency that the authorized milestone does not use.
- Preserve all behavior completed in earlier milestones.
- Keep the application runnable.
- Stop after the milestone passes its acceptance criteria.
- Report completion and wait for authorization.

Never advance to another milestone merely because the current one is complete.

---

## 5. Workflow Summary

Every milestone follows six steps. The full process and the mandatory completion
report format are in `spec/WORKFLOW.md`. Read it before starting a milestone and
again before declaring one complete.

1. **Inspect** — read the milestone section, the repository state, existing
   patterns, and `git status`. Identify uncommitted user changes.
2. **Plan** — state the milestone, the vertical slice, files to change, tests to
   add, verification commands, and any ambiguity needing user input.
3. **Implement** — one small complete vertical slice. Tests alongside behavior.
   Run targeted checks throughout, not only at the end.
4. **Verify** — run format, lint, type-check, tests, and build. Perform and
   document manual verification.
5. **Record** — update `PROGRESS.md` with status, decisions, deviations, known
   limitations, and validation results.
6. **Stop** — provide the completion report and wait for explicit authorization.

Do not claim that a command passed if it was not run successfully. If a command
could not run, report the exact command, why, the error, and what remains
unverified.

---

## 6. Deep Reference Map

Read the relevant file before working in its area. Do not load all of them.

| Read | Before |
| --- | --- |
| `spec/WORKFLOW.md` | Starting or completing any milestone |
| `spec/ARCHITECTURE.md` | Adding a module or directory, defining a repository or facade, adding a route handler, changing persistence |
| `spec/CODING-STANDARDS.md` | Defining types, modeling variant content, generating IDs, handling time, validating external input |
| `spec/TESTING.md` | Adding or changing tests, introducing a repository or external-service adapter |
| `spec/UI-GUIDELINES.md` | Building or changing any user-facing view |
| `spec/SECURITY.md` | Handling secrets or credentials, adding the access gate, fetching a URL, adding logs |
| `spec/DOMAIN-RULES.md` | Modeling questions, revisions, lifecycle, quality state, or session composition |
| `spec/AI-GUIDELINES.md` | Touching Bedrock, prompts, provenance, personas, Polly, or Transcribe |

These files hold detail, not exceptions. Nothing in `spec/` overrides sections 3,
4, 7, 8, or 9 of this file.

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

Do not add a separate backend service. StudyBench must remain one full-stack
TypeScript Next.js application deployed as one ECS service. See
`spec/ARCHITECTURE.md` section 1.

A future single-owner access gate is allowed only in the production-hardening
milestone. It must not become a multi-user product model.

`SPEC.md` section 3 records the full non-goals list and is authoritative.

---

## 8. Dependency Rules

Before adding a dependency:

1. Confirm that the authorized milestone needs it.
2. Confirm that the platform does not already provide the capability.
3. Prefer a maintained, focused package.
4. Avoid overlapping libraries.
5. Explain significant dependency choices in the completion report.

Do not add dependencies for future milestones. A dependency belongs to the
milestone that first uses it — database drivers, ORMs, AWS SDKs, AI SDKs,
authentication, PDF, audio, PWA, vector databases, and state-management libraries
all wait for their milestone.

Use `npm` and commit the lockfile.

Do not manually edit dependency versions in the lockfile.

---

## 9. Git and File Safety

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

## 10. Project Commands

The repository must provide documented commands for development, formatting,
formatting verification, linting, type checking, unit and component tests,
integration tests when introduced, and production build.

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

If the repository already uses equivalent names, preserve consistency and document
them in `README.md`.

---

## 11. Definition of Done

A task is not complete merely because code was written.

A milestone is done only when:

- Its acceptance criteria in `SPEC.md` are satisfied.
- Scope exclusions were respected.
- The application remains runnable.
- Relevant tests were added.
- Tests pass.
- Format verification passes.
- Lint passes.
- Type checking passes.
- Production build passes.
- Manual verification is documented.
- `README.md` is current.
- `PROGRESS.md` reflects reality.
- Deviations are reported.
- No unauthorized future work was added.
- The completion report is provided.
- Work stops and waits for authorization.

If one of these conditions is not met, report the milestone as incomplete.

---

## 12. Final Instruction

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
