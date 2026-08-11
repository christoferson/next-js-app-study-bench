import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Flashcard } from "@/modules/flashcards/domain/flashcard";
import {
  cardRevisionFixture,
  flashcardFixture,
  reviewRecordFixture,
  scheduleFixture,
  vocabularyContent,
} from "@/modules/flashcards/infrastructure/test-support";
import { FlashcardRevisionHistory } from "./flashcard-revision-history";
import { FlashcardOwnerPanel } from "./flashcard-owner-panel";
import { ReviewHistory } from "./review-history";

vi.mock("./actions", () => ({
  activateFlashcardAction: vi.fn(),
  retireFlashcardAction: vi.fn(),
  restoreFlashcardAction: vi.fn(),
}));

const REVISIONS = [
  // Newest first, as the facade returns them.
  cardRevisionFixture({
    id: "card-revision-2",
    revisionNumber: 2,
    content: vocabularyContent(),
    createdAt: "2026-03-05T09:00:00.000Z",
  }),
  cardRevisionFixture({
    id: "card-revision-1",
    revisionNumber: 1,
    createdAt: "2026-03-01T09:00:00.000Z",
  }),
];

describe("ReviewHistory", () => {
  it("says a card has not been reviewed rather than showing an empty schedule", () => {
    render(
      <ReviewHistory reviews={[]} schedule={null} revisions={REVISIONS} />,
    );

    expect(screen.getByText(/has not been reviewed yet/)).toBeVisible();
    expect(screen.queryByText("Next due")).toBeNull();
  });

  it("summarises the schedule of a reviewed card", () => {
    render(
      <ReviewHistory
        reviews={[reviewRecordFixture()]}
        schedule={scheduleFixture({
          intervalMinutes: 8640,
          dueAt: "2026-03-13T09:00:00.000Z",
          reviewCount: 4,
          lapseCount: 2,
        })}
        revisions={REVISIONS}
      />,
    );

    expect(screen.getByText("2026-03-13")).toBeVisible();
    expect(screen.getByText("6 days")).toBeVisible();
    expect(screen.getByText("4")).toBeVisible();
    expect(screen.getByText("2")).toBeVisible();
  });

  it("shows each rating with the interval it produced", () => {
    render(
      <ReviewHistory
        reviews={[
          reviewRecordFixture({
            id: "review-2",
            rating: "AGAIN",
            intervalMinutes: 10,
            reviewedAt: "2026-03-06T09:00:00.000Z",
            dueAt: "2026-03-06T09:10:00.000Z",
          }),
          reviewRecordFixture({
            id: "review-1",
            rating: "GOOD",
            intervalMinutes: 4320,
            reviewedAt: "2026-03-01T09:00:00.000Z",
            dueAt: "2026-03-04T09:00:00.000Z",
          }),
        ]}
        schedule={scheduleFixture()}
        revisions={REVISIONS}
      />,
    );

    expect(screen.getByText("Again")).toBeVisible();
    expect(screen.getByText("Good")).toBeVisible();
    expect(screen.getByText("Next in 10 minutes")).toBeVisible();
    expect(screen.getByText("Next in 3 days")).toBeVisible();
  });

  it("names the revision each rating was given against", () => {
    render(
      <ReviewHistory
        reviews={[
          reviewRecordFixture({
            id: "review-old",
            flashcardRevisionId: "card-revision-1",
            reviewedAt: "2026-03-02T09:00:00.000Z",
            dueAt: "2026-03-05T09:00:00.000Z",
          }),
        ]}
        schedule={scheduleFixture()}
        revisions={REVISIONS}
      />,
    );

    // Rated against revision 1, even though revision 2 is now current: that is
    // what the append-only history is for.
    expect(
      screen.getByText(/Reviewed 2026-03-02 · revision 1 · due 2026-03-05/),
    ).toBeVisible();
  });
});

describe("FlashcardRevisionHistory", () => {
  it("lists every revision, marking the current one", () => {
    render(
      <FlashcardRevisionHistory
        slug="demo"
        flashcardId="flashcard-1"
        revisions={REVISIONS}
        currentRevisionId="card-revision-2"
      />,
    );

    expect(screen.getByText("Revision 1")).toBeVisible();
    expect(screen.getByText("Revision 2")).toBeVisible();
    expect(screen.getAllByText("Current")).toHaveLength(1);
  });

  it("shows the type of each revision, so a retyped card is visible", () => {
    render(
      <FlashcardRevisionHistory
        slug="demo"
        flashcardId="flashcard-1"
        revisions={REVISIONS}
        currentRevisionId="card-revision-2"
      />,
    );

    expect(screen.getByText("Basic")).toBeVisible();
    expect(screen.getByText("Vocabulary")).toBeVisible();
  });

  it("links each revision to its read-only view", () => {
    render(
      <FlashcardRevisionHistory
        slug="demo"
        flashcardId="flashcard-1"
        revisions={REVISIONS}
        currentRevisionId="card-revision-2"
      />,
    );

    expect(
      screen.getByRole("link", { name: "Read revision 1" }),
    ).toHaveAttribute(
      "href",
      "/study-tracks/demo/flashcards/flashcard-1/revisions/1",
    );
    expect(
      screen.getByRole("link", { name: "Read revision 2" }),
    ).toHaveAttribute(
      "href",
      "/study-tracks/demo/flashcards/flashcard-1/revisions/2",
    );
  });

  it("shows when each revision was written", () => {
    render(
      <FlashcardRevisionHistory
        slug="demo"
        flashcardId="flashcard-1"
        revisions={REVISIONS}
        currentRevisionId="card-revision-2"
      />,
    );

    expect(screen.getByText("Written 2026-03-01")).toBeVisible();
    expect(screen.getByText("Written 2026-03-05")).toBeVisible();
  });
});

function renderOwnerPanel(flashcard: Flashcard): void {
  render(<FlashcardOwnerPanel slug="demo" flashcard={flashcard} />);
}

describe("FlashcardOwnerPanel", () => {
  it("offers activation for a draft and nothing else", () => {
    renderOwnerPanel(flashcardFixture({ lifecycleStatus: "DRAFT" }));

    expect(
      screen.getByRole("button", { name: "Activate" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retire" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Restore to active" }),
    ).toBeNull();
  });

  it("offers retirement for an active card and says it is in the queue", () => {
    renderOwnerPanel(flashcardFixture({ lifecycleStatus: "ACTIVE" }));

    expect(screen.getByRole("button", { name: "Retire" })).toBeInTheDocument();
    expect(screen.getByText("This card is in the review queue.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Activate" })).toBeNull();
  });

  it("offers restoration for a retired card", () => {
    renderOwnerPanel(flashcardFixture({ lifecycleStatus: "RETIRED" }));

    expect(
      screen.getByRole("button", { name: "Restore to active" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Only active cards come up for review."),
    ).toBeVisible();
  });

  it("offers no delete control, because D4 has no card deletion", () => {
    for (const status of ["DRAFT", "ACTIVE", "RETIRED"] as const) {
      renderOwnerPanel(flashcardFixture({ lifecycleStatus: status }));

      expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    }
  });
});
