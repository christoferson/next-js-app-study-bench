import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CertificationDetailView } from "@/modules/certifications/application/certification-facade";
import { buildObjectiveTree } from "@/modules/certifications/domain/objective";
import {
  certificationFixture,
  objectiveFixture,
} from "@/modules/certifications/infrastructure/test-support";
import StudyTrackPage from "@/app/study-tracks/[slug]/page";

/**
 * Detail page rendering test.
 *
 * The composition root is mocked, so the page is exercised without a database
 * while still consuming the real facade view shape.
 */
class NotFoundSignal extends Error {}

const findDetailBySlug =
  vi.fn<(slug: string) => Promise<CertificationDetailView | null>>();

const countBank =
  vi.fn<
    (
      certificationId: string,
    ) => Promise<{ readonly total: number; readonly active: number }>
  >();

vi.mock("@/modules/certifications/composition", () => ({
  getCertificationFacade: () => ({ findDetailBySlug }),
}));

const countCards = vi.fn<
  (certificationId: string) => Promise<{
    readonly total: number;
    readonly active: number;
    readonly due: number;
  }>
>();

vi.mock("@/modules/question-bank/composition", () => ({
  getQuestionBankFacade: () => ({ countBank }),
}));

vi.mock("@/modules/flashcards/composition", () => ({
  getFlashcardFacade: () => ({ countBank: countCards }),
}));

vi.mock("next/navigation", () => ({
  notFound: (): never => {
    throw new NotFoundSignal("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/modules/certifications/ui/actions", () => ({
  archiveCertificationAction: vi.fn(),
  restoreCertificationAction: vi.fn(),
  archiveObjectiveAction: vi.fn(),
  restoreObjectiveAction: vi.fn(),
  moveObjectiveAction: vi.fn(),
}));

const OBJECTIVES = [
  objectiveFixture({
    id: "objective-1",
    code: "Domain 1",
    title: "Everyday vocabulary",
    displayOrder: 1,
  }),
  objectiveFixture({
    id: "objective-2",
    parentObjectiveId: "objective-1",
    code: "Task 1.1",
    title: "Demo unit 1",
    displayOrder: 1,
  }),
];

function stubDetail(view: Partial<CertificationDetailView> = {}): void {
  findDetailBySlug.mockResolvedValue({
    objectiveTree: buildObjectiveTree(OBJECTIVES),
    activeObjectiveCount: OBJECTIVES.length,
    archivedObjectiveCount: 0,
    ...view,
    certification: view.certification ?? certificationFixture(),
  });
}

async function renderTrackPage(slug: string): Promise<void> {
  render(await StudyTrackPage({ params: Promise.resolve({ slug }) }));
}

describe("Study-track detail page", () => {
  beforeEach(() => {
    findDetailBySlug.mockReset();
    countBank.mockReset();
    countBank.mockResolvedValue({ total: 0, active: 0 });
    countCards.mockReset();
    countCards.mockResolvedValue({ total: 0, active: 0, due: 0 });
  });

  it("renders the track name and metadata", async () => {
    stubDetail({
      certification: certificationFixture({
        name: "Demo Cloud Practitioner",
        provider: "Demo Provider",
        examCode: "DEMO-001",
      }),
    });

    await renderTrackPage("demo-cloud-practitioner");

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Demo Cloud Practitioner",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Demo Provider")).toBeVisible();
    expect(screen.getByText("Technical certification")).toBeVisible();
    expect(screen.getByText("DEMO-001")).toBeVisible();
  });

  it("labels seeded content as demo", async () => {
    stubDetail({ certification: certificationFixture({ origin: "DEMO" }) });

    await renderTrackPage("demo-cloud-practitioner");

    expect(screen.getByText("Demo")).toBeVisible();
  });

  it("renders the objective hierarchy", async () => {
    stubDetail();

    await renderTrackPage("demo-cloud-practitioner");

    const child = screen.getByText("Demo unit 1");
    const parentItem = screen.getByText("Everyday vocabulary").closest("li");

    expect(parentItem).not.toBeNull();
    expect(parentItem?.contains(child)).toBe(true);
  });

  it("offers editing, archiving, and objective creation", async () => {
    stubDetail();

    await renderTrackPage("demo-cloud-practitioner");

    expect(screen.getByRole("link", { name: "Edit track" })).toHaveAttribute(
      "href",
      "/study-tracks/demo-cloud-practitioner/edit",
    );
    expect(
      screen.getByRole("button", { name: "Archive track" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Add root objective" }),
    ).toHaveAttribute(
      "href",
      "/study-tracks/demo-cloud-practitioner/objectives/new",
    );
  });

  it("offers restore instead of archive for an archived track", async () => {
    stubDetail({
      certification: certificationFixture({ status: "ARCHIVED" }),
    });

    await renderTrackPage("demo-cloud-practitioner");

    expect(screen.getByText("Archived")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Restore track" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive track" })).toBeNull();
  });

  it("offers a working return link to the dashboard", async () => {
    stubDetail();

    await renderTrackPage("demo-cloud-practitioner");

    expect(
      screen.getByRole("link", { name: "Back to study tracks" }),
    ).toHaveAttribute("href", "/");
  });

  it("links to the question bank for this track", async () => {
    stubDetail();
    countBank.mockResolvedValue({ total: 7, active: 4 });

    await renderTrackPage("demo-cloud-practitioner");

    expect(
      screen.getByRole("link", { name: "Open question bank" }),
    ).toHaveAttribute(
      "href",
      "/study-tracks/demo-cloud-practitioner/questions",
    );
    expect(screen.getByText("4 active of 7 questions.")).toBeVisible();
  });

  it("invites the owner to start the bank when it is empty", async () => {
    stubDetail();
    countBank.mockResolvedValue({ total: 0, active: 0 });

    await renderTrackPage("demo-cloud-practitioner");

    expect(screen.getByText(/No questions yet/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open question bank" }),
    ).toBeInTheDocument();
  });

  it("links to the flashcards for this track", async () => {
    stubDetail();
    countCards.mockResolvedValue({ total: 9, active: 6, due: 0 });

    await renderTrackPage("demo-cloud-practitioner");

    expect(
      screen.getByRole("link", { name: "Open flashcards" }),
    ).toHaveAttribute(
      "href",
      "/study-tracks/demo-cloud-practitioner/flashcards",
    );
    expect(
      screen.getByText("6 active of 9 cards. Nothing due right now."),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: /^Review/ })).toBeNull();
  });

  it("offers a review call to action only when cards are due", async () => {
    stubDetail();
    countCards.mockResolvedValue({ total: 9, active: 6, due: 3 });

    await renderTrackPage("demo-cloud-practitioner");

    expect(screen.getByRole("link", { name: "Review 3 due" })).toHaveAttribute(
      "href",
      "/study-tracks/demo-cloud-practitioner/review",
    );
    expect(screen.getByText("6 active of 9 cards. 3 due now.")).toBeVisible();
  });

  it("invites the owner to start the flashcards when there are none", async () => {
    stubDetail();

    await renderTrackPage("demo-cloud-practitioner");

    expect(screen.getByText(/No flashcards yet/)).toBeVisible();
  });

  it("triggers the not-found path for an unknown slug", async () => {
    findDetailBySlug.mockResolvedValue(null);

    await expect(
      StudyTrackPage({ params: Promise.resolve({ slug: "no-such-track" }) }),
    ).rejects.toBeInstanceOf(NotFoundSignal);
  });
});
