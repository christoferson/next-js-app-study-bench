import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseInput } from "@/shared/parse-input";
import type { FormState } from "@/shared/ui/form-state";
import { certificationFixture } from "@/modules/certifications/infrastructure/test-support";
import { startSessionSchema } from "@/modules/study-sessions/application/schemas";
import type { StartSessionInput } from "@/modules/study-sessions/application/schemas";
import type {
  SessionModeOption,
  StartSessionView,
} from "@/modules/study-sessions/application/study-facade";
import { SESSION_MODES } from "@/modules/study-sessions/domain/study-session";
import { StartSessionForm } from "./start-session-form";

/**
 * The start form.
 *
 * The behaviour that matters is that it cannot start a session that would fail: an
 * unavailable mode is disabled with its reason next to it, and the track control
 * matches what the chosen mode accepts.
 */

const TRACK = certificationFixture();
const SECOND_TRACK = certificationFixture({
  id: "certification-2",
  slug: "second-track",
  name: "Second Track",
});

function startAction(
  onStarted: (input: StartSessionInput) => void = () => undefined,
) {
  return async (_state: FormState, form: FormData): Promise<FormState> => {
    onStarted(
      parseInput(startSessionSchema, {
        mode: String(form.get("mode") ?? ""),
        certificationIds: form.getAll("certificationIds").map(String),
        targetMinutes: String(form.get("targetMinutes") ?? ""),
      }),
    );

    return { status: "idle", fieldErrors: {}, values: {} };
  };
}

/** Every mode available unless named otherwise. */
function modes(
  unavailable: Readonly<Record<string, string>> = {},
): readonly SessionModeOption[] {
  return SESSION_MODES.map((mode) => ({
    mode,
    available: unavailable[mode] === undefined,
    unavailableReason: unavailable[mode] ?? null,
  }));
}

function startView(
  overrides: Partial<StartSessionView> = {},
): StartSessionView {
  return {
    tracks: [TRACK, SECOND_TRACK],
    preselectedId: null,
    defaultMinutes: 10,
    minuteOptions: [5, 10, 20, 30],
    modes: modes(),
    inProgressId: null,
    dueCardCount: 3,
    activeQuestionCount: 20,
    ...overrides,
  };
}

function renderStartForm(
  options: {
    readonly view?: StartSessionView;
    readonly action?: ReturnType<typeof startAction>;
  } = {},
): void {
  render(
    <StartSessionForm
      action={options.action ?? startAction()}
      view={options.view ?? startView()}
    />,
  );
}

describe("StartSessionForm", () => {
  it("offers every mode with what it will put in front of the owner", () => {
    renderStartForm();

    for (const label of [
      "One study track",
      "Mixed study tracks",
      "Questions only",
      "Flashcards only",
      "Mistake review",
      "Diagnostic",
    ]) {
      expect(screen.getByText(label)).toBeVisible();
    }
  });

  it("defaults to ten minutes", () => {
    renderStartForm();

    expect(screen.getByLabelText(/how long/i)).toHaveValue("10");
  });

  it("offers the lengths the view supplied", () => {
    renderStartForm({
      view: startView({ minuteOptions: [5, 10, 20, 30, 45] }),
    });

    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual([
      "5 minutes",
      "10 minutes",
      "20 minutes",
      "30 minutes",
      "45 minutes",
    ]);
  });

  it("says the length is a guide rather than a timer", () => {
    renderStartForm();

    expect(screen.getByText(/a guide, not a timer/i)).toBeVisible();
    expect(screen.getByText(/finish early at any point/i)).toBeVisible();
  });

  describe("unavailable modes", () => {
    it("disables a mode that has nothing to offer, and states the reason", () => {
      renderStartForm({
        view: startView({
          modes: modes({
            FLASHCARDS_ONLY: "No cards are due yet.",
          }),
        }),
      });

      expect(
        screen.getByRole("radio", { name: /flashcards only/i }),
      ).toBeDisabled();
      // A control that disappears looks like a missing feature; one that says why
      // tells the owner what to do about it (`spec/UI-GUIDELINES.md` section 1.4).
      expect(screen.getByText("No cards are due yet.")).toBeVisible();
    });

    it("selects the first available mode rather than a disabled one", () => {
      renderStartForm({
        view: startView({
          modes: modes({
            SINGLE_TRACK: "No active questions or due cards yet.",
            MIXED_TRACKS: "No active questions or due cards yet.",
          }),
        }),
      });

      expect(
        screen.getByRole("radio", { name: /questions only/i }),
      ).toBeChecked();
      expect(
        screen.getByRole("radio", { name: /one study track/i }),
      ).not.toBeChecked();
    });
  });

  describe("track selection", () => {
    it("takes one track for a single-track session", () => {
      renderStartForm();

      expect(screen.getByText("Which study track?")).toBeVisible();
      expect(screen.getByRole("radio", { name: TRACK.name })).toBeChecked();
      expect(
        screen.getByRole("radio", { name: SECOND_TRACK.name }),
      ).not.toBeChecked();
    });

    it("takes several tracks once a mixed session is chosen", async () => {
      renderStartForm();

      const user = userEvent.setup();

      await user.click(
        screen.getByRole("radio", { name: /mixed study tracks/i }),
      );

      expect(screen.getByText("Which study tracks?")).toBeVisible();
      // Remounted as checkboxes, all checked: a mixed session draws from every track.
      expect(screen.getByRole("checkbox", { name: TRACK.name })).toBeChecked();
      expect(
        screen.getByRole("checkbox", { name: SECOND_TRACK.name }),
      ).toBeChecked();
    });

    it("preselects the track the owner arrived from", () => {
      renderStartForm({ view: startView({ preselectedId: SECOND_TRACK.id }) });

      expect(
        screen.getByRole("radio", { name: SECOND_TRACK.name }),
      ).toBeChecked();
      expect(screen.getByRole("radio", { name: TRACK.name })).not.toBeChecked();
    });

    it("says there is nothing to study when no track exists, and offers no start", () => {
      renderStartForm({ view: startView({ tracks: [] }) });

      expect(screen.getByText(/no active study tracks yet/i)).toBeVisible();
      expect(
        screen.getByRole("button", { name: /start studying/i }),
      ).toBeDisabled();
    });
  });

  it("submits the mode, the track, and the length", async () => {
    const onStarted = vi.fn();

    renderStartForm({ action: startAction(onStarted) });

    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText(/how long/i), "20");
    await user.click(screen.getByRole("button", { name: /start studying/i }));

    await waitFor(() => {
      expect(onStarted).toHaveBeenCalledTimes(1);
    });

    expect(onStarted.mock.calls[0]?.[0]).toEqual({
      mode: "SINGLE_TRACK",
      certificationIds: [TRACK.id],
      targetMinutes: 20,
    });
  });

  it("submits every checked track for a mixed session", async () => {
    const onStarted = vi.fn();

    renderStartForm({ action: startAction(onStarted) });

    const user = userEvent.setup();

    await user.click(
      screen.getByRole("radio", { name: /mixed study tracks/i }),
    );
    await user.click(screen.getByRole("button", { name: /start studying/i }));

    await waitFor(() => {
      expect(onStarted).toHaveBeenCalledTimes(1);
    });

    expect(onStarted.mock.calls[0]?.[0]).toMatchObject({
      mode: "MIXED_TRACKS",
      certificationIds: [TRACK.id, SECOND_TRACK.id],
    });
  });

  it("submits the mode the owner selected", async () => {
    const onStarted = vi.fn();

    renderStartForm({ action: startAction(onStarted) });

    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: /mistake review/i }));
    await user.click(screen.getByRole("button", { name: /start studying/i }));

    await waitFor(() => {
      expect(onStarted).toHaveBeenCalledTimes(1);
    });

    expect(onStarted.mock.calls[0]?.[0]?.mode).toBe("MISTAKE_REVIEW");
  });
});
