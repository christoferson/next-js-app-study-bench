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
});

function isNotModelKnowledge(mode: GenerationMode): boolean {
  return mode !== "MODEL_KNOWLEDGE";
}

function badgeText(): string {
  return document.body.textContent?.trim() ?? "";
}
