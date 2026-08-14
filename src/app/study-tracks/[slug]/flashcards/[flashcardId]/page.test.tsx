import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { certificationFixture } from "@/modules/certifications/infrastructure/test-support";
import type { FlashcardDetailView } from "@/modules/flashcards/application/flashcard-facade";
import {
  cardRevisionFixture,
  flashcardFixture,
  vocabularyContent,
} from "@/modules/flashcards/infrastructure/test-support";
import type { SpeechClip } from "@/modules/audio/domain/speech-clip";
import FlashcardDetailPage from "@/app/study-tracks/[slug]/flashcards/[flashcardId]/page";

/**
 * The flashcard page, on the one question it now has to answer correctly.
 *
 * This file exists because of a defect the owner hit on first use. `SPEECH_PROVIDER` was
 * unset, so the composed gateway was the placeholder one, which returns valid but *silent*
 * MP3 frames. The card therefore offered pronunciation, accepted the press, stored a clip,
 * and played nothing — indistinguishable from a broken feature.
 *
 * The rule now is that a study surface offers audio only when a real voice is configured,
 * and the case below pins it: with the placeholder provider the vocabulary card page
 * renders no play button at all. The rest of the page's behaviour is covered by the
 * component tests it composes.
 */
class NotFoundSignal extends Error {}

const findDetail =
  vi.fn<(slug: string, id: string) => Promise<FlashcardDetailView | null>>();

vi.mock("@/modules/flashcards/composition", () => ({
  getFlashcardFacade: () => ({ findDetail }),
}));

const findFlashcardClips = vi.fn<() => Promise<readonly SpeechClip[]>>();
const isAudioEnabled = vi.fn<() => boolean>();

vi.mock("@/modules/audio/composition", () => ({
  getAudioFacade: () => ({ findFlashcardClips }),
  isAudioEnabled: () => isAudioEnabled(),
}));

vi.mock("@/modules/audio/ui/actions", () => ({
  playAudioClipAction: vi.fn(),
}));

vi.mock("@/modules/flashcards/ui/actions", () => ({
  linkFlashcardObjectiveAction: vi.fn(),
  unlinkFlashcardObjectiveAction: vi.fn(),
  activateFlashcardAction: vi.fn(),
  retireFlashcardAction: vi.fn(),
  restoreFlashcardAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: (): never => {
    throw new NotFoundSignal("NEXT_NOT_FOUND");
  },
}));

/**
 * The clips a configured install resolves for the vocabulary fixture: the term, and only
 * the term. `flashcardClipRequests` is what makes this a single clip, and
 * `content-clips.test.ts` is what holds it to that; this fixture matches it so the page
 * test renders what the page really receives.
 */
const CLIPS: readonly SpeechClip[] = [
  {
    key: "term",
    label: "Term",
    text: "学习",
    language: "zh",
    assetId: null,
  },
];

function stubVocabularyCard(): void {
  const flashcard = flashcardFixture({ lifecycleStatus: "ACTIVE" });

  findDetail.mockResolvedValue({
    certification: certificationFixture({
      slug: "demo-hsk-1",
      studyType: "LANGUAGE_PROFICIENCY",
    }),
    flashcard,
    currentRevision: cardRevisionFixture({
      content: vocabularyContent(),
      language: "zh",
    }),
    revisions: [cardRevisionFixture({ content: vocabularyContent() })],
    linkedObjectives: [],
    linkableObjectives: [],
    schedule: null,
    reviews: [],
    sourceQuestionId: null,
  });
}

async function renderCardPage(): Promise<void> {
  render(
    await FlashcardDetailPage({
      params: Promise.resolve({
        slug: "demo-hsk-1",
        flashcardId: "flashcard-1",
      }),
    }),
  );
}

describe("Flashcard detail page", () => {
  beforeEach(() => {
    findDetail.mockReset();
    findFlashcardClips.mockReset();
    findFlashcardClips.mockResolvedValue(CLIPS);
    isAudioEnabled.mockReset();
  });

  describe("when a speech provider is configured", () => {
    beforeEach(() => {
      isAudioEnabled.mockReturnValue(true);
    });

    it("offers one press to hear the term", async () => {
      stubVocabularyCard();

      await renderCardPage();

      expect(
        screen.getByRole("button", { name: "Play 学习" }),
      ).toBeInTheDocument();
    });

    it("offers the term and nothing else", async () => {
      // The example sentence gets no control. It is the part of the card that is read
      // rather than learned, and a column of buttons down the answer face invited
      // pressing all of them — at a dozen billed characters each.
      stubVocabularyCard();

      await renderCardPage();

      expect(screen.getAllByRole("button", { name: /^Play / })).toHaveLength(1);
      expect(screen.queryByRole("button", { name: /example/i })).toBeNull();
    });

    it("uses none of the vocabulary of how audio is made", async () => {
      // The owner should never read "generate", "synthesize", "cache", or a provider name
      // on a card they are studying.
      stubVocabularyCard();

      await renderCardPage();

      for (const name of [/generate/i, /synthes/i, /provider/i]) {
        expect(screen.queryByRole("button", { name })).toBeNull();
      }
    });

    it("keeps removal off the card, where a mis-tap would destroy a paid-for clip", async () => {
      stubVocabularyCard();

      await renderCardPage();

      expect(
        screen.queryByRole("button", { name: /remove audio/i }),
      ).toBeNull();
    });
  });

  describe("when no speech provider is configured", () => {
    beforeEach(() => {
      isAudioEnabled.mockReturnValue(false);
    });

    it("renders no play button at all", async () => {
      // The regression guard. The placeholder provider speaks silence, so the feature is
      // invisible until it is configured rather than present and mute.
      stubVocabularyCard();

      await renderCardPage();

      expect(screen.queryByRole("button", { name: /^Play / })).toBeNull();
      expect(document.querySelector("audio")).toBeNull();
    });

    it("shows no Listen section to explain the absence of controls", async () => {
      stubVocabularyCard();

      await renderCardPage();

      expect(screen.queryByRole("heading", { name: "Listen" })).toBeNull();
    });

    it("does not read the audio cache, so nothing is looked up that cannot be played", async () => {
      stubVocabularyCard();

      await renderCardPage();

      expect(findFlashcardClips).not.toHaveBeenCalled();
    });
  });
});
