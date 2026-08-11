import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { certificationFixture } from "@/modules/certifications/infrastructure/test-support";
import type { ReviewSessionView } from "@/modules/flashcards/application/flashcard-facade";
import {
  cardRevisionFixture,
  flashcardFixture,
  scheduleFixture,
} from "@/modules/flashcards/infrastructure/test-support";
import ReviewPage from "@/app/study-tracks/[slug]/review/page";

/**
 * The review route.
 *
 * The card itself is covered by the `ReviewCard` component test; what belongs here
 * is the routing behaviour: an unknown track is a 404, and an empty queue explains
 * which of the three reasons it is empty for.
 */
class NotFoundSignal extends Error {}

const findReviewSession =
  vi.fn<(slug: string) => Promise<ReviewSessionView | null>>();

vi.mock("@/modules/flashcards/composition", () => ({
  getFlashcardFacade: () => ({ findReviewSession }),
}));

vi.mock("@/modules/flashcards/ui/actions", () => ({
  reviewFlashcardAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: (): never => {
    throw new NotFoundSignal("NEXT_NOT_FOUND");
  },
}));

function stubSession(view: Partial<ReviewSessionView> = {}): void {
  findReviewSession.mockResolvedValue({
    certification: certificationFixture({
      name: "Demo HSK 1",
      slug: "demo-hsk-1",
    }),
    card: null,
    remainingCount: 0,
    activeCount: 0,
    ...view,
  });
}

async function renderReviewPage(slug = "demo-hsk-1"): Promise<void> {
  render(await ReviewPage({ params: Promise.resolve({ slug }) }));
}

describe("Review page", () => {
  beforeEach(() => {
    findReviewSession.mockReset();
  });

  it("shows the next due card", async () => {
    stubSession({
      card: {
        flashcard: flashcardFixture({ lifecycleStatus: "ACTIVE" }),
        revision: cardRevisionFixture(),
        schedule: scheduleFixture(),
      },
      remainingCount: 3,
      activeCount: 5,
    });

    await renderReviewPage();

    expect(screen.getByText("What does S3 stand for?")).toBeVisible();
    expect(screen.getByText("3 cards due")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /show answer/i }),
    ).toBeInTheDocument();
  });

  it("explains an empty queue by there being no active cards", async () => {
    stubSession({ activeCount: 0 });

    await renderReviewPage();

    expect(
      screen.getByText(/No cards are active in this track yet/),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open the flashcards" }),
    ).toHaveAttribute("href", "/study-tracks/demo-hsk-1/flashcards");
  });

  it("explains an empty queue by everything waiting for its due date", async () => {
    stubSession({ activeCount: 4 });

    await renderReviewPage();

    expect(screen.getByText(/waiting for its next due date/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /show answer/i })).toBeNull();
  });

  it("triggers the not-found path for an unknown track", async () => {
    findReviewSession.mockResolvedValue(null);

    await expect(
      ReviewPage({ params: Promise.resolve({ slug: "no-such-track" }) }),
    ).rejects.toBeInstanceOf(NotFoundSignal);
  });
});
