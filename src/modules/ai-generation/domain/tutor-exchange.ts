/**
 * What the owner may ask a tutor about one question, and what a tutor may answer
 * (`SPEC.md` section 25.2, `spec/AI-GUIDELINES.md` section 1.10).
 *
 * The shape here is the design decision of this slice, so it is worth stating plainly.
 * Tutoring is **a bounded menu of single asks**, not a conversation. Each ask is one
 * structured call whose answer is validated and recorded as its own run, and there is no
 * chat history, no thread, and no accumulated context. Three reasons:
 *
 * - `SPEC.md` section 25.2 lists specific asks — a follow-up explanation, a beginner
 *   explanation, a technical explanation, a choice-by-choice explanation, a follow-up
 *   question — and every one of them is answerable from the question alone. None of them
 *   needs the previous turn.
 * - One call per ask is what makes an answer *inspectable*: it has a recorded prompt
 *   template, a recorded model, a token count, and the exact revision it was about. A
 *   chat transcript would have one provenance record for many claims.
 * - It is bounded in cost by construction. A menu of asks cannot become a long thread the
 *   owner is billed for by accident.
 *
 * The consequence is that `converse` on the language-model gateway port remains
 * unimplemented. A free-chat tutor would be a future enhancement rather than something
 * this slice needs, and adding the method with no caller would be an unused abstraction
 * (`spec/ARCHITECTURE.md` section 3).
 *
 * Domain code is framework-free: no React, Next.js, database driver, AWS SDK, or
 * environment access.
 */

/**
 * The one thing the owner asked for.
 *
 * A closed list rather than free text, and that is the safety property as much as the
 * cost one: every kind below is a request to *explain what is already stored*, so there
 * is no ask that means "change this question". The tutor is never in a position to
 * propose a rewrite, because no ask requests one (`SPEC.md` section 25.3, "the tutor
 * cannot silently rewrite a question").
 *
 * `EXPLAIN_CHOICE` is the only kind that needs an argument — which choice — and that is
 * why the request type below is a union rather than a bare kind.
 */
export type TutorAskKind =
  | "EXPLAIN_ANSWER"
  | "EXPLAIN_CHOICE"
  | "EXPLAIN_SIMPLER"
  | "EXPLAIN_TECHNICAL"
  | "GIVE_EXAMPLE"
  | "FOLLOW_UP_QUESTION";

export const TUTOR_ASK_KINDS: readonly TutorAskKind[] = [
  "EXPLAIN_ANSWER",
  "EXPLAIN_CHOICE",
  "EXPLAIN_SIMPLER",
  "EXPLAIN_TECHNICAL",
  "GIVE_EXAMPLE",
  "FOLLOW_UP_QUESTION",
];

/**
 * One ask, as the facade receives it.
 *
 * `choiceId` is optional in the type rather than being modelled as a discriminated union
 * on the kind, because this value comes from a form and every field on a form is
 * optional until it is parsed. The schema requires it for `EXPLAIN_CHOICE` and the
 * template refuses to render without it, so the union would only move the check.
 *
 * `note` is the owner's own free text — "I still do not get why the VPC matters" — and it
 * travels into the prompt inside `<owner_request>` like every other piece of owner text.
 */
export interface TutorAsk {
  readonly kind: TutorAskKind;
  /** Which choice `EXPLAIN_CHOICE` is about. Ignored by every other kind. */
  readonly choiceId: string | null;
  /** Optional free-text note from the owner. */
  readonly note: string | null;
}

/** Bounds on one tutor answer, so a runaway response cannot fill a column. */
export const TUTOR_TEXT_LIMIT = 4000;
export const TUTOR_STEM_LIMIT = 1000;
export const TUTOR_ANSWER_LIMIT = 1000;
export const TUTOR_NOTE_LIMIT = 500;

/**
 * How many "items" one ask asks for: one answer.
 *
 * The run schema requires `requested_item_count >= 1`, and one answer is the honest
 * number for a single ask.
 */
export const TUTOR_ITEM_COUNT = 1;

/** How many past exchanges a question's page shows. */
export const TUTOR_EXCHANGE_LIMIT = 5;

/**
 * A tutor's answer, by what was asked.
 *
 * A union keyed on the same `kind` the ask carried, so a stored payload says which ask it
 * answers and a panel cannot render a follow-up question as though it were an
 * explanation. The `kind` is *validated against the ask* rather than trusted, so a model
 * that answers a different question than the one it was asked fails validation.
 *
 * What is deliberately absent is the whole of the no-rewrite acceptance criterion. There
 * is no field anywhere in this union that can carry replacement question content: no
 * corrected stem, no replacement choice, no revised answer key, no `correctedAnswer`. A
 * tutor that wanted to fix the question can only talk about it. That is
 * `spec/AI-GUIDELINES.md` section 1.10 expressed as a type — the same construction the
 * review uses — so a hidden rewrite is not something the code has to remember to refuse.
 */
export type TutorResponse =
  | { readonly kind: "EXPLAIN_ANSWER"; readonly text: string }
  | {
      readonly kind: "EXPLAIN_CHOICE";
      /** Echoed back, and checked against the choice that was asked about. */
      readonly choiceId: string;
      readonly text: string;
    }
  | { readonly kind: "EXPLAIN_SIMPLER"; readonly text: string }
  | { readonly kind: "EXPLAIN_TECHNICAL"; readonly text: string }
  | { readonly kind: "GIVE_EXAMPLE"; readonly text: string }
  | {
      readonly kind: "FOLLOW_UP_QUESTION";
      /**
       * A further question to think about, and only that.
       *
       * Ephemeral tutoring content: it is shown in the panel, recorded on the run so the
       * exchange is readable later, and **not inserted into the question bank**. Adding a
       * bank item means a draft, a lifecycle, objective mapping, deterministic checks,
       * and an owner review — which is the generation pipeline, and it already exists
       * (`SPEC.md` section 24). "Ask a follow-up question" in `SPEC.md` section 6.16 is a
       * tutoring interaction, so this is a question to *read*, not one to study.
       */
      readonly stem: string;
      readonly answer: string;
      readonly explanation: string;
    };

/** The ask a stored response answers, for reading an exchange back. */
export function responseKind(response: TutorResponse): TutorAskKind {
  return response.kind;
}

/**
 * What the owner asked, in the owner's words.
 *
 * Used as the button label, as the heading of a recorded exchange, and in the prompt's
 * own statement of the ask, so the three cannot describe the same ask differently.
 */
export function describeAskKind(kind: TutorAskKind): string {
  switch (kind) {
    case "EXPLAIN_ANSWER":
      return "Explain the answer";
    case "EXPLAIN_CHOICE":
      return "Why is this choice wrong?";
    case "EXPLAIN_SIMPLER":
      return "Explain it simply";
    case "EXPLAIN_TECHNICAL":
      return "Explain it technically";
    case "GIVE_EXAMPLE":
      return "Give an example";
    case "FOLLOW_UP_QUESTION":
      return "Ask me a follow-up question";
  }
}

/**
 * What the tutor is being asked to do, as the instruction sent to the model.
 *
 * In the domain rather than in the template because it is the substance of the ask
 * rather than the wording of the prompt, and because a fixture test asserting that six
 * asks render six different user messages needs one place to read them from.
 *
 * Each is written against the failure mode that ask actually has. "Simpler" drifts into
 * being shorter rather than more elementary; "technical" drifts into jargon for its own
 * sake; "example" drifts into restating the question; a follow-up question drifts into
 * being the same question again.
 */
export function askInstruction(kind: TutorAskKind): string {
  switch (kind) {
    case "EXPLAIN_ANSWER":
      return "Explain why the answer this question marks as correct is the answer. Say what the question is really testing, why the marked answer follows, and — briefly — why the other choices do not. Go beyond the explanation the question already stores rather than restating it.";
    case "EXPLAIN_CHOICE":
      return "Explain why the one choice named below is not the answer to this question. Say what that choice actually is or does, what somebody who picked it was probably thinking, and what would have to be different about the question for it to be the right answer.";
    case "EXPLAIN_SIMPLER":
      return "Explain the answer to somebody meeting this topic for the first time. Use plain words, define every term you cannot avoid, and use a concrete comparison. Simpler means more elementary, not shorter: do not compress the explanation, unfold it.";
    case "EXPLAIN_TECHNICAL":
      return "Explain the answer at the depth somebody who already knows the basics would want: the mechanism, the constraints, the edge cases, and where the boundary with the neighbouring answer actually falls. Use precise terminology and say what each term means at first use, rather than reaching for jargon as a substitute for the explanation.";
    case "GIVE_EXAMPLE":
      return "Give a concrete worked example of what this question is about. A real situation with specific details, walked through step by step, ending in the outcome. Do not restate the question as the example.";
    case "FOLLOW_UP_QUESTION":
      return "Write one further question that tests the same understanding from a different angle — a neighbouring case, a consequence, or the same idea in another situation. It must not be a reworded copy of the question above. Supply its answer and a short explanation, because this is a question for the person to think about and then check, not one they will be marked on.";
  }
}

/**
 * Whether the tutor's answer answers the ask it was given.
 *
 * The deterministic check for a tutor exchange, and it exists for the reason every other
 * deterministic check does: the model is never the authority on its own output
 * (`spec/AI-GUIDELINES.md` sections 1.5 and 1.8). Two things are checked here rather
 * than in the schema, because both are about the *relationship* between the ask and the
 * answer, which a schema cannot see:
 *
 * - the kind answered is the kind asked, so an answer cannot be filed under the wrong
 *   ask and read months later as though it were about something else;
 * - `EXPLAIN_CHOICE` echoes back a choice identifier that the question actually has, and
 *   the one that was asked about. A model that invents a choice id, or explains a
 *   different choice than the one the owner clicked, has answered a question nobody
 *   asked.
 *
 * Messages name a field and an expectation and carry none of the owner's text, so they
 * are safe to send back to the provider as repair feedback
 * (`spec/AI-GUIDELINES.md` section 1.7).
 */
export function checkTutorResponse(
  response: TutorResponse,
  ask: TutorAsk,
  choiceIds: readonly string[],
): readonly string[] {
  const problems: string[] = [];

  if (response.kind !== ask.kind) {
    problems.push(`kind: must be ${ask.kind}, which is what was asked`);
  }

  if (response.kind === "EXPLAIN_CHOICE") {
    if (!choiceIds.includes(response.choiceId)) {
      problems.push(
        "choiceId: must be one of the choice identifiers given with the question",
      );
    } else if (ask.choiceId !== null && response.choiceId !== ask.choiceId) {
      problems.push(
        "choiceId: must be the choice the request named, not another one",
      );
    }
  }

  return problems;
}
