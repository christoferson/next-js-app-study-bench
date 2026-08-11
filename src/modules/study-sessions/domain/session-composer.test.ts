import { describe, expect, it } from "vitest";
import type {
  CandidateFlashcard,
  CandidateQuestion,
  ComposedItem,
  CompositionRequest,
  ObjectiveAccuracy,
  QuestionAttemptSummary,
  SelectionReason,
} from "./session-composer";
import {
  DETERMINISTIC_COMPOSER_ID,
  DIAGNOSTIC_MIN_OBJECTIVES,
  DIAGNOSTIC_MIN_QUESTIONS,
  DeterministicSessionComposer,
  FLASHCARD_ESTIMATE_SECONDS,
  MAX_SESSION_ITEMS,
  QUESTION_ESTIMATE_SECONDS,
  WEAK_OBJECTIVE_MIN_ATTEMPTS,
  describeSelectionReason,
  estimateMinutes,
  hasStudiableMistake,
  isDiagnosticAvailable,
} from "./session-composer";
import type { SessionMode } from "./study-session";
import { SESSION_MODES } from "./study-session";

/**
 * Composition rules, tested without a database.
 *
 * The composer is pure domain logic over candidate lists, so every rule in
 * `spec/DOMAIN-RULES.md` section 2.2 is asserted directly here: nothing in this file
 * opens a connection, and no test depends on the order a query happened to return
 * rows in.
 *
 * Exclusion of draft, retired, archived, and disputed content is not tested here on
 * purpose: it is applied in SQL by `findStudyCandidates`, so it is asserted in the
 * question repository's contract instead. What is tested here is that the composer
 * never invents a candidate it was not given.
 */

const composer = new DeterministicSessionComposer();

const EARLY = "2026-01-01T00:00:00.000Z";
const MIDDLE = "2026-02-01T00:00:00.000Z";
const LATE = "2026-03-01T00:00:00.000Z";

function question(
  overrides: Partial<CandidateQuestion> & { readonly questionId: string },
): CandidateQuestion {
  return {
    questionRevisionId: `${overrides.questionId}-rev-1`,
    objectiveIds: [],
    createdAt: MIDDLE,
    ...overrides,
  };
}

function card(
  overrides: Partial<CandidateFlashcard> & { readonly flashcardId: string },
): CandidateFlashcard {
  return {
    flashcardRevisionId: `${overrides.flashcardId}-rev-1`,
    dueAt: EARLY,
    createdAt: EARLY,
    ...overrides,
  };
}

function attempt(
  overrides: Partial<QuestionAttemptSummary> & { readonly questionId: string },
): QuestionAttemptSummary {
  return {
    attemptCount: 1,
    lastAttemptedAt: MIDDLE,
    lastIsCorrect: false,
    lastConfidence: "UNCERTAIN",
    ...overrides,
  };
}

function objectiveAccuracy(
  objectiveId: string,
  attemptCount: number,
  correctCount: number,
): ObjectiveAccuracy {
  return { objectiveId, attemptCount, correctCount };
}

function request(
  overrides: Partial<CompositionRequest> = {},
): CompositionRequest {
  return {
    mode: "SINGLE_TRACK",
    targetMinutes: 10,
    questions: [],
    flashcards: [],
    attempts: [],
    objectiveAccuracy: [],
    ...overrides,
  };
}

/** The item identifiers in composed order, whichever kind each item is. */
function ids(items: readonly ComposedItem[]): string[] {
  return items.map((item) =>
    item.content.itemType === "QUESTION"
      ? item.content.questionId
      : item.content.flashcardId,
  );
}

function reasons(items: readonly ComposedItem[]): SelectionReason[] {
  return items.map((item) => item.reason);
}

describe("DeterministicSessionComposer", () => {
  it("names itself, so a later policy change is visible in review", () => {
    expect(composer.id).toBe(DETERMINISTIC_COMPOSER_ID);
  });

  it("composes nothing from nothing", () => {
    expect(composer.compose(request())).toEqual([]);
  });

  describe("priority order (spec/DOMAIN-RULES.md section 2.2)", () => {
    it("selects the seven bands in the documented order", () => {
      const items = composer.compose(
        request({
          targetMinutes: 60,
          flashcards: [card({ flashcardId: "card-due" })],
          questions: [
            question({ questionId: "q-retention", objectiveIds: ["obj-seen"] }),
            question({ questionId: "q-never-attempted" }),
            question({ questionId: "q-unseen", objectiveIds: ["obj-unseen"] }),
            question({ questionId: "q-weak", objectiveIds: ["obj-weak"] }),
            question({ questionId: "q-incorrect" }),
            question({ questionId: "q-confident-wrong" }),
          ],
          attempts: [
            attempt({
              questionId: "q-confident-wrong",
              lastIsCorrect: false,
              lastConfidence: "CONFIDENT",
            }),
            attempt({
              questionId: "q-incorrect",
              lastIsCorrect: false,
              lastConfidence: "GUESS",
            }),
            attempt({
              questionId: "q-weak",
              lastIsCorrect: true,
              lastConfidence: "FAIRLY_SURE",
            }),
            attempt({
              questionId: "q-retention",
              lastIsCorrect: true,
              lastConfidence: "FAIRLY_SURE",
            }),
          ],
          objectiveAccuracy: [
            objectiveAccuracy("obj-weak", 4, 1),
            objectiveAccuracy("obj-seen", 4, 4),
          ],
        }),
      );

      expect(reasons(items)).toEqual([
        "OVERDUE_FLASHCARD",
        "CONFIDENT_BUT_INCORRECT",
        "OTHER_INCORRECT",
        "WEAK_OBJECTIVE",
        "UNSEEN_OBJECTIVE",
        "NEVER_ATTEMPTED",
        "GENERAL_RETENTION",
      ]);
      expect(ids(items)).toEqual([
        "card-due",
        "q-confident-wrong",
        "q-incorrect",
        "q-weak",
        "q-unseen",
        "q-never-attempted",
        "q-retention",
      ]);
    });

    it("separates a confident wrong answer from an uncertain one", () => {
      const items = composer.compose(
        request({
          questions: [
            question({ questionId: "q-guessed" }),
            question({ questionId: "q-sure" }),
          ],
          attempts: [
            attempt({ questionId: "q-guessed", lastConfidence: "UNCERTAIN" }),
            attempt({ questionId: "q-sure", lastConfidence: "FAIRLY_SURE" }),
          ],
        }),
      );

      expect(ids(items)).toEqual(["q-sure", "q-guessed"]);
      expect(reasons(items)).toEqual([
        "CONFIDENT_BUT_INCORRECT",
        "OTHER_INCORRECT",
      ]);
    });

    it("treats a corrected answer as retention rather than a mistake", () => {
      const items = composer.compose(
        request({
          questions: [question({ questionId: "q-1" })],
          attempts: [attempt({ questionId: "q-1", lastIsCorrect: true })],
        }),
      );

      expect(reasons(items)).toEqual(["GENERAL_RETENTION"]);
    });

    it("needs enough evidence before calling an objective weak", () => {
      const oneWrongAnswer = composer.compose(
        request({
          questions: [question({ questionId: "q-1", objectiveIds: ["obj-1"] })],
          attempts: [attempt({ questionId: "q-1", lastIsCorrect: true })],
          objectiveAccuracy: [
            objectiveAccuracy("obj-1", WEAK_OBJECTIVE_MIN_ATTEMPTS - 1, 0),
          ],
        }),
      );

      expect(reasons(oneWrongAnswer)).toEqual(["GENERAL_RETENTION"]);

      const enoughEvidence = composer.compose(
        request({
          questions: [question({ questionId: "q-1", objectiveIds: ["obj-1"] })],
          attempts: [attempt({ questionId: "q-1", lastIsCorrect: true })],
          objectiveAccuracy: [
            objectiveAccuracy("obj-1", WEAK_OBJECTIVE_MIN_ATTEMPTS, 0),
          ],
        }),
      );

      expect(reasons(enoughEvidence)).toEqual(["WEAK_OBJECTIVE"]);
    });

    it("sorts the stalest evidence to the front within a band", () => {
      const items = composer.compose(
        request({
          questions: [
            question({ questionId: "q-recent" }),
            question({ questionId: "q-stale" }),
          ],
          attempts: [
            attempt({ questionId: "q-recent", lastAttemptedAt: LATE }),
            attempt({ questionId: "q-stale", lastAttemptedAt: EARLY }),
          ],
        }),
      );

      expect(ids(items)).toEqual(["q-stale", "q-recent"]);
    });

    it("offers the longest overdue card first", () => {
      const items = composer.compose(
        request({
          mode: "FLASHCARDS_ONLY",
          flashcards: [
            card({ flashcardId: "card-soon", dueAt: LATE }),
            card({ flashcardId: "card-overdue", dueAt: EARLY }),
            card({ flashcardId: "card-new", dueAt: null, createdAt: MIDDLE }),
          ],
        }),
      );

      expect(ids(items)).toEqual(["card-overdue", "card-new", "card-soon"]);
    });
  });

  describe("mode filtering", () => {
    it("includes only questions in a questions-only session", () => {
      const items = composer.compose(
        request({
          mode: "QUESTIONS_ONLY",
          questions: [question({ questionId: "q-1" })],
          flashcards: [card({ flashcardId: "card-1" })],
        }),
      );

      expect(ids(items)).toEqual(["q-1"]);
    });

    it("includes only flashcards in a flashcards-only session", () => {
      const items = composer.compose(
        request({
          mode: "FLASHCARDS_ONLY",
          questions: [question({ questionId: "q-1" })],
          flashcards: [card({ flashcardId: "card-1" })],
        }),
      );

      expect(ids(items)).toEqual(["card-1"]);
    });

    it.each<SessionMode>(["SINGLE_TRACK", "MIXED_TRACKS"])(
      "mixes both kinds in a %s session",
      (mode) => {
        const items = composer.compose(
          request({
            mode,
            questions: [question({ questionId: "q-1" })],
            flashcards: [card({ flashcardId: "card-1" })],
          }),
        );

        expect(ids(items)).toEqual(["card-1", "q-1"]);
      },
    );

    it("keeps only recorded mistakes in a mistake-review session", () => {
      const items = composer.compose(
        request({
          mode: "MISTAKE_REVIEW",
          targetMinutes: 60,
          flashcards: [card({ flashcardId: "card-1" })],
          questions: [
            question({ questionId: "q-wrong-sure" }),
            question({ questionId: "q-wrong-unsure" }),
            question({ questionId: "q-right" }),
            question({ questionId: "q-untouched" }),
            question({ questionId: "q-weak-objective", objectiveIds: ["obj"] }),
          ],
          attempts: [
            attempt({
              questionId: "q-wrong-sure",
              lastConfidence: "CONFIDENT",
            }),
            attempt({
              questionId: "q-wrong-unsure",
              lastConfidence: "GUESS",
            }),
            attempt({ questionId: "q-right", lastIsCorrect: true }),
            attempt({ questionId: "q-weak-objective", lastIsCorrect: true }),
          ],
          objectiveAccuracy: [objectiveAccuracy("obj", 4, 0)],
        }),
      );

      // Bands 2 and 3 only: a weak objective is a statistic, not a mistake, and a
      // never-answered question cannot be one at all.
      expect(ids(items)).toEqual(["q-wrong-sure", "q-wrong-unsure"]);
    });

    it("never composes an item it was not given a candidate for", () => {
      for (const mode of SESSION_MODES) {
        const items = composer.compose(
          request({ mode: mode === "DIAGNOSTIC" ? "SINGLE_TRACK" : mode }),
        );

        expect(items).toEqual([]);
      }
    });

    describe("whether mistake review can be offered at all", () => {
      it("is available when a studiable question was answered wrongly", () => {
        expect(
          hasStudiableMistake(
            [question({ questionId: "q-1" })],
            [attempt({ questionId: "q-1" })],
          ),
        ).toBe(true);
      });

      it("is unavailable when every recorded answer was right", () => {
        expect(
          hasStudiableMistake(
            [question({ questionId: "q-1" })],
            [attempt({ questionId: "q-1", lastIsCorrect: true })],
          ),
        ).toBe(false);
      });

      it("is unavailable when the mistaken question can no longer be studied", () => {
        // The attempt is real history the progress page still reports, but a
        // retired or disputed question is not a candidate, so composition would
        // find nothing and the mode has to be reported as unavailable rather than
        // failing after the owner presses start.
        expect(
          hasStudiableMistake(
            [question({ questionId: "q-still-active" })],
            [attempt({ questionId: "q-retired" })],
          ),
        ).toBe(false);
      });

      it("is unavailable with no answers at all", () => {
        expect(hasStudiableMistake([question({ questionId: "q-1" })], [])).toBe(
          false,
        );
      });

      it("agrees with what the composer would actually select", () => {
        // The two must not be able to disagree: availability is a promise that
        // composing will produce something.
        const questions = [question({ questionId: "q-1" })];
        const attempts = [attempt({ questionId: "q-gone" })];

        expect(hasStudiableMistake(questions, attempts)).toBe(false);
        expect(
          composer.compose(
            request({ mode: "MISTAKE_REVIEW", questions, attempts }),
          ),
        ).toEqual([]);
      });
    });
  });

  describe("no duplicates", () => {
    it("selects a repeated question candidate once", () => {
      const items = composer.compose(
        request({
          questions: [
            question({ questionId: "q-1" }),
            question({ questionId: "q-1" }),
          ],
        }),
      );

      expect(ids(items)).toEqual(["q-1"]);
    });

    it("selects a repeated card candidate once", () => {
      const items = composer.compose(
        request({
          mode: "FLASHCARDS_ONLY",
          flashcards: [
            card({ flashcardId: "card-1" }),
            card({ flashcardId: "card-1" }),
          ],
        }),
      );

      expect(ids(items)).toEqual(["card-1"]);
    });

    it("places a question in exactly one priority band", () => {
      const items = composer.compose(
        request({
          // Wrong last time and mapped to a weak, unseen-elsewhere objective: it
          // qualifies for several bands and must still appear once.
          questions: [question({ questionId: "q-1", objectiveIds: ["obj-1"] })],
          attempts: [attempt({ questionId: "q-1" })],
          objectiveAccuracy: [objectiveAccuracy("obj-1", 4, 0)],
        }),
      );

      expect(ids(items)).toEqual(["q-1"]);
      expect(reasons(items)).toEqual(["OTHER_INCORRECT"]);
    });
  });

  describe("frozen revisions (spec/DOMAIN-RULES.md section 2.3)", () => {
    it("carries the candidate's revision into the composed item", () => {
      const items = composer.compose(
        request({
          questions: [
            question({
              questionId: "q-1",
              questionRevisionId: "revision-7",
            }),
          ],
          flashcards: [
            card({
              flashcardId: "card-1",
              flashcardRevisionId: "card-revision-3",
            }),
          ],
        }),
      );

      expect(items.map((item) => item.content)).toEqual([
        {
          itemType: "FLASHCARD",
          flashcardId: "card-1",
          flashcardRevisionId: "card-revision-3",
        },
        {
          itemType: "QUESTION",
          questionId: "q-1",
          questionRevisionId: "revision-7",
        },
      ]);
    });
  });

  describe("item-count estimation", () => {
    it("fills a ten-minute session with about ten questions", () => {
      const candidates = Array.from({ length: 40 }, (_unused, index) =>
        question({ questionId: `q-${String(index).padStart(2, "0")}` }),
      );
      const items = composer.compose(
        request({ targetMinutes: 10, questions: candidates }),
      );

      expect(items).toHaveLength((10 * 60) / QUESTION_ESTIMATE_SECONDS);
    });

    it("fits more cards than questions into the same length", () => {
      const cards = Array.from({ length: 60 }, (_unused, index) =>
        card({ flashcardId: `card-${String(index).padStart(2, "0")}` }),
      );
      const items = composer.compose(
        request({
          mode: "FLASHCARDS_ONLY",
          targetMinutes: 5,
          flashcards: cards,
        }),
      );

      expect(items).toHaveLength((5 * 60) / FLASHCARD_ESTIMATE_SECONDS);
    });

    it("composes fewer items than the budget when the bank is small", () => {
      const items = composer.compose(
        request({
          targetMinutes: 30,
          questions: [question({ questionId: "q-1" })],
        }),
      );

      expect(items).toHaveLength(1);
    });

    it("always composes at least one item when anything is available", () => {
      const items = composer.compose(
        request({
          targetMinutes: 5,
          // A budget smaller than one item would otherwise open an empty session.
          questions: [question({ questionId: "q-1" })],
        }),
      );

      expect(items).toHaveLength(1);
    });

    it("caps a pathologically long request", () => {
      const cards = Array.from({ length: 400 }, (_unused, index) =>
        card({ flashcardId: `card-${String(index).padStart(3, "0")}` }),
      );
      const items = composer.compose(
        request({
          mode: "FLASHCARDS_ONLY",
          targetMinutes: 240,
          flashcards: cards,
        }),
      );

      expect(items).toHaveLength(MAX_SESSION_ITEMS);
    });

    it("reports the estimate the budget was built from", () => {
      const items = composer.compose(
        request({
          targetMinutes: 10,
          questions: Array.from({ length: 10 }, (_unused, index) =>
            question({ questionId: `q-${index}` }),
          ),
        }),
      );

      expect(estimateMinutes(items)).toBe(10);
      expect(estimateMinutes([])).toBe(1);
    });
  });

  describe("determinism", () => {
    it("returns the same selection for the same request", () => {
      const input = request({
        targetMinutes: 20,
        questions: [
          question({ questionId: "q-b" }),
          question({ questionId: "q-a" }),
          question({ questionId: "q-c" }),
        ],
        flashcards: [
          card({ flashcardId: "card-b" }),
          card({ flashcardId: "card-a" }),
        ],
      });

      expect(ids(composer.compose(input))).toEqual(
        ids(composer.compose(input)),
      );
    });

    it("ignores the order candidates arrived in", () => {
      const forwards = composer.compose(
        request({
          questions: [
            question({ questionId: "q-a" }),
            question({ questionId: "q-b" }),
            question({ questionId: "q-c" }),
          ],
        }),
      );
      const backwards = composer.compose(
        request({
          questions: [
            question({ questionId: "q-c" }),
            question({ questionId: "q-b" }),
            question({ questionId: "q-a" }),
          ],
        }),
      );

      expect(ids(forwards)).toEqual(["q-a", "q-b", "q-c"]);
      expect(ids(backwards)).toEqual(ids(forwards));
    });

    it("breaks a tie on identifier, so no two candidates compare equal", () => {
      const items = composer.compose(
        request({
          questions: [
            question({ questionId: "q-2", createdAt: MIDDLE }),
            question({ questionId: "q-1", createdAt: MIDDLE }),
          ],
        }),
      );

      expect(ids(items)).toEqual(["q-1", "q-2"]);
    });
  });

  describe("diagnostic sessions (SPEC.md section 6.9)", () => {
    const spread = Array.from({ length: 9 }, (_unused, index) =>
      question({
        questionId: `q-${String(index).padStart(2, "0")}`,
        objectiveIds: [`obj-${index % 3}`],
      }),
    );

    it("is unavailable with too few questions", () => {
      expect(
        isDiagnosticAvailable(spread.slice(0, DIAGNOSTIC_MIN_QUESTIONS - 1)),
      ).toBe(false);
    });

    it("is unavailable when the questions cover too few objectives", () => {
      const narrow = Array.from(
        { length: DIAGNOSTIC_MIN_QUESTIONS },
        (_unused, index) =>
          question({
            questionId: `q-${index}`,
            objectiveIds: [`obj-${index % (DIAGNOSTIC_MIN_OBJECTIVES - 1)}`],
          }),
      );

      expect(isDiagnosticAvailable(narrow)).toBe(false);
    });

    it("is available at the documented threshold", () => {
      expect(isDiagnosticAvailable(spread)).toBe(true);
    });

    it("spreads across objectives instead of exhausting one", () => {
      const items = composer.compose(
        request({ mode: "DIAGNOSTIC", targetMinutes: 3, questions: spread }),
      );

      // One from each objective before a second from any of them.
      expect(ids(items)).toEqual(["q-00", "q-01", "q-02"]);
    });

    it("visits unseen objectives before ones with evidence", () => {
      const items = composer.compose(
        request({
          mode: "DIAGNOSTIC",
          targetMinutes: 2,
          questions: spread,
          objectiveAccuracy: [objectiveAccuracy("obj-0", 4, 4)],
        }),
      );

      expect(ids(items)).toEqual(["q-01", "q-02"]);
      expect(reasons(items)).toEqual(["UNSEEN_OBJECTIVE", "UNSEEN_OBJECTIVE"]);
    });

    it("offers questions mapped to no objective last", () => {
      const items = composer.compose(
        request({
          mode: "DIAGNOSTIC",
          targetMinutes: 60,
          questions: [...spread, question({ questionId: "q-unmapped" })],
        }),
      );

      expect(ids(items).at(-1)).toBe("q-unmapped");
    });

    it("offers a question mapped to several objectives only once", () => {
      const items = composer.compose(
        request({
          mode: "DIAGNOSTIC",
          targetMinutes: 60,
          questions: [
            question({
              questionId: "q-shared",
              objectiveIds: ["obj-0", "obj-1", "obj-2"],
            }),
          ],
        }),
      );

      expect(ids(items)).toEqual(["q-shared"]);
    });

    it("includes no flashcards, so a diagnostic measures questions", () => {
      const items = composer.compose(
        request({
          mode: "DIAGNOSTIC",
          targetMinutes: 60,
          questions: spread,
          flashcards: [card({ flashcardId: "card-1" })],
        }),
      );

      expect(ids(items)).not.toContain("card-1");
    });
  });

  it("describes every selection reason", () => {
    const allReasons: readonly SelectionReason[] = [
      "OVERDUE_FLASHCARD",
      "CONFIDENT_BUT_INCORRECT",
      "OTHER_INCORRECT",
      "WEAK_OBJECTIVE",
      "UNSEEN_OBJECTIVE",
      "NEVER_ATTEMPTED",
      "GENERAL_RETENTION",
    ];

    for (const reason of allReasons) {
      expect(describeSelectionReason(reason).length).toBeGreaterThan(0);
    }
  });
});
