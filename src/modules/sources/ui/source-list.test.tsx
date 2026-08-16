import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SourceListEntry } from "@/modules/sources/application/source-facade";
import {
  snapshotFixture,
  sourceFixture,
} from "@/modules/sources/infrastructure/test-support";
import { SourceList } from "./source-list";

/**
 * One track's source library.
 *
 * What is worth asserting here is what a row tells the owner *before* they open it, because
 * that is the whole job of this list: what the document is, how much weight it carries, how
 * many readings there have been, and when the last one was. The snapshot count is the
 * interesting number for a web source and the boring number 1 for everything else, so both
 * the singular and the plural are pinned down rather than left to whichever the fixtures
 * happened to produce.
 */

function entry(overrides: Partial<SourceListEntry> = {}): SourceListEntry {
  return {
    source: sourceFixture(),
    snapshotCount: 1,
    latestSnapshot: snapshotFixture(),
    chunkCount: 1,
    objectiveCount: 0,
    ...overrides,
  };
}

describe("SourceList", () => {
  it("explains what a source is when there are none", () => {
    // The empty state has to answer "what would I even put here", because a source is not
    // a word the owner has met yet at this point in the product.
    render(<SourceList slug="demo" entries={[]} />);

    expect(screen.getByText(/No sources yet\./)).toBeVisible();
    expect(
      screen.getByText(/an exam guide, a documentation page, your own notes/),
    ).toBeVisible();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("links each row to that source's own page", () => {
    render(
      <SourceList
        slug="aws-saa"
        entries={[
          entry({
            source: sourceFixture({ id: "src-7", title: "Exam guide" }),
          }),
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "Exam guide" })).toHaveAttribute(
      "href",
      "/study-tracks/aws-saa/sources/src-7",
    );
  });

  it("escapes an id that would otherwise break the address", () => {
    render(
      <SourceList
        slug="demo"
        entries={[
          entry({ source: sourceFixture({ id: "src/7 8", title: "Odd id" }) }),
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "Odd id" })).toHaveAttribute(
      "href",
      "/study-tracks/demo/sources/src%2F7%208",
    );
  });

  it("labels the type and the authority together", () => {
    // Either alone is misleading: "PDF" says nothing about whether it is the official
    // guide, and "Official" says nothing about whether it can be refreshed.
    render(
      <SourceList
        slug="demo"
        entries={[
          entry({
            source: sourceFixture({
              sourceType: "WEB_URL",
              authority: "TRUSTED_THIRD_PARTY",
            }),
          }),
        ]}
      />,
    );

    expect(screen.getByText("Web page")).toBeVisible();
    expect(screen.getByText("Trusted third party")).toBeVisible();
  });

  it("counts one snapshot in the singular", () => {
    render(<SourceList slug="demo" entries={[entry()]} />);

    expect(screen.getByText(/^1 snapshot ·/)).toBeVisible();
  });

  it("counts two snapshots in the plural, which is the interesting case", () => {
    // Two snapshots mean the page behind a web source changed since the import. It is the
    // one number in this list the owner might act on.
    render(
      <SourceList
        slug="demo"
        entries={[entry({ snapshotCount: 2, chunkCount: 4 })]}
      />,
    );

    expect(screen.getByText(/^2 snapshots ·/)).toBeVisible();
  });

  it("says plainly when an import stored no text at all", () => {
    // `latestSnapshot` is null when the import failed before writing one, and a row
    // reading "0 snapshots · last read …" would be worse than a sentence.
    render(
      <SourceList
        slug="demo"
        entries={[
          entry({ snapshotCount: 0, latestSnapshot: null, chunkCount: 0 }),
        ]}
      />,
    );

    expect(screen.getByText("No stored text.")).toBeVisible();
  });

  it("shows the last reading as a date, with no time of day", () => {
    render(
      <SourceList
        slug="demo"
        entries={[
          entry({
            latestSnapshot: snapshotFixture({
              retrievedAt: "2026-03-14T15:09:26.535Z",
            }),
          }),
        ]}
      />,
    );

    expect(screen.getByText(/last read 2026-03-14/)).toBeVisible();
    expect(screen.queryByText(/15:09/)).toBeNull();
  });

  it("shows how much text there is and how many passages it became", () => {
    render(
      <SourceList
        slug="demo"
        entries={[
          entry({
            latestSnapshot: snapshotFixture({ charCount: 48_200 }),
            chunkCount: 12,
          }),
        ]}
      />,
    );

    expect(screen.getByText(/48,200 characters in 12 passages/)).toBeVisible();
  });

  it("counts a single passage in the singular", () => {
    render(<SourceList slug="demo" entries={[entry({ chunkCount: 1 })]} />);

    expect(screen.getByText(/in 1 passage(?!s)/)).toBeVisible();
  });

  it("counts linked objectives when there are any", () => {
    render(<SourceList slug="demo" entries={[entry({ objectiveCount: 3 })]} />);

    expect(screen.getByText(/· 3 objectives/)).toBeVisible();
  });

  it("counts one linked objective in the singular", () => {
    render(<SourceList slug="demo" entries={[entry({ objectiveCount: 1 })]} />);

    expect(screen.getByText(/· 1 objective(?!s)/)).toBeVisible();
  });

  it("says nothing about objectives when none are linked", () => {
    // "0 objectives" would read as a warning about a source that is perfectly fine —
    // linking is optional, and most sources start unlinked.
    render(<SourceList slug="demo" entries={[entry()]} />);

    expect(screen.queryByText(/objective/)).toBeNull();
  });

  it("shows where a source came from when it remembers", () => {
    render(
      <SourceList
        slug="demo"
        entries={[
          entry({
            source: sourceFixture({
              sourceType: "WEB_URL",
              originalLocation: "https://example.test/exam-guide",
            }),
          }),
        ]}
      />,
    );

    expect(screen.getByText("https://example.test/exam-guide")).toBeVisible();
  });

  it("shows no origin line for a paste, which has none", () => {
    const { container } = render(
      <SourceList slug="demo" entries={[entry()]} />,
    );

    expect(container.querySelectorAll(".card-text")).toHaveLength(1);
  });

  it("marks an archived source in words, and still lists it", () => {
    // There is no delete in this slice, so filtering an archived source out would make it
    // unreachable — and a retired exam guide is still the document some question was
    // written from.
    render(
      <SourceList
        slug="demo"
        entries={[
          entry({
            source: sourceFixture({
              id: "src-old",
              title: "2024 exam guide",
              status: "ARCHIVED",
            }),
          }),
        ]}
      />,
    );

    expect(screen.getByText("Archived")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "2024 exam guide" }),
    ).toBeInTheDocument();
  });

  it("marks only the archived row when the list mixes both", () => {
    render(
      <SourceList
        slug="demo"
        entries={[
          entry({ source: sourceFixture({ id: "src-1", title: "Live" }) }),
          entry({
            source: sourceFixture({
              id: "src-2",
              title: "Retired",
              status: "ARCHIVED",
            }),
          }),
        ]}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByText("Archived")).toHaveLength(1);
  });
});
