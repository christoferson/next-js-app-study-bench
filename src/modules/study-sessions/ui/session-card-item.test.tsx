import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { rateSessionCardSchema } from "@/modules/study-sessions/application/schemas";
import type { RateSessionCardInput } from "@/modules/study-sessions/application/schemas";
import type { FlashcardContent } from "@/modules/flashcards/domain/flashcard";
import {
  cardRevisionFixture,
  clozeContent,
} from "@/modules/flashcards/infrastructure/test-support";
import { CLOZE_BLANK } from "@/modules/flashcards/domain/flashcard-content";
import { SessionCardItem } from "./session-card-item";

/**
 * A flashcard met inside a session.
 *
 * The behaviour that matters is that it prompts and rates exactly as the D4 review
 * screen does — the faces come from the same component — while submitting the session
 * item rather than the card, because the facade completes the item and the review in
 * one transaction.
 */
function ratingAction(
  onRated: (input: RateSessionCardInput) => void = () => undefined,
) {
  return async (_state: FormState, form: FormData): Promise<FormState> => {
    onRated(
      parseInput(rateSessionCardSchema, {
        sessionId: String(form.get("sessionId") ?? ""),
        itemId: String(form.get("itemId") ?? ""),
        rating: String(form.get("rating") ?? ""),
      }),
    );

    return { status: "idle", fieldErrors: {}, values: {} };
  };
}

function renderCardItem(
  options: {
    readonly content?: FlashcardContent;
    readonly notes?: string | null;
    readonly action?: ReturnType<typeof ratingAction>;
    /** What the page passes in as pronunciation controls, opaque to the component. */
    readonly audio?: ReactNode;
  } = {},
): void {
  render(
    <SessionCardItem
      action={options.action ?? ratingAction()}
      sessionId="session-1"
      itemId="item-1"
      revision={cardRevisionFixture({
        ...(options.content === undefined ? {} : { content: options.content }),
        notes: options.notes ?? null,
      })}
      {...(options.audio === undefined ? {} : { audio: options.audio })}
    />,
  );
}

describe("SessionCardItem", () => {
  it("prompts with the front and hides the answer", () => {
    renderCardItem();

    expect(screen.getByText("What does S3 stand for?")).toBeVisible();
    expect(screen.queryByText("Simple Storage Service")).toBeNull();
  });

  it("offers no rating until the answer has been seen", () => {
    renderCardItem();

    expect(screen.queryByRole("button", { name: /^Good/ })).toBeNull();
  });

  it("reveals the answer and then offers all four ratings", async () => {
    renderCardItem();

    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /show answer/i }));

    expect(screen.getByText("Simple Storage Service")).toBeVisible();

    for (const word of ["Again", "Hard", "Good", "Easy"]) {
      expect(
        screen.getByRole("button", { name: new RegExp(`^${word}`) }),
      ).toBeInTheDocument();
    }
  });

  it("submits the session item and the rating pressed, not the card", async () => {
    const onRated = vi.fn();

    renderCardItem({ action: ratingAction(onRated) });

    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /show answer/i }));
    await user.click(screen.getByRole("button", { name: /^Hard/ }));

    await waitFor(() => {
      expect(onRated).toHaveBeenCalledTimes(1);
    });

    // The item identifies which card was offered and at which frozen revision, so
    // the server never has to guess which of a session's cards was rated.
    expect(onRated.mock.calls[0]?.[0]).toEqual({
      sessionId: "session-1",
      itemId: "item-1",
      rating: "HARD",
    });
  });

  it("marks the item as a flashcard, so a mixed session is readable", () => {
    renderCardItem();

    expect(screen.getByText("Flashcard")).toBeVisible();
  });

  it("prompts a cloze card with blanks rather than the marker syntax", () => {
    renderCardItem({ content: clozeContent() });

    expect(
      screen.getByText(`An S3 bucket name must be ${CLOZE_BLANK}.`),
    ).toBeVisible();
    expect(screen.queryByText(/\{\{/)).toBeNull();
  });

  it("keeps an owner note behind a disclosure, so it is never part of a face", () => {
    renderCardItem({ notes: "Confused this with EBS twice." });

    const note = screen.getByText("Confused this with EBS twice.");

    expect(note.closest("details")).not.toBeNull();
    expect(note.closest("details")?.open).toBe(false);
  });

  it("renders no note section when the card has none", () => {
    renderCardItem({ notes: null });

    expect(screen.queryByText(/your note on this card/i)).toBeNull();
  });

  describe("pronunciation", () => {
    const audio = <p data-testid="audio">Listen</p>;

    it("keeps the audio off screen until the answer is revealed", () => {
      // Same rule as the review screen: hearing the term must not pre-empt recalling it.
      renderCardItem({ audio });

      expect(screen.queryByTestId("audio")).toBeNull();
    });

    it("offers the audio once the answer has been seen", async () => {
      renderCardItem({ audio });

      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /show answer/i }));

      expect(screen.getByTestId("audio")).toBeVisible();
    });
  });
});
