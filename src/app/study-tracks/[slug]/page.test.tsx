import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import StudyTrackPage from "@/app/study-tracks/[slug]/page";

class NotFoundSignal extends Error {}

vi.mock("next/navigation", () => ({
  notFound: (): never => {
    throw new NotFoundSignal("NEXT_NOT_FOUND");
  },
}));

async function renderTrackPage(slug: string): Promise<void> {
  render(await StudyTrackPage({ params: Promise.resolve({ slug }) }));
}

describe("Study-track detail page", () => {
  it("renders the track name, metadata, and demo badge", async () => {
    await renderTrackPage("aws-certified-generative-ai-developer-professional");

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "AWS Certified Generative AI Developer - Professional (AIP-C01)",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("AWS")).toBeVisible();
    expect(screen.getByText("Certification")).toBeVisible();
    expect(screen.getByText("Demo")).toBeVisible();
  });

  it("renders the read-only demo objectives", async () => {
    await renderTrackPage("hsk-chinese-demo-track");

    expect(screen.getByText("Language examination")).toBeVisible();
    expect(screen.getByText("Everyday vocabulary")).toBeVisible();
    expect(screen.getByText("Demo unit 1")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers a working return link to the dashboard", async () => {
    await renderTrackPage("hsk-chinese-demo-track");

    expect(
      screen.getByRole("link", { name: "Back to study tracks" }),
    ).toHaveAttribute("href", "/");
  });

  it("triggers the not-found path for an unknown slug", async () => {
    await expect(
      StudyTrackPage({ params: Promise.resolve({ slug: "no-such-track" }) }),
    ).rejects.toBeInstanceOf(NotFoundSignal);
  });
});
