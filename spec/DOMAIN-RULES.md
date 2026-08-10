# DOMAIN-RULES — StudyBench

Invariants for question content and study sessions.

**Read before:** modeling questions, revisions, lifecycle, quality state, or
session composition. Question rules apply from D3; session rules apply from D5.

**Authority:** below `SPEC.md` and `PROGRESS.md`. See `CLAUDE.md` section 3.

Moved verbatim from `CLAUDE.md` sections 16 and 17.

---

## 1. Question and revision rules

These rules apply when the question-bank milestone is authorized.

### 1.1 Question root and immutable revisions

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

### 1.2 Lifecycle and quality are separate

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

### 1.3 Deletion

Hard deletion is allowed only when the question has no protected dependent
history.

Otherwise, use retirement or archival.

Do not cascade-delete study history to make a question deletable.

### 1.4 Historical integrity

Attempts and artifacts must reference exact revisions.

Do not display current question text as if it were the text used for a historical
attempt.

---

## 2. Study session rules

These rules apply beginning with the study-session milestone.

### 2.1 No required AI call at session start

A normal study session must start from existing active bank content.

Starting a session must not wait for Bedrock.

AI may later support:

- Explanations
- Free-text grading
- Challenges
- Follow-up questions
- Bank replenishment

### 2.2 Session selection

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

### 2.3 Frozen revisions

When a session is created, store the selected question and flashcard revision IDs.

A later content edit must not change an in-progress session.

### 2.4 Save incrementally

Persist after every completed item.

Do not wait until the session ends to save all attempts.

Sessions must support interruption and resumption.

### 2.5 Diagnostics

Diagnostics are optional.

If skipped:

- Do not assign a score of zero.
- Mark relevant content as `UNSEEN`.
- Prioritize it as new content.
