# TESTING — StudyBench

What to test, at which level, and how to keep tests deterministic and free.

**Read before:** adding or changing tests, or introducing a repository or an
external-service adapter.

**Authority:** below `SPEC.md` and `PROGRESS.md`. See `CLAUDE.md` section 3.

Moved verbatim from `CLAUDE.md` section 22.

---

## 1. Test behavior, not implementation trivia

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

---

## 2. Test levels

Use the smallest useful level:

- Unit tests for pure domain logic
- Repository contract tests for persistence behavior
- Component tests for user interactions
- Route tests for request/response behavior
- End-to-end tests for important completed vertical slices

---

## 3. Determinism

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

---

## 4. Test data

Use clearly fictional or explicitly demo-labeled data.

Do not present generated sample questions as official exam questions.

---

## 5. External services

Default tests must never incur AWS cost.

Live AWS tests must require an explicit opt-in environment setting and must not
run as part of the normal `npm test` command.
