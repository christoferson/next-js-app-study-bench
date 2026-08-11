import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Question } from "@/modules/question-bank/domain/question";
import { questionFixture } from "@/modules/question-bank/infrastructure/test-support";
import { QuestionOwnerPanel } from "./question-owner-panel";

// The panel renders Server Action references into `form action`; the actions
// themselves are exercised through the facade tests.
vi.mock("./actions", () => ({
  activateQuestionAction: vi.fn(),
  retireQuestionAction: vi.fn(),
  restoreQuestionAction: vi.fn(),
  approveQuestionAction: vi.fn(),
  disputeQuestionAction: vi.fn(),
  resolveDisputeAction: vi.fn(),
  deleteQuestionAction: vi.fn(),
}));

function renderPanel(
  overrides: Partial<Question> = {},
  options: {
    readonly deletable?: boolean;
    readonly blockingDependencies?: readonly string[];
  } = {},
): void {
  render(
    <QuestionOwnerPanel
      slug="demo"
      question={questionFixture(overrides)}
      deletable={options.deletable ?? true}
      blockingDependencies={options.blockingDependencies ?? []}
    />,
  );
}

function buttonNames(): readonly string[] {
  return screen
    .getAllByRole("button")
    .map((button) => button.textContent ?? "");
}

/**
 * The dispute disclosure summary, whose label the submit button repeats. The
 * summary element is what proves the reason field is reachable at all.
 */
function disputeDisclosure(): HTMLElement | null {
  return screen.queryByText("Dispute this question", { selector: "summary" });
}

describe("QuestionOwnerPanel lifecycle actions", () => {
  it("offers only activation for a draft", () => {
    renderPanel({ lifecycleStatus: "DRAFT" });

    expect(screen.getByRole("button", { name: "Activate" })).toBeVisible();
    expect(buttonNames()).not.toContain("Retire");
    expect(buttonNames()).not.toContain("Restore to active");
  });

  it("offers only retirement for an active question", () => {
    renderPanel({ lifecycleStatus: "ACTIVE" });

    expect(screen.getByRole("button", { name: "Retire" })).toBeVisible();
    expect(buttonNames()).not.toContain("Activate");
  });

  it("offers only restoration for a retired question", () => {
    renderPanel({ lifecycleStatus: "RETIRED" });

    expect(
      screen.getByRole("button", { name: "Restore to active" }),
    ).toBeVisible();
    expect(buttonNames()).not.toContain("Retire");
    expect(buttonNames()).not.toContain("Activate");
  });

  it("offers no lifecycle move for an archived question", () => {
    renderPanel({ lifecycleStatus: "ARCHIVED" });

    const names = buttonNames();

    expect(names).not.toContain("Activate");
    expect(names).not.toContain("Retire");
    expect(names).not.toContain("Restore to active");
  });
});

describe("QuestionOwnerPanel review actions", () => {
  it("offers approval and a dispute disclosure for an unreviewed question", () => {
    renderPanel({ qualityStatus: "UNREVIEWED" });

    expect(screen.getByRole("button", { name: "Mark approved" })).toBeVisible();
    expect(disputeDisclosure()).toBeVisible();
    expect(screen.getByLabelText(/reason for disputing/i)).toBeRequired();
  });

  it("does not offer approval again for an approved question", () => {
    renderPanel({ qualityStatus: "USER_APPROVED" });

    expect(buttonNames()).not.toContain("Mark approved");
    expect(disputeDisclosure()).toBeVisible();
  });

  it("shows the reason and the resolutions for a disputed question", () => {
    renderPanel({
      qualityStatus: "DISPUTED",
      disputeReason: "The console renamed this setting.",
    });

    expect(
      screen.getByText(/The console renamed this setting\./),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Resolve as unreviewed" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Resolve as approved" }),
    ).toBeVisible();
  });

  it("replaces approval and dispute with resolution while disputed", () => {
    renderPanel({ qualityStatus: "DISPUTED", disputeReason: "wrong" });

    expect(buttonNames()).not.toContain("Mark approved");
    expect(disputeDisclosure()).toBeNull();
    expect(screen.queryByLabelText(/reason for disputing/i)).toBeNull();
  });

  it("keeps lifecycle actions available on a disputed question", () => {
    // A dispute is about content, not availability: retiring stays possible.
    renderPanel({
      lifecycleStatus: "ACTIVE",
      qualityStatus: "DISPUTED",
      disputeReason: "wrong",
    });

    expect(screen.getByRole("button", { name: "Retire" })).toBeVisible();
  });
});

describe("QuestionOwnerPanel deletion", () => {
  it("hides deletion behind a disclosure rather than a confirm dialog", () => {
    renderPanel();

    const disclosure = screen
      .getByText("Delete this question permanently")
      .closest("details");

    expect(disclosure).not.toBeNull();
    expect(disclosure?.open).toBe(false);
    expect(
      screen.getByRole("button", { name: "Yes, delete permanently" }),
    ).toBeInTheDocument();
  });

  it("replaces deletion with an explanation when the facade blocks it", () => {
    renderPanel(
      {},
      {
        deletable: false,
        blockingDependencies: ["answer attempts", "study sessions"],
      },
    );

    expect(screen.getByText(/answer attempts, study sessions/)).toBeVisible();
    expect(buttonNames()).not.toContain("Yes, delete permanently");
    expect(screen.queryByText("Delete this question permanently")).toBeNull();
  });
});
