import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseInput } from "@/shared/parse-input";
import { objectiveFixture } from "@/modules/certifications/infrastructure/test-support";
import { questionFilterSchema } from "@/modules/question-bank/application/schemas";
import type { QuestionWithRevision } from "@/modules/question-bank/domain/question";
import {
  questionFixture,
  revisionFixture,
  shortAnswerContent,
} from "@/modules/question-bank/infrastructure/test-support";
import { QuestionBankList } from "./question-bank-list";
import { QuestionFilterForm } from "./question-filter-form";

const BANK: readonly QuestionWithRevision[] = [
  {
    question: questionFixture({
      id: "q-draft",
      updatedAt: "2026-02-03T09:00:00.000Z",
    }),
    revision: revisionFixture({ stem: "Which service stores objects?" }),
  },
  {
    question: questionFixture({
      id: "q-disputed",
      lifecycleStatus: "ACTIVE",
      qualityStatus: "DISPUTED",
      disputeReason: "The wording predates the 2026 console.",
      updatedAt: "2026-02-04T09:00:00.000Z",
    }),
    revision: revisionFixture({
      id: "revision-2",
      questionId: "q-disputed",
      revisionNumber: 3,
      questionType: "SHORT_ANSWER",
      content: shortAnswerContent(),
      stem: "Describe S3 durability.",
    }),
  },
];

describe("QuestionBankList", () => {
  it("shows both status dimensions and the type for each row", () => {
    render(<QuestionBankList slug="demo" items={BANK} />);

    expect(screen.getByText("Status: Draft")).toBeVisible();
    expect(screen.getByText("Status: Active")).toBeVisible();
    expect(screen.getByText("Review: Unreviewed")).toBeVisible();
    expect(screen.getByText("Review: Disputed")).toBeVisible();
    expect(screen.getByText("Single choice")).toBeVisible();
    expect(screen.getByText("Short answer")).toBeVisible();
  });

  it("labels a disputed question in words, not by colour alone", () => {
    render(<QuestionBankList slug="demo" items={BANK} />);

    const badge = screen.getByText("Review: Disputed");

    // The alert class only reinforces the word that is already there.
    expect(badge).toHaveTextContent("Disputed");
    expect(
      screen.getByText(/The wording predates the 2026 console\./),
    ).toBeVisible();
  });

  it("links each row to its question detail page", () => {
    render(<QuestionBankList slug="demo" items={BANK} />);

    expect(
      screen.getByRole("link", { name: "Which service stores objects?" }),
    ).toHaveAttribute("href", "/study-tracks/demo/questions/q-draft");
    expect(
      screen.getByRole("link", { name: "Describe S3 durability." }),
    ).toHaveAttribute("href", "/study-tracks/demo/questions/q-disputed");
  });

  it("shows the revision number and the update date", () => {
    render(<QuestionBankList slug="demo" items={BANK} />);

    expect(screen.getByText("Revision 1 · updated 2026-02-03")).toBeVisible();
    expect(screen.getByText("Revision 3 · updated 2026-02-04")).toBeVisible();
  });

  it("truncates a long stem instead of rendering it whole", () => {
    const stem = `Start ${"word ".repeat(60)}end`;

    render(
      <QuestionBankList
        slug="demo"
        items={[
          {
            question: questionFixture({ id: "q-long" }),
            revision: revisionFixture({ stem }),
          },
        ]}
      />,
    );

    const link = screen.getByRole("link");

    expect(link.textContent ?? "").toContain("…");
    expect((link.textContent ?? "").length).toBeLessThan(stem.length);
  });

  it("renders nothing but an empty list when the page has no matches", () => {
    render(<QuestionBankList slug="demo" items={[]} />);

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
    <QuestionFilterForm
      action="/study-tracks/demo/questions"
      filters={parseInput(questionFilterSchema, query)}
      objectives={OBJECTIVES}
    />,
  );
}

describe("QuestionFilterForm", () => {
  it("submits as a GET form so a filtered bank stays bookmarkable", () => {
    renderFilters();

    const form = screen
      .getByRole("button", { name: /apply filters/i })
      .closest("form");

    expect(form).not.toBeNull();
    expect(form?.getAttribute("method")).toBe("get");
    expect(form?.getAttribute("action")).toBe("/study-tracks/demo/questions");
  });

  it("offers every lifecycle, quality, and type value plus an any option", () => {
    renderFilters();

    expect(screen.getByLabelText(/^status$/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Any status" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Retired" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Disputed" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Short answer" })).toBeVisible();
  });

  it("preselects the applied filters", () => {
    renderFilters({
      lifecycle: "RETIRED",
      quality: "DISPUTED",
      type: "SHORT_ANSWER",
      objective: "objective-1",
      q: "buckets",
    });

    expect(screen.getByLabelText(/^status$/i)).toHaveValue("RETIRED");
    expect(screen.getByLabelText(/review state/i)).toHaveValue("DISPUTED");
    expect(screen.getByLabelText(/question type/i)).toHaveValue("SHORT_ANSWER");
    expect(screen.getByLabelText(/objective/i)).toHaveValue("objective-1");
    expect(screen.getByLabelText(/search question text/i)).toHaveValue(
      "buckets",
    );
  });

  it("falls back to no filter when the query string is unrecognised", () => {
    renderFilters({ lifecycle: "PUBLISHED", type: "ESSAY" });

    expect(screen.getByLabelText(/^status$/i)).toHaveValue("");
    expect(screen.getByLabelText(/question type/i)).toHaveValue("");
  });

  it("marks an archived objective in the objective filter", () => {
    renderFilters();

    expect(
      screen.getByRole("option", { name: "Retired area (archived)" }),
    ).toBeVisible();
    expect(
      screen.getByRole("option", { name: "Domain 1 — Storage" }),
    ).toBeVisible();
  });

  it("clears filters with a link to the unfiltered bank, not a reset button", () => {
    renderFilters({ lifecycle: "RETIRED" });

    expect(
      screen.getByRole("link", { name: /clear filters/i }),
    ).toHaveAttribute("href", "/study-tracks/demo/questions");
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
  });
});
