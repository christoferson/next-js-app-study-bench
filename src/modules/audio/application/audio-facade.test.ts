import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "@/platform/hash";
import type { SqliteDatabase } from "@/platform/database/sqlite";
import {
  createMigratedDatabase,
  FixedClock,
  SequentialIdGenerator,
} from "@/modules/certifications/infrastructure/test-support";
import {
  basicContent,
  vocabularyContent,
} from "@/modules/flashcards/infrastructure/test-support";
import {
  AudioAssetNotFoundError,
  SpeechTextNotSpeakableError,
} from "@/modules/audio/domain/errors";
import { objectKeyForCacheKey } from "@/modules/audio/domain/media-asset";
import type { SpeechClipRequest } from "@/modules/audio/domain/speech-clip";
import {
  canonicalSpeechRequest,
  MAX_SPEECH_TEXT_LENGTH,
} from "@/modules/audio/domain/speech-request";
import type { VoiceSettings } from "@/modules/audio/domain/voice-settings";
import { FakeSpeechSynthesisGateway } from "@/modules/audio/infrastructure/fake-speech-synthesis-gateway";
import { SqliteMediaAssetRepository } from "@/modules/audio/infrastructure/sqlite-media-asset-repository";
import { InMemoryObjectStorage } from "@/modules/audio/infrastructure/test-support";
import { AudioFacade } from "./audio-facade";

/**
 * The audio facade.
 *
 * The cache assertions are this milestone's acceptance criterion: an identical
 * request must not reach the provider a second time. They are stated in terms of the
 * gateway's own call count, so they measure what would actually be billed rather
 * than what the facade reports about itself.
 *
 * Every case uses the fake gateway and an in-memory store, so nothing here calls AWS
 * or touches `./data`.
 */

const VOICES: VoiceSettings = {
  voiceIdZh: "Zhiyu",
  voiceIdEn: "Joanna",
  engine: "neural",
};

const NOW = "2026-06-01T12:00:00.000Z";

interface Subject {
  readonly facade: AudioFacade;
  readonly gateway: FakeSpeechSynthesisGateway;
  readonly storage: InMemoryObjectStorage;
  readonly database: SqliteDatabase;
  readonly clock: FixedClock;
}

function createSubject(voices: VoiceSettings = VOICES): Subject {
  const database = createMigratedDatabase();
  const gateway = new FakeSpeechSynthesisGateway();
  const storage = new InMemoryObjectStorage();
  const clock = new FixedClock(NOW);

  return {
    facade: new AudioFacade({
      assets: new SqliteMediaAssetRepository(database),
      storage,
      gateway,
      voices,
      clock,
      ids: new SequentialIdGenerator("asset"),
    }),
    gateway,
    storage,
    database,
    clock,
  };
}

describe("AudioFacade", () => {
  let subject: Subject;

  beforeEach(() => {
    subject = createSubject();
  });

  describe("synthesize", () => {
    it("produces a playable asset from a vocabulary term", async () => {
      const outcome = await subject.facade.synthesize({
        text: "学习",
        language: "zh",
      });

      expect(outcome.cached).toBe(false);
      expect(outcome.asset).toMatchObject({
        id: "asset-1",
        contentType: "audio/mpeg",
        voiceId: "Zhiyu",
        engine: "neural",
        language: "zh",
        speechRate: "medium",
        createdAt: NOW,
      });
      expect(outcome.asset.byteSize).toBeGreaterThan(0);
    });

    it("stores the bytes under the key the row names", async () => {
      const { asset } = await subject.facade.synthesize({
        text: "学习",
        language: "zh",
      });

      await expect(
        subject.storage.get(asset.objectKey),
      ).resolves.not.toBeNull();
      expect(asset.objectKey).toBe(objectKeyForCacheKey(asset.cacheKey));
    });

    it("records the byte length that was actually stored", async () => {
      // A mismatch here would make the playback route's Content-Length a lie.
      const { asset } = await subject.facade.synthesize({
        text: "学习",
        language: "zh",
      });
      const bytes = await subject.storage.get(asset.objectKey);

      expect(asset.byteSize).toBe(bytes?.length);
    });

    it("does not measure a duration", async () => {
      // `SynthesizeSpeech` does not report one, and guessing would be worse than
      // saying nothing.
      const { asset } = await subject.facade.synthesize({
        text: "学习",
        language: "zh",
      });

      expect(asset.durationSeconds).toBeNull();
    });

    it("uses the configured voice for the content's language", async () => {
      const chinese = await subject.facade.synthesize({
        text: "学习",
        language: "zh",
      });
      const english = await subject.facade.synthesize({
        text: "Which service stores objects?",
        language: "en",
      });

      expect(chinese.asset.voiceId).toBe("Zhiyu");
      expect(english.asset.voiceId).toBe("Joanna");
    });

    it("passes a configured voice and engine through to the provider", async () => {
      const configured = createSubject({
        voiceIdZh: "Zhiyu",
        voiceIdEn: "Amy",
        engine: "standard",
      });

      await configured.facade.synthesize({ text: "Hello", language: "en" });

      expect(configured.gateway.requests[0]).toMatchObject({
        voiceId: "Amy",
        engine: "standard",
      });
    });

    it("speaks at the requested rate", async () => {
      const { asset } = await subject.facade.synthesize({
        text: "学习",
        language: "zh",
        rate: "slow",
      });

      expect(asset.speechRate).toBe("slow");
      expect(subject.gateway.requests[0]).toMatchObject({ rate: "slow" });
    });

    describe("the cache", () => {
      it("calls the provider once for two identical requests", async () => {
        // The acceptance criterion.
        const first = await subject.facade.synthesize({
          text: "学习",
          language: "zh",
        });
        const second = await subject.facade.synthesize({
          text: "学习",
          language: "zh",
        });

        expect(subject.gateway.callCount).toBe(1);
        expect(second.cached).toBe(true);
        expect(second.asset).toEqual(first.asset);
      });

      it("stores one row and one object for a repeated request", async () => {
        await subject.facade.synthesize({ text: "学习", language: "zh" });
        await subject.facade.synthesize({ text: "学习", language: "zh" });

        const library = await subject.facade.findLibrary();

        expect(library.totalCount).toBe(1);
        expect(subject.storage.size).toBe(1);
        // And the bytes were not re-uploaded.
        expect(subject.storage.writes).toHaveLength(1);
      });

      it("treats whitespace-equivalent text as the same request", async () => {
        await subject.facade.synthesize({ text: "学习", language: "zh" });
        const repeat = await subject.facade.synthesize({
          text: "  学习\n",
          language: "zh",
        });

        expect(repeat.cached).toBe(true);
        expect(subject.gateway.callCount).toBe(1);
      });

      it.each([
        ["different text", { text: "学生", language: "zh" as const }],
        ["a different language", { text: "学习", language: "en" as const }],
        [
          "a different rate",
          { text: "学习", language: "zh" as const, rate: "slow" as const },
        ],
      ])("calls the provider again for %s", async (_label, input) => {
        await subject.facade.synthesize({ text: "学习", language: "zh" });
        const second = await subject.facade.synthesize(input);

        expect(second.cached).toBe(false);
        expect(subject.gateway.callCount).toBe(2);
      });

      it("calls the provider again when the configured voice changes", async () => {
        // A re-recorded clip in a new voice is genuinely different audio, so it must
        // not be served from the old key.
        const original = createSubject();

        await original.facade.synthesize({ text: "Hello", language: "en" });

        const reconfigured = new AudioFacade({
          assets: new SqliteMediaAssetRepository(original.database),
          storage: original.storage,
          gateway: original.gateway,
          voices: { ...VOICES, voiceIdEn: "Matthew" },
          clock: original.clock,
          ids: new SequentialIdGenerator("second"),
        });

        const outcome = await reconfigured.synthesize({
          text: "Hello",
          language: "en",
        });

        expect(outcome.cached).toBe(false);
        expect(outcome.asset.voiceId).toBe("Matthew");
        expect(original.gateway.callCount).toBe(2);
      });

      it("calls the provider again when the provider itself changes", async () => {
        // The one that bit during manual verification. A clip generated with
        // `SPEECH_PROVIDER=fake` was a permanent cache hit after switching to
        // `polly`, so the owner would hear a placeholder tone for the word they were
        // trying to learn, with no way out but deleting every clip by hand.
        const original = createSubject();

        await original.facade.synthesize({ text: "学习", language: "zh" });

        const switched = new AudioFacade({
          assets: new SqliteMediaAssetRepository(original.database),
          storage: original.storage,
          // A differently named gateway stands in for the real one: the facade reads
          // the provider name off the port, so nothing here needs Polly.
          gateway: Object.assign(new FakeSpeechSynthesisGateway(), {
            provider: "polly",
          }),
          voices: VOICES,
          clock: original.clock,
          ids: new SequentialIdGenerator("second"),
        });

        const outcome = await switched.synthesize({
          text: "学习",
          language: "zh",
        });

        expect(outcome.cached).toBe(false);
        // Two rows for one phrase, which is correct: they are different audio.
        await expect(switched.findLibrary()).resolves.toMatchObject({
          totalCount: 2,
        });
      });

      it("uses the cache key the domain defines", async () => {
        // Asserted against the domain function rather than a copied literal, so the
        // facade cannot drift into its own key format.
        const { asset } = await subject.facade.synthesize({
          text: "学习",
          language: "zh",
        });

        expect(asset.cacheKey).toBe(
          sha256Hex(
            canonicalSpeechRequest(
              {
                text: "学习",
                language: "zh",
                voiceId: "Zhiyu",
                engine: "neural",
                rate: "medium",
              },
              // The gateway under test is the fake one, and the provider is part of
              // the key: see `canonicalSpeechRequest`.
              "fake",
            ),
          ),
        );
      });
    });

    describe("refusing to speak", () => {
      it.each(["", "   ", "\n\t"])(
        "refuses %j without calling the provider",
        async (text) => {
          await expect(
            subject.facade.synthesize({ text, language: "zh" }),
          ).rejects.toBeInstanceOf(SpeechTextNotSpeakableError);

          expect(subject.gateway.callCount).toBe(0);
        },
      );

      it("refuses text past the length limit without calling the provider", async () => {
        // Polly bills the whole request, so a too-long one is caught before it is
        // sent rather than after.
        await expect(
          subject.facade.synthesize({
            text: "a".repeat(MAX_SPEECH_TEXT_LENGTH + 1),
            language: "en",
          }),
        ).rejects.toBeInstanceOf(SpeechTextNotSpeakableError);

        expect(subject.gateway.callCount).toBe(0);
      });

      it("says how long the text was and what the limit is", async () => {
        await expect(
          subject.facade.synthesize({ text: "a".repeat(2000), language: "en" }),
        ).rejects.toThrow(/2000 characters.*up to 1500/);
      });
    });
  });

  describe("findCached", () => {
    it("reports nothing before anything is synthesized", async () => {
      await expect(
        subject.facade.findCached({ text: "学习", language: "zh" }),
      ).resolves.toBeNull();
    });

    it("never calls the provider", async () => {
      // A server-rendered read must not be able to spend money, however many times
      // the page is refreshed.
      await subject.facade.findCached({ text: "学习", language: "zh" });
      await subject.facade.findCached({ text: "学习", language: "zh" });

      expect(subject.gateway.callCount).toBe(0);
    });

    it("finds the asset a synthesis produced", async () => {
      const { asset } = await subject.facade.synthesize({
        text: "学习",
        language: "zh",
      });

      await expect(
        subject.facade.findCached({ text: "学习", language: "zh" }),
      ).resolves.toEqual(asset);
    });

    it("agrees with synthesize about which requests match", async () => {
      await subject.facade.synthesize({ text: "学习", language: "zh" });

      await expect(
        subject.facade.findCached({ text: " 学习 ", language: "zh" }),
      ).resolves.not.toBeNull();
      await expect(
        subject.facade.findCached({ text: "学习", language: "en" }),
      ).resolves.toBeNull();
      await expect(
        subject.facade.findCached({
          text: "学习",
          language: "zh",
          rate: "slow",
        }),
      ).resolves.toBeNull();
    });

    it("reports nothing for text that cannot be spoken", async () => {
      // The card has no term, so the page shows no control rather than an error.
      await expect(
        subject.facade.findCached({ text: "   ", language: "zh" }),
      ).resolves.toBeNull();
    });
  });

  describe("findClips", () => {
    const TERM: SpeechClipRequest = {
      key: "term",
      label: "Term",
      text: "学习",
      language: "zh",
    };
    // `findClips` is generic over whatever a caller hands it, and it resolves a batch in
    // one pass. Study surfaces currently pass a single clip each — a card its term, a
    // question its stem — so the two-clip cases below exercise the batching the method
    // promises rather than a page that exists today.
    const OTHER_TERM: SpeechClipRequest = {
      key: "term",
      label: "Term",
      text: "我每天学习汉语。",
      language: "zh",
    };

    it("reports no asset for a page whose audio has never been generated", async () => {
      const clips = await subject.facade.findClips([TERM, OTHER_TERM]);

      expect(clips.map((clip) => clip.assetId)).toEqual([null, null]);
    });

    it("never calls the provider", async () => {
      // The whole reason this is separate from `synthesize`: rendering a card is free,
      // however many clips it has and however often it is refreshed.
      await subject.facade.findClips([TERM, OTHER_TERM]);
      await subject.facade.findClips([TERM, OTHER_TERM]);

      expect(subject.gateway.callCount).toBe(0);
    });

    it("preserves the requests, adding only the asset", async () => {
      const clips = await subject.facade.findClips([TERM]);

      expect(clips).toEqual([{ ...TERM, assetId: null }]);
    });

    it("reports the asset of a clip that has been generated", async () => {
      const { asset } = await subject.facade.synthesize({
        text: "学习",
        language: "zh",
      });

      const clips = await subject.facade.findClips([TERM, OTHER_TERM]);

      expect(clips.map((clip) => clip.assetId)).toEqual([asset.id, null]);
    });

    it("resolves duplicate text once, and points both clips at it", async () => {
      // Two cards sharing a term, resolved in one batch: two controls, one asset — the
      // same thing the cache key guarantees between two pages.
      const { asset } = await subject.facade.synthesize({
        text: "学习",
        language: "zh",
      });

      const clips = await subject.facade.findClips([
        TERM,
        { ...OTHER_TERM, text: "学习" },
      ]);

      expect(clips.map((clip) => clip.assetId)).toEqual([asset.id, asset.id]);
    });

    it("reports no asset for a clip with nothing speakable in it", async () => {
      const clips = await subject.facade.findClips([{ ...TERM, text: "   " }]);

      expect(clips[0]?.assetId).toBeNull();
    });

    it("returns nothing for no requests, without touching the database", async () => {
      await expect(subject.facade.findClips([])).resolves.toEqual([]);
    });

    it("distinguishes a clip by its language, so a voice change is a miss", async () => {
      await subject.facade.synthesize({ text: "学习", language: "zh" });

      const clips = await subject.facade.findClips([
        { ...TERM, language: "en" },
      ]);

      expect(clips[0]?.assetId).toBeNull();
    });

    it("distinguishes a clip by its rate", async () => {
      await subject.facade.synthesize({ text: "学习", language: "zh" });

      const clips = await subject.facade.findClips([{ ...TERM, rate: "slow" }]);

      expect(clips[0]?.assetId).toBeNull();
    });
  });

  describe("findFlashcardClips", () => {
    it("offers a vocabulary card's term in the card's language", async () => {
      const clips = await subject.facade.findFlashcardClips({
        content: vocabularyContent(),
        contentLanguage: "zh",
        studyType: "LANGUAGE_PROFICIENCY",
      });

      expect(clips.map((clip) => clip.text)).toEqual(["学习"]);
      expect(clips.every((clip) => clip.language === "zh")).toBe(true);
    });

    it("falls back to the track's study type when the card records no language", async () => {
      // Older revisions predate the language column being populated, and a language
      // track in this installation is Chinese. Falling back to English would teach the
      // wrong pronunciation, which is the one thing this feature must get right.
      const clips = await subject.facade.findFlashcardClips({
        content: vocabularyContent(),
        contentLanguage: null,
        studyType: "LANGUAGE_PROFICIENCY",
      });

      expect(clips.every((clip) => clip.language === "zh")).toBe(true);
    });

    it("reads an English card inside a language track in English", async () => {
      // The card's own recorded language wins over the track's study type.
      const clips = await subject.facade.findFlashcardClips({
        content: vocabularyContent(),
        contentLanguage: "en",
        studyType: "LANGUAGE_PROFICIENCY",
      });

      expect(clips.every((clip) => clip.language === "en")).toBe(true);
    });

    it("resolves the term against what a synthesis stored for it", async () => {
      const { asset } = await subject.facade.synthesize({
        text: "学习",
        language: "zh",
      });

      const clips = await subject.facade.findFlashcardClips({
        content: vocabularyContent(),
        contentLanguage: "zh",
        studyType: "LANGUAGE_PROFICIENCY",
      });

      expect(clips[0]?.assetId).toBe(asset.id);
    });

    it("offers nothing for a card type whose text is read rather than heard", async () => {
      await expect(
        subject.facade.findFlashcardClips({
          content: basicContent(),
          contentLanguage: "en",
          studyType: "TECHNICAL_CERTIFICATION",
        }),
      ).resolves.toEqual([]);
    });

    it("costs nothing", async () => {
      await subject.facade.findFlashcardClips({
        content: vocabularyContent(),
        contentLanguage: "zh",
        studyType: "LANGUAGE_PROFICIENCY",
      });

      expect(subject.gateway.callCount).toBe(0);
    });
  });

  describe("findFlashcardClipsByCard", () => {
    it("keys each card's clips by its id and skips cards offering none", async () => {
      const clipsByCard = await subject.facade.findFlashcardClipsByCard([
        {
          id: "card-vocab",
          content: vocabularyContent(),
          contentLanguage: "zh",
          studyType: "LANGUAGE_PROFICIENCY",
        },
        {
          id: "card-basic",
          content: basicContent(),
          contentLanguage: "en",
          studyType: "TECHNICAL_CERTIFICATION",
        },
      ]);

      expect(clipsByCard.get("card-vocab")?.map((clip) => clip.text)).toEqual([
        "学习",
      ]);
      // A basic card offers nothing, so a list surface renders no button for it —
      // an absent entry, not an empty array.
      expect(clipsByCard.has("card-basic")).toBe(false);
    });

    it("resolves against the cache and never synthesizes", async () => {
      const { asset } = await subject.facade.synthesize({
        text: "学习",
        language: "zh",
      });
      const callsAfterSetup = subject.gateway.callCount;

      const clipsByCard = await subject.facade.findFlashcardClipsByCard([
        {
          id: "card-a",
          content: vocabularyContent(),
          contentLanguage: "zh",
          studyType: "LANGUAGE_PROFICIENCY",
        },
        // The same term on a second card is the same cache entry: one lookup,
        // both controls pointing at the one asset.
        {
          id: "card-b",
          content: vocabularyContent(),
          contentLanguage: "zh",
          studyType: "LANGUAGE_PROFICIENCY",
        },
      ]);

      expect(clipsByCard.get("card-a")?.[0]?.assetId).toBe(asset.id);
      expect(clipsByCard.get("card-b")?.[0]?.assetId).toBe(asset.id);
      expect(subject.gateway.callCount).toBe(callsAfterSetup);
    });
  });

  describe("findQuestionClips", () => {
    it("offers the stem in the revision's language", async () => {
      const clips = await subject.facade.findQuestionClips({
        revision: { stem: "Which service stores objects?", language: "en" },
        studyType: "TECHNICAL_CERTIFICATION",
      });

      expect(clips).toEqual([
        {
          key: "stem",
          label: "Question",
          text: "Which service stores objects?",
          language: "en",
          assetId: null,
        },
      ]);
    });

    it("falls back to the track's study type for a revision with no language", async () => {
      const clips = await subject.facade.findQuestionClips({
        revision: { stem: "Which service stores objects?", language: null },
        studyType: "TECHNICAL_CERTIFICATION",
      });

      expect(clips[0]?.language).toBe("en");
    });

    it("resolves the stem against what a synthesis stored for it", async () => {
      const { asset } = await subject.facade.synthesize({
        text: "Which service stores objects?",
        language: "en",
      });

      const clips = await subject.facade.findQuestionClips({
        revision: { stem: "Which service stores objects?", language: "en" },
        studyType: "TECHNICAL_CERTIFICATION",
      });

      expect(clips[0]?.assetId).toBe(asset.id);
    });

    it("costs nothing", async () => {
      await subject.facade.findQuestionClips({
        revision: { stem: "Which service stores objects?", language: "en" },
        studyType: "TECHNICAL_CERTIFICATION",
      });

      expect(subject.gateway.callCount).toBe(0);
    });
  });

  describe("readBytes", () => {
    it("returns the asset and its bytes", async () => {
      const { asset } = await subject.facade.synthesize({
        text: "学习",
        language: "zh",
      });

      const read = await subject.facade.readBytes(asset.id);

      expect(read?.asset).toEqual(asset);
      expect(read?.bytes.length).toBe(asset.byteSize);
    });

    it("reports nothing for an unknown identifier", async () => {
      await expect(subject.facade.readBytes("nope")).resolves.toBeNull();
    });

    it("reports nothing when the row's file has gone missing", async () => {
      // A hand-deleted file must be a 404, not a server error.
      const { asset } = await subject.facade.synthesize({
        text: "学习",
        language: "zh",
      });

      subject.storage.forget(asset.objectKey);

      await expect(subject.facade.readBytes(asset.id)).resolves.toBeNull();
    });
  });

  describe("delete", () => {
    it("removes the row and the file", async () => {
      const { asset } = await subject.facade.synthesize({
        text: "学习",
        language: "zh",
      });

      await subject.facade.delete(asset.id);

      await expect(subject.facade.findById(asset.id)).resolves.toBeNull();
      expect(subject.storage.deletes).toEqual([asset.objectKey]);
      expect(subject.storage.size).toBe(0);
    });

    it("lets the owner generate the clip again afterwards", async () => {
      const first = await subject.facade.synthesize({
        text: "学习",
        language: "zh",
      });

      await subject.facade.delete(first.asset.id);

      const second = await subject.facade.synthesize({
        text: "学习",
        language: "zh",
      });

      expect(second.cached).toBe(false);
      expect(subject.gateway.callCount).toBe(2);
      expect(second.asset.cacheKey).toBe(first.asset.cacheKey);
    });

    it("refuses an unknown identifier", async () => {
      await expect(subject.facade.delete("nope")).rejects.toBeInstanceOf(
        AudioAssetNotFoundError,
      );
    });

    it("deletes nothing else", async () => {
      const keep = await subject.facade.synthesize({
        text: "学习",
        language: "zh",
      });
      const drop = await subject.facade.synthesize({
        text: "学生",
        language: "zh",
      });

      await subject.facade.delete(drop.asset.id);

      await expect(
        subject.facade.findById(keep.asset.id),
      ).resolves.not.toBeNull();
      await expect(
        subject.storage.get(keep.asset.objectKey),
      ).resolves.not.toBeNull();
    });
  });

  describe("findLibrary", () => {
    it("is empty before anything is synthesized", async () => {
      await expect(subject.facade.findLibrary()).resolves.toMatchObject({
        assets: [],
        totalCount: 0,
        totalByteSize: 0,
      });
    });

    it("reports the totals and the settings a new clip would use", async () => {
      const first = await subject.facade.synthesize({
        text: "学习",
        language: "zh",
      });
      const second = await subject.facade.synthesize({
        text: "Hello",
        language: "en",
      });

      const library = await subject.facade.findLibrary();

      expect(library.totalCount).toBe(2);
      expect(library.totalByteSize).toBe(
        first.asset.byteSize + second.asset.byteSize,
      );
      expect(library).toMatchObject({
        provider: "fake",
        voiceIdZh: "Zhiyu",
        voiceIdEn: "Joanna",
        engine: "neural",
      });
    });
  });

  it("names the provider it would use", () => {
    expect(subject.facade.provider).toBe("fake");
  });
});
