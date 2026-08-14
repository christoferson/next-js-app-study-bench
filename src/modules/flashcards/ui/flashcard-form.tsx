"use client";

import { useActionState } from "react";
import Link from "next/link";
import { FieldErrors } from "@/shared/ui/field-errors";
import type { FormState } from "@/shared/ui/form-state";
import {
  IDLE_FORM_STATE,
  fieldErrors,
  formLevelErrors,
} from "@/shared/ui/form-state";
import type {
  CardType,
  FlashcardRevision,
} from "@/modules/flashcards/domain/flashcard";
import {
  describeCardPrompting,
  describeCardType,
} from "@/modules/flashcards/domain/flashcard";
import type { VocabularyExample } from "@/modules/flashcards/domain/flashcard";
import {
  CLOZE_CLOSE,
  CLOZE_HINT_SEPARATOR,
  CLOZE_OPEN,
} from "@/modules/flashcards/domain/flashcard-content";

type FlashcardFormAction = (
  state: FormState,
  form: FormData,
) => Promise<FormState>;

interface FlashcardFormProps {
  readonly action: FlashcardFormAction;
  readonly submitLabel: string;
  readonly cancelHref: string;
  readonly slug: string;
  readonly cardType: CardType;
  /** Present when creating; the track the new draft will belong to. */
  readonly certificationId?: string;
  /** Present when editing; the card a new revision will be appended to. */
  readonly flashcardId?: string;
  /** The revision being edited, used to prefill the fields. */
  readonly revision?: FlashcardRevision;
}

/**
 * Create and edit form for one flashcard.
 *
 * The card type is fixed by the caller rather than chosen inside the form: the type
 * decides which fields exist, so the new-card route asks for it first. On edit the
 * type comes from the type picker on the edit page, which is what lets the owner
 * turn a basic card into a vocabulary one by appending a revision.
 *
 * Every field is uncontrolled, so the browser keeps typed text through a rejected
 * submission and the form needs no client state at all.
 */
export function FlashcardForm({
  action,
  submitLabel,
  cancelHref,
  slug,
  cardType,
  certificationId,
  flashcardId,
  revision,
}: FlashcardFormProps) {
  const [state, formAction, isPending] = useActionState(
    action,
    IDLE_FORM_STATE,
  );
  // Prefill only from a revision of the same type: a basic card's front is not a
  // vocabulary card's term, so switching type starts from empty fields.
  const content =
    revision !== undefined && revision.cardType === cardType
      ? revision.content
      : undefined;
  const initial = (field: string, fallback: string): string =>
    state.values[field] ?? fallback;
  const formErrors = formLevelErrors(state);

  return (
    <form action={formAction} className="form" noValidate>
      <input type="hidden" name="slug" value={slug} readOnly />
      <input type="hidden" name="cardType" value={cardType} readOnly />
      {certificationId !== undefined ? (
        <input
          type="hidden"
          name="certificationId"
          value={certificationId}
          readOnly
        />
      ) : null}
      {flashcardId !== undefined ? (
        <input type="hidden" name="flashcardId" value={flashcardId} readOnly />
      ) : null}

      {formErrors.length > 0 ? (
        <FieldErrors id="flashcard-form-errors" messages={formErrors} />
      ) : null}

      <p className="field-hint">
        {describeCardType(cardType)} — {describeCardPrompting(cardType)}
      </p>

      {cardType === "BASIC" || cardType === "REVERSED" ? (
        <>
          <TextField
            name="front"
            label="Front"
            required
            rows={3}
            hint={
              cardType === "REVERSED"
                ? "Written the same way round as a basic card. This side is revealed as the answer."
                : "The side that prompts you."
            }
            state={state}
            defaultValue={initial(
              "front",
              content !== undefined &&
                (content.type === "BASIC" || content.type === "REVERSED")
                ? content.front
                : "",
            )}
          />
          <TextField
            name="back"
            label="Back"
            required
            rows={3}
            hint={
              cardType === "REVERSED"
                ? "This side prompts you when the card comes up."
                : "The side that answers."
            }
            state={state}
            defaultValue={initial(
              "back",
              content !== undefined &&
                (content.type === "BASIC" || content.type === "REVERSED")
                ? content.back
                : "",
            )}
          />
        </>
      ) : null}

      {cardType === "CLOZE" ? (
        <TextField
          name="text"
          label="Sentence"
          required
          rows={4}
          hint={`Wrap each part to blank out in ${CLOZE_OPEN} and ${CLOZE_CLOSE}, for example: An S3 bucket name must be ${CLOZE_OPEN}globally unique${CLOZE_CLOSE}. Add a hint after a ${CLOZE_HINT_SEPARATOR}: ${CLOZE_OPEN}globally unique${CLOZE_HINT_SEPARATOR}across every account${CLOZE_CLOSE}.`}
          state={state}
          defaultValue={initial(
            "text",
            content !== undefined && content.type === "CLOZE"
              ? content.text
              : "",
          )}
        />
      ) : null}

      {cardType === "VOCABULARY" ? (
        <>
          <TextField
            name="term"
            label="Term"
            required
            hint="The word or phrase this card teaches."
            state={state}
            defaultValue={initial(
              "term",
              content !== undefined && content.type === "VOCABULARY"
                ? content.term
                : "",
            )}
          />
          <TextField
            name="reading"
            label="Reading"
            hint="Optional pronunciation such as pinyin or kana."
            state={state}
            defaultValue={initial(
              "reading",
              content !== undefined && content.type === "VOCABULARY"
                ? (content.reading ?? "")
                : "",
            )}
          />
          <TextField
            name="meaning"
            label="Meaning"
            required
            rows={2}
            hint="What the term means."
            state={state}
            defaultValue={initial(
              "meaning",
              content !== undefined && content.type === "VOCABULARY"
                ? content.meaning
                : "",
            )}
          />
          <TextField
            name="exampleSentence"
            label="Example sentence"
            rows={2}
            hint="Optional. The term used in context."
            state={state}
            defaultValue={initial(
              "exampleSentence",
              content !== undefined && content.type === "VOCABULARY"
                ? (content.exampleSentence ?? "")
                : "",
            )}
          />

          {/*
            The richer fields are collapsed by default so the four fields that
            make a usable card stay the whole form for anyone typing one by hand.
            A `details` element rather than a toggle: it needs no client state,
            and the browser expands it when a field inside it is focused, so a
            rejected submission still shows the message next to its cause.
          */}
          <details
            className="disclosure"
            open={hasRicherFields(state, content)}
          >
            <summary>More fields</summary>
            <div className="form-stack">
              <TextField
                name="meanings"
                label="Further meanings"
                rows={3}
                hint="Optional, one per line. Other senses of the term, beyond the meaning above."
                state={state}
                defaultValue={initial(
                  "meanings",
                  vocabularyLines(content, (vocabulary) => vocabulary.meanings),
                )}
              />
              <TextField
                name="synonyms"
                label="Synonyms"
                rows={2}
                hint="Optional, one per line."
                state={state}
                defaultValue={initial(
                  "synonyms",
                  vocabularyLines(content, (vocabulary) => vocabulary.synonyms),
                )}
              />
              <TextField
                name="antonyms"
                label="Antonyms"
                rows={2}
                hint="Optional, one per line."
                state={state}
                defaultValue={initial(
                  "antonyms",
                  vocabularyLines(content, (vocabulary) => vocabulary.antonyms),
                )}
              />
              <TextField
                name="examples"
                label="Further examples"
                rows={4}
                hint={`Optional, one per line as sentence ${CLOZE_HINT_SEPARATOR} reading ${CLOZE_HINT_SEPARATOR} translation. The reading and the translation may be left off.`}
                state={state}
                defaultValue={initial(
                  "examples",
                  exampleLines(
                    content !== undefined && content.type === "VOCABULARY"
                      ? content.examples
                      : undefined,
                  ),
                )}
              />
              <TextField
                name="usageNotes"
                label="Usage notes"
                rows={3}
                hint="Optional. Register, collocations, or what to watch out for."
                state={state}
                defaultValue={initial(
                  "usageNotes",
                  content !== undefined && content.type === "VOCABULARY"
                    ? (content.usageNotes ?? "")
                    : "",
                )}
              />
            </div>
          </details>
        </>
      ) : null}

      {cardType === "SCENARIO" ? (
        <>
          <TextField
            name="scenario"
            label="Situation"
            required
            rows={3}
            hint="The setting the question is asked in."
            state={state}
            defaultValue={initial(
              "scenario",
              content !== undefined && content.type === "SCENARIO"
                ? content.scenario
                : "",
            )}
          />
          <TextField
            name="question"
            label="Question"
            required
            rows={2}
            hint="What the situation asks you to decide."
            state={state}
            defaultValue={initial(
              "question",
              content !== undefined && content.type === "SCENARIO"
                ? content.question
                : "",
            )}
          />
          <TextField
            name="answer"
            label="Answer"
            required
            rows={3}
            hint="The answer, revealed after you recall it."
            state={state}
            defaultValue={initial(
              "answer",
              content !== undefined && content.type === "SCENARIO"
                ? content.answer
                : "",
            )}
          />
        </>
      ) : null}

      <TextField
        name="notes"
        label="Your note"
        rows={3}
        hint="Optional, for you only. Never shown while reviewing."
        state={state}
        defaultValue={initial("notes", revision?.notes ?? "")}
      />

      <div className="form-row">
        <div className="field">
          <label htmlFor="language">Language</label>
          <p className="field-hint" id="language-hint">
            Optional tag such as <code>en</code> or <code>zh</code>.
          </p>
          <input
            id="language"
            name="language"
            type="text"
            className="input-narrow"
            aria-describedby={
              fieldErrors(state, "language") !== undefined
                ? "language-hint language-error"
                : "language-hint"
            }
            aria-invalid={fieldErrors(state, "language") !== undefined}
            defaultValue={initial("language", revision?.language ?? "")}
          />
          <FieldErrors
            id="language-error"
            messages={fieldErrors(state, "language")}
          />
        </div>

        <div className="field">
          <label htmlFor="tags">Tags</label>
          <p className="field-hint" id="tags-hint">
            Optional, comma separated.
          </p>
          <input
            id="tags"
            name="tags"
            type="text"
            aria-describedby={
              fieldErrors(state, "tags") !== undefined
                ? "tags-hint tags-error"
                : "tags-hint"
            }
            aria-invalid={fieldErrors(state, "tags") !== undefined}
            defaultValue={initial("tags", revision?.tags.join(", ") ?? "")}
          />
          <FieldErrors id="tags-error" messages={fieldErrors(state, "tags")} />
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" className="button" disabled={isPending}>
          {isPending ? "Saving…" : submitLabel}
        </button>
        <Link className="button-quiet" href={cancelHref}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

/** The field names inside the disclosure, so it can open when one is in play. */
const RICHER_VOCABULARY_FIELDS: readonly string[] = [
  "meanings",
  "synonyms",
  "antonyms",
  "examples",
  "usageNotes",
];

/**
 * Whether the disclosure starts open.
 *
 * Open when the card already carries one of these fields, and open when a
 * rejected submission has a message or a typed value for one of them — a
 * validation message hidden inside a collapsed section is a form that looks
 * broken for no visible reason.
 */
function hasRicherFields(
  state: FormState,
  content: FlashcardRevision["content"] | undefined,
): boolean {
  if (
    RICHER_VOCABULARY_FIELDS.some(
      (field) =>
        fieldErrors(state, field) !== undefined ||
        (state.values[field] ?? "").trim().length > 0,
    )
  ) {
    return true;
  }

  if (content === undefined || content.type !== "VOCABULARY") {
    return false;
  }

  return (
    content.meanings !== undefined ||
    content.synonyms !== undefined ||
    content.antonyms !== undefined ||
    content.examples !== undefined ||
    content.usageNotes !== undefined
  );
}

/** One of the card's optional string lists, as one entry per line. */
function vocabularyLines(
  content: FlashcardRevision["content"] | undefined,
  select: (
    vocabulary: Extract<FlashcardRevision["content"], { type: "VOCABULARY" }>,
  ) => readonly string[] | undefined,
): string {
  if (content === undefined || content.type !== "VOCABULARY") {
    return "";
  }

  return (select(content) ?? []).join("\n");
}

/** Examples as the pipe-separated lines the schema parses back. */
function exampleLines(
  examples: readonly VocabularyExample[] | undefined,
): string {
  return (examples ?? [])
    .map((example) =>
      [example.text, example.reading, example.translation]
        .filter((part): part is string => part !== undefined)
        .join(` ${CLOZE_HINT_SEPARATOR} `),
    )
    .join("\n");
}

interface TextFieldProps {
  readonly name: string;
  readonly label: string;
  readonly state: FormState;
  readonly defaultValue: string;
  readonly hint?: string;
  readonly required?: boolean;
  /** Renders a textarea with this many rows; omit for a single-line input. */
  readonly rows?: number;
}

/**
 * One labelled text field with its hint and its validation messages.
 *
 * Card content is a handful of text fields that differ only in label, hint, and
 * size, so one component renders them all and every field is wired to its errors
 * the same way (`spec/UI-GUIDELINES.md` section 1.3: errors are associated with
 * their field).
 */
function TextField({
  name,
  label,
  state,
  defaultValue,
  hint,
  required = false,
  rows,
}: TextFieldProps) {
  const errors = fieldErrors(state, name);
  const hintId = `${name}-hint`;
  const errorId = `${name}-error`;
  const describedBy = [
    ...(hint === undefined ? [] : [hintId]),
    ...(errors === undefined ? [] : [errorId]),
  ].join(" ");

  return (
    <div className="field">
      <label htmlFor={name}>
        {label}
        {required ? <span className="field-required"> (required)</span> : null}
      </label>
      {hint === undefined ? null : (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {rows === undefined ? (
        <input
          id={name}
          name={name}
          type="text"
          required={required}
          aria-describedby={describedBy.length > 0 ? describedBy : undefined}
          aria-invalid={errors !== undefined}
          defaultValue={defaultValue}
        />
      ) : (
        <textarea
          id={name}
          name={name}
          rows={rows}
          required={required}
          aria-describedby={describedBy.length > 0 ? describedBy : undefined}
          aria-invalid={errors !== undefined}
          defaultValue={defaultValue}
        />
      )}
      <FieldErrors id={errorId} messages={errors} />
    </div>
  );
}
