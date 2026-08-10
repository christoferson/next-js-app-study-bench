# WORKFLOW — StudyBench

The mandatory per-milestone process and the required completion report.

**Read before:** starting an authorized milestone, and again before declaring one
complete.

**Authority:** below `SPEC.md` and `PROGRESS.md`. See `CLAUDE.md` section 3.

Moved verbatim from `CLAUDE.md` sections 5, 6, and 26.

---

## 1. Mandatory incremental workflow

For every authorized milestone, follow this workflow.

### 1.1 Inspect

Before editing:

- Read the milestone goal, scope, exclusions, tests, and acceptance criteria.
- Inspect the current repository state.
- Inspect `package.json`, configuration files, and existing scripts.
- Inspect existing tests and architectural patterns.
- Check `git status`.
- Identify uncommitted user changes.
- Do not overwrite unrelated user work.

### 1.2 Plan

Before making changes, provide a concise implementation plan containing:

- The authorized milestone
- The vertical slice being implemented
- Expected files or areas to change
- Tests to add or update
- Verification commands
- Any ambiguity or decision that requires user input

Keep the plan specific to the authorized milestone.

Do not include speculative future architecture in the implementation plan.

### 1.3 Implement

During implementation:

- Keep the application runnable.
- Prefer a small complete vertical slice.
- Add tests with behavior.
- Avoid dead controls and placeholder pages.
- Avoid unused abstractions and dependencies.
- Preserve completed milestone behavior.
- Run targeted checks throughout development.
- Do not wait until the end to run all validation.

### 1.4 Verify

Before declaring the milestone complete, run all applicable commands for:

- Formatting verification
- Linting
- Type checking
- Unit and component tests
- Integration tests, when the milestone includes persistence
- Production build
- Any applicable end-to-end tests

Also perform and document manual verification.

### 1.5 Record

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

### 1.6 Stop

After completing the authorized milestone:

- Do not begin the next milestone.
- Do not add "helpful" future scaffolding.
- Provide the required implementation report.
- Wait for explicit user approval.

---

## 2. Required completion report

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

## 3. Documentation standards

### 3.1 README

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

### 3.2 PROGRESS

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

### 3.3 Comments

Prefer clear code over explanatory comments.

Use comments for:

- Non-obvious invariants
- Security-sensitive decisions
- Database compatibility constraints
- Intentional workarounds
- Reasons for unusual code

Do not add comments that merely restate the code.

### 3.4 Decision records

Do not create a large architecture-decision-record system unless explicitly
requested.

Record milestone-level decisions in `PROGRESS.md`.

Create a separate decision document only when a decision is substantial enough
to require detailed alternatives and consequences.
