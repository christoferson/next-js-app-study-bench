import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { certificationFixture } from "@/modules/certifications/infrastructure/test-support";
import {
  questionFixture,
  revisionFixture,
} from "@/modules/question-bank/infrastructure/test-support";
import {
  cardRevisionFixture,
  flashcardFixture,
  vocabularyContent,
} from "@/modules/flashcards/infrastructure/test-support";
import type {
  GeneratedItemReview,
  GenerationRunDetailView,
} from "@/modules/ai-generation/application/generation-facade";
import type { GenerationRun } from "@/modules/ai-generation/domain/generation-run";
import { personaForStudyType } from "@/modules/ai-generation/domain/personas";
import { generationRunFixture } from "@/modules/ai-generation/infrastructure/test-support";
import { GenerationRunReview } from "./generation-run-review";

// The review screen renders a Server Action into the reject form's `action`; the action
// itself is exercised through the facade tests.
vi.mock("./actions", () => ({ rejectDraftAction: vi.fn() }));

const TRACK = certificationFixture();

/** A generated question draft, as the facade reports it for review. */
function questionItem(
  overrides: {
    readonly id?: string;
    readonly stem?: string;
    readonly lifecycleStatus?: "DRAFT" | "ACTIVE";
    readonly rejectable?: boolean;
    readonly changedSinceGeneration?: boolean;
  } = {},
): GeneratedItemReview {
  const id = overrides.id ?? "question-1";

  return {
    kind: "QUESTION",
    item: {
      question: questionFixture({
        id,
        generationMode: "MODEL_KNOWLEDGE",
        generationRunId: "run-1",
        lifecycleStatus: overrides.lifecycleStatus ?? "DRAFT",
      }),
      revision: revisionFixture({
        questionId: id,
        stem: overrides.stem ?? "Which demo service stores fictional objects?",
        explanation: "Because this demo says so.",
      }),
    },
    rejectable: overrides.rejectable ?? true,
    changedSinceGeneration: overrides.changedSinceGeneration ?? false,
  };
}

function cardItem(): GeneratedItemReview {
  return {
    kind: "FLASHCARD",
    item: {
      flashcard: flashcardFixture({
        generationMode: "MODEL_KNOWLEDGE",
        generationRunId: "run-1",
      }),
      revision: cardRevisionFixture({ content: vocabularyContent() }),
    },
    rejectable: true,
    changedSinceGeneration: false,
  };
}

const COMPLETED_RUN: GenerationRun = generationRunFixture({
  requestedItemCount: 2,
  successfulItemCount: 2,
  usageMetadata: { inputTokens: 420, outputTokens: 260, totalTokens: 680 },
  startedAt: "2026-04-01T09:00:00.000Z",
  completedAt: "2026-04-01T09:00:04.000Z",
  status: "COMPLETED",
});

function renderReview(
  overrides: {
    readonly run?: GenerationRun;
    readonly items?: readonly GeneratedItemReview[];
    readonly counts?: GenerationRunDetailView["counts"];
    readonly persona?: GenerationRunDetailView["persona"];
  } = {},
): void {
  const items = overrides.items ?? [questionItem()];

  render(
    <GenerationRunReview
      view={{
        certification: TRACK,
        run: overrides.run ?? COMPLETED_RUN,
        counts: overrides.counts ?? {
          total: items.length,
          draft: items.length,
          active: 0,
        },
        items,
        persona:
          overrides.persona === undefined
            ? personaForStudyType("TECHNICAL_CERTIFICATION")
            : overrides.persona,
      }}
    />,
  );
}

/** The text of one `dl` entry, found by its term. */
function metaValue(term: string): string {
  const dt = screen.getByText(term, { selector: "dt" });

  return dt.parentElement?.querySelector("dd")?.textContent ?? "";
}

describe("GenerationRunReview", () => {
  describe("what produced the batch", () => {
    it("marks the batch as model knowledge and says nothing was verified", () => {
      renderReview();

      expect(screen.getByText("AI generated — model knowledge")).toBeVisible();
      expect(
        screen.getByText(/no source consulted and nothing verified/),
      ).toBeVisible();
      expect(
        screen.getByText(/none of it is official exam material/),
      ).toBeVisible();
    });

    it("names the model, the persona version, and the template version", () => {
      // These three are the only record of why an old batch reads differently from a
      // new one (`spec/AI-GUIDELINES.md` section 1.9).
      renderReview();

      expect(metaValue("Model")).toBe("fake-deterministic via fake");
      expect(metaValue("Persona")).toBe(
        "Technical certification (technical-certification v1)",
      );
      expect(metaValue("Prompt template")).toBe("question-model-knowledge v1");
    });

    it("falls back to the recorded identifier when the persona is no longer known", () => {
      renderReview({ persona: null });

      expect(metaValue("Persona")).toBe(
        "technical-certification (technical-certification v1)",
      );
    });

    it("reports the token usage the provider gave", () => {
      renderReview();

      expect(metaValue("Tokens")).toBe("420 in, 260 out, 680 total");
    });

    it("says usage was not reported rather than showing a zero", () => {
      renderReview({
        run: generationRunFixture({ status: "COMPLETED", usageMetadata: null }),
      });

      expect(metaValue("Tokens")).toBe("Not reported");
    });

    it("separates what the run wrote from what is still in the bank", () => {
      // A batch the owner has since rejected must not keep claiming its items.
      renderReview({
        run: COMPLETED_RUN,
        items: [questionItem()],
        counts: { total: 1, draft: 0, active: 1 },
      });

      expect(metaValue("Written")).toBe("2");
      expect(metaValue("Still in the bank")).toBe("1 (0 draft, 1 active)");
    });

    it("shows the outcome as a word, not by colour alone", () => {
      renderReview();

      expect(screen.getByText("Completed")).toBeVisible();
    });
  });

  describe("a run that failed", () => {
    const FAILED_RUN: GenerationRun = generationRunFixture({
      requestedItemCount: 3,
      successfulItemCount: 0,
      failedItemCount: 3,
      failureReason: "MODEL_ACCESS_DENIED",
      completedAt: "2026-04-01T09:00:02.000Z",
      status: "FAILED",
    });

    it("explains the failure in words the owner can act on", () => {
      renderReview({ run: FAILED_RUN, items: [] });

      const notice = screen.getByRole("status");

      expect(notice).toHaveTextContent(
        "This account cannot use the configured model in this region.",
      );
      expect(screen.getByText("Failed")).toBeVisible();
    });

    it("never shows a provider message, a stack trace, or a credential", () => {
      // The failure is stored as a category, so there is nothing to leak
      // (`spec/SECURITY.md`).
      renderReview({ run: FAILED_RUN, items: [] });

      const page = document.body.textContent ?? "";

      expect(page).not.toMatch(/arn:|AKIA|at Object\.|Error:/);
    });

    it("says the run saved nothing rather than showing an empty list", () => {
      renderReview({
        run: FAILED_RUN,
        items: [],
        counts: { total: 0, draft: 0, active: 0 },
      });

      expect(screen.getByText("This run saved nothing.")).toBeVisible();
      expect(screen.queryByRole("button", { name: /Reject/ })).toBeNull();
    });

    it("distinguishes a run whose items were all rejected afterwards", () => {
      renderReview({
        run: COMPLETED_RUN,
        items: [],
        counts: { total: 0, draft: 0, active: 0 },
      });

      expect(
        screen.getByText(
          "Everything this run produced has since been deleted.",
        ),
      ).toBeVisible();
    });
  });

  describe("the items it produced", () => {
    it("previews a question without spoiling the answer", () => {
      renderReview();

      // The stem appears in the row's own preview and again inside the disclosure,
      // because both faces render from the bank's own component.
      expect(
        screen.getAllByText("Which demo service stores fictional objects?", {
          selector: ".question-stem",
        }),
      ).toHaveLength(2);
      // The explanation sits behind the disclosure, so reviewing a batch does not
      // spoil the questions the owner keeps.
      expect(screen.getByText("Reveal the answer")).toBeVisible();
      expect(screen.getByText("Because this demo says so.")).not.toBeVisible();
    });

    it("previews a card with the bank's own card face", () => {
      renderReview({ items: [cardItem()] });

      expect(
        screen.getAllByText("学习", { selector: ".card-study-prompt" }),
      ).toHaveLength(2);
      // The meaning is the answer, so it too waits behind the disclosure.
      expect(screen.getByText("to study; to learn")).not.toBeVisible();
    });

    it("says every item is a draft that study cannot reach", () => {
      renderReview();

      expect(screen.getByText("Status: Draft")).toBeVisible();
      expect(
        screen.getByText(/nothing here can appear in a study session/),
      ).toBeVisible();
    });

    it("links each item to its own page, where it is edited or activated", () => {
      // Accepting is activating, which lives with the rest of the item's lifecycle;
      // this screen does not offer a competing path to the same transition.
      renderReview();

      expect(
        screen.getByRole("link", { name: "Open to edit or activate" }),
      ).toHaveAttribute(
        "href",
        "/study-tracks/demo-cloud-practitioner/questions/question-1",
      );
    });

    it("offers rejection for a draft, named so it reads out of context", () => {
      renderReview();

      expect(
        screen.getByRole("button", {
          name: "Reject Which demo service stores fictional objects?",
        }),
      ).toBeVisible();
    });

    it("withdraws rejection once the owner has activated the item", () => {
      renderReview({
        items: [
          questionItem({
            lifecycleStatus: "ACTIVE",
            rejectable: false,
            changedSinceGeneration: true,
          }),
        ],
      });

      expect(screen.queryByRole("button", { name: /^Reject/ })).toBeNull();
      expect(
        screen.getByText(/no longer a draft, so generation will not delete it/),
      ).toBeVisible();
      expect(screen.getByText("Status: Not a draft any more")).toBeVisible();
    });

    it("marks an item the owner has since changed and says the preview is theirs", () => {
      renderReview({
        items: [questionItem({ changedSinceGeneration: true })],
      });

      expect(screen.getByText("Changed since generation")).toBeVisible();
      expect(
        screen.getByText(/what is shown below is your version/),
      ).toBeVisible();
    });

    it("does not mark an untouched draft as changed", () => {
      renderReview();

      expect(screen.queryByText("Changed since generation")).toBeNull();
    });

    it("lists every item of a mixed-state batch", () => {
      renderReview({
        items: [
          questionItem({ id: "question-1", stem: "First demo question?" }),
          questionItem({
            id: "question-2",
            stem: "Second demo question?",
            lifecycleStatus: "ACTIVE",
            rejectable: false,
          }),
        ],
        counts: { total: 2, draft: 1, active: 1 },
      });

      expect(
        screen.getByRole("link", { name: "First demo question?" }),
      ).toBeVisible();
      expect(
        screen.getByRole("link", { name: "Second demo question?" }),
      ).toBeVisible();
      expect(screen.getAllByRole("button", { name: /^Reject/ })).toHaveLength(
        1,
      );
    });
  });
});
