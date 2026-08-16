import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { QuestionEvidence } from "@/modules/ai-generation/ports/source-grounding-repository";
import { SourceEvidence, hasOutdatedEvidence } from "./source-evidence";

/**
 * The passages one question was built from.
 *
 * What these tests protect is the difference between evidence and provenance. A badge
 * saying "from your sources" is a claim; this panel is the thing that makes the claim
 * checkable, so the assertions are about the passage text being on screen verbatim, and
 * about each passage naming the document, the position, and the date it was read. Without
 * those three a reader cannot go and look, and the panel would be a prettier badge.
 *
 * The superseded case is asserted twice over — badge and sentence — because colour and a
 * short label are not enough on their own (`spec/UI-GUIDELINES.md`).
 */

const CURRENT: QuestionEvidence = {
  chunkId: "chunk-1",
  sourceId: "source-1",
  sourceTitle: "Official exam guide",
  snapshotId: "snapshot-2",
  retrievedAt: "2026-03-14T15:09:26.535Z",
  chunkIndex: 0,
  text: "A VPC endpoint keeps traffic to the service on the AWS network.",
  supersededByNewerSnapshot: false,
};

const SUPERSEDED: QuestionEvidence = {
  chunkId: "chunk-2",
  sourceId: "source-2",
  sourceTitle: "My VPC notes",
  snapshotId: "snapshot-1",
  retrievedAt: "2026-01-02T00:00:00.000Z",
  chunkIndex: 6,
  text: "Gateway endpoints support S3 and DynamoDB only.",
  supersededByNewerSnapshot: true,
};

describe("SourceEvidence", () => {
  it("quotes each passage exactly as the model was sent it", () => {
    // Verbatim rather than summarised: the excerpt on screen being the excerpt the model
    // read is the whole reason this panel counts as evidence.
    render(<SourceEvidence evidence={[CURRENT]} />);

    expect(screen.getByText(CURRENT.text)).toBeVisible();
  });

  it("names the document, the position in it, and the day it was read", () => {
    render(<SourceEvidence evidence={[CURRENT]} />);

    const row = screen.getByRole("listitem");

    expect(row).toHaveTextContent("Official exam guide");
    // One-based on screen, zero-based in storage: "passage 0" would send the owner
    // looking for something the document does not have.
    expect(row).toHaveTextContent("Passage 1");
    expect(row).toHaveTextContent("Read 2026-03-14");
  });

  it("counts the passage position from one, not from the stored index", () => {
    render(<SourceEvidence evidence={[SUPERSEDED]} />);

    expect(screen.getByText("Passage 7")).toBeVisible();
    expect(screen.queryByText("Passage 6")).toBeNull();
  });

  it("shows every passage the question records", () => {
    render(<SourceEvidence evidence={[CURRENT, SUPERSEDED]} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(SUPERSEDED.text)).toBeVisible();
  });

  it("says in words as well as in a badge that a passage is from an older snapshot", () => {
    render(<SourceEvidence evidence={[SUPERSEDED]} />);

    expect(screen.getByText("Older snapshot")).toBeVisible();
    expect(
      screen.getByText(
        /this source has been read again since, so this passage is from an older snapshot of it/,
      ),
    ).toBeVisible();
  });

  it("leaves a current passage unmarked", () => {
    render(<SourceEvidence evidence={[CURRENT]} />);

    expect(screen.queryByText("Older snapshot")).toBeNull();
    expect(screen.queryByText(/read again since/)).toBeNull();
  });

  it("marks only the passages that are superseded", () => {
    // A mixed question is the interesting case: the notice must not spread from the one
    // stale passage to the ones that are still current.
    render(<SourceEvidence evidence={[CURRENT, SUPERSEDED]} />);

    expect(screen.getAllByText("Older snapshot")).toHaveLength(1);
  });

  it("explains an absence of evidence rather than showing an empty list", () => {
    // Every question page loads evidence, so "none" is the ordinary case for a
    // hand-written or model-knowledge question and is stated as such.
    render(<SourceEvidence evidence={[]} />);

    expect(
      screen.getByText(/This question records no source passages\./),
    ).toBeVisible();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});

describe("hasOutdatedEvidence", () => {
  it("is false when nothing has been read again", () => {
    expect(hasOutdatedEvidence([CURRENT])).toBe(false);
  });

  it("is false for a question with no evidence at all", () => {
    // Nothing to be outdated against, so no notice — an empty list must not read as
    // a warning.
    expect(hasOutdatedEvidence([])).toBe(false);
  });

  it("is true when one passage of several is superseded", () => {
    expect(hasOutdatedEvidence([CURRENT, SUPERSEDED])).toBe(true);
  });

  it("is true when every passage is superseded", () => {
    expect(hasOutdatedEvidence([SUPERSEDED])).toBe(true);
  });
});
