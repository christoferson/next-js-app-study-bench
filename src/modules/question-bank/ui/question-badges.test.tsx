import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GENERATION_MODES } from "@/modules/question-bank/domain/question";
import type { GenerationMode } from "@/modules/question-bank/domain/question";
import { ProvenanceBadge } from "./question-badges";

/**
 * Provenance for one bank item.
 *
 * The claim this badge makes is the point of it: model-written content must stand out
 * from the owner's own, must say that the model's own knowledge produced it, and must
 * never imply that it is official or real exam material (`SPEC.md` section 3,
 * `spec/AI-GUIDELINES.md` section 1.9).
 */

const LABEL = "AI generated — model knowledge";

describe("ProvenanceBadge", () => {
  it("links a generated item to the run that explains it", () => {
    // Provenance is inspectable rather than a label: the run page names the model,
    // the persona, and the prompt template.
    render(
      <ProvenanceBadge
        slug="demo"
        generationMode="MODEL_KNOWLEDGE"
        generationRunId="run-1"
      />,
    );

    expect(screen.getByRole("link", { name: LABEL })).toHaveAttribute(
      "href",
      "/study-tracks/demo/generation-runs/run-1",
    );
  });

  it("still says how the item was written when its run is gone", () => {
    render(
      <ProvenanceBadge
        slug="demo"
        generationMode="MODEL_KNOWLEDGE"
        generationRunId={null}
      />,
    );

    expect(screen.getByText(LABEL)).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("never claims the item is official, real, or exam material", () => {
    render(
      <ProvenanceBadge
        slug="demo"
        generationMode="MODEL_KNOWLEDGE"
        generationRunId="run-1"
      />,
    );

    expect(document.body.textContent ?? "").not.toMatch(
      /official|real exam|exam question/i,
    );
  });

  it("renders nothing for content the owner wrote", () => {
    // A "Manual" badge on every hand-written row is noise, and it would blunt the one
    // signal this badge exists to give.
    const { container } = render(
      <ProvenanceBadge
        slug="demo"
        generationMode="MANUAL"
        generationRunId={null}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("names the mode on a detail page, where every field is on show", () => {
    render(
      <ProvenanceBadge
        alwaysShow
        slug="demo"
        generationMode="MANUAL"
        generationRunId={null}
      />,
    );

    expect(screen.getByText("Manual")).toBeVisible();
  });

  it("has a word for every generation mode the schema allows", () => {
    // A mode with no label would render blank, and a later milestone adds several.
    for (const mode of GENERATION_MODES) {
      const { unmount } = render(
        <ProvenanceBadge
          alwaysShow
          slug="demo"
          generationMode={mode}
          generationRunId={null}
        />,
      );

      expect(badgeText()).not.toBe("");
      unmount();
    }
  });

  it("shows the model-knowledge wording only for the model-knowledge mode", () => {
    for (const mode of GENERATION_MODES.filter(isNotModelKnowledge)) {
      const { unmount } = render(
        <ProvenanceBadge
          alwaysShow
          slug="demo"
          generationMode={mode}
          generationRunId="run-1"
        />,
      );

      expect(badgeText()).not.toBe(LABEL);
      unmount();
    }
  });

  it("says a grounded item came from the owner's own sources", () => {
    // The claim that separates this mode from model knowledge: there are passages behind
    // it, and the evidence panel on the question page quotes them.
    render(
      <ProvenanceBadge
        slug="demo"
        generationMode="SOURCE_GROUNDED"
        generationRunId="run-1"
      />,
    );

    expect(badgeText()).toBe("AI generated — from your sources");
  });

  it("discloses the ungrounded half of a hybrid item", () => {
    // "Hybrid" alone would let the grounded half vouch for the rest, so the badge says
    // *part* from your sources.
    render(
      <ProvenanceBadge
        slug="demo"
        generationMode="HYBRID"
        generationRunId="run-1"
      />,
    );

    const label = badgeText();

    expect(label).toMatch(/hybrid/i);
    expect(label).toMatch(/part from your sources/);
  });

  it("never calls a grounded or hybrid item official or verified", () => {
    // An acceptance criterion of the grounded milestone, and asserted for all three
    // model-written modes: a source the owner imported is only as good as the document it
    // came from, and StudyBench publishes no exam material (`SPEC.md` section 3).
    for (const mode of [
      "MODEL_KNOWLEDGE",
      "SOURCE_GROUNDED",
      "HYBRID",
    ] as const) {
      const { unmount } = render(
        <ProvenanceBadge
          slug="demo"
          generationMode={mode}
          generationRunId="run-1"
        />,
      );

      expect(badgeText()).not.toMatch(/official|verified/i);
      unmount();
    }
  });

  it("links a grounded item to its run, and states the mode without one", () => {
    // The same two shapes the model-knowledge tests above assert, checked for the new
    // modes because each carries a different label through the same branch.
    const grounded = render(
      <ProvenanceBadge
        slug="demo"
        generationMode="SOURCE_GROUNDED"
        generationRunId="run-4"
      />,
    );

    expect(
      screen.getByRole("link", { name: "AI generated — from your sources" }),
    ).toHaveAttribute("href", "/study-tracks/demo/generation-runs/run-4");

    grounded.unmount();

    render(
      <ProvenanceBadge
        slug="demo"
        generationMode="HYBRID"
        generationRunId={null}
      />,
    );

    expect(
      screen.getByText("AI generated — hybrid, part from your sources"),
    ).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

function isNotModelKnowledge(mode: GenerationMode): boolean {
  return mode !== "MODEL_KNOWLEDGE";
}

function badgeText(): string {
  return document.body.textContent?.trim() ?? "";
}
