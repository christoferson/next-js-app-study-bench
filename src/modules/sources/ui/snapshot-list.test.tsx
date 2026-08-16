import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { snapshotFixture } from "@/modules/sources/infrastructure/test-support";
import { SnapshotList, formatBytes } from "./snapshot-list";

/**
 * Every reading of one source.
 *
 * The hash prefix is what these tests spend most of their attention on, because it is the
 * only thing on the row that distinguishes "read again and it had changed" from "read again
 * and nothing had" — two dates cannot, and two byte counts can coincide. Twelve characters
 * is the promise `shortHash` makes and the length a reader can compare between rows, so it
 * is asserted as a length rather than as a substring that a longer prefix would also
 * satisfy.
 */

const NEWEST = snapshotFixture({
  id: "snapshot-2",
  contentHash: `bbbb2222cccc${"3".repeat(52)}`,
  retrievedAt: "2026-03-14T15:09:26.535Z",
  byteSize: 4_096,
  charCount: 4_000,
});

const OLDER = snapshotFixture({
  id: "snapshot-1",
  contentHash: `aaaa1111dddd${"9".repeat(52)}`,
  retrievedAt: "2026-01-02T00:00:00.000Z",
  byteSize: 900,
  charCount: 880,
});

describe("SnapshotList", () => {
  it("says why there is nothing rather than showing an empty list", () => {
    // No snapshot means the import did not complete, which is a different thing from a
    // source with nothing interesting to show — so it is stated, not implied.
    render(<SnapshotList snapshots={[]} chunkCounts={{}} />);

    expect(screen.getByText(/No stored text\./)).toBeVisible();
    expect(
      screen.getByText(/nothing to ground a question in yet/),
    ).toBeVisible();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("marks the newest reading as the one in use", () => {
    render(
      <SnapshotList
        snapshots={[NEWEST, OLDER]}
        chunkCounts={{ "snapshot-2": 4, "snapshot-1": 3 }}
      />,
    );

    const rows = screen.getAllByRole("listitem");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Current");
    expect(rows[1]).not.toHaveTextContent("Current");
  });

  it("marks exactly one row, even when there is only one", () => {
    render(
      <SnapshotList snapshots={[NEWEST]} chunkCounts={{ "snapshot-2": 4 }} />,
    );

    expect(screen.getAllByText("Current")).toHaveLength(1);
  });

  it("shows twelve characters of each hash, and no more", () => {
    // The full 64 would not fit on a phone and would not be compared anyway; twelve is
    // what `shortHash` promises and what two rows can be told apart by.
    render(
      <SnapshotList
        snapshots={[NEWEST, OLDER]}
        chunkCounts={{ "snapshot-2": 4, "snapshot-1": 3 }}
      />,
    );

    const codes = [...document.querySelectorAll("code")].map(
      (code) => code.textContent ?? "",
    );

    expect(codes).toEqual(["bbbb2222cccc", "aaaa1111dddd"]);
    expect(codes.every((code) => code.length === 12)).toBe(true);
    expect(screen.queryByText(NEWEST.contentHash)).toBeNull();
  });

  it("shows the two differing hashes that are the evidence of a change", () => {
    render(
      <SnapshotList
        snapshots={[NEWEST, OLDER]}
        chunkCounts={{ "snapshot-2": 4, "snapshot-1": 3 }}
      />,
    );

    expect(screen.getByText("bbbb2222cccc")).toBeVisible();
    expect(screen.getByText("aaaa1111dddd")).toBeVisible();
  });

  it("shows the date, the character count, the size, and the passages", () => {
    render(
      <SnapshotList snapshots={[NEWEST]} chunkCounts={{ "snapshot-2": 4 }} />,
    );

    const row = screen.getByRole("listitem");

    expect(row).toHaveTextContent("Read 2026-03-14");
    expect(row).toHaveTextContent("4,000 characters");
    expect(row).toHaveTextContent("4.0 kB");
    expect(row).toHaveTextContent("4 passages");
  });

  it("shows the reading date without the time of day", () => {
    render(
      <SnapshotList snapshots={[NEWEST]} chunkCounts={{ "snapshot-2": 4 }} />,
    );

    expect(screen.queryByText(/15:09/)).toBeNull();
  });

  it("counts a single passage in the singular", () => {
    render(
      <SnapshotList snapshots={[NEWEST]} chunkCounts={{ "snapshot-2": 1 }} />,
    );

    expect(screen.getByRole("listitem")).toHaveTextContent("1 passage");
    expect(screen.getByRole("listitem")).not.toHaveTextContent("1 passages");
  });

  it("reads a missing chunk count as none rather than rendering a blank", () => {
    // The counts arrive as a map built by the facade, and a snapshot the chunker never
    // reached is absent from it. "0 passages" is the truthful reading of that.
    render(<SnapshotList snapshots={[NEWEST]} chunkCounts={{}} />);

    expect(screen.getByRole("listitem")).toHaveTextContent("0 passages");
  });

  it("groups a large character count for reading", () => {
    render(
      <SnapshotList
        snapshots={[snapshotFixture({ charCount: 1_234_567 })]}
        chunkCounts={{}}
      />,
    );

    expect(screen.getByRole("listitem")).toHaveTextContent("1,234,567");
  });
});

describe("formatBytes", () => {
  it("gives a small document its exact size in bytes", () => {
    expect(formatBytes(0)).toBe("0 bytes");
    expect(formatBytes(1)).toBe("1 bytes");
    expect(formatBytes(1023)).toBe("1023 bytes");
  });

  it("switches to kilobytes at 1024, the way a file manager does", () => {
    // 1024 rather than 1000, because the number beside it will be compared against what
    // the owner's own operating system reports for the file they uploaded.
    expect(formatBytes(1024)).toBe("1.0 kB");
    expect(formatBytes(1536)).toBe("1.5 kB");
    expect(formatBytes(1024 * 1024 - 1)).toBe("1024.0 kB");
  });

  it("switches to megabytes at a megabyte", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(12 * 1024 * 1024)).toBe("12.0 MB");
  });

  it("keeps one decimal place past a kilobyte and no more", () => {
    // The exact size of a stored document is never the interesting part, only its order of
    // magnitude — a second decimal would be noise on a row meant to be scanned.
    expect(formatBytes(1_234_567)).toBe("1.2 MB");
    expect(formatBytes(4_097)).toBe("4.0 kB");
  });
});
