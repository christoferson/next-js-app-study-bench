import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { reviewInputSchema } from "@/modules/flashcards/application/schemas";
import type { ReviewInput } from "@/modules/flashcards/application/schemas";
import {
  cardRevisionFixture,
  clozeContent,
  enrichedVocabularyContent,
  flashcardFixture,
  hintedClozeContent,
  reversedContent,
  scheduleFixture,
  vocabularyContent,
} from "@/modules/flashcards/infrastructure/test-support";
import type { FlashcardContent } from "@/modules/flashcards/domain/flashcard";
import type { ReviewSchedule } from "@/modules/flashcards/domain/review-scheduling";
import { CLOZE_BLANK } from "@/modules/flashcards/domain/flashcard-content";
import { ReviewCard } from "./review-card";

/**
 * The review screen is the one study surface in D4, so it is tested through the
 * behaviour it must have: the answer is hidden until asked for, and rating it
 * submits the card, the revision on screen, and the rating together.
 *
 * The action is exercised against the real review schema, because that is what the
 * Server Action parses. A stub taking arbitrary values would not prove that the
 * form supplies the fields the action needs.
 */
function ratingAction(onRated: (input: ReviewInput) => void = () => undefined) {
  return async (_state: FormState, form: FormData): Promise<FormState> => {
    onRated(
      parseInput(reviewInputSchema, {
        flashcardId: String(form.get("flashcardId") ?? ""),
        flashcardRevisionId: String(form.get("flashcardRevisionId") ?? ""),
        rating: String(form.get("rating") ?? ""),
      }),
    );

    return { status: "idle", fieldErrors: {}, values: {} };
  };
}

function renderReview(
  options: {
    readonly content?: FlashcardContent;
    readonly schedule?: ReviewSchedule | null;
    readonly remainingCount?: number;
    readonly notes?: string | null;
    readonly action?: ReturnType<typeof ratingAction>;
  } = {},
): void {
  render(
    <ReviewCard
      action={options.action ?? ratingAction()}
      slug="demo"
      flashcard={flashcardFixture({ lifecycleStatus: "ACTIVE" })}
      revision={cardRevisionFixture({
        ...(options.content === undefined ? {} : { content: options.content }),
        notes: options.notes ?? null,
      })}
      schedule={options.schedule === undefined ? null : options.schedule}
      remainingCount={options.remainingCount ?? 1}
    />,
  );
}

describe("ReviewCard", () => {
  it("shows the prompt and hides the answer until it is revealed", () => {
    renderReview();

    expect(screen.getByText("What does S3 stand for?")).toBeVisible();
    expect(screen.queryByText("Simple Storage Service")).toBeNull();
    expect(
      screen.getByRole("button", { name: /show answer/i }),
    ).toBeInTheDocument();
  });

  it("offers no rating until the answer has been seen", () => {
    renderReview();

    expect(screen.queryByRole("button", { name: /^Good/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Again/ })).toBeNull();
  });

  it("reveals the answer and then offers all four ratings", async () => {
    renderReview();

    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /show answer/i }));

    expect(screen.getByText("Simple Storage Service")).toBeVisible();

    for (const word of ["Again", "Hard", "Good", "Easy"]) {
      expect(
        screen.getByRole("button", { name: new RegExp(`^${word}`) }),
      ).toBeInTheDocument();
    }

    expect(screen.queryByRole("button", { name: /show answer/i })).toBeNull();
  });

  it("says what each rating means, not only its word", async () => {
    renderReview();

    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /show answer/i }));

    expect(screen.getByText("I did not recall it")).toBeVisible();
    expect(screen.getByText("Recalled with difficulty")).toBeVisible();
    expect(screen.getByText("Recalled correctly")).toBeVisible();
    expect(screen.getByText("Recalled immediately")).toBeVisible();
  });

  it("submits the card, the revision on screen, and the rating pressed", async () => {
    const onRated = vi.fn();

    renderReview({ action: ratingAction(onRated) });

    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /show answer/i }));
    await user.click(screen.getByRole("button", { name: /^Good/ }));

    await waitFor(() => {
      expect(onRated).toHaveBeenCalledTimes(1);
    });

    expect(onRated.mock.calls[0]?.[0]).toEqual({
      flashcardId: "flashcard-1",
      flashcardRevisionId: "card-revision-1",
      rating: "GOOD",
    });
  });

  it("submits the rating of whichever button was pressed", async () => {
    const onRated = vi.fn();

    renderReview({ action: ratingAction(onRated) });

    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /show answer/i }));
    await user.click(screen.getByRole("button", { name: /^Again/ }));

    await waitFor(() => {
      expect(onRated).toHaveBeenCalledTimes(1);
    });

    expect(onRated.mock.calls[0]?.[0]?.rating).toBe("AGAIN");
  });

  it("prompts a reversed card with its back, which is the point of the type", () => {
    renderReview({ content: reversedContent() });

    expect(screen.getByText("lasting for a very short time")).toBeVisible();
    expect(screen.queryByText("ephemeral")).toBeNull();
  });

  it("prompts a cloze card with blanks rather than the marker syntax", () => {
    renderReview({ content: clozeContent() });

    expect(
      screen.getByText(`An S3 bucket name must be ${CLOZE_BLANK}.`),
    ).toBeVisible();
    expect(screen.queryByText(/\{\{/)).toBeNull();
  });

  it("reveals a vocabulary card's reading, meaning, and example", async () => {
    renderReview({ content: vocabularyContent() });

    expect(screen.getByText("学习")).toBeVisible();
    expect(screen.queryByText("xuéxí")).toBeNull();

    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /show answer/i }));

    expect(screen.getByText("xuéxí")).toBeVisible();
    expect(screen.getByText("to study; to learn")).toBeVisible();
    expect(screen.getByText("我每天学习汉语。")).toBeVisible();
  });

  it("shows a blank's hint next to the blank, so it helps while recalling", () => {
    renderReview({ content: hintedClozeContent() });

    expect(
      screen.getByText(
        `An S3 bucket name must be ${CLOZE_BLANK} (hint: across every account).`,
      ),
    ).toBeVisible();
    // The hint belongs to the prompt; the answer still reveals the deleted text.
    expect(screen.queryByText(/\|/)).toBeNull();
  });

  it("reveals an enriched vocabulary card's further senses, relations, and notes", async () => {
    renderReview({ content: enrichedVocabularyContent() });

    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /show answer/i }));

    // The primary gloss stays first; the enrichment is added after it.
    expect(screen.getByText("to study; to learn")).toBeVisible();
    expect(screen.getByText("to imitate a good example")).toBeVisible();
    expect(screen.getByText("念书, 读书")).toBeVisible();
    expect(screen.getByText("玩儿")).toBeVisible();
    // The card's own example sentence and the enriched ones are both shown.
    expect(screen.getByText("我每天学习汉语。")).toBeVisible();
    expect(
      screen.getByText(/他在学习开车。[\s\S]*He is learning to drive\./),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Neutral register; also used of learning from an example.",
      ),
    ).toBeVisible();
  });

  it("says how many cards are left, in words that agree in number", () => {
    renderReview({ remainingCount: 1 });
    expect(screen.getByText("1 card due")).toBeVisible();

    renderReview({ remainingCount: 4 });
    expect(screen.getByText("4 cards due")).toBeVisible();
  });

  it("marks a card that has never been reviewed as a first review", () => {
    renderReview({ schedule: null });

    expect(screen.getByText("First review")).toBeVisible();
  });

  it("reports the review number and last interval for a reviewed card", () => {
    renderReview({
      schedule: scheduleFixture({ reviewCount: 2, intervalMinutes: 4320 }),
    });

    expect(screen.queryByText("First review")).toBeNull();
    expect(screen.getByText(/Review 3 · last interval 3 days/)).toBeVisible();
  });

  it("keeps an owner note behind a disclosure, so it is never part of a face", async () => {
    renderReview({ notes: "Confused this with EBS twice." });

    const user = userEvent.setup();
    const note = screen.getByText("Confused this with EBS twice.");

    // Present in the markup but inside a closed `details`, which is what keeps it
    // off screen while the card is being recalled.
    expect(note.closest("details")).not.toBeNull();
    expect(note.closest("details")?.open).toBe(false);

    await user.click(screen.getByText(/your note on this card/i));

    expect(note.closest("details")?.open).toBe(true);
  });

  it("renders no note section when the card has none", () => {
    renderReview({ notes: null });

    expect(screen.queryByText(/your note on this card/i)).toBeNull();
  });
});
