import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { GenerationRunSummary } from "@/modules/ai-generation/application/generation-facade";
import type { GenerationRunStatus } from "@/modules/ai-generation/domain/generation-run";
import { GENERATION_RUN_STATUSES } from "@/modules/ai-generation/domain/generation-run";
import { generationRunFixture } from "@/modules/ai-generation/infrastructure/test-support";
import { GenerationRunList } from "./generation-run-list";
import { RunStatusBadge } from "./run-status-badge";

/**
 * Run history rows and the status badge they carry.
 *
 * A row must answer what the owner wants to know about a past batch without opening
 * it, and it must never present a generated batch as anything but model-written.
 */

const COMPLETED: GenerationRunSummary = {
  run: generationRunFixture({
    id: "run-2",
    requestedItemCount: 3,
    successfulItemCount: 3,
    startedAt: "2026-04-02T10:00:00.000Z",
    completedAt: "2026-04-02T10:00:05.000Z",
    status: "COMPLETED",
  }),
  counts: { total: 3, draft: 1, active: 2 },
};

/** One review run: a model call that produced findings and no content. */
const REVIEW: GenerationRunSummary = {
  run: generationRunFixture({
    id: "run-3",
    itemKind: "QUESTION_REVIEW",
    subjectQuestionId: "question-7",
    subjectRevisionId: "revision-7",
    requestedItemCount: 1,
    successfulItemCount: 1,
    startedAt: "2026-04-03T10:00:00.000Z",
    completedAt: "2026-04-03T10:00:04.000Z",
    status: "COMPLETED",
  }),
  counts: { total: 0, draft: 0, active: 0 },
};

/** One tutor run: a model call that explained a question and produced no content at all. */
const TUTOR: GenerationRunSummary = {
  run: generationRunFixture({
    id: "run-9",
    itemKind: "TUTOR_EXPLANATION",
    subjectQuestionId: "question-9",
    subjectRevisionId: "revision-9",
    requestedItemCount: 1,
    successfulItemCount: 1,
    startedAt: "2026-04-04T10:00:00.000Z",
    completedAt: "2026-04-04T10:00:03.000Z",
    status: "COMPLETED",
  }),
  counts: { total: 0, draft: 0, active: 0 },
};

const RUNS: readonly GenerationRunSummary[] = [
  COMPLETED,
  {
    run: generationRunFixture({
      id: "run-1",
      itemKind: "FLASHCARD",
      personaId: "hsk",
      personaVersion: 2,
      requestedItemCount: 4,
      successfulItemCount: 0,
      failedItemCount: 4,
      failureReason: "PROVIDER_THROTTLED",
      startedAt: "2026-04-01T10:00:00.000Z",
      completedAt: "2026-04-01T10:00:02.000Z",
      status: "FAILED",
    }),
    counts: { total: 0, draft: 0, active: 0 },
  },
];

describe("GenerationRunList", () => {
  it("links each run to its own review page", () => {
    render(<GenerationRunList slug="demo" runs={RUNS} />);

    expect(
      screen.getByRole("link", { name: "Completed · 3 of 3 written" }),
    ).toHaveAttribute("href", "/study-tracks/demo/generation-runs/run-2");
  });

  it("says which bank each run wrote into", () => {
    render(<GenerationRunList slug="demo" runs={RUNS} />);

    expect(screen.getByText("Questions")).toBeVisible();
    expect(screen.getByText("Flashcards")).toBeVisible();
  });

  it("marks every row as model knowledge, never as official material", () => {
    render(<GenerationRunList slug="demo" runs={RUNS} />);

    expect(screen.getAllByText("AI generated — model knowledge")).toHaveLength(
      2,
    );
    expect(document.body.textContent ?? "").not.toMatch(/official/i);
  });

  it("counts what still exists, not what the run once claimed", () => {
    // A batch the owner has since rejected must not keep claiming its items.
    render(<GenerationRunList slug="demo" runs={RUNS} />);

    expect(screen.getByText("3 kept · 1 still draft · 2 active")).toBeVisible();
  });

  it("names the model and persona version, which is why two runs differ", () => {
    render(<GenerationRunList slug="demo" runs={RUNS} />);

    expect(
      screen.getByText(
        "fake-deterministic via fake · persona hsk v2 · started 2026-04-01",
      ),
    ).toBeVisible();
  });

  it("explains a failed run on the row, so it need not be opened", () => {
    render(<GenerationRunList slug="demo" runs={RUNS} />);

    expect(
      screen.getByText(
        "The model provider is rate limiting requests. Wait a moment and try a smaller batch.",
      ),
    ).toBeVisible();
  });

  it("says nothing about failure for a run that worked", () => {
    render(<GenerationRunList slug="demo" runs={[COMPLETED]} />);

    expect(document.body.textContent ?? "").not.toMatch(/rate limiting/);
  });

  it("labels a review row and links it to the question it judged", () => {
    // A review wrote nothing into either bank, so the row's useful destination is the
    // question whose findings it produced, not a review screen with no items on it.
    render(<GenerationRunList slug="demo" runs={[REVIEW]} />);

    expect(screen.getByText("AI question review")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Read the findings on the question" }),
    ).toHaveAttribute("href", "/study-tracks/demo/questions/question-7");
  });

  it("says a review judged rather than wrote, and counts nothing", () => {
    render(<GenerationRunList slug="demo" runs={[REVIEW]} />);

    expect(
      screen.getByRole("link", { name: "Completed · one question judged" }),
    ).toBeVisible();
    expect(document.body.textContent ?? "").not.toMatch(/kept ·/);
    // Not presented as generated content, because nothing was generated.
    expect(screen.getByText("Judged from model knowledge")).toBeVisible();
    expect(document.body.textContent ?? "").not.toMatch(/AI generated/);
  });

  it("labels a tutor row and links it to the answer on the question", () => {
    // The anchor is the point: a run history row about an ask lands on the tutor panel
    // holding the answer, rather than at the top of a long question page.
    render(<GenerationRunList slug="demo" runs={[TUTOR]} />);

    expect(screen.getByText("AI tutor answer")).toBeVisible();
    expect(screen.getByText("Explained from model knowledge")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Completed · one tutor answer" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Read the answer on the question" }),
    ).toHaveAttribute("href", "/study-tracks/demo/questions/question-9#tutor");
    // Not generated content, and with no batch to count.
    expect(document.body.textContent ?? "").not.toMatch(/AI generated/);
    expect(document.body.textContent ?? "").not.toMatch(/kept ·/);
  });

  it("says so when the tutored question has since been deleted", () => {
    render(
      <GenerationRunList
        slug="demo"
        runs={[
          {
            run: generationRunFixture({
              id: "run-5",
              itemKind: "TUTOR_EXPLANATION",
              subjectQuestionId: null,
              status: "COMPLETED",
            }),
            counts: { total: 0, draft: 0, active: 0 },
          },
        ]}
      />,
    );

    expect(
      screen.getByText(
        "The question this answer was about has since been deleted.",
      ),
    ).toBeVisible();
  });

  it("says so when the reviewed question has since been deleted", () => {
    // `ON DELETE SET NULL`: the run stays, because it records a model call that happened.
    render(
      <GenerationRunList
        slug="demo"
        runs={[
          {
            run: generationRunFixture({
              id: "run-4",
              itemKind: "QUESTION_REVIEW",
              subjectQuestionId: null,
              status: "COMPLETED",
            }),
            counts: { total: 0, draft: 0, active: 0 },
          },
        ]}
      />,
    );

    expect(
      screen.getByText(
        "The question this review was about has since been deleted.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: /findings/ })).toBeNull();
  });

  it("renders nothing but an empty list when there are no runs", () => {
    render(<GenerationRunList slug="demo" runs={[]} />);

    expect(screen.queryByRole("listitem")).toBeNull();
  });
});

describe("RunStatusBadge", () => {
  it("carries a word for every status, so colour is never the only signal", () => {
    for (const status of GENERATION_RUN_STATUSES) {
      const { unmount } = render(<RunStatusBadge status={status} />);

      expect(screen.getByText(label(status))).toBeVisible();
      unmount();
    }
  });

  it("marks only a failure with the alert variant, on top of its word", () => {
    render(<RunStatusBadge status="FAILED" />);

    const badge = screen.getByText("Failed");

    expect(badge).toHaveClass("badge-alert");
    expect(badge).toHaveTextContent("Failed");
  });

  it("leaves a partial run unalarmed, since it produced content", () => {
    render(<RunStatusBadge status="PARTIAL" />);

    expect(screen.getByText("Partly completed")).not.toHaveClass("badge-alert");
  });
});

function label(status: GenerationRunStatus): string {
  switch (status) {
    case "PENDING":
      return "In progress";
    case "COMPLETED":
      return "Completed";
    case "PARTIAL":
      return "Partly completed";
    case "FAILED":
      return "Failed";
  }
}
