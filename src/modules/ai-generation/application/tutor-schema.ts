import { z } from "zod";
import {
  TUTOR_ANSWER_LIMIT,
  TUTOR_ASK_KINDS,
  TUTOR_STEM_LIMIT,
  TUTOR_TEXT_LIMIT,
  checkTutorResponse,
} from "@/modules/ai-generation/domain/tutor-exchange";
import type {
  TutorAsk,
  TutorAskKind,
  TutorResponse,
} from "@/modules/ai-generation/domain/tutor-exchange";
import type {
  JsonSchema,
  StructuredValidation,
} from "@/modules/ai-generation/ports/language-model-gateway";
import { enumOf } from "@/shared/schema-fields";

/**
 * Application-owned schema for one tutor answer, and the same schema used to read a
 * stored answer back out of the run row.
 *
 * Two directions, one schema, for the reason `question-review-schema.ts` gives: a model's
 * answer and a database row are both untrusted input
 * (`spec/CODING-STANDARDS.md` section 2), and here they are literally the same value —
 * what goes into `generation_runs.proposed_payload` is exactly what the validator
 * accepted. So the tutor panel cannot render an answer that would not have been accepted,
 * and a hand-edited row fails where a bad answer would.
 *
 * The permissive-schema-plus-strict-validator split is the same too. The JSON Schema sent
 * to the provider describes the *widest* shape any ask can answer in, because the port
 * sends one schema per call and a union of six shapes is not something its `JsonSchema`
 * can express; this zod schema is the authority, and it narrows the payload to the one
 * shape the ask that was made allows. A model that answers `EXPLAIN_ANSWER` with a
 * follow-up question therefore fails validation rather than being stored under the wrong
 * ask.
 *
 * One thing is worth stating about what is *absent*. No field in this schema can carry
 * replacement question content — no corrected stem, no replacement choice, no
 * `correctedAnswer`. That is `spec/AI-GUIDELINES.md` section 1.10 enforced by
 * construction: a tutor that returns a rewrite has it dropped as an unknown key rather
 * than having it reach a page where the owner might mistake it for the question
 * (`SPEC.md` section 25.3, "the tutor cannot silently rewrite a question").
 */

const KIND_KEY = "kind";

/** Non-empty text the model must supply, bounded and trimmed. */
const requiredModelText = (limit: number) =>
  z
    .string({ message: "must be a string" })
    .max(limit, { message: `use ${limit} characters or fewer` })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: "must not be empty" });

/**
 * The widest answer, as the provider may return it.
 *
 * Everything but `kind` is optional here and required by the per-kind narrowing below,
 * because which fields are needed depends on what was asked and a single zod object
 * cannot say "text unless this is a follow-up question". Splitting the check in two — one
 * shape check, then one ask-specific check — keeps the repair feedback specific: a
 * missing `text` on an explanation says `text: must be a string`, not a discriminated
 * union error naming six branches.
 */
const responseSchema = z.object({
  [KIND_KEY]: enumOf(
    TUTOR_ASK_KINDS,
    `must be one of ${TUTOR_ASK_KINDS.join(", ")}`,
  ),
  text: requiredModelText(TUTOR_TEXT_LIMIT).nullish(),
  choiceId: z
    .string({ message: "must be a string" })
    .max(200, { message: "use 200 characters or fewer" })
    .transform((value) => value.trim())
    .nullish(),
  stem: requiredModelText(TUTOR_STEM_LIMIT).nullish(),
  answer: requiredModelText(TUTOR_ANSWER_LIMIT).nullish(),
  explanation: requiredModelText(TUTOR_TEXT_LIMIT).nullish(),
});

type ParsedResponse = z.output<typeof responseSchema>;

/**
 * The validator the gateway calls, and the reader the tutor panel calls.
 *
 * Curried over the ask rather than taking it as a second argument, because the port's
 * `validate` is a one-argument function by design: the gateway knows nothing about what
 * was asked, and it should not have to. The facade closes over the ask when it builds the
 * request.
 *
 * Three checks, in order: shape, then the fields that ask requires, then the domain's
 * consistency rules (`checkTutorResponse`) — which are the ones a schema cannot see,
 * because they compare the answer with the ask and with the question's real choice
 * identifiers. Every message names a field and an expectation and carries none of the
 * owner's text, so all of them are safe to send back to the provider as repair feedback
 * (`spec/AI-GUIDELINES.md` section 1.7).
 */
export function tutorResponseValidator(
  ask: TutorAsk,
  choiceIds: readonly string[],
): (payload: unknown) => StructuredValidation<TutorResponse> {
  return (payload) => {
    const result = responseSchema.safeParse(payload);

    if (!result.success) {
      return { ok: false, errors: describeIssues(result.error) };
    }

    const narrowed = narrow(result.data);

    if (!narrowed.ok) {
      return narrowed;
    }

    const problems = checkTutorResponse(narrowed.value, ask, choiceIds);

    return problems.length > 0
      ? { ok: false, errors: problems }
      : { ok: true, value: narrowed.value };
  };
}

/**
 * The parsed payload as the one response shape its kind allows.
 *
 * Exhaustive over the ask kinds, so a seventh ask must decide what its answer looks like
 * rather than falling through to the prose shape by accident. Extra fields a kind does
 * not use are dropped rather than refused: a model that returns `choiceId` on an
 * `EXPLAIN_SIMPLER` answer has answered the ask correctly and added noise, and failing
 * the call for that would spend the repair attempt on tidiness.
 */
function narrow(parsed: ParsedResponse): StructuredValidation<TutorResponse> {
  const { kind } = parsed;

  if (kind === "FOLLOW_UP_QUESTION") {
    const missing = [
      parsed.stem === null || parsed.stem === undefined
        ? "stem: must be a non-empty string"
        : null,
      parsed.answer === null || parsed.answer === undefined
        ? "answer: must be a non-empty string"
        : null,
      parsed.explanation === null || parsed.explanation === undefined
        ? "explanation: must be a non-empty string"
        : null,
    ].filter((message): message is string => message !== null);

    if (missing.length > 0) {
      return { ok: false, errors: missing };
    }

    return {
      ok: true,
      value: {
        kind,
        stem: parsed.stem ?? "",
        answer: parsed.answer ?? "",
        explanation: parsed.explanation ?? "",
      },
    };
  }

  if (parsed.text === null || parsed.text === undefined) {
    return { ok: false, errors: ["text: must be a non-empty string"] };
  }

  if (kind === "EXPLAIN_CHOICE") {
    if (
      parsed.choiceId === null ||
      parsed.choiceId === undefined ||
      parsed.choiceId.length === 0
    ) {
      return {
        ok: false,
        errors: [
          "choiceId: must be the identifier of the choice the request named",
        ],
      };
    }

    return {
      ok: true,
      value: { kind, choiceId: parsed.choiceId, text: parsed.text },
    };
  }

  return { ok: true, value: { kind, text: parsed.text } };
}

/** The answer as stored on the run row: the accepted value, unchanged. */
export function serializeTutorResponse(response: TutorResponse): string {
  return JSON.stringify(response);
}

/**
 * A stored answer, re-validated.
 *
 * Returns `null` rather than throwing for unreadable JSON and for a payload that no
 * longer validates, so the question page can say the exchange can no longer be read
 * instead of returning a 500 for a row somebody edited by hand.
 *
 * The ask is reconstructed from the payload's own `kind` and `choiceId`, with the stored
 * choice accepted as the real one: a recorded exchange is being *read* here, and the
 * question's choices may since have been edited. Re-checking against today's choices
 * would hide an answer that was correct when it was given — the panel says the exchange
 * is about an earlier revision instead, which is the honest thing to show.
 */
export function readTutorResponse(
  payload: string | null,
): TutorResponse | null {
  if (payload === null) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  const shape = responseSchema.safeParse(parsed);

  if (!shape.success) {
    return null;
  }

  const narrowed = narrow(shape.data);

  return narrowed.ok ? narrowed.value : null;
}

/** Name of the tool the provider is asked to fill in. */
export const TUTOR_SCHEMA_NAME = "tutor_answer";

export const TUTOR_SCHEMA_DESCRIPTION =
  "Your answer to the one thing the person asked about the practice question they are studying.";

/**
 * The answer shape sent to the provider.
 *
 * One schema covering every ask, with `kind` naming which one is being answered, because
 * the port sends one schema per call. The descriptions do the narrowing the type system
 * cannot: each field says which asks use it, so a model answering `EXPLAIN_SIMPLER` is
 * told at the field itself that `stem` is not for it.
 *
 * The descriptions are part of the prompt, not documentation. Two of them carry rules
 * that matter: `text` says the explanation is of the question as stored and cites
 * nothing, and `stem` says the follow-up question is for the person to think about rather
 * than something being added to their bank.
 */
export function tutorJsonSchema(askKind: TutorAskKind): JsonSchema {
  return {
    type: "object",
    description: TUTOR_SCHEMA_DESCRIPTION,
    required: requiredFor(askKind),
    additionalProperties: false,
    properties: {
      [KIND_KEY]: {
        type: "string",
        description: `Which ask you are answering. It must be ${askKind}, because that is what was asked.`,
        enum: [...TUTOR_ASK_KINDS],
      },
      text: {
        type: "string",
        description: `Your answer, as prose the person can read on a phone: short paragraphs, no headings, no lists, no markdown. In ${TUTOR_TEXT_LIMIT} characters or fewer. Explain the question exactly as it is stored, and cite nothing — nothing was looked up for this answer. Used by every ask except FOLLOW_UP_QUESTION.`,
      },
      choiceId: {
        type: "string",
        description:
          "Only for EXPLAIN_CHOICE: the identifier of the choice you explained, copied exactly from the question. It is checked against the choice the request named, so an altered or invented identifier fails.",
      },
      stem: {
        type: "string",
        description: `Only for FOLLOW_UP_QUESTION: the further question, as a question. It is shown to the person to think about and is not added to their question bank, so write it to be read rather than to be marked. In ${TUTOR_STEM_LIMIT} characters or fewer.`,
      },
      answer: {
        type: "string",
        description: `Only for FOLLOW_UP_QUESTION: the answer to your question, in ${TUTOR_ANSWER_LIMIT} characters or fewer.`,
      },
      explanation: {
        type: "string",
        description: `Only for FOLLOW_UP_QUESTION: why that is the answer, in ${TUTOR_TEXT_LIMIT} characters or fewer.`,
      },
    },
  };
}

/**
 * Which fields the provider is told are required, by ask.
 *
 * Stated per ask rather than as one list of everything, because a required list naming
 * `stem` on an explanation would tell the model to invent a question nobody asked for.
 */
function requiredFor(askKind: TutorAskKind): readonly string[] {
  switch (askKind) {
    case "FOLLOW_UP_QUESTION":
      return [KIND_KEY, "stem", "answer", "explanation"];
    case "EXPLAIN_CHOICE":
      return [KIND_KEY, "choiceId", "text"];
    case "EXPLAIN_ANSWER":
    case "EXPLAIN_SIMPLER":
    case "EXPLAIN_TECHNICAL":
    case "GIVE_EXAMPLE":
      return [KIND_KEY, "text"];
  }
}

/**
 * Zod issues as repair feedback.
 *
 * Paths and expectations only, never the value that failed: a validation message travels
 * back to the provider, and the value here can contain the model's quotation of the
 * owner's own question (`spec/AI-GUIDELINES.md` section 1.7).
 */
function describeIssues(error: z.ZodError): readonly string[] {
  return error.issues.slice(0, 10).map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join(".");

    return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
  });
}
