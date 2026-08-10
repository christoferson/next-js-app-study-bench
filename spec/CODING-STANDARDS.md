# CODING-STANDARDS — StudyBench

TypeScript and validation standards.

**Read before:** defining types, modeling variant content, generating IDs,
handling time, or validating any external input.

**Authority:** below `SPEC.md` and `PROGRESS.md`. See `CLAUDE.md` section 3.

Moved verbatim from `CLAUDE.md` sections 11 and 12.

---

## 1. TypeScript standards

### 1.1 Strictness

TypeScript strict mode is mandatory.

Do not weaken compiler settings to avoid fixing a type error.

Avoid:

- `any`
- Unsafe type assertions
- Non-null assertions without a documented invariant
- Broad `Record<string, unknown>` domain objects
- Untyped JSON parsing

Use `unknown` at external boundaries and validate before use.

### 1.2 Domain types

Prefer explicit domain names:

- `StudyTrackId`
- `QuestionId`
- `QuestionRevisionId`
- `ObjectiveId`
- `GenerationMode`
- `QuestionLifecycleStatus`

Do not overuse primitive wrappers when they add no safety or clarity.

### 1.3 Discriminated unions

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

### 1.4 Exhaustive handling

Use exhaustive switching for closed unions.

A new question type must cause relevant compile-time failures until renderers,
validators, and evaluators handle it deliberately.

### 1.5 IDs

Generate IDs in application code using an injected generator where deterministic
testing requires one.

The default production-capable implementation may use:

`crypto.randomUUID()`

Do not rely on database-specific auto-increment IDs for domain identity.

### 1.6 Time

Represent application time consistently in UTC.

Inject a clock into time-sensitive domain services when deterministic tests
require it.

Do not scatter direct `new Date()` calls through scheduling and session-selection
logic.

---

## 2. Validation

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
