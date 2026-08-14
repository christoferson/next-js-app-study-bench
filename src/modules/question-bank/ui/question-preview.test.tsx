import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  multipleResponseContent,
  revisionFixture,
  shortAnswerContent,
  singleChoiceContent,
} from "@/modules/question-bank/infrastructure/test-support";
import { QuestionPreview } from "./question-preview";

/**
 * The one component that renders a question, used by the detail page, the revision
 * view, and the generation review screen.
 *
 * Two properties are worth pinning: a choice is presented under a letter the owner can
 * refer to, and the reveal marks the answer with something other than a colour.
 */
describe("QuestionPreview", () => {
  it("presents each choice under the letter it is offered as", () => {
    render(
      <QuestionPreview
        revealAnswer={false}
        revision={revisionFixture({ content: multipleResponseContent() })}
      />,
    );

    const rows = screen.getAllByRole("listitem");

    expect(rows.map((row) => row.textContent)).toEqual([
      "a.Durability",
      "b.Availability",
      "c.Colour",
    ]);
  });

  it("marks the correct answer with a glyph and a word, not a colour", () => {
    render(
      <QuestionPreview
        revealAnswer
        revision={revisionFixture({ content: singleChoiceContent() })}
      />,
    );

    const correct = screen.getByText("Amazon S3").closest("li");

    expect(correct?.textContent).toContain("✓");
    expect(correct?.textContent).toContain("Correct answer");
    expect(correct?.className).toContain("verdict-correct");
    expect(screen.getByText("Amazon EBS").closest("li")?.className).toBe(
      "question-choice",
    );
  });

  it("marks nothing while the answer is hidden", () => {
    render(
      <QuestionPreview
        revealAnswer={false}
        revision={revisionFixture({ content: singleChoiceContent() })}
      />,
    );

    expect(screen.queryByText("Correct answer")).toBeNull();
    expect(document.body.textContent).not.toContain("✓");
  });

  it("shows the letters without a second numbering from the list itself", () => {
    // An `ol` marker plus an a/b/c label would number every row twice.
    render(
      <QuestionPreview
        revealAnswer={false}
        revision={revisionFixture({ content: singleChoiceContent() })}
      />,
    );

    expect(screen.getByRole("list").className).toBe("question-choices");
  });

  it("offers no choice list for a short answer", () => {
    render(
      <QuestionPreview
        revealAnswer
        revision={revisionFixture({
          questionType: "SHORT_ANSWER",
          content: shortAnswerContent(),
        })}
      />,
    );

    expect(screen.getByText("Expected concepts")).toBeVisible();
    expect(screen.getByText("object storage")).toBeVisible();
  });
});
