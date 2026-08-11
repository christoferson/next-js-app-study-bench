import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { revisionFixture } from "@/modules/question-bank/infrastructure/test-support";
import { RevisionHistory } from "./revision-history";

const HISTORY = [
  revisionFixture({
    id: "revision-2",
    revisionNumber: 2,
    stem: "Which service stores objects durably?",
    createdAt: "2026-03-02T10:00:00.000Z",
  }),
  revisionFixture({
    id: "revision-1",
    revisionNumber: 1,
    stem: "Which service stores objects?",
    createdAt: "2026-03-01T10:00:00.000Z",
  }),
];

function renderHistory(
  revisions = HISTORY,
  currentRevisionId = "revision-2",
): void {
  render(
    <RevisionHistory
      slug="demo"
      questionId="question-1"
      revisions={revisions}
      currentRevisionId={currentRevisionId}
    />,
  );
}

describe("RevisionHistory", () => {
  it("lists every revision newest first", () => {
    renderHistory();

    const rows = screen.getAllByRole("listitem");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Revision 2");
    expect(rows[1]).toHaveTextContent("Revision 1");
  });

  it("marks only the current revision as current", () => {
    renderHistory();

    const current = screen.getByText("Current").closest("li");

    expect(current).toHaveTextContent("Revision 2");
    expect(screen.getAllByText("Current")).toHaveLength(1);
  });

  it("keeps a superseded revision inspectable through its own link", () => {
    renderHistory();

    expect(
      screen.getByRole("link", { name: "Read revision 1" }),
    ).toHaveAttribute(
      "href",
      "/study-tracks/demo/questions/question-1/revisions/1",
    );
    expect(
      screen.getByRole("link", { name: "Read revision 2" }),
    ).toHaveAttribute(
      "href",
      "/study-tracks/demo/questions/question-1/revisions/2",
    );
  });

  it("shows the previous wording, not only the current one", () => {
    renderHistory();

    expect(screen.getByText("Which service stores objects?")).toBeVisible();
    expect(
      screen.getByText("Which service stores objects durably?"),
    ).toBeVisible();
  });

  it("shows when each revision was written", () => {
    renderHistory();

    expect(screen.getByText("Written 2026-03-01")).toBeVisible();
    expect(screen.getByText("Written 2026-03-02")).toBeVisible();
  });

  it("renders a single-revision history without a superseded entry", () => {
    renderHistory([HISTORY[1]!], "revision-1");

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Current")).toBeVisible();
  });
});
