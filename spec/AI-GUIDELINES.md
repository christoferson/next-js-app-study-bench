# AI-GUIDELINES — StudyBench

Rules for AI generation, certification personas, and speech.

**Read before:** touching Bedrock, prompts, generation provenance, persona
behavior, Polly, or Transcribe. These rules apply beginning with the authorized
AI milestone (D6) and the audio milestones (D10, D11).

**Authority:** below `SPEC.md` and `PROGRESS.md`. See `CLAUDE.md` section 3.

Moved verbatim from `CLAUDE.md` sections 14, 15, and 18.

---

## 1. AI engineering rules

These rules apply beginning with the authorized AI milestone.

### 1.1 AI behind a gateway

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

### 1.2 Provenance

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

### 1.3 Model knowledge is allowed

Claude or another Bedrock model may generate questions from raw model knowledge.

Such content must be identified as model-generated and ungrounded unless source
evidence exists.

Raw model knowledge is not prohibited.

It is one supported provenance mode.

### 1.4 Generated content defaults to draft

AI-generated questions and flashcards must default to:

- Lifecycle: `DRAFT`
- Quality status: `UNREVIEWED`, unless a separate review occurred

Do not auto-activate generated content in the initial implementation.

### 1.5 Generation and verification are separate

Do not treat the generator as the sole authority on its output.

The workflow may include:

1. Generate candidate
2. Validate schema
3. Apply deterministic checks
4. Optionally run a separate AI review
5. Let the owner inspect or edit
6. Activate only through an explicit workflow

### 1.6 Prompt location

Prompt templates must:

- Live outside route handlers
- Be versioned
- Be associated with a persona
- Be testable with fixtures
- Be recorded in generation metadata

Do not embed long prompts directly in React components.

### 1.7 Prompt-injection protection

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

### 1.8 Deterministic output checks

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

### 1.9 Fake AI for tests

Default automated tests must not call Bedrock.

Use deterministic fakes and fixtures.

Live AWS tests must be:

- Explicitly enabled
- Cost-bounded
- Excluded from default test commands
- Safe to rerun
- Clearly reported

### 1.10 No hidden question rewrites

The tutor or verifier must not silently modify an existing question revision.

A proposed correction must become:

- A quality finding
- A dispute recommendation
- A proposed new revision
- An owner-controlled action

Historical attempts must continue to reference the old revision.

---

## 2. Certification persona rules

### 2.1 Persona selection

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

### 2.2 Technical certification behavior

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

### 2.3 HSK behavior

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

## 3. Audio and speech rules

These rules apply beginning with the relevant audio milestones.

### 3.1 Gateways

Do not directly import Polly or Transcribe SDKs into domain or application
modules.

Use:

- `SpeechSynthesisGateway`
- `SpeechTranscriptionGateway`

### 3.2 Audio caching

Identical speech-synthesis requests must reuse cached output.

The cache identity must account for:

- Normalized text
- Language
- Voice
- Engine
- Speech rate
- Relevant speech configuration

### 3.3 Speech-evaluation limits

Amazon Transcribe output is a transcript, not a precise pronunciation score.

Do not claim:

- Exact tone accuracy
- Exact phoneme accuracy
- Clinical or expert pronunciation assessment

A transcript mismatch may be presented as:

- A possible pronunciation issue
- A possible recognition issue
- A reason to retry

### 3.4 Recording privacy

Voice recordings must:

- Remain private
- Have a delete action
- Have defined retention behavior
- Not be retained indefinitely without owner intent
