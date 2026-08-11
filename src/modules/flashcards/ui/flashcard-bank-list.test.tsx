import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseInput } from "@/shared/parse-input";
import { objectiveFixture } from "@/modules/certifications/infrastructure/test-support";
import { flashcardFilterSchema } from "@/modules/flashcards/application/schemas";
import type { FlashcardWithRevision } from "@/modules/flashcards/domain/flashcard";
import {
  cardRevisionFixture,
  clozeContent,
  flashcardFixture,
  vocabularyContent,
} from "@/modules/flashcards/infrastructure/test-support";
import { FlashcardBankList } from "./flashcard-bank-list";
import { FlashcardFilterForm } from "./flashcard-filter-form";

const BANK: readonly FlashcardWithRevision[] = [
  {
    flashcard: flashcardFixture({
      id: "card-draft",
      updatedAt: "2026-03-03T09:00:00.000Z",
    }),
    revision: cardRevisionFixture(),
  },
  {
    flashcard: flashcardFixture({
      id: "card-converted",
      lifecycleStatus: "ACTIVE",
      sourceQuestionId: "question-1",
      updatedAt: "2026-03-04T09:00:00.000Z",
    }),
    revision: cardRevisionFixture({
      id: "card-revision-2",
      flashcardId: "card-converted",
      revisionNumber: 3,
      content: vocabularyContent(),
    }),
  },
];

describe("FlashcardBankList", () => {
  it("shows the type and the lifecycle status of each row", () => {
    render(<FlashcardBankList slug="demo" items={BANK} />);

    expect(screen.getByText("Basic")).toBeVisible();
    expect(screen.getByText("Vocabulary")).toBeVisible();
    expect(screen.getByText("Status: Draft")).toBeVisible();
    expect(screen.getByText("Status: Active")).toBeVisible();
  });

  it("marks a converted card, so provenance is visible in the bank", () => {
    render(<FlashcardBankList slug="demo" items={BANK} />);

    expect(screen.getAllByText("From a question")).toHaveLength(1);
  });

  it("links each row to its card detail page", () => {
    render(<FlashcardBankList slug="demo" items={BANK} />);

    expect(
      screen.getByRole("link", { name: "What does S3 stand for?" }),
    ).toHaveAttribute("href", "/study-tracks/demo/flashcards/card-draft");
    expect(screen.getByRole("link", { name: "学习" })).toHaveAttribute(
      "href",
      "/study-tracks/demo/flashcards/card-converted",
    );
  });

  it("shows the revision number and the update date", () => {
    render(<FlashcardBankList slug="demo" items={BANK} />);

    expect(screen.getByText("Revision 1 · updated 2026-03-03")).toBeVisible();
    expect(screen.getByText("Revision 3 · updated 2026-03-04")).toBeVisible();
  });

  it("shows the prompt side only, so scanning the bank does not spoil answers", () => {
    render(<FlashcardBankList slug="demo" items={BANK} />);

    expect(screen.queryByText(/Simple Storage Service/)).toBeNull();
    expect(screen.queryByText(/to study; to learn/)).toBeNull();
  });

  it("summarises a cloze card by its sentence rather than its markers", () => {
    render(
      <FlashcardBankList
        slug="demo"
        items={[
          {
            flashcard: flashcardFixture({ id: "card-cloze" }),
            revision: cardRevisionFixture({ content: clozeContent() }),
          },
        ]}
      />,
    );

    expect(screen.getByRole("link").textContent ?? "").not.toContain("{{");
  });

  it("truncates a long card instead of rendering it whole", () => {
    const front = `Start ${"word ".repeat(60)}end`;

    render(
      <FlashcardBankList
        slug="demo"
        items={[
          {
            flashcard: flashcardFixture({ id: "card-long" }),
            revision: cardRevisionFixture({
              content: { type: "BASIC", front, back: "Short" },
            }),
          },
        ]}
      />,
    );

    const link = screen.getByRole("link");

    expect(link.textContent ?? "").toContain("…");
    expect((link.textContent ?? "").length).toBeLessThan(front.length);
  });

  it("renders nothing but an empty list when the page has no matches", () => {
    render(<FlashcardBankList slug="demo" items={[]} />);

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});

const OBJECTIVES = [
  objectiveFixture({ id: "objective-1", code: "Domain 1", title: "Storage" }),
  objectiveFixture({
    id: "objective-2",
    code: null,
    title: "Retired area",
    status: "ARCHIVED",
  }),
];

function renderFilters(query: Record<string, string> = {}): void {
  render(
    <FlashcardFilterForm
      action="/study-tracks/demo/flashcards"
      filters={parseInput(flashcardFilterSchema, query)}
      objectives={OBJECTIVES}
    />,
  );
}

describe("FlashcardFilterForm", () => {
  it("submits as a GET form so a filtered bank stays bookmarkable", () => {
    renderFilters();

    const form = screen
      .getByRole("button", { name: /apply filters/i })
      .closest("form");

    expect(form).not.toBeNull();
    expect(form?.getAttribute("method")).toBe("get");
    expect(form?.getAttribute("action")).toBe("/study-tracks/demo/flashcards");
  });

  it("offers every lifecycle and card type plus an any option", () => {
    renderFilters();

    expect(screen.getByRole("option", { name: "Any status" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Retired" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Any type" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Reversed" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Vocabulary" })).toBeVisible();
  });

  it("preselects the applied filters", () => {
    renderFilters({
      lifecycle: "RETIRED",
      type: "VOCABULARY",
      objective: "objective-1",
      q: "学习",
    });

    expect(screen.getByLabelText(/^status$/i)).toHaveValue("RETIRED");
    expect(screen.getByLabelText(/card type/i)).toHaveValue("VOCABULARY");
    expect(screen.getByLabelText(/objective/i)).toHaveValue("objective-1");
    expect(screen.getByLabelText(/search card text/i)).toHaveValue("学习");
  });

  it("falls back to no filter when the query string is unrecognised", () => {
    renderFilters({ lifecycle: "PUBLISHED", type: "IMAGE" });

    expect(screen.getByLabelText(/^status$/i)).toHaveValue("");
    expect(screen.getByLabelText(/card type/i)).toHaveValue("");
  });

  it("marks an archived objective in the objective filter", () => {
    renderFilters();

    expect(
      screen.getByRole("option", { name: "Retired area (archived)" }),
    ).toBeVisible();
  });

  it("clears filters with a link to the unfiltered bank, not a reset button", () => {
    renderFilters({ lifecycle: "RETIRED" });

    expect(
      screen.getByRole("link", { name: /clear filters/i }),
    ).toHaveAttribute("href", "/study-tracks/demo/flashcards");
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
  });
});
