import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CertificationListView } from "@/modules/certifications/application/certification-facade";
import { certificationFixture } from "@/modules/certifications/infrastructure/test-support";
import HomePage from "@/app/page";

/**
 * Dashboard rendering test.
 *
 * The page is a Server Component that reads through the composition root. The
 * composition root is mocked so the test never opens a database, while the page
 * still exercises the same facade view shape that production uses.
 */
const listCertifications = vi.fn<() => Promise<CertificationListView>>();
const findInProgressId = vi.fn<() => Promise<string | null>>();

vi.mock("@/modules/certifications/composition", () => ({
  getCertificationFacade: () => ({ listCertifications }),
}));

// D5: the dashboard leads with studying, so it reads the study module too. Both
// composition roots are `server-only`, so both are mocked and the page still
// exercises the real facade view shapes.
vi.mock("@/modules/study-sessions/composition", () => ({
  getStudyFacade: () => ({ findInProgressId }),
}));

// The archived card posts to a Server Action; the action itself is covered by the
// facade tests.
vi.mock("@/modules/certifications/ui/actions", () => ({
  restoreCertificationAction: vi.fn(),
  deleteCertificationAction: vi.fn(),
}));

const ACTIVE_TRACK = certificationFixture({
  id: "certification-1",
  slug: "demo-cloud-practitioner",
  name: "Demo Cloud Practitioner",
  provider: "Demo Provider",
});

const ARCHIVED_TRACK = certificationFixture({
  id: "certification-2",
  slug: "retired-track",
  name: "Retired Track",
  status: "ARCHIVED",
});

function stubView(view: Partial<CertificationListView>): void {
  listCertifications.mockResolvedValue({
    active: [],
    archived: [],
    archivedCount: 0,
    ...view,
  });
}

async function renderHomePage(
  searchParams: Record<string, string> = {},
): Promise<void> {
  render(await HomePage({ searchParams: Promise.resolve(searchParams) }));
}

describe("Home page", () => {
  beforeEach(() => {
    listCertifications.mockReset();
    findInProgressId.mockReset();
    findInProgressId.mockResolvedValue(null);
  });

  it("renders the StudyBench identity and tagline", async () => {
    stubView({});

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
    stubView({});

    await renderHomePage();

    expect(screen.getByText(/personal, single-user workbench/i)).toBeVisible();
  });

  it("offers a link to create a study track", async () => {
    stubView({});

    await renderHomePage();

    expect(
      screen.getByRole("link", { name: "New study track" }),
    ).toHaveAttribute("href", "/study-tracks/new");
  });

  it("explains the empty state and names the seed command", async () => {
    stubView({});

    await renderHomePage();

    expect(screen.getByText(/no study tracks yet/i)).toBeVisible();
    expect(screen.getByText("npm run seed")).toBeVisible();
  });

  it("lists each active track with a working detail link", async () => {
    stubView({ active: [ACTIVE_TRACK] });

    await renderHomePage();

    expect(
      screen.getByRole("link", { name: "Demo Cloud Practitioner" }),
    ).toHaveAttribute("href", "/study-tracks/demo-cloud-practitioner");
    expect(screen.getByText("Demo Provider")).toBeVisible();
  });

  it("claims no study progress", async () => {
    stubView({ active: [ACTIVE_TRACK] });

    await renderHomePage();

    expect(screen.queryByText(/complete/i)).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("hides archived tracks by default and offers to reveal them", async () => {
    stubView({ active: [ACTIVE_TRACK], archivedCount: 1 });

    await renderHomePage();

    expect(screen.queryByText("Retired Track")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Show archived tracks (1)" }),
    ).toHaveAttribute("href", "/?archived=1");
  });

  it("shows archived tracks with restore when asked", async () => {
    stubView({
      active: [ACTIVE_TRACK],
      archived: [ARCHIVED_TRACK],
      archivedCount: 1,
    });

    await renderHomePage({ archived: "1" });

    expect(screen.getByText("Retired Track")).toBeVisible();
    expect(screen.getByText("Archived")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Restore Retired Track" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Hide archived tracks" }),
    ).toHaveAttribute("href", "/");
  });

  it("labels seeded content as demo", async () => {
    stubView({
      active: [certificationFixture({ id: "seeded", origin: "DEMO" })],
    });

    await renderHomePage();

    expect(screen.getByText("Demo")).toBeVisible();
  });

  it("omits the archived affordance when nothing is archived", async () => {
    stubView({ active: [ACTIVE_TRACK] });

    await renderHomePage();

    expect(screen.queryByRole("link", { name: /archived/i })).toBeNull();
  });

  describe("studying", () => {
    it("leads with starting a session, above the track list", async () => {
      stubView({ active: [ACTIVE_TRACK] });

      await renderHomePage();

      // Studying is the product's primary action; managing the bank is secondary
      // (`spec/UI-GUIDELINES.md` section 1.2).
      expect(
        screen.getByRole("link", { name: /start 10-minute session/i }),
      ).toHaveAttribute("href", "/study/new");
      expect(screen.getByRole("link", { name: "Progress" })).toHaveAttribute(
        "href",
        "/progress",
      );
    });

    it("offers to resume the session already running", async () => {
      stubView({ active: [ACTIVE_TRACK] });
      findInProgressId.mockResolvedValue("session-7");

      await renderHomePage();

      // Resuming rather than re-choosing a mode: the owner already made that
      // decision (`SPEC.md` section 6.6).
      expect(
        screen.getByRole("link", { name: /resume your session/i }),
      ).toHaveAttribute("href", "/study/sessions/session-7");
      expect(
        screen.queryByRole("link", { name: /start 10-minute session/i }),
      ).toBeNull();
      expect(
        screen.getByRole("link", { name: /start a different session/i }),
      ).toHaveAttribute("href", "/study/new");
    });
  });
});
