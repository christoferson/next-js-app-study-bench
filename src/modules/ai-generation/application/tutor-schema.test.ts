import { describe, expect, it } from "vitest";
import {
  TUTOR_ASK_KINDS,
  TUTOR_TEXT_LIMIT,
} from "@/modules/ai-generation/domain/tutor-exchange";
import type {
  TutorAsk,
  TutorAskKind,
  TutorResponse,
} from "@/modules/ai-generation/domain/tutor-exchange";
import {
  readTutorResponse,
  serializeTutorResponse,
  tutorJsonSchema,
  tutorResponseValidator,
} from "./tutor-schema";

/**
 * The tutor answer contract.
 *
 * Four properties are pinned here, and each is one of the slice's acceptance criteria held
 * by the schema rather than by the prompt:
 *
 * - an answer must answer the ask that was made, so an answer cannot be filed under a
 *   different ask and read months later as though it were about something else;
 * - a choice-by-choice answer must echo back a choice the question really has, and the one
 *   that was asked about;
 * - there is nowhere in the accepted shape to put replacement question content, so a tutor
 *   that returns a rewrite has it dropped rather than rendered
 *   (`spec/AI-GUIDELINES.md` section 1.10);
 * - the same schema reads the stored payload back, so a row it would not have accepted comes
 *   back as `null` rather than as half an answer.
 */

const CHOICE_IDS = ["choice-1", "choice-2", "choice-3"] as const;

function ask(overrides: Partial<TutorAsk> = {}): TutorAsk {
  return { kind: "EXPLAIN_ANSWER", choiceId: null, note: null, ...overrides };
}

function accepted(asked: TutorAsk, value: unknown): TutorResponse {
  const result = tutorResponseValidator(asked, CHOICE_IDS)(value);

  if (!result.ok) {
    throw new Error(
      `Expected a valid answer, got: ${result.errors.join("; ")}`,
    );
  }

  return result.value;
}

function rejection(asked: TutorAsk, value: unknown): readonly string[] {
  const result = tutorResponseValidator(asked, CHOICE_IDS)(value);

  if (result.ok) {
    throw new Error("Expected the answer to be rejected.");
  }

  return result.errors;
}

/** A valid answer for each ask, so every kind can be round-tripped. */
function answerFor(kind: TutorAskKind): Record<string, unknown> {
  if (kind === "FOLLOW_UP_QUESTION") {
    return {
      kind,
      stem: "Which storage service would you use for a 40 TB archive?",
      answer: "Amazon S3 Glacier Deep Archive.",
      explanation: "It is the cheapest durable tier for data read rarely.",
    };
  }

  return kind === "EXPLAIN_CHOICE"
    ? {
        kind,
        choiceId: "choice-2",
        text: "Amazon EBS is block storage attached to one instance.",
      }
    : {
        kind,
        text: "Objects live in buckets, which is what the stem describes.",
      };
}

function askFor(kind: TutorAskKind): TutorAsk {
  return ask({
    kind,
    choiceId: kind === "EXPLAIN_CHOICE" ? "choice-2" : null,
  });
}

describe("tutorResponseValidator", () => {
  it("accepts a valid answer for every one of the six asks", () => {
    for (const kind of TUTOR_ASK_KINDS) {
      expect(accepted(askFor(kind), answerFor(kind)).kind).toBe(kind);
    }
  });

  it("refuses an answer to a different ask than the one that was made", () => {
    // The check a JSON Schema cannot make: the answer is well-formed, it is just not an
    // answer to this question.
    expect(
      rejection(
        ask({ kind: "EXPLAIN_SIMPLER" }),
        answerFor("EXPLAIN_ANSWER"),
      ).join(" "),
    ).toMatch(/EXPLAIN_SIMPLER/);
  });

  it("refuses a follow-up question when an explanation was asked for", () => {
    expect(rejection(ask(), answerFor("FOLLOW_UP_QUESTION")).join(" ")).toMatch(
      /EXPLAIN_ANSWER/,
    );
  });

  it("requires the choice-by-choice answer to echo the identifier back", () => {
    expect(
      rejection(askFor("EXPLAIN_CHOICE"), {
        kind: "EXPLAIN_CHOICE",
        text: "Because it is block storage.",
      }).join(" "),
    ).toMatch(/choiceId/);
  });

  it("refuses an invented choice identifier", () => {
    // A model that makes up a choice has answered about a question the owner does not have.
    expect(
      rejection(askFor("EXPLAIN_CHOICE"), {
        ...answerFor("EXPLAIN_CHOICE"),
        choiceId: "choice-9",
      }).join(" "),
    ).toMatch(/must be one of the choice identifiers given with the question/);
  });

  it("refuses a real choice that is not the one that was asked about", () => {
    expect(
      rejection(askFor("EXPLAIN_CHOICE"), {
        ...answerFor("EXPLAIN_CHOICE"),
        choiceId: "choice-3",
      }).join(" "),
    ).toMatch(/must be the choice the request named/);
  });

  it("requires non-empty prose for every explaining ask", () => {
    for (const kind of TUTOR_ASK_KINDS) {
      if (kind === "FOLLOW_UP_QUESTION") {
        continue;
      }

      expect(
        rejection(askFor(kind), { ...answerFor(kind), text: "   " }).join(" "),
      ).toMatch(/text/);
    }
  });

  it("requires all three parts of a follow-up question", () => {
    for (const missing of ["stem", "answer", "explanation"]) {
      const partial = { ...answerFor("FOLLOW_UP_QUESTION") };
      delete partial[missing];

      expect(
        rejection(askFor("FOLLOW_UP_QUESTION"), partial).join(" "),
      ).toContain(missing);
    }
  });

  it("bounds the answer, so one call cannot return an essay", () => {
    expect(
      rejection(ask(), {
        kind: "EXPLAIN_ANSWER",
        text: "x".repeat(TUTOR_TEXT_LIMIT + 1),
      }).join(" "),
    ).toMatch(/characters or fewer/);
  });

  it("has nowhere to put a rewritten question, so a rewrite is dropped", () => {
    // `spec/AI-GUIDELINES.md` section 1.10 by construction: the acceptance criterion is
    // that the tutor cannot silently rewrite a question, and the strongest form of that is
    // an accepted value with no field a rewrite could live in.
    const value = accepted(ask(), {
      ...answerFor("EXPLAIN_ANSWER"),
      correctedStem: "A corrected stem the owner must never see",
      correctedAnswer: "choice-3",
      choices: ["one", "two"],
    });

    expect(JSON.stringify(value)).not.toContain("corrected");
    expect(JSON.stringify(value)).not.toContain("choices");
  });

  it("drops a field the ask does not use rather than failing the call", () => {
    // Noise is not worth spending the one repair attempt on.
    const value = accepted(ask({ kind: "EXPLAIN_SIMPLER" }), {
      ...answerFor("EXPLAIN_SIMPLER"),
      choiceId: "choice-1",
    });

    expect(value).toEqual({
      kind: "EXPLAIN_SIMPLER",
      text: answerFor("EXPLAIN_SIMPLER").text,
    });
  });

  it("names a field and an expectation, never the value that failed", () => {
    // Validation messages travel back to the provider as repair feedback
    // (`spec/AI-GUIDELINES.md` section 1.7).
    const errors = rejection(ask(), {
      kind: "EXPLAIN_ANSWER",
      text: 42,
    });

    expect(errors.join(" ")).toContain("text");
    expect(errors.join(" ")).not.toContain("42");
  });
});

describe("reading a stored answer back", () => {
  it("round-trips every kind through the stored payload", () => {
    for (const kind of TUTOR_ASK_KINDS) {
      const value = accepted(askFor(kind), answerFor(kind));

      expect(readTutorResponse(serializeTutorResponse(value))).toEqual(value);
    }
  });

  it("returns null for a missing payload, unreadable JSON, and a bad shape", () => {
    expect(readTutorResponse(null)).toBeNull();
    expect(readTutorResponse("{not json")).toBeNull();
    expect(readTutorResponse(JSON.stringify({ kind: "NONSENSE" }))).toBeNull();
    expect(
      readTutorResponse(JSON.stringify({ kind: "EXPLAIN_ANSWER" })),
    ).toBeNull();
  });

  it("still reads an answer about a choice the question no longer has", () => {
    // A recorded exchange is history. Re-checking it against today's choices would hide an
    // answer that was correct when it was given; the panel labels it as an earlier revision
    // instead.
    const stored = JSON.stringify({
      kind: "EXPLAIN_CHOICE",
      choiceId: "choice-since-deleted",
      text: "That choice described block storage.",
    });

    expect(readTutorResponse(stored)).toEqual({
      kind: "EXPLAIN_CHOICE",
      choiceId: "choice-since-deleted",
      text: "That choice described block storage.",
    });
  });
});

describe("tutorJsonSchema", () => {
  it("requires only the fields the ask actually needs", () => {
    // A required `stem` on an explanation would tell the model to invent a question nobody
    // asked for.
    expect(tutorJsonSchema("EXPLAIN_ANSWER").required).toEqual([
      "kind",
      "text",
    ]);
    expect(tutorJsonSchema("EXPLAIN_CHOICE").required).toEqual([
      "kind",
      "choiceId",
      "text",
    ]);
    expect(tutorJsonSchema("FOLLOW_UP_QUESTION").required).toEqual([
      "kind",
      "stem",
      "answer",
      "explanation",
    ]);
  });

  it("offers no property that could carry replacement question content", () => {
    for (const kind of TUTOR_ASK_KINDS) {
      expect(
        Object.keys(tutorJsonSchema(kind).properties ?? {}).sort(),
      ).toEqual(["answer", "choiceId", "explanation", "kind", "stem", "text"]);
      expect(tutorJsonSchema(kind).additionalProperties).toBe(false);
    }
  });

  it("tells the model which ask it is answering", () => {
    expect(
      tutorJsonSchema("GIVE_EXAMPLE").properties?.kind?.description,
    ).toContain("GIVE_EXAMPLE");
  });

  it("says in the schema itself that nothing was looked up", () => {
    // The descriptions are part of the prompt, so the no-citation rule is stated where the
    // model is filling the field in as well as in the instructions.
    expect(
      tutorJsonSchema("EXPLAIN_ANSWER").properties?.text?.description,
    ).toMatch(/cite nothing/);
  });

  it("says the follow-up question is not being added to the bank", () => {
    expect(
      tutorJsonSchema("FOLLOW_UP_QUESTION").properties?.stem?.description,
    ).toMatch(/not added to their question bank/);
  });
});
