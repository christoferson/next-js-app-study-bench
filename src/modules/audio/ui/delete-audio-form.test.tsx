import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FormState } from "@/shared/ui/form-state";
import { IDLE_FORM_STATE } from "@/shared/ui/form-state";
import { DeleteAudioForm } from "./delete-audio-form";

function recordingAction(onDelete: (form: FormData) => void) {
  return async (_state: FormState, form: FormData): Promise<FormState> => {
    onDelete(form);

    return IDLE_FORM_STATE;
  };
}

describe("DeleteAudioForm", () => {
  it("submits the asset and the page to re-render", async () => {
    const onDelete = vi.fn();

    render(
      <DeleteAudioForm
        action={recordingAction(onDelete)}
        assetId="asset-1"
        revalidatePath="/settings/audio"
      />,
    );

    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /remove audio/i }));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledTimes(1);
    });

    const form = onDelete.mock.calls[0]?.[0] as FormData;

    expect(form.get("assetId")).toBe("asset-1");
    expect(form.get("revalidatePath")).toBe("/settings/audio");
  });

  it("names what it removes when the caller says", async () => {
    // On a card four rows each hold a button reading "Remove audio", and a screen reader
    // listing controls out of context would hear four identical ones.
    render(
      <DeleteAudioForm
        action={recordingAction(vi.fn())}
        assetId="asset-1"
        revalidatePath="/"
        label="the audio for the term"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Remove the audio for the term" }),
    ).toBeInTheDocument();
  });

  it("adds no accessible name of its own when the row already says which clip", async () => {
    render(
      <DeleteAudioForm
        action={recordingAction(vi.fn())}
        assetId="asset-1"
        revalidatePath="/"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Remove audio" }),
    ).toBeInTheDocument();
  });

  it("shows why a removal failed, next to the button that failed", async () => {
    // The case this is a client form for: another tab removed the clip first, and the
    // facade refuses. Without a message the button would appear to do nothing.
    const failing = async (): Promise<FormState> => ({
      status: "invalid",
      fieldErrors: { "": ["That audio has already been removed."] },
      values: {},
    });

    render(
      <DeleteAudioForm action={failing} assetId="asset-1" revalidatePath="/" />,
    );

    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /remove audio/i }));

    const message = await screen.findByText(
      "That audio has already been removed.",
    );

    expect(message).toBeVisible();
    expect(
      screen.getByRole("button", { name: /remove audio/i }),
    ).toHaveAttribute("aria-describedby", "delete-audio-asset-1-errors");
  });
});
