import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { certificationFixture } from "@/modules/certifications/infrastructure/test-support";
import {
  questionFixture,
  revisionFixture,
} from "@/modules/question-bank/infrastructure/test-support";
import {
  cardRevisionFixture,
  enrichedVocabularyContent,
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

/**
 * One card an enrichment run rewrote, as the facade reports it.
 *
 * The card is `ACTIVE` and `MANUAL` on purpose: an enriched card is the owner's own,
 * so it never was a draft of this run and its `generationRunId` stays null. Only the
 * revision carries the run.
 */
function enrichedItem(
  overrides: {
    readonly revisionNumber?: number;
    readonly changedSinceGeneration?: boolean;
  } = {},
): GeneratedItemReview {
  return {
    kind: "ENRICH_VOCABULARY",
    item: {
      flashcard: flashcardFixture({
        lifecycleStatus: "ACTIVE",
        generationMode: "MANUAL",
        generationRunId: null,
      }),
      revision: cardRevisionFixture({
        revisionNumber: overrides.revisionNumber ?? 2,
        content: enrichedVocabularyContent(),
        generationRunId: "run-1",
      }),
    },
    rejectable: false,
    changedSinceGeneration: overrides.changedSinceGeneration ?? false,
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

    it("says outright that a fake run's items are placeholder content", () => {
      // The provenance line already names the provider, but "via fake" reads as
      // configuration detail. The owner has to be told the drafts below are invented.
      renderReview();

      expect(
        screen.getByText(/this run used the fake test provider/i),
      ).toBeVisible();
    });

    it("says nothing about the provider when a real model wrote the batch", () => {
      renderReview({
        run: generationRunFixture({
          status: "COMPLETED",
          modelProvider: "bedrock",
          modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        }),
      });

      expect(screen.queryByText(/test provider/i)).toBeNull();
      expect(metaValue("Model")).toBe(
        "us.anthropic.claude-sonnet-4-5-20250929-v1:0 via bedrock",
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

      // Found by its words rather than as *the* status region: a fake-provider run
      // also announces itself, and both are standing conditions of this page.
      expect(
        screen.getByText(
          /This account cannot use the configured model in this region\./,
        ),
      ).toBeVisible();
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

  /**
   * The same screen, reviewing an enrichment run.
   *
   * The variant exists because an enrichment run did not write anything new: it added
   * a revision to cards the owner already had. Every place the accept/reject reading
   * would be wrong has to say something else, so these tests are about the words as
   * much as the controls.
   */
  describe("a run that enriched existing cards", () => {
    const ENRICHMENT_RUN: GenerationRun = generationRunFixture({
      itemKind: "ENRICH_VOCABULARY",
      personaId: "hsk",
      promptTemplateId: "vocabulary-enrichment",
      requestedItemCount: 3,
      successfulItemCount: 2,
      failedItemCount: 1,
      completedAt: "2026-04-01T09:00:06.000Z",
      status: "PARTIAL",
    });

    function renderEnrichment(
      items: readonly GeneratedItemReview[] = [enrichedItem()],
    ): void {
      renderReview({
        run: ENRICHMENT_RUN,
        items,
        counts: { total: 40, draft: 0, active: 40 },
        persona: personaForStudyType("LANGUAGE_PROFICIENCY"),
      });
    }

    it("titles the run as enrichment rather than as new material", () => {
      renderEnrichment();

      expect(
        screen.getByRole("heading", { name: /Enriched vocabulary from AI/ }),
      ).toBeVisible();
      expect(screen.getByText("Partly completed")).toBeVisible();
    });

    it("says the previous text is still on the card", () => {
      // The owner's own words were not replaced, and that is the reassurance the
      // accept/reject wording would not give.
      renderEnrichment();

      expect(
        screen.getByText(/gained a new revision with the extra detail/),
      ).toHaveTextContent("its previous text is still on its page");
      expect(
        screen.queryByText(/none of it is official exam material/),
      ).toBeNull();
    });

    it("counts cards enriched and cards left unchanged", () => {
      // Not "written" and "rejected by checks": nothing was written, and a card the
      // model did not answer for was left exactly as it was.
      renderEnrichment();

      expect(metaValue("Enriched")).toBe("2");
      expect(metaValue("Left unchanged")).toBe("1");
      expect(screen.queryByText("Written", { selector: "dt" })).toBeNull();
      expect(
        screen.queryByText("Rejected by checks", { selector: "dt" }),
      ).toBeNull();
    });

    it("records the enrichment persona and template it ran under", () => {
      renderEnrichment();

      expect(metaValue("Persona")).toBe("HSK Chinese proficiency (hsk v1)");
      expect(metaValue("Prompt template")).toBe("vocabulary-enrichment v1");
      expect(metaValue("Requested")).toBe("3 enriched cards");
    });

    it("offers another enrichment run rather than the generate form", () => {
      renderEnrichment();

      expect(screen.getByRole("link", { name: "Enrich more" })).toHaveAttribute(
        "href",
        "/study-tracks/demo-cloud-practitioner/enrich",
      );
      expect(screen.queryByRole("link", { name: "Generate again" })).toBeNull();
    });

    it("heads the list with the cards it enriched", () => {
      renderEnrichment();

      expect(
        screen.getByRole("heading", { name: "The cards it enriched" }),
      ).toBeVisible();
      expect(
        screen.getByText(/there is nothing here to accept or reject/),
      ).toBeVisible();
      expect(
        screen.queryByText(/nothing here can appear in a study session/),
      ).toBeNull();
    });

    it("identifies each card by the revision the run wrote", () => {
      // "Draft or not" is the wrong question about a card that was already active.
      renderEnrichment();

      expect(screen.getByText("Revision 2")).toBeVisible();
      expect(screen.queryByText(/^Status:/)).toBeNull();
    });

    it("previews the new detail through the bank's own card face", () => {
      renderEnrichment();

      expect(
        screen.getAllByText("学习", { selector: ".card-study-prompt" }),
      ).toHaveLength(2);
      // The enriched fields are part of the answer, so they wait behind the
      // disclosure with the meaning.
      expect(screen.getByText("念书, 读书")).not.toBeVisible();
      expect(
        screen.getByText(/Neutral register; also used of learning/),
      ).not.toBeVisible();
    });

    it("never offers to reject a card the owner already had", () => {
      renderEnrichment();

      expect(screen.queryByRole("button", { name: /^Reject/ })).toBeNull();
      expect(
        screen.getByText(/enrichment has nothing to take back/),
      ).toBeVisible();
      expect(
        screen.getByRole("link", { name: "Open the card" }),
      ).toHaveAttribute(
        "href",
        "/study-tracks/demo-cloud-practitioner/flashcards/flashcard-1",
      );
    });

    it("says when a newer revision has replaced the one the run wrote", () => {
      renderEnrichment([
        enrichedItem({ revisionNumber: 2, changedSinceGeneration: true }),
      ]);

      expect(screen.getByText("Edited since enrichment")).toBeVisible();
      expect(
        screen.getByText(/what is shown below is that newer version/),
      ).toBeVisible();
      expect(screen.queryByText("Changed since generation")).toBeNull();
    });

    it("says the run enriched nothing rather than showing an empty list", () => {
      renderReview({
        run: generationRunFixture({
          itemKind: "ENRICH_VOCABULARY",
          successfulItemCount: 0,
          failedItemCount: 2,
          status: "FAILED",
        }),
        items: [],
        counts: { total: 40, draft: 0, active: 40 },
      });

      expect(screen.getByText("This run enriched nothing.")).toBeVisible();
    });

    it("distinguishes an enriched card the owner has since deleted", () => {
      renderEnrichment([]);

      expect(
        screen.getByText(
          "Every card this run enriched has since been deleted.",
        ),
      ).toBeVisible();
    });
  });
});
