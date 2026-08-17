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

const countActiveSources =
  vi.fn<(certificationId: string) => Promise<number>>();

vi.mock("@/modules/sources/composition", () => ({
  getSourceFacade: () => ({ countActiveSources }),
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
  archiveAllObjectivesAction: vi.fn(),
  restoreAllObjectivesAction: vi.fn(),
  deleteAllObjectivesAction: vi.fn(),
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
    countActiveSources.mockReset();
    countActiveSources.mockResolvedValue(0);
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

    // The ad-hoc "Back to study tracks" link is now the first breadcrumb. Same destination,
    // shorter label, because a trail reads as a path rather than as an instruction.
    expect(screen.getByRole("link", { name: "Tracks" })).toHaveAttribute(
      "href",
      "/",
    );
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

  it("links to the source library for this track", async () => {
    stubDetail();
    countActiveSources.mockResolvedValue(3);

    await renderTrackPage("demo-cloud-practitioner");

    expect(screen.getByRole("link", { name: "Sources" })).toHaveAttribute(
      "href",
      "/study-tracks/demo-cloud-practitioner/sources",
    );
    expect(screen.getByText("3 active sources.")).toBeVisible();
  });

  it("counts a single source in the singular", async () => {
    stubDetail();
    countActiveSources.mockResolvedValue(1);

    await renderTrackPage("demo-cloud-practitioner");

    expect(screen.getByText("1 active source.")).toBeVisible();
  });

  it("explains what a source is when the library is empty", async () => {
    // The count is zero by default, so this is the first thing the owner reads about
    // the library — the link has to be reachable before there is anything behind it.
    stubDetail();

    await renderTrackPage("demo-cloud-practitioner");

    expect(screen.getByText(/No sources yet/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Sources" })).toBeInTheDocument();
  });

  /**
   * The AI entry points, which differ by how the track is studied.
   *
   * Asserted through the study type only. No test here sets a provider or a name, so a
   * regression that started keying on "HSK" would not be covered by these assertions.
   */
  describe("building study material", () => {
    it("leads a language track with enrichment and drills", async () => {
      stubDetail({
        certification: certificationFixture({
          slug: "demo-hsk-2",
          studyType: "LANGUAGE_PROFICIENCY",
        }),
      });

      await renderTrackPage("demo-hsk-2");

      expect(
        screen.getByRole("heading", { level: 2, name: "Build study material" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Enrich vocabulary with AI" }),
      ).toHaveAttribute("href", "/study-tracks/demo-hsk-2/enrich");
      expect(
        screen.getByRole("link", { name: "Generate drills" }),
      ).toHaveAttribute("href", "/study-tracks/demo-hsk-2/generate");
      expect(screen.getByRole("link", { name: "Past runs" })).toHaveAttribute(
        "href",
        "/study-tracks/demo-hsk-2/generation-runs",
      );
      expect(
        screen.queryByRole("link", { name: "Generate with AI" }),
      ).toBeNull();
    });

    it("keeps a technical certification's single generate entry point", async () => {
      stubDetail();

      await renderTrackPage("demo-cloud-practitioner");

      expect(
        screen.getByRole("heading", { level: 2, name: "Generate with AI" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Generate with AI" }),
      ).toHaveAttribute(
        "href",
        "/study-tracks/demo-cloud-practitioner/generate",
      );
      expect(
        screen.queryByRole("link", { name: "Enrich vocabulary with AI" }),
      ).toBeNull();
      expect(
        screen.queryByRole("link", { name: "Generate drills" }),
      ).toBeNull();
    });

    it("leads a general track with generation, like a certification", async () => {
      stubDetail({
        certification: certificationFixture({ studyType: "GENERAL" }),
      });

      await renderTrackPage("demo-cloud-practitioner");

      expect(
        screen.getByRole("link", { name: "Generate with AI" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Enrich vocabulary with AI" }),
      ).toBeNull();
    });

    it("offers neither on an archived language track", async () => {
      stubDetail({
        certification: certificationFixture({
          studyType: "LANGUAGE_PROFICIENCY",
          status: "ARCHIVED",
        }),
      });

      await renderTrackPage("demo-hsk-2");

      expect(
        screen.queryByRole("heading", {
          level: 2,
          name: "Build study material",
        }),
      ).toBeNull();
      expect(
        screen.queryByRole("link", { name: "Enrich vocabulary with AI" }),
      ).toBeNull();
    });
  });

  /**
   * The whole-outline controls, which are conditional on there being something for
   * each of them to act on. Every assertion here is about what does *not* render,
   * because that is the rule the section exists under: no dead bulk buttons.
   */
  describe("bulk objective actions", () => {
    it("offers archive-all and permanent deletion for a populated outline", async () => {
      stubDetail();

      await renderTrackPage("demo-cloud-practitioner");

      expect(
        screen.getByRole("button", { name: "Archive all 2" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Yes, delete all 2 objectives" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /Delete all 2 objectives permanently\. Questions and cards lose their objective mappings\. This cannot be undone\./,
        ),
      ).toBeInTheDocument();
    });

    it("offers restore-all only when archived objectives exist", async () => {
      stubDetail();

      await renderTrackPage("demo-cloud-practitioner");

      expect(screen.queryByRole("button", { name: /^Restore all/ })).toBeNull();
    });

    it("offers restore-all when some objectives are archived", async () => {
      stubDetail({ activeObjectiveCount: 1, archivedObjectiveCount: 1 });

      await renderTrackPage("demo-cloud-practitioner");

      expect(
        screen.getByRole("button", { name: "Restore all 1 archived" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Archive all 1" }),
      ).toBeInTheDocument();
    });

    it("drops archive-all when every objective is already archived", async () => {
      stubDetail({ activeObjectiveCount: 0, archivedObjectiveCount: 2 });

      await renderTrackPage("demo-cloud-practitioner");

      expect(screen.queryByRole("button", { name: /^Archive all/ })).toBeNull();
      expect(
        screen.getByRole("button", { name: "Restore all 2 archived" }),
      ).toBeInTheDocument();
    });

    it("renders no bulk controls for a track with no objectives", async () => {
      stubDetail({
        objectiveTree: [],
        activeObjectiveCount: 0,
        archivedObjectiveCount: 0,
      });

      await renderTrackPage("demo-cloud-practitioner");

      expect(screen.getByText(/No objectives yet/)).toBeVisible();
      expect(screen.queryByRole("button", { name: /^Archive all/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /^Restore all/ })).toBeNull();
      expect(
        screen.queryByText("Delete all objectives permanently"),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: /^Yes, delete all/ }),
      ).toBeNull();
    });
  });

  it("triggers the not-found path for an unknown slug", async () => {
    findDetailBySlug.mockResolvedValue(null);

    await expect(
      StudyTrackPage({ params: Promise.resolve({ slug: "no-such-track" }) }),
    ).rejects.toBeInstanceOf(NotFoundSignal);
  });
});
