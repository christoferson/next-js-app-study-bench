import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "@/app/page";

async function renderHomePage(): Promise<void> {
  render(await HomePage());
}

describe("Home page", () => {
  it("renders the StudyBench identity and tagline", async () => {
    await renderHomePage();

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Build your study bank. Learn anywhere.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("StudyBench")).toBeInTheDocument();
  });

  it("describes the personal workbench purpose", async () => {
    await renderHomePage();

    expect(screen.getByText(/personal, single-user workbench/i)).toBeVisible();
  });

  it("lists both demo study tracks with working detail links", async () => {
    await renderHomePage();

    const awsLink = screen.getByRole("link", {
      name: "AWS Certified Generative AI Developer - Professional (AIP-C01)",
    });
    const hskLink = screen.getByRole("link", {
      name: "HSK Chinese — Demo Track",
    });

    expect(awsLink).toHaveAttribute(
      "href",
      "/study-tracks/aws-certified-generative-ai-developer-professional",
    );
    expect(hskLink).toHaveAttribute(
      "href",
      "/study-tracks/hsk-chinese-demo-track",
    );
  });

  it("identifies each track as demo content with visible text", async () => {
    await renderHomePage();

    expect(screen.getAllByText("Demo")).toHaveLength(2);
  });

  it("claims no study progress", async () => {
    await renderHomePage();

    expect(screen.getByText(/no progress has been recorded/i)).toBeVisible();
  });
});
